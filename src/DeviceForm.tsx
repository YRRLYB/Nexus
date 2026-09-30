import { useState } from 'react';
import { KeyRound, LockKeyhole } from 'lucide-react';
import type { Device, ProbeNode } from '../shared/types';
import { api, DeviceIcon, icons, Modal, errorText } from './ui';
import { locations, resolveLocation } from '../shared/location';
import { deviceProfile } from '../shared/device';
export function newDevice(index = 0): Device {
  const positions = [
    { x: 178, y: 152 },
    { x: 516, y: 235 },
    { x: 320, y: 435 },
    { x: 855, y: 135 },
    { x: 707, y: 512 },
    { x: 1008, y: 385 },
  ];
  const position = positions[index % positions.length];
  return {
    id: crypto.randomUUID(),
    name: '',
    type: 'linux-vps',
    icon: 'cloud',
    tags: [],
    notes: '',
    os: '',
    position: { x: position.x + Math.floor(index / 6) * 1120, y: position.y },
    connection: { host: '', port: 22, username: 'root', auth: 'password', keyPath: '' },
    probe: { enabled: false, deviceId: '' },
    capabilities: { ssh: true, sftp: true, restart: true, shutdown: true },
  };
}
export function DeviceForm({
  initial,
  nodes,
  close,
  saved,
  vault,
}: {
  initial: Device;
  nodes: ProbeNode[];
  close: () => void;
  saved: (d: Device) => void;
  vault: boolean;
}) {
  const [d, setD] = useState({
    ...initial,
    location: resolveLocation(initial.location)?.code || '',
  });
  const [password, setPassword] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [clearCredential, setClear] = useState(false);
  const [tags, setTags] = useState(initial.tags.join(', '));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const connection = (key: string, value: string | number) =>
    setD((v) => ({ ...v, connection: { ...v.connection, [key]: value } }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const device = {
        ...d,
        tags: tags
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean),
      };
      const credential =
        d.connection.auth === 'password' && password
          ? { password }
          : d.connection.auth === 'key' && passphrase
            ? { passphrase }
            : undefined;
      saved(await api.saveDevice({ device, credential, clearCredential }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={initial.name ? '编辑设备' : '添加设备'}
      subtitle="为你的服务器，在工作台留一个位置。"
      close={() => !busy && close()}
    >
      <form onSubmit={submit} className="device-form">
        <label>
          所在地
          <select
            aria-label="所在地"
            value={d.location}
            onChange={(event) => setD({ ...d, location: event.target.value })}
          >
            <option value="">跟随探针</option>
            {locations.map((region) => (
              <option key={region.code} value={region.code}>
                {region.label}
              </option>
            ))}
          </select>
        </label>
        <p className="helper">系统图标自动识别；以下图标用于未知系统。</p>
        <div className="icon-picker">
          {Object.keys(icons).map((icon) => (
            <button
              type="button"
              key={icon}
              className={d.icon === icon ? 'selected' : ''}
              aria-label={`图标 ${icon}`}
              onClick={() => setD({ ...d, icon })}
            >
              <DeviceIcon icon={icon} />
            </button>
          ))}
        </div>
        <div className="form-grid">
          <label>
            设备名称
            <input
              autoFocus
              required
              maxLength={100}
              value={d.name}
              placeholder="例如 Tokyo VPS"
              onChange={(e) => setD({ ...d, name: e.target.value })}
            />
          </label>
          <label>
            设备类型
            <select
              value={d.type}
              onChange={(e) => {
                const type = e.target.value as Device['type'];
                const linux = ['linux-server', 'linux-vps'].includes(type);
                setD({
                  ...d,
                  type,
                  os: type === d.type ? d.os : '',
                  connection: {
                    ...d.connection,
                    username:
                      ['windows', 'macos'].includes(type) && d.connection.username === 'root'
                        ? 'user'
                        : d.connection.username,
                  },
                  capabilities: { ...d.capabilities, restart: linux, shutdown: linux },
                });
              }}
            >
              <option value="linux-vps">Linux VPS</option>
              <option value="linux-server">Linux Server</option>
              <option value="nas">NAS / Linux</option>
              <option value="windows">Windows PC</option>
              <option value="macos">macOS</option>
            </select>
          </label>
        </div>
        <p className="helper">{deviceProfile(d).hint}</p>
        <div className="form-grid host-grid">
          <label>
            IP / 主机名
            <input
              value={d.connection.host}
              placeholder="留空可作为仅监控设备"
              onChange={(e) => connection('host', e.target.value.trim())}
            />
          </label>
          <label>
            SSH 端口
            <input
              required
              type="number"
              min={1}
              max={65535}
              value={d.connection.port}
              onChange={(e) => connection('port', Number(e.target.value))}
            />
          </label>
        </div>
        <div className="form-grid">
          <label>
            用户名
            <input
              required
              value={d.connection.username}
              onChange={(e) => connection('username', e.target.value)}
            />
          </label>
          <label>
            认证方式
            <select value={d.connection.auth} onChange={(e) => connection('auth', e.target.value)}>
              <option value="password">密码</option>
              <option value="key">SSH 私钥</option>
              <option value="agent">系统 SSH Agent</option>
            </select>
          </label>
        </div>
        {d.connection.auth === 'password' && (
          <label>
            密码 {d.hasCredential && <small>已保存，留空保留</small>}
            <input
              disabled={!vault}
              type="password"
              autoComplete="new-password"
              value={password}
              placeholder={vault ? '加密保存在当前系统账户下' : '系统凭据库不可用'}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        )}
        {d.connection.auth === 'key' && (
          <>
            <label>
              私钥文件
              <div className="input-action">
                <input value={d.connection.keyPath} readOnly placeholder="选择本地 SSH 私钥" />
                <button
                  type="button"
                  disabled={!vault}
                  onClick={async () => {
                    try {
                      const path = await api.pickKey();
                      if (path) connection('keyPath', path);
                    } catch (e) {
                      setError(errorText(e));
                    }
                  }}
                >
                  <KeyRound size={16} />
                  选择
                </button>
              </div>
            </label>
            <label>
              私钥口令（可选）
              <input
                type="password"
                autoComplete="new-password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
              />
            </label>
          </>
        )}
        {d.hasCredential && (
          <label className="check">
            <input
              type="checkbox"
              checked={clearCredential}
              onChange={(e) => setClear(e.target.checked)}
            />
            清除已保存凭据
          </label>
        )}
        <label>
          绑定探针节点
          <select
            value={d.probe.deviceId}
            onChange={(e) =>
              setD({ ...d, probe: { enabled: !!e.target.value, deviceId: e.target.value } })
            }
          >
            <option value="">暂不绑定</option>
            {d.probe.deviceId && !nodes.some((n) => n.id === d.probe.deviceId) && (
              <option value={d.probe.deviceId}>{d.probe.deviceId}（未读取到）</option>
            )}
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name} · {n.id.slice(0, 10)}
              </option>
            ))}
          </select>
        </label>
        <div className="form-grid">
          <label>
            系统版本
            <input
              value={d.os}
              placeholder="可稍后通过 SSH 读取"
              onChange={(e) => setD({ ...d, os: e.target.value })}
            />
          </label>
          <label>
            标签
            <input
              value={tags}
              placeholder="生产, 个人, 东京"
              onChange={(e) => setTags(e.target.value)}
            />
          </label>
        </div>
        <label>
          备注
          <textarea
            rows={2}
            value={d.notes}
            onChange={(e) => setD({ ...d, notes: e.target.value })}
          />
        </label>
        <div className="capabilities">
          {(['ssh', 'sftp', 'restart', 'shutdown'] as const).map((cap) => (
            <label className="check" key={cap}>
              <input
                type="checkbox"
                checked={d.capabilities[cap]}
                disabled={
                  ['windows', 'macos'].includes(d.type) && ['restart', 'shutdown'].includes(cap)
                }
                onChange={(e) =>
                  setD({ ...d, capabilities: { ...d.capabilities, [cap]: e.target.checked } })
                }
              />
              {{ ssh: 'SSH', sftp: '文件', restart: '重启', shutdown: '关机' }[cap]}
            </label>
          ))}
        </div>
        <p className="helper">
          <LockKeyhole size={14} />
          密码与私钥通过系统安全存储加密；系统 SSH 使用交互式认证。
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button type="button" disabled={busy} onClick={close}>
            取消
          </button>
          <button className="primary" disabled={busy}>
            {busy ? '保存中…' : '保存设备'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
