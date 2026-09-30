import { createHash, randomUUID } from 'node:crypto';
import type { Client, SFTPWrapper } from 'ssh2';
import { z } from 'zod';
import type {
  DeploymentCheck,
  DeploymentPlan,
  InstallTool,
  ProbeInstallOptions,
} from '../shared/types';
import { executeSSH } from './ssh';
import { Sessions } from './sessions';

export const installerSources = {
  docker: 'https://get.docker.com',
  baota: 'https://download.bt.cn/install/installStable_12.sh',
  probe: 'bundled:scripts/probe/install.sh (ServerStatus-Rust v1.8.1)',
};
export const toolNames = { docker: 'Docker', baota: '宝塔面板', probe: 'ServerStatus 探针' };
export const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
export const PREFLIGHT_COMMAND = `sh -c ${shellQuote(`
set -eu
system=$(uname -s)
distribution=unknown
version=unknown
if [ "$system" = Linux ] && [ -r /etc/os-release ]; then
  . /etc/os-release
  distribution=$ID
  version=\${VERSION_ID:-unknown}
fi
printf '__NEXUS_CHECK__\\n'
printf 'system=%s\\ndistribution=%s\\nversion=%s\\narchitecture=%s\\nuser=%s\\nuid=%s\\n' "$system" "$distribution" "$version" "$(uname -m)" "$(id -un)" "$(id -u)"
for name in sudo bash curl unzip sha256sum systemctl docker; do
  if command -v "$name" >/dev/null 2>&1; then printf '%s=1\\n' "$name"; else printf '%s=0\\n' "$name"; fi
done
if [ -d /run/systemd/system ]; then echo systemd=1; else echo systemd=0; fi
if [ -e /www/server/panel ]; then echo baota=1; else echo baota=0; fi
if [ -e /etc/nexus-probe.env ] || [ -e /opt/nexus-probe/stat_client ]; then echo probe=1; else echo probe=0; fi
if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet stat_client.service; then echo otherProbe=1; else echo otherProbe=0; fi
`)}`;

export function parsePreflight(output: string, tool: InstallTool): DeploymentCheck {
  const section = output.split('__NEXUS_CHECK__\n')[1];
  if (!section) throw new Error('无法识别服务器环境，未执行安装');
  const fields = Object.fromEntries(
    section
      .trim()
      .split(/\r?\n/)
      .map((line) => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
  for (const key of ['system', 'distribution', 'version', 'architecture', 'user', 'uid'])
    if (!fields[key]) throw new Error('环境检查结果不完整');
  const blockers: string[] = [];
  if (fields.system !== 'Linux') blockers.push('自动部署仅支持 Linux');
  if (fields.uid !== '0' && fields.sudo !== '1')
    blockers.push('需要 root 或 sudo；当前用户没有可用的 sudo');
  if (fields.bash !== '1') blockers.push('服务器需要安装 bash');
  if (fields[tool] === '1') blockers.push(`${toolNames[tool]} 已安装，本入口不覆盖或升级现有安装`);
  if (tool === 'docker') {
    if (
      !['debian', 'ubuntu', 'fedora', 'centos', 'rhel', 'rocky', 'almalinux'].includes(
        fields.distribution,
      )
    )
      blockers.push('当前发行版不在此 Docker 安装入口的支持范围内');
    if (!['x86_64', 'aarch64', 'armv7l'].includes(fields.architecture))
      blockers.push('不支持此 CPU 架构');
  } else if (tool === 'baota') {
    if (!['debian', 'ubuntu', 'centos', 'rocky', 'almalinux'].includes(fields.distribution))
      blockers.push('当前发行版不在此宝塔安装入口的支持范围内');
    if (!['x86_64', 'aarch64'].includes(fields.architecture))
      blockers.push('宝塔部署入口仅支持 x86_64 / ARM64');
    if (
      (fields.distribution === 'debian' &&
        (!/^\d+(?:\.\d+)*$/.test(fields.version) || Number(fields.version.split('.')[0]) < 11)) ||
      (fields.distribution === 'ubuntu' && !['20.04', '22.04', '24.04'].includes(fields.version))
    )
      blockers.push('请选择 Debian 11 及以上，或 Ubuntu 20.04 / 22.04 / 24.04 LTS');
  } else {
    if (!['x86_64', 'aarch64', 'armv7l'].includes(fields.architecture))
      blockers.push('探针不支持此 CPU 架构');
    if (fields.systemd !== '1') blockers.push('探针自动安装需要运行中的 systemd');
    for (const dependency of ['curl', 'unzip', 'sha256sum', 'systemctl'])
      if (fields[dependency] !== '1') blockers.push(`缺少依赖：${dependency}`);
    if (fields.otherProbe === '1') blockers.push('stat_client.service 正在运行，请复用已有探针');
  }
  return {
    system: fields.system,
    distribution: fields.distribution,
    version: fields.version,
    architecture: fields.architecture,
    user: fields.user,
    root: fields.uid === '0',
    sudo: fields.sudo === '1',
    systemd: fields.systemd === '1',
    installed: fields[tool] === '1',
    blockers,
  };
}
export async function fetchInstaller(tool: 'docker' | 'baota', request: typeof fetch = fetch) {
  const response = await request(installerSources[tool], {
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok || !response.body)
    throw new Error(`下载安装脚本失败（HTTP ${response.status}）`);
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 1024 * 1024) throw new Error('安装脚本超过 1 MB，已拒绝');
      parts.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const script = Buffer.concat(parts).toString('utf8');
  if (!/^#![^\n]*(?:sh|bash)/.test(script) || script.includes('\0'))
    throw new Error('下载内容不是有效的安装脚本，未执行');
  return script;
}
const parameter = z
  .string()
  .trim()
  .min(1)
  .max(1024)
  .regex(/^[^\x00-\x1f\x7f]+$/);
export const probeInstallSchema = z
  .object({
    server: parameter.url().refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        !url.hash &&
        !url.search &&
        url.pathname.endsWith('/report')
      );
    }, '填写不含账号密码的 HTTPS /report 地址'),
    group: parameter.max(128),
    alias: parameter.max(128),
    location: parameter.max(32),
  })
  .strict();
