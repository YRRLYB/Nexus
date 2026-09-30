import type { Client } from 'ssh2';
import type { DiscoveryReport, DiscoverySource, DiscoveredProject } from '../shared/types';
import { executeSSH } from './ssh';

// Fixed read-only commands. Never collect process arguments, environment values or config contents.
// A sentinel lets the parser distinguish bounded output from a complete inventory.
const bounded = (command: string, limit: number) =>
  `out=$(${command}) || exit $?; printf '%s\\n' "$out" | awk 'NR<=${limit} {print} END {if (NR>${limit}) print "__NEXUS_LIMIT__"}'`;
const cronFilter = (system: boolean) =>
  `awk 'function executable(s) {return s ~ /=/ ? "[environment assignment]" : s} !/^[[:space:]]*(#|$)/ && !/^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*[[:space:]]*=/ {if ($1 ~ /^@/) {print $1 " | " ${system ? '$2' : '"current user"'} " | " executable($${system ? 3 : 2})} else if (NF>=${system ? 7 : 6}) {print $1 " " $2 " " $3 " " $4 " " $5 " | " ${system ? '$6' : '"current user"'} " | " executable($${system ? 7 : 6})}}'`;
export const discoveryCommands: Record<DiscoverySource, string> = {
  processes: `export LC_ALL=C
out=$(ps -eo pid=,ppid=,pcpu=,pmem=,comm= --sort=-pcpu) || exit $?
printf '%s\\n' "$out" | head -n 160 | while read -r pid parent cpu mem name; do
  case "$pid" in ''|*[!0-9]*) continue ;; esac
  cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null | tr '\\t\\n' '  ')
  exe=$(readlink "/proc/$pid/exe" 2>/dev/null | tr '\\t\\n' '  ')
  printf '%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n' "$pid" "$parent" "$cpu" "$mem" "$name" "$cwd" "$exe"
done
if [ "$(printf '%s\\n' "$out" | wc -l)" -gt 160 ]; then printf '__NEXUS_LIMIT__\\n'; fi`,
  services: bounded(
    'LC_ALL=C systemctl list-units --type=service --state=running --no-pager --no-legend --plain',
    200,
  ),
  containers: bounded(
    `docker ps --no-trunc --format '{"name":{{json .Names}},"image":{{json .Image}},"state":{{json .Status}},"ports":{{json .Ports}},"project":{{json (.Label "com.docker.compose.project")}}}'`,
    150,
  ),
  ports: bounded('LC_ALL=C ss -lntupH', 250),
  timers: bounded('LC_ALL=C systemctl list-timers --all --no-pager --no-legend --plain', 150),
  cron: `export LC_ALL=C
# Emit only schedule, owner and executable, never command arguments or environment assignments.
out=$(crontab -l 2>&1)
result=$?
if [ "$result" -ne 0 ]; then
  case "$out" in *"no crontab for"*) out='' ;; *) out=''; printf '__NEXUS_LIMIT__\\n' ;; esac
fi
printf '%s\\n' "$out" | ${cronFilter(false)}
for file in /etc/crontab /etc/cron.d/*; do
  [ -f "$file" ] || continue
  if [ ! -r "$file" ]; then printf '__NEXUS_LIMIT__\\n'; continue; fi
  ${cronFilter(true)} "$file"
done`,
};

export interface SourceResult {
  source: DiscoverySource;
  output?: string;
  error?: string;
}
const clean = (value: unknown) =>
  typeof value === 'string'
    ? value
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .trim()
        .slice(0, 1000)
    : '';
