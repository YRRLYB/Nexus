import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ArrowUpRight, LoaderCircle, RefreshCw } from 'lucide-react';
import type { Device, DiscoveryReport, DiscoverySource } from '../shared/types';
import { api, errorText, Modal } from './ui';
import './discovery.css';
import { deviceProfile } from '../shared/device';

const labels: Record<DiscoverySource, string> = {
  processes: '进程',
  services: '系统服务',
  containers: 'Docker 容器',
  ports: '监听端口',
  timers: '系统定时器',
  cron: '计划任务',
};
export function Discovery({ device, edit }: { device: Device; edit: () => void }) {
  const [report, setReport] = useState<DiscoveryReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const sequence = useRef(0);
  const linux = deviceProfile(device).discovery;
  const ready =
    linux &&
    device.capabilities.ssh &&
    !!device.connection.host &&
    (device.connection.auth === 'agent' || !!device.hasCredential);
  const count = (source: 'containers' | 'services' | 'processes') =>
    report?.sources.find((item) => item.source === source)?.status === 'unavailable'
      ? '—'
      : report?.[source].length;
  const scan = useCallback(
    async (refresh = false) => {
      if (!ready) return;
      const current = ++sequence.current;
      setBusy(true);
      setError('');
      try {
        const result = await api.discover(device.id, refresh);
        if (current === sequence.current) setReport(result);
      } catch (e) {
        if (current === sequence.current) setError(errorText(e));
      } finally {
        if (current === sequence.current) setBusy(false);
      }
    },
    [device.id, ready],
  );
  useEffect(() => {
    void scan();
    return () => {
      sequence.current++;
    };
  }, [scan]);
  return (
    <section className="detail-section discovery-summary" aria-label="运行识别">
      <div className="section-label">
        <span>
          <Activity size={16} /> 运行识别
        </span>
        {ready && (
          <button aria-label="重新识别" disabled={busy} onClick={() => void scan(true)}>
            <RefreshCw size={15} />
          </button>
        )}
      </div>
      {!linux ? (
        <p>运行识别目前支持 Linux 服务器。</p>
      ) : !ready ? (
        <button className="discovery-open" onClick={edit}>
          配置 SSH，自动识别运行内容 <ArrowUpRight size={16} />
        </button>
      ) : (
        <>
          {busy && (
            <p role="status">
              <LoaderCircle className="spin" size={16} /> 正在识别服务、项目与任务…
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {report && (
            <>
              <p>
                <strong>{count('containers')}</strong> 个容器 · <strong>{count('services')}</strong>{' '}
                个服务 · <strong>{count('processes')}</strong> 个进程
              </p>
              <p className="discovery-time">
                采集于 {new Date(report.scannedAt).toLocaleTimeString('zh-CN', { hour12: false })}
                {report.sources.some((s) => s.status !== 'ok') && ' · 部分信息未完整读取'}
              </p>
              <button className="discovery-open" onClick={() => setOpen(true)}>
                查看运行内容 <ArrowUpRight size={16} />
              </button>
            </>
          )}
          {!report && !busy && error && <button onClick={() => void scan(true)}>重试识别</button>}
        </>
      )}
      {open && report && (
        <Modal
          className="discovery-overlay"
          wide
          title={`${device.name} · 运行内容`}
          subtitle="结合当前运行证据，了解这台服务器在做什么。"
          close={() => setOpen(false)}
        >
          <DiscoveryResults
            report={report}
            busy={busy}
            error={error}
            refresh={() => void scan(true)}
          />
        </Modal>
      )}
    </section>
  );
}
function DiscoveryResults({
  report,
  busy,
  error,
  refresh,
}: {
  report: DiscoveryReport;
  busy: boolean;
  error: string;
  refresh: () => void;
}) {
  const [tab, setTab] = useState<'projects' | DiscoverySource>('projects');
  const [query, setQuery] = useState('');
  const matches = (value: unknown) =>
    JSON.stringify(value).toLowerCase().includes(query.trim().toLowerCase());
  const selectedSource = report.sources.find((s) => s.source === tab);
  const counts = {
    projects: report.projects.length,
    containers: report.containers.length,
    services: report.services.length,
    processes: report.processes.length,
    ports: report.ports.length,
    timers: report.timers.length,
    cron: report.cron.length,
  };
  const projectRows = report.projects.filter(matches);
  const rows: string[][] =
    tab === 'processes'
      ? report.processes
          .filter(matches)
          .map((p) => [
            String(p.pid),
            p.name,
            `${p.cpu.toFixed(1)}%`,
            `${p.memory.toFixed(1)}%`,
            p.directory || '无权限或无工作目录',
          ])
      : tab === 'services'
        ? report.services.filter(matches).map((s) => [s.name, s.description, '运行中'])
        : tab === 'containers'
          ? report.containers
              .filter(matches)
              .map((c) => [c.name, c.image, c.project || '—', c.state, c.ports || '未发布端口'])
          : tab === 'ports'
            ? report.ports
                .filter(matches)
                .map((p) => [p.protocol, p.address, p.pids.join(', ') || '未提供进程信息'])
            : tab === 'timers'
              ? report.timers.filter(matches).map((s) => [s])
              : tab === 'cron'
                ? report.cron.filter(matches).map((s) => [s])
                : [];
  const headers =
    tab === 'processes'
      ? ['PID', '进程', 'CPU¹', '内存', '工作目录']
      : tab === 'services'
        ? ['服务', '说明', '状态']
        : tab === 'containers'
          ? ['容器', '镜像', 'Compose 项目', '状态', '端口映射']
          : tab === 'ports'
            ? ['协议', '监听地址', 'PID']
            : tab === 'timers'
              ? ['下次 / 上次触发时间、定时器与目标服务（服务器时区）']
              : ['计划 · 用户 · 执行程序'];
  return (
    <div className="discovery-results">
      <div className="discovery-toolbar">
        <span>采集于 {new Date(report.scannedAt).toLocaleString('zh-CN', { hour12: false })}</span>
        <button disabled={busy} onClick={refresh}>
          <RefreshCw size={16} className={busy ? 'spin' : ''} />
          {busy ? '识别中…' : '重新识别'}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          刷新失败：{error}。以下仍为上次采集结果。
        </p>
      )}
      <div className="discovery-tabs" role="tablist" aria-label="运行内容分类">
        {(
          ['projects', 'containers', 'services', 'processes', 'ports', 'timers', 'cron'] as const
        ).map((item) => (
          <button
            key={item}
            role="tab"
            id={`discovery-tab-${item}`}
            aria-selected={tab === item}
            aria-controls="discovery-content"
            onClick={() => setTab(item)}
          >
            {item === 'projects' ? '项目线索' : labels[item]}{' '}
            <span>
              {report.sources.find((source) => source.source === item)?.status === 'unavailable'
                ? '—'
                : counts[item]}
            </span>
          </button>
        ))}
      </div>
      <input
        autoFocus
        aria-label="搜索运行内容"
        placeholder="搜索项目、进程、端口或目录"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div
        className="discovery-content"
        id="discovery-content"
        role="tabpanel"
        aria-labelledby={`discovery-tab-${tab}`}
      >
        {selectedSource?.status !== 'ok' && selectedSource && (
          <p className="discovery-notice">
            {labels[selectedSource.source]}：{selectedSource.message}
          </p>
        )}
        {tab === 'projects' ? (
          <>
            <p className="discovery-explanation">
              「已确认」来自运行中的服务或容器。「待确认」根据进程和工作目录推测；同一项目可能同时出现在多个来源中。
            </p>
            {projectRows.length ? (
              <div className="project-grid">
                {projectRows.map((project, index) => (
                  <article className="project-card" key={index}>
                    <div>
                      <span className="project-kind">{project.kind}</span>
                      <span className={`project-confidence ${project.confidence}`}>
                        {project.confidence === 'confirmed' ? '已确认' : '待确认'}
                      </span>
                    </div>
                    <h3>{project.name}</h3>
                    <p>{project.evidence}</p>
                    {project.directory && <code>{project.directory}</code>}
                    {project.ports && <p>端口：{project.ports}</p>}
                  </article>
                ))}
              </div>
            ) : (
              <p className="discovery-empty">
                {query
                  ? '没有匹配的项目线索。'
                  : '暂未识别出项目线索，可继续查看进程和服务；这不代表服务器没有运行项目。'}
              </p>
            )}
          </>
        ) : rows.length ? (
          <div className="discovery-table-wrap">
            <table>
              <thead>
                <tr>
                  {headers.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((value, j) => (
                      <td key={j}>{value}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="discovery-empty">
            {query
              ? '没有匹配的条目。'
              : selectedSource?.status === 'unavailable'
                ? '此项未能读取，请查看上方原因。'
                : '本次采集未发现条目。'}
          </p>
        )}
        {tab === 'processes' && (
          <p className="discovery-explanation">
            ¹ CPU 为进程存活期间的平均占用，并非实时采样。按 CPU 排序最多采集 160
            个进程；目录读取受当前用户权限限制。
          </p>
        )}
        {tab === 'ports' && (
          <p className="discovery-explanation">
            监听地址不等于公网可访问；端口与进程仅在系统提供 PID 时关联。
          </p>
        )}
        {tab === 'cron' && (
          <p className="discovery-explanation">
            覆盖当前 SSH 用户及可读取的系统
            crontab、/etc/cron.d。仅显示计划和执行程序，省略参数；其他用户的个人任务不在此范围内。
          </p>
        )}
      </div>
      <details className="discovery-coverage">
        <summary>识别范围与读取情况</summary>
        <p>
          通过 SSH
          只读采集，本地规则分析。不会启动或停止服务，不读取进程参数、环境变量值或项目配置。容器内部进程的项目路径需要进一步核实。
        </p>
        <ul>
          {report.sources.map((source) => (
            <li key={source.source}>
              <strong>{labels[source.source]}</strong>：
              {source.status === 'ok' ? '已读取' : source.message}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
