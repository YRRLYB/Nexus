import { useEffect, useState } from 'react';
import { Download, LoaderCircle, Square, ShieldCheck } from 'lucide-react';
import type {
  DeploymentPlan,
  Device,
  InstallTool,
  ProbeInstallOptions,
  SessionInfo,
} from '../shared/types';
import { api, errorText, Modal } from './ui';
import { TerminalPane } from './Terminal';

const names: Record<InstallTool, string> = {
  docker: 'Docker',
  baota: '宝塔面板',
  probe: 'ServerStatus 探针',
  '3x-ui': '3x-ui 面板',
};
const descriptions: Record<InstallTool, string> = {
  docker:
    '安装 Docker Engine 和命令行组件。使用官方便利脚本，不覆盖已有 Docker。生产环境请先阅读官方说明。',
  baota:
    '安装宝塔 Linux 面板 12 稳定版。会修改软件包、服务和防火墙；建议使用干净系统，安装后检查面板端口。',
  probe:
    '安装 ServerStatus-Rust v1.8.1 客户端及 systemd 服务。需要已有探针服务端；不会新建服务端。',
  '3x-ui':
    '安装 3x-ui v3.9.0 面板，用于管理 Xray 服务。支持带 systemd 的 Linux / VPS；安装时在终端设置面板入口和登录信息，已有 x-ui 安装不会被覆盖。',
};
export function Deployment({ device, close }: { device: Device; close: () => void }) {
  const [tool, setTool] = useState<InstallTool>('docker');
  const [plan, setPlan] = useState<DeploymentPlan | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [planning, setPlanning] = useState(true);
  const [options, setOptions] = useState<ProbeInstallOptions>({
    server: '',
    group: '',
    alias: device.name,
    location: 'us',
  });
  useEffect(() => {
    const unsubscribe = api.onSessionState((value) => {
      if (value.kind === 'deployment' && value.deviceId === device.id) setSession(value);
    });
    void api
      .sessions()
      .then((items) => {
        const existing =
          items
            .filter((item) => item.kind === 'deployment' && item.deviceId === device.id)
            .at(-1) || null;
        setSession(existing);
        if (existing) {
          setPlanning(false);
          setTool(existing.tool || 'docker');
        }
      })
      .catch((failure) => setError(errorText(failure)));
    return unsubscribe;
  }, [device.id]);
  const active = session && ['running', 'verifying'].includes(session.state);
  async function prepare() {
    setBusy(true);
    setError('');
    setPlan(null);
    setAccepted(false);
    try {
      setPlan(await api.prepareDeployment(device.id, tool));
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    if (!plan) return;
    setBusy(true);
    setError('');
    const previous = session;
    setSession(null);
    try {
      const started = await api.startDeployment(plan.id, tool === 'probe' ? options : undefined);
      if (started) {
        setSession(started);
        setPlan(null);
        setPlanning(false);
      } else setSession(previous);
    } catch (failure) {
      setError(errorText(failure));
      setSession(previous);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      wide
      title={`部署软件 · ${device.name}`}
      subtitle={`${device.connection.username}@${device.connection.host}:${device.connection.port}`}
      close={close}
    >
      <div className="deployment-tools">
        {(Object.keys(names) as InstallTool[]).map((value) => (
          <button
            key={value}
            className={tool === value ? 'selected' : ''}
            disabled={busy || !!active}
            onClick={() => {
              setTool(value);
              setPlan(null);
              setAccepted(false);
              setError('');
              setPlanning(true);
            }}
          >
            {names[value]}
          </button>
        ))}
      </div>
      <p className="helper">{descriptions[tool]}</p>
      {tool === 'probe' && !active && planning && (
        <div className="probe-install-fields">
          <label>
            上报地址
            <input
              aria-label="探针上报地址"
              placeholder="https://status.example.com/report"
              value={options.server}
              onChange={(event) => setOptions({ ...options, server: event.target.value })}
            />
          </label>
          <label>
            组 ID
            <input
              aria-label="探针组 ID"
              value={options.group}
              onChange={(event) => setOptions({ ...options, group: event.target.value })}
            />
          </label>
          <label>
            节点名称
            <input
              aria-label="探针节点名称"
              value={options.alias}
              onChange={(event) => setOptions({ ...options, alias: event.target.value })}
            />
          </label>
          <label>
            地区代码
            <input
              aria-label="探针地区代码"
              value={options.location}
              onChange={(event) => setOptions({ ...options, location: event.target.value })}
            />
          </label>
          <p className="helper">组密码在安装终端的隐藏提示中输入，不保存在部署表单中。</p>
        </div>
      )}
      {!active && planning && (
        <button disabled={busy} onClick={() => void prepare()}>
          {busy ? <LoaderCircle size={16} className="spin" /> : <ShieldCheck size={16} />}
          检查环境并加载脚本
        </button>
      )}
      {!active && !planning && <button onClick={() => setPlanning(true)}>准备新安装</button>}
      {plan && (
        <div className="deployment-plan">
          <dl>
            <dt>环境</dt>
            <dd>
              {plan.check.system} · {plan.check.distribution} {plan.check.version} ·{' '}
              {plan.check.architecture}
            </dd>
            <dt>权限</dt>
            <dd>{plan.check.root ? 'root' : '使用 sudo，可能需要在终端输入密码'}</dd>
            <dt>脚本来源</dt>
            <dd>
              <code>{plan.source}</code>
            </dd>
            {plan.script && (
              <>
                <dt>SHA-256</dt>
                <dd>
                  <code>{plan.sha256}</code>
                </dd>
              </>
            )}
          </dl>
          {plan.check.blockers.map((reason) => (
            <p className="error" role="alert" key={reason}>
              {reason}
            </p>
          ))}
          {plan.script && (
            <>
              <details>
                <summary>查看将要执行的脚本</summary>
                <pre className="installer-source">{plan.script}</pre>
              </details>
              <p className="helper">
                这里只展示入口脚本，脚本下载的第三方组件不在预览范围内。确认有效期为 5 分钟。
              </p>
              <label className="deployment-consent">
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(event) => setAccepted(event.target.checked)}
                />
                我已检查脚本并备份服务器，允许修改软件包和系统服务。中断安装不会自动回滚。
              </label>
              <button
                className="primary"
                disabled={
                  busy ||
                  !accepted ||
                  (tool === 'probe' &&
                    (!options.server || !options.group || !options.alias || !options.location))
                }
                onClick={() => void start()}
              >
                <Download size={16} />
                在服务器安装 {names[tool]}
              </button>
            </>
          )}
        </div>
      )}
      {session && (
        <div className="deployment-session">
          <div className="terminal-toolbar">
            <strong>{session.title}</strong>
            {session.state === 'running' && (
              <button
                className="danger"
                onClick={() => {
                  if (
                    window.confirm(
                      '中断安装？已经安装的软件、服务和防火墙改动不会回滚，后台进程也可能继续运行。',
                    )
                  )
                    void api
                      .closeSession(session.id)
                      .catch((failure) => setError(errorText(failure)));
                }}
              >
                <Square size={14} />
                中断安装
              </button>
            )}
          </div>
          <TerminalPane session={session} />
          <p className="helper">
            需要确认或输入 sudo
            密码时，直接在终端中操作。收起窗口不会停止安装，可从设备详情再次打开。
          </p>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