const lines = (value = '') =>
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && line !== '__NEXUS_LIMIT__');
const kinds: [RegExp, string][] = [
  [/(?:nginx|caddy|apache|httpd|traefik)/i, '网站 / 反向代理'],
  [/(?:postgres|mysql|mariadb|mongod|redis|valkey|clickhouse)/i, '数据库 / 缓存'],
  [/(?:minecraft|paper-server|bedrock)/i, '游戏服务'],
  [/(?:node|npm|pm2|bun|deno)/i, 'JavaScript 项目'],
  [/(?:python|gunicorn|uvicorn|celery)/i, 'Python 项目'],
  [/(?:java|tomcat)/i, 'Java 项目'],
  [/(?:php|php-fpm)/i, 'PHP 应用'],
  [/(?:xray|v2ray|sing-box|mihomo|frps|frpc)/i, '网络服务'],
  [/(?:stat_client|nezha|komari|prometheus|grafana)/i, '监控服务'],
];
function kind(value: string) {
  return kinds.find(([pattern]) => pattern.test(value))?.[1];
}
function sourceError(error: string) {
  if (/not found|not recognized|No such file/i.test(error)) return '所需工具未安装或不在 PATH 中';
  if (/permission|denied|not permitted/i.test(error)) return '当前 SSH 用户权限不足';
  if (/systemd|bus/i.test(error)) return '此系统未提供可访问的 systemd';
  if (/超时/.test(error)) return '读取超时，其他结果仍可查看';
  if (/上限/.test(error)) return '输出过大，未纳入本次结果';
  return '读取失败，其他结果仍可查看';
}
export const discoveryShellCommand = (command: string) =>
  `sh -c '${command.replaceAll("'", "'\\''")}'`;