export function deploymentCommand(
  tool: InstallTool,
  directory: string,
  check: DeploymentCheck,
  options?: ProbeInstallOptions,
) {
  if (!/^\/tmp\/nexus-deploy\.[a-zA-Z0-9]+$/.test(directory)) throw new Error('远程临时目录无效');
  let args = '';
  if (tool === 'probe') {
    const input = probeInstallSchema.parse(options);
    args = ` --yes --server ${shellQuote(input.server)} --group ${shellQuote(input.group)} --alias ${shellQuote(input.alias)} --location ${shellQuote(input.location)}`;
  }
  const script = `${directory}/installer.sh`;
  const body = `bash ${shellQuote(script)}${args}; result=$?; if [ "$result" -ne 0 ]; then exit "$result"; fi; printf '\\n[Nexus] Checking installation...\\n'; ${verificationCommands[tool]}; result=$?; if [ "$result" -ne 0 ]; then echo '[Nexus] Verification failed' >&2; fi; exit "$result"`;
  const command = `${check.root ? '' : "sudo -p '[sudo] password: ' -- "}bash -c ${shellQuote(body)}`;
  return `sh -c ${shellQuote(`cd ${shellQuote(directory)} || exit 1; trap 'rm -f -- installer.sh; cd /; rmdir -- ${directory} 2>/dev/null || true' EXIT; ${command}; result=$?; exit "$result"`)}`;
}
export const verificationCommands = {
  docker: 'docker version --format "{{.Server.Version}}"',
  baota:
    'panel=/www/server/panel; executable=BT-Panel; test -s "$panel/$executable" && test -s "$panel/data/port.pl" && pgrep -f "$panel/[B]T-Panel" >/dev/null',
  probe:
    'systemctl is-active --quiet nexus-probe.service && systemctl is-enabled --quiet nexus-probe.service',
};
interface StoredPlan {
  plan: DeploymentPlan;
  identity: string;
}
export function stageInstaller(
  client: Client,
  directory: string,
  script: string,
  timeoutMs = 30_000,
) {
  return new Promise<void>((resolve, reject) => {
    let finished = false;
    let sftp: SFTPWrapper | undefined;
    const closed = () => finish(new Error('上传安装脚本时连接中断'));
    const finish = (error?: Error | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      client.removeListener('close', closed);
      client.removeListener('error', finish);
      sftp?.end();
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => finish(new Error('上传安装脚本超时')), timeoutMs);
    client.once('close', closed);
    client.once('error', finish);
    client.sftp((error, channel) => {
      if (finished) {
        channel?.end();
        return;
      }
      if (error) return finish(error);
      sftp = channel;
      channel.once('error', finish);
      channel.writeFile(`${directory}/installer.sh`, script, { mode: 0o600 }, finish);
    });
  });
}
export class Deployments {
  private plans = new Map<string, StoredPlan>();
  private active = new Set<string>();
  constructor(
    private connect: (id: string) => Promise<Client>,
    private identity: (id: string) => string,
    private sessions: Sessions,
    private load: (tool: InstallTool) => Promise<string>,
  ) {}
  async prepare(deviceId: string, tool: InstallTool): Promise<DeploymentPlan> {
    for (const [id, stored] of this.plans)
      if (stored.plan.expiresAt <= Date.now() || stored.plan.deviceId === deviceId)
        this.plans.delete(id);
    if (this.plans.size >= 32) throw new Error('待确认部署过多，请稍后重试');
    if (this.active.has(deviceId)) throw new Error('该设备已有安装任务，请等待其完成');
    const identity = this.identity(deviceId);
    const check = parsePreflight(
      await executeSSH(await this.connect(deviceId), PREFLIGHT_COMMAND),
      tool,
    );
    const script = check.blockers.length ? '' : await this.load(tool);
    const plan: DeploymentPlan = {
      id: randomUUID(),
      deviceId,
      tool,
      check,
      script,
      source: installerSources[tool],
      sha256: createHash('sha256').update(script).digest('hex'),
      expiresAt: Date.now() + 5 * 60_000,
    };
    this.plans.set(plan.id, { plan, identity });
    return structuredClone(plan);
  }
  get(id: string) {
    const stored = this.plans.get(id);
    if (!stored || stored.plan.expiresAt <= Date.now())
      throw new Error('部署确认已过期，请重新检查环境');
    if (stored.identity !== this.identity(stored.plan.deviceId))
      throw new Error('连接配置已变化，请重新检查环境');
    if (stored.plan.check.blockers.length) throw new Error(stored.plan.check.blockers.join('；'));
    return structuredClone(stored.plan);
  }
  async start(id: string, options?: ProbeInstallOptions) {
    const plan = this.get(id);
    const identity = this.identity(plan.deviceId);
    if (plan.tool === 'probe') probeInstallSchema.parse(options);
    if (this.active.has(plan.deviceId)) throw new Error('该设备已有安装任务');
    this.sessions.assertCapacity();
    this.active.add(plan.deviceId);
    this.plans.delete(id);
    let client: Client | undefined;
    let directory: string | undefined;
    try {
      client = await this.connect(plan.deviceId);
      if (this.identity(plan.deviceId) !== identity)
        throw new Error('连接配置已变化，请重新检查环境');
      const check = parsePreflight(
        await executeSSH(client, PREFLIGHT_COMMAND, { keepOpen: true }),
        plan.tool,
      );
      if (
        check.blockers.length ||
        ['system', 'distribution', 'version', 'architecture', 'user', 'root'].some(
          (key) => check[key as keyof DeploymentCheck] !== plan.check[key as keyof DeploymentCheck],
        )
      )
        throw new Error('服务器环境已变化，请重新检查后安装');
      directory = (
        await executeSSH(client, 'umask 077; mktemp -d /tmp/nexus-deploy.XXXXXXXXXX', {
          keepOpen: true,
        })
      ).trim();
      const command = deploymentCommand(plan.tool, directory, check, options);
      await stageInstaller(client, directory, plan.script);
      if (this.identity(plan.deviceId) !== identity) throw new Error('连接配置已变化，安装未执行');
      const session = await this.sessions.open(
        client,
        {
          deviceId: plan.deviceId,
          title: `安装 ${toolNames[plan.tool]}`,
          kind: 'deployment',
          tool: plan.tool,
        },
        command,
        async (sessionId, code, error) => {
          try {
            if (error || code !== 0)
              throw new Error(error || `安装脚本退出码：${code ?? '未知'}。请检查日志和服务器。`);
            this.sessions.update(sessionId, {
              state: 'complete',
              message:
                plan.tool === 'probe'
                  ? '探针服务已启动；请在状态页核对上报与认证，再绑定节点。'
                  : '安装脚本已完成，运行状态验证通过。',
            });
          } catch (failure) {
            this.sessions.update(sessionId, { state: 'failed', message: String(failure) });
          } finally {
            this.active.delete(plan.deviceId);
          }
        },
      );
      return session;
    } catch (error) {
      if (client && directory && /^\/tmp\/nexus-deploy\.[a-zA-Z0-9]+$/.test(directory))
        await executeSSH(
          client,
          `rm -f -- ${shellQuote(`${directory}/installer.sh`)}; rmdir -- ${shellQuote(directory)}`,
          { keepOpen: true },
        ).catch(() => {});
      client?.end();
      this.active.delete(plan.deviceId);
      throw error;
    }
  }
  cancelled(deviceId: string) {
    this.active.delete(deviceId);
  }
}
