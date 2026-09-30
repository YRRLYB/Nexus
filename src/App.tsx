import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Copy,
  Download,
  Ellipsis,
  FolderOpen,
  Globe2,
  LoaderCircle,
  Maximize,
  Plus,
  Power,
  Radio,
  RotateCw,
  Search,
  ShieldCheck,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import logoUrl from '../gemini-svg.svg';
import type { Bootstrap, Device, PowerState, ProbeSnapshot } from '../shared/types';
import { api, bytes, errorText, Metric, Modal, nodeFor, pct, status } from './ui';
import { DeviceForm, newDevice } from './DeviceForm';
import { Settings } from './Settings';
import { Files } from './Files';
import { Discovery } from './Discovery';
import { SystemIcon } from './SystemIcon';
import { LocationBadge } from './LocationBadge';
import { resolveOS } from '../shared/os';
import { deviceProfile, quickActionLabel } from '../shared/device';
import { useCanvas } from './useCanvas';
import {
  DesktopClock,
  DesktopTools,
  readPreferences,
  type DesktopPreferences,
} from './DesktopTools';

export function App() {
  const [info, setInfo] = useState<Bootstrap | null>(null);
  const [fatal, setFatal] = useState('');
  const [snapshot, setSnapshot] = useState<ProbeSnapshot>({ nodes: [], fetchedAt: 0 });
  const [powers, setPowers] = useState<Record<string, PowerState>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Device | null>(null);
  const [settings, showSettings] = useState(false);
  const [files, setFiles] = useState<Device | null>(null);
  const [discoveryRevision, setDiscoveryRevision] = useState(0);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const canvas = useCanvas(!!info);
  const { viewport, camera, changeZoom, fit } = canvas;
  const zoom = camera.zoom;
  const [output, setOutput] = useState<{ title: string; text: string } | null>(null);
  const [search, setSearch] = useState(false);
  const [preferences, setPreferences] = useState(readPreferences);
  const [fullScreen, setFullScreen] = useState(false);
  function changePreferences(value: DesktopPreferences) {
    setPreferences(value);
    try {
      localStorage.setItem('nexus.desktop', JSON.stringify(value));
    } catch {
      setToast('外观已应用，但偏好暂时无法保存');
    }
  }
  useEffect(() => {
    if (!api) return;
    void api.windowState().then((value) => setFullScreen(value.fullScreen));
    return api.onWindowState((value) => setFullScreen(value.fullScreen));
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'F11') {
        event.preventDefault();
        void api.setFullScreen(!fullScreen);
        return;
      }
      if (editing || settings || files || output) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearch((value) => !value);
      }
      if (event.key === 'Escape' && !search) {
        if (selected) setSelected(null);
        else if (fullScreen) void api.setFullScreen(false);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [editing, settings, files, output, search, selected, fullScreen]);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [polling, setPolling] = useState(false);
  const detailScroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    detailScroll.current?.scrollTo({ top: 0 });
  }, [selected]);
  const dragging = useRef<{
    id: string;
    startX: number;
    startY: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const notify = useCallback((text: string) => setToast(text), []);
  const refresh = useCallback(async () => {
    setPolling(true);
    try {
      setSnapshot(await api.pollProbe());
      setPowers(await api.powerStates());
    } catch (e) {
      setSnapshot({ nodes: [], fetchedAt: Date.now(), error: errorText(e) });
    } finally {
      setPolling(false);
    }
  }, []);
  useEffect(() => {
    if (!api) {
      setFatal('请通过桌面应用打开 Nexus。开发启动命令：npm run dev');
      return;
    }
    api
      .bootstrap()
      .then(setInfo)
      .catch((e) => setFatal(errorText(e)));
  }, []);
  useEffect(() => {
    if (!info) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      await refresh();
      if (!stopped) timer = setTimeout(tick, info.settings.pollSeconds * 1000);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [info?.settings.pollSeconds, info?.settings.probeUrl, refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 5500);
    return () => clearTimeout(timer);
  }, [toast]);
  async function run(action: () => Promise<unknown>, success?: string) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      if (success) notify(success);
    } catch (e) {
      notify(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  function upsert(device: Device) {
    setInfo(
      (old) =>
        old && {
          ...old,
          devices: old.devices.some((d) => d.id === device.id)
            ? old.devices.map((d) => (d.id === device.id ? device : d))
            : [...old.devices, device],
        },
    );
  }
  function dragStart(e: React.PointerEvent, d: Device) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = {
      id: d.id,
      startX: e.clientX,
      startY: e.clientY,
      x: d.position.x,
      y: d.position.y,
      moved: false,
    };
  }
  function dragMove(e: React.PointerEvent) {
    const drag = dragging.current;
    if (!drag) return;
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 5 && !drag.moved) return;
    drag.moved = true;
    const x = drag.x + (e.clientX - drag.startX) / zoom;
    const y = drag.y + (e.clientY - drag.startY) / zoom;
    setInfo(
      (old) =>
        old && {
          ...old,
          devices: old.devices.map((d) => (d.id === drag.id ? { ...d, position: { x, y } } : d)),
        },
    );
  }
  async function dragEnd(e: React.PointerEvent, d: Device) {
    const drag = dragging.current;
    if (!drag) return;
    dragging.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    if (!drag.moved) {
      setSelected(d.id);
      return;
    }
    try {
      await api.moveDevice(d.id, {
        x: drag.x + (e.clientX - drag.startX) / zoom,
        y: drag.y + (e.clientY - drag.startY) / zoom,
      });
    } catch (e) {
      notify(errorText(e));
      setInfo(
        (old) =>
          old && {
            ...old,
            devices: old.devices.map((v) =>
              v.id === drag.id ? { ...v, position: { x: drag.x, y: drag.y } } : v,
            ),
          },
      );
    }
  }
  function cancelDrag(event: React.PointerEvent) {
    const drag = dragging.current;
    dragging.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (drag)
      setInfo(
        (old) =>
          old && {
            ...old,
            devices: old.devices.map((d) =>
              d.id === drag.id ? { ...d, position: { x: drag.x, y: drag.y } } : d,
            ),
          },
      );
  }
  if (fatal)
    return (
      <div className="launch-screen">
        <div className="brand-mark">
          <img src={logoUrl} alt="Nexus" />
        </div>
        <h1>Nexus</h1>
        <p>{fatal}</p>
      </div>
    );
  if (!info)
    return (
      <div className="launch-screen">
        <LoaderCircle className="spin" />
        <p>正在打开工作台…</p>
      </div>
    );
  const devices = info.devices;
  const device = devices.find((d) => d.id === selected);
  const node = device && nodeFor(device, snapshot);
  const state = device && status(device, node, snapshot);
  const profile = device && deviceProfile(device);
  const online = devices.filter(
    (d) => status(d, nodeFor(d, snapshot), snapshot).kind === 'online',
  ).length;
  const visible = devices.filter(
    (d) =>
      `${d.name} ${d.connection.host} ${d.tags.join(' ')}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === 'all' || status(d, nodeFor(d, snapshot), snapshot).kind === filter),
  );
  const activePower = device && powers[device.id];
  const powerLabel = activePower
    ? {
        'waiting-offline': '命令已接受，等待离线',
        'waiting-online': '已离线，等待重新上线',
        complete: activePower.action === 'restart' ? '已确认重新上线' : '已确认离线',
        timeout: '未能在 5 分钟内确认结果',
      }[activePower.phase]
    : '';
  return (
    <div
      className={`app-shell desktop-shell wallpaper-${preferences.wallpaper} ${fullScreen ? 'is-fullscreen' : ''}`}
      style={{ '--desktop-icon-size': `${preferences.iconSize}px` } as React.CSSProperties}
    >
      <div className="desktop-wallpaper" aria-hidden="true">
        <div className="wallpaper-fold fold-one" />
        <div className="wallpaper-fold fold-two" />
        <div className="wallpaper-fold fold-three" />
      </div>
      <header className="desktop-menubar">
        <div className="desktop-brand">
          <img src={logoUrl} alt="Nexus" />
          <h1>Nexus</h1>
          <span>Your devices, your space.</span>
        </div>
        <button
          className={`desktop-connection ${snapshot.error ? 'has-error' : ''}`}
          aria-label="连接状态"
          title={snapshot.error || `${online} / ${devices.length} 台在线`}
          onClick={() => showSettings(true)}
        >
          <span
            className={`status-dot ${snapshot.error ? 'offline' : snapshot.fetchedAt ? 'online' : ''}`}
          />
          {snapshot.error ? '连接异常' : snapshot.fetchedAt ? '已同步' : '连接中'}
        </button>
      </header>
      <main className="main desktop-main" aria-label="设备桌面">
        {preferences.showClock && <DesktopClock />}
        {(query || filter !== 'all') && (
          <div className="active-search glass">
            <Search size={14} />
            <span>
              {query || { online: '在线设备', offline: '离线设备', unknown: '未连接探针' }[filter]}{' '}
              · {visible.length} 台
            </span>
            <button
              title="定位筛选结果"
              aria-label="定位筛选结果"
              onClick={() => fit(visible.map((d) => d.position))}
            >
              <Maximize size={14} />
            </button>
            <button
              aria-label="清除筛选"
              onClick={() => {
                setQuery('');
                setFilter('all');
              }}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {snapshot.error && (
          <button className="connection-warning glass" onClick={() => showSettings(true)}>
            <Radio size={15} />
            <span>探针暂不可用 · {snapshot.error}</span>
            <ArrowUpRight size={14} />
          </button>
        )}
        <div className={`workspace-body ${device ? 'with-detail' : ''}`}>
          <div className="canvas-area">
            <div
              className={`canvas-viewport ${canvas.panning ? 'is-panning' : ''}`}
              ref={viewport}
              onPointerDown={(event) => {
                if (!(event.target as HTMLElement).closest('.device-card') || event.button === 1) {
                  setSelected(null);
                  setSearch(false);
                  canvas.panStart(event);
                }
              }}
              onPointerMove={canvas.panMove}
              onPointerUp={canvas.panEnd}
              onPointerCancel={canvas.panEnd}
            >
              <div className="canvas">
                <div
                  className="canvas-transform"
                  style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${zoom})` }}
                >
                  {visible.map((d) => {
                    const n = nodeFor(d, snapshot);
                    const s = status(d, n, snapshot);
                    const usable = s.kind === 'online';
                    return (
                      <article
                        key={d.id}
                        className={`device-card desktop-device ${selected === d.id ? 'selected' : ''}`}
                        style={{ left: d.position.x, top: d.position.y }}
                        tabIndex={0}
                        role="button"
                        aria-label={`设备 ${d.name}`}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelected(d.id);
                          }
                        }}
                        onPointerDown={(e) => dragStart(e, d)}
                        onPointerMove={dragMove}
                        onPointerUp={(e) => void dragEnd(e, d)}
                        onPointerCancel={cancelDrag}
                      >
                        <div className="desktop-device-symbol">
                          <SystemIcon device={d} probeOS={n?.os} />
                          <span className={`device-state-badge ${s.kind}`} title={s.label} />
                          <LocationBadge location={d.location || n?.location} />
                        </div>
                        <h3>{d.name}</h3>
                        <span className={`status-pill sr-only ${s.kind}`}>{s.label}</span>
                        <div className="device-peek glass" aria-hidden="true">
                          <strong>{d.os || n?.os || resolveOS(d).label}</strong>
                          <span>
                            {usable ? `CPU ${pct(n?.cpu)}   ·   内存 ${pct(n?.memory)}` : s.label}
                          </span>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            </div>
            {!devices.length && (
              <div className="empty-canvas">
                <div className="empty-orbit">
                  <span />
                  <span />
                  <div>
                    <Globe2 size={37} strokeWidth={1.3} />
                  </div>
                </div>
                <span className="eyebrow">A PLACE FOR EVERY SERVER</span>
                <h2>从你的第一台设备开始</h2>
                <p>
                  把散落的服务器，放进一个清晰的空间。
                  <br />
                  状态、连接与文件，都在触手可及的地方。
                </p>
                <div>
                  <button className="primary" onClick={() => setEditing(newDevice())}>
                    <Plus size={16} />
                    添加设备
                  </button>
                  <button onClick={() => showSettings(true)}>
                    <Download size={16} />
                    从探针导入
                    {snapshot.nodes.length > 0 && (
                      <span className="count">{snapshot.nodes.length}</span>
                    )}
                  </button>
                </div>
                <small>
                  <ShieldCheck size={13} />
                  凭据安全保存在本机
                </small>
              </div>
            )}
            {devices.length > 0 && !visible.length && (
              <div className="no-results">
                <Search size={28} />
                <p>没有找到符合条件的设备</p>
                <button
                  onClick={() => {
                    setQuery('');
                    setFilter('all');
                  }}
                >
                  显示全部
                </button>
              </div>
            )}
          </div>
          {device && (
            <aside className="detail-panel glass" aria-label="设备详情">
              <div className="detail-header">
                <span>设备详情</span>
                <div>
                  <button
                    className="icon-button"
                    title="编辑设备"
                    onClick={() => setEditing(device)}
                  >
                    <Ellipsis size={20} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="关闭详情"
                    onClick={() => setSelected(null)}
                  >
                    <X size={19} />
                  </button>
                </div>
              </div>
              <div className="detail-scroll" ref={detailScroll}>
                <div className="detail-device-icon">
                  <SystemIcon device={device} probeOS={node?.os} />
                  <LocationBadge location={device.location || node?.location} />
                </div>
                <h2>{device.name}</h2>
                <div className="detail-status">
                  <span className={`status-dot ${state!.kind}`} />
                  {state!.label}
                  <span>·</span>
                  {device.os || node?.os || '系统版本未设置'}
                </div>
                <div className="tag-list">
                  {device.tags.map((tag, i) => (
                    <span key={`${tag}-${i}`}>{tag}</span>
                  ))}
                </div>
                <div className="primary-actions">
                  {device.capabilities.ssh && (
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => void run(() => api.openSSH(device.id), '已打开系统 SSH 终端')}
                    >
                      <Terminal size={17} />
                      SSH 连接
                    </button>
                  )}
                  {device.capabilities.sftp && (
                    <button onClick={() => setFiles(device)}>
                      <FolderOpen size={17} />
                      文件
                    </button>
                  )}
                </div>
                {device.capabilities.ssh && (
                  <Discovery
                    key={`${device.id}:${discoveryRevision}`}
                    device={device}
                    edit={() => setEditing(device)}
                  />
                )}
                <section className="detail-section">
                  {profile && <p className="platform-hint">{profile.hint}</p>}
                </section>
                {profile?.deployment && device.capabilities.ssh && (
                  <section className="detail-section install-section">
                    <div className="section-label">安装引导</div>
                    <p className="helper">
                      复制后在目标 Linux 服务器执行。脚本会先显示内容，再请求 sudo；请先审阅命令。
                    </p>
                    <div className="copy-actions">
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () => api.copyInstallCommand(device.id, 'docker'),
                            'Docker 安装命令已复制',
                          )
                        }
                      >
                        复制 Docker 安装命令
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () => api.copyInstallCommand(device.id, 'probe'),
                            '探针安装命令已复制',
                          )
                        }
                      >
                        复制探针安装命令
                      </button>
                    </div>
                  </section>
                )}
                <section className="detail-section">
                  <div className="section-label">
                    实时状态{' '}
                    <span>
                      {node?.lastSeen
                        ? new Date(node.lastSeen * 1000).toLocaleTimeString('zh-CN', {
                            hour12: false,
                          })
                        : '尚无数据'}
                    </span>
                  </div>
                  <Metric
                    label="CPU"
                    value={state!.kind === 'online' ? (node?.cpu ?? null) : null}
                  />
                  <Metric
                    label="内存"
                    value={state!.kind === 'online' ? (node?.memory ?? null) : null}
                    detail={
                      node ? `${bytes(node.memoryUsed)} / ${bytes(node.memoryTotal)}` : undefined
                    }
                  />
                  <Metric
                    label="磁盘"
                    value={state!.kind === 'online' ? (node?.disk ?? null) : null}
                    detail={node ? `${bytes(node.diskUsed)} / ${bytes(node.diskTotal)}` : undefined}
                  />
                  <div className="network-row">
                    <span>
                      <ArrowDown size={14} />
                      {state!.kind === 'online' ? bytes(node?.rx) + '/s' : '—'}
                    </span>
                    <span>
                      <ArrowUp size={14} />
                      {state!.kind === 'online' ? bytes(node?.tx) + '/s' : '—'}
                    </span>
                  </div>
                  <div className="uptime">
                    运行时间 <span>{node?.uptime || '—'}</span>
                  </div>
                  {node?.latency !== null && node?.latency !== undefined && (
                    <div className="uptime">
                      探针 → 联通延迟 <span>{node.latency.toFixed(1)} ms</span>
                    </div>
                  )}
                </section>
                <section className="detail-section">
                  <div className="section-label">
                    连接信息
                    <button title="编辑连接" onClick={() => setEditing(device)}>
                      编辑
                    </button>
                  </div>
                  {(['host', 'port', 'username'] as const).map((field) => (
                    <div className="connection-row" key={field}>
                      <label>{{ host: '地址', port: '端口', username: '用户' }[field]}</label>
                      <code>{device.connection[field] || '未设置'}</code>
                      <button
                        title={`复制${field}`}
                        disabled={busy}
                        onClick={() => void run(() => api.copy(device.id, field), '已复制')}
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                  ))}
                  <div className="copy-actions">
                    <button
                      disabled={busy}
                      onClick={() => void run(() => api.copy(device.id, 'ssh'), 'SSH 命令已复制')}
                    >
                      复制 SSH 命令
                    </button>
                    {device.connection.auth === 'password' && (
                      <button
                        disabled={busy || !device.hasCredential}
                        onClick={() => void run(() => api.copy(device.id, 'password'))}
                      >
                        复制密码
                      </button>
                    )}
                    <button
                      disabled={busy}
                      onClick={() => void run(() => api.copy(device.id, 'info'), '设备信息已复制')}
                    >
                      复制设备信息
                    </button>
                  </div>
                </section>
                {device.capabilities.ssh && (
                  <section className="detail-section">
                    <div className="section-label">快捷操作</div>
                    <div className="quick-actions">
                      {(['docker', 'services', 'logs', 'sysinfo'] as const).map((action) => (
                        <button
                          key={action}
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              const text = await api.quickAction(device.id, action);
                              if (action === 'sysinfo') {
                                upsert({ ...device, os: text.trim() });
                                notify('系统版本已更新');
                              } else
                                setOutput({
                                  title: {
                                    docker: 'Docker 容器',
                                    services: '运行中的服务',
                                    logs: '系统日志',
                                    sysinfo: '系统版本',
                                  }[action],
                                  text,
                                });
                            })
                          }
                        >
                          {quickActionLabel(device, action)}
                          <ArrowUpRight size={13} />
                        </button>
                      ))}
                    </div>
                  </section>
                )}
                {device.notes && (
                  <section className="detail-section">
                    <div className="section-label">备注</div>
                    <p className="notes">{device.notes}</p>
                  </section>
                )}
                {profile?.power &&
                  (device.capabilities.restart || device.capabilities.shutdown) && (
                    <section className="detail-section">
                      <div className="section-label">电源管理</div>
                      <div className="power-actions">
                        {device.capabilities.restart && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                if (await api.power(device.id, 'restart')) {
                                  setPowers(await api.powerStates());
                                  notify('已安排约 1 分钟后重启');
                                }
                              })
                            }
                          >
                            <RotateCw size={15} />
                            重启
                          </button>
                        )}
                        {device.capabilities.shutdown && (
                          <button
                            className="danger-quiet"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                if (await api.power(device.id, 'shutdown')) {
                                  setPowers(await api.powerStates());
                                  notify('已安排约 1 分钟后关机');
                                }
                              })
                            }
                          >
                            <Power size={15} />
                            关机
                          </button>
                        )}
                      </div>
                      {powerLabel && (
                        <p className="helper">
                          {powerLabel}
                          {!device.probe.enabled && '（未绑定探针，无法确认状态）'}
                        </p>
                      )}
                    </section>
                  )}
                <button
                  className="delete-device"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      if (await api.deleteDevice(device.id)) {
                        setInfo(
                          (old) =>
                            old && {
                              ...old,
                              devices: old.devices.filter((d) => d.id !== device.id),
                            },
                        );
                        setSelected(null);
                      }
                    })
                  }
                >
                  <Trash2 size={14} />
                  移除设备
                </button>
              </div>
            </aside>
          )}
        </div>
        <DesktopTools
          preferences={preferences}
          changePreferences={changePreferences}
          zoom={zoom}
          changeZoom={changeZoom}
          search={search}
          setSearch={setSearch}
          query={query}
          setQuery={setQuery}
          filter={filter}
          setFilter={setFilter}
          fullScreen={fullScreen}
          toggleFullScreen={() => void run(() => api.setFullScreen(!fullScreen))}
          add={() => {
            const d = newDevice(devices.length);
            const rect = viewport.current?.getBoundingClientRect();
            if (rect)
              d.position = {
                x: (rect.width / 2 - camera.x) / zoom - 68,
                y: (rect.height / 2 - camera.y) / zoom - 56,
              };
            setEditing(d);
          }}
          settings={() => showSettings(true)}
          refresh={() => void refresh()}
          polling={polling}
          resetView={() => fit(visible.map((d) => d.position))}
          arrange={() =>
            void run(async () => {
              try {
                for (let index = 0; index < devices.length; index++) {
                  const position = newDevice(index).position;
                  await api.moveDevice(devices[index].id, position);
                }
              } finally {
                setInfo(await api.bootstrap());
              }
              fit(devices.map((_, index) => newDevice(index).position));
              notify('设备已舒展排列，仍可自由拖动');
            })
          }
        />
      </main>
      {editing && (
        <DeviceForm
          key={editing.id}
          initial={editing}
          nodes={snapshot.nodes}
          vault={info.vaultAvailable}
          close={() => setEditing(null)}
          saved={(d) => {
            upsert(d);
            setDiscoveryRevision((revision) => revision + 1);
            setEditing(null);
            setSelected(d.id);
            notify('设备已保存');
          }}
        />
      )}
      {settings && (
        <Settings
          info={info}
          snapshot={snapshot}
          close={() => showSettings(false)}
          refresh={refresh}
          saved={(settings) => setInfo((old) => old && { ...old, settings })}
          imported={(created) => {
            const all = [...devices, ...created];
            setInfo((old) => old && { ...old, devices: all });
            if (created.length) fit(all.map((d) => d.position));
          }}
        />
      )}
      {files && <Files device={files} close={() => setFiles(null)} />}
      {output && (
        <Modal wide title={output.title} subtitle={device?.name} close={() => setOutput(null)}>
          <pre className="command-output">{output.text || '命令执行成功，没有输出。'}</pre>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button aria-label="关闭提示" onClick={() => setToast('')}>
            <X size={15} />
          </button>
        </div>
      )}
      {busy && (
        <div className="busy-indicator">
          <LoaderCircle className="spin" size={15} />
          正在处理…
        </div>
      )}
    </div>
  );
}