export function analyzeDiscovery(results: SourceResult[], now = Date.now()): DiscoveryReport {
  const data = (source: DiscoverySource) =>
    results.find((r) => r.source === source && !r.error)?.output || '';
  const report: DiscoveryReport = {
    scannedAt: now,
    sources: (Object.keys(discoveryCommands) as DiscoverySource[]).map((source) => {
      const result = results.find((r) => r.source === source);
      const limited = result?.output?.includes('__NEXUS_LIMIT__');
      return {
        source,
        status: !result || result.error ? 'unavailable' : limited ? 'limited' : 'ok',
        message: !result
          ? '未采集'
          : result.error
            ? sourceError(result.error)
            : limited
              ? '结果达到上限，或部分条目不可读取'
              : undefined,
      };
    }),
    projects: [],
    processes: [],
    services: [],
    containers: [],
    ports: [],
    timers: [],
    cron: [],
  };
  const malformed = (source: DiscoverySource) => {
    const entry = report.sources.find((item) => item.source === source)!;
    if (entry.status === 'unavailable') return;
    entry.status = 'limited';
    entry.message = '部分输出格式无法识别，结果可能不完整';
  };
  for (const line of data('processes').split(/\r?\n/)) {
    if (!line.trim() || line.trim() === '__NEXUS_LIMIT__') continue;
    const [pid, parent, cpu, memory, name, directory, executable] = line.split('\t');
    if (
      !/^\d+$/.test(pid || '') ||
      !name ||
      !Number.isFinite(Number(cpu)) ||
      !Number.isFinite(Number(memory))
    ) {
      malformed('processes');
      continue;
    }
    report.processes.push({
      pid: Number(pid),
      parentPid: Number(parent),
      cpu: Number(cpu),
      memory: Number(memory),
      name: clean(name),
      directory: clean(directory),
      executable: clean(executable),
    });
  }
  for (const line of lines(data('services'))) {
    const match = line.match(/^([^\s]+\.service)\s+loaded\s+active\s+running\s*(.*)$/);
    if (match) report.services.push({ name: clean(match[1]), description: clean(match[2]) });
    else malformed('services');
  }
  for (const line of lines(data('containers'))) {
    try {
      const raw = JSON.parse(line);
      if (!raw || typeof raw.name !== 'string' || !raw.name) throw new Error('Invalid container');
      report.containers.push({
        name: clean(raw.name),
        image: clean(raw.image),
        state: clean(raw.state),
        ports: clean(raw.ports),
        project: clean(raw.project),
      });
    } catch {
      const source = report.sources.find((s) => s.source === 'containers')!;
      source.status = 'limited';
      source.message = '部分容器信息格式无法识别';
    }
  }
  for (const line of lines(data('ports'))) {
    const fields = line.split(/\s+/);
    if (!['tcp', 'udp'].includes(fields[0]) || fields.length < 6) {
      malformed('ports');
      continue;
    }
    report.ports.push({
      protocol: fields[0].toUpperCase(),
      address: clean(fields[4]),
      pids: [...new Set([...line.matchAll(/pid=(\d+)/g)].map((match) => Number(match[1])))],
    });
  }
  report.timers = lines(data('timers')).map(clean);
  report.cron = lines(data('cron')).map(clean);
  const projects: DiscoveredProject[] = report.containers.map((c) => ({
    name: c.project || c.name,
    kind: kind(`${c.name} ${c.image}`) || '容器应用',
    confidence: 'confirmed',
    evidence: `Docker · ${c.name} · ${c.image}`,
    ports: c.ports,
  }));
  for (const service of report.services) {
    const category = kind(service.name);
    if (category)
      projects.push({
        name: service.name,
        kind: category,
        confidence: 'confirmed',
        evidence: `运行中的系统服务 · ${service.description || service.name}`,
      });
  }
  const seen = new Set<string>();
  for (const process of report.processes) {
    const category = kind(`${process.directory} ${process.name}`);
    const customDir =
      process.directory &&
      !/^\/(?:$|usr(?:\/|$)|etc(?:\/|$)|run(?:\/|$)|var\/lib(?:\/|$))/.test(process.directory);
    if (!category && !customDir) continue;
    if (
      [
        'sh',
        'bash',
        'dash',
        'sshd',
        'readlink',
        'awk',
        'head',
        'ps',
        'tr',
        'systemctl',
        'docker',
        'ss',
      ].includes(process.name)
    )
      continue;
    const key = `${process.name}:${process.directory}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const related = report.processes.filter((p) => `${p.name}:${p.directory}` === key);
    const ports = report.ports.filter((p) =>
      p.pids.some((pid) => related.some((item) => item.pid === pid)),
    );
    projects.push({
      name: customDir ? process.directory.split('/').filter(Boolean).at(-1)! : process.name,
      kind: category || '自定义程序',
      confidence: 'candidate',
      directory: process.directory || undefined,
      evidence: `${process.name} · PID ${related.map((p) => p.pid).join(', ')}${!process.directory ? ' · 工作目录不可读取' : ''}`,
      ports: ports.map((p) => `${p.protocol} ${p.address}`).join(' · '),
    });
  }
  report.projects = projects;
  return report;
}

export async function discoverServer(client: Client): Promise<DiscoveryReport> {
  try {
    const os = await executeSSH(client, 'uname -s', {
      keepOpen: true,
      timeoutMs: 8000,
      maxBytes: 4096,
    });
    if (os.trim() !== 'Linux') throw new Error('运行识别目前支持 Linux 服务器');
    const results = await Promise.all(
      (Object.entries(discoveryCommands) as [DiscoverySource, string][]).map(
        async ([source, command]): Promise<SourceResult> => {
          try {
            const output = await executeSSH(client, discoveryShellCommand(command), {
              keepOpen: true,
              timeoutMs: 12_000,
              maxBytes: 160_000,
            });
            return { source, output };
          } catch (error) {
            return { source, error: error instanceof Error ? error.message : String(error) };
          }
        },
      ),
    );
    if (results.every((r) => r.error))
      throw new Error('未能读取运行信息，请检查 SSH 权限与系统工具后重试');
    return analyzeDiscovery(results);
  } finally {
    client.end();
  }
}

/** Per-session cache: concurrent requests share a scan; credential/config changes invalidate it. */
export class DiscoveryCache {
  private entries = new Map<
    string,
    { key: string; result?: DiscoveryReport; flight?: Promise<DiscoveryReport> }
  >();
  invalidate(id: string) {
    this.entries.delete(id);
  }
  get(id: string, key: string, refresh: boolean, scan: () => Promise<DiscoveryReport>) {
    const previous = this.entries.get(id);
    if (previous?.key === key) {
      if (previous.flight) return previous.flight;
      if (!refresh && previous.result && Date.now() - previous.result.scannedAt < 5 * 60_000)
        return Promise.resolve(previous.result);
    }
    const entry: { key: string; result?: DiscoveryReport; flight?: Promise<DiscoveryReport> } = {
      key,
    };
    this.entries.set(id, entry);
    entry.flight = scan()
      .then((result) => {
        entry.result = result;
        return result;
      })
      .finally(() => {
        entry.flight = undefined;
      });
    return entry.flight;
  }
}
