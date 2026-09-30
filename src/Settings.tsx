import { useState } from 'react';
import { Check, Radio, ShieldCheck } from 'lucide-react';
import type { Bootstrap, Device, ProbeSnapshot, Settings as SettingsType } from '../shared/types';
import { api, Modal, errorText } from './ui';
import { newDevice } from './DeviceForm';
import { SSHGuide } from './SSHGuide';
export function Settings({
  info,
  snapshot,
  close,
  saved,
  imported,
  refresh,
}: {
  info: Bootstrap;
  snapshot: ProbeSnapshot;
  close: () => void;
  saved: (settings: SettingsType) => void;
  imported: (devices: Device[]) => void;
  refresh: () => Promise<void>;
}) {
  const [settings, setSettings] = useState(info.settings);
  const [token, setToken] = useState('');
  const [removeToken, setRemoveToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const bound = new Set(info.devices.map((d) => d.probe.deviceId));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      saved(await api.saveSettings(settings, removeToken ? '' : token || undefined));
      await refresh();
      setMessage('设置已保存，已重新读取探针。');
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function importNodes() {
    setBusy(true);
    const created: Device[] = [];
    try {
      for (const id of selected) {
        if (bound.has(id)) continue;
        const n = snapshot.nodes.find((n) => n.id === id)!;
        const d = newDevice(info.devices.length + created.length);
        d.name = n.name;
        d.os = n.os;
        if (/windows/i.test(n.os)) d.type = 'windows';
        else if (/macos|mac os|darwin/i.test(n.os)) d.type = 'macos';
        if (d.type === 'windows' || d.type === 'macos') {
          d.connection.username = 'user';
          d.capabilities.restart = false;
          d.capabilities.shutdown = false;
        }
        d.probe = { enabled: true, deviceId: n.id };
        d.tags = n.location ? [n.location.toUpperCase()] : [];
        created.push(await api.saveDevice({ device: d }));
      }
      setSelected([]);
      setMessage(`已导入 ${created.length} 台设备，请编辑设备补充 SSH 地址。`);
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      imported(created);
      setBusy(false);
    }
  }
  return (
    <Modal
      title="工作台设置"
      subtitle="连接你的探针，让设备状态自然汇聚。"
      close={() => !busy && close()}
    >
      <SSHGuide />
      <form className="settings-form" onSubmit={save}>
        <h3>
          <Radio size={17} />
          ServerStatus 探针
        </h3>
        <label>
          数据接口
          <input
            type="url"
            required
            value={settings.probeUrl}
            onChange={(e) => setSettings({ ...settings, probeUrl: e.target.value })}
          />
        </label>
        <p className="helper">使用状态站的 /json/stats.json，而非探针上报用的 /report。</p>
        <div className="form-grid">
          <label>
            刷新间隔（秒）
            <input
              type="number"
              min={5}
              max={300}
              value={settings.pollSeconds}
              onChange={(e) => setSettings({ ...settings, pollSeconds: Number(e.target.value) })}
            />
          </label>
          <label>
            过期阈值（秒）
            <input
              type="number"
              min={30}
              max={3600}
              value={settings.staleSeconds}
              onChange={(e) => setSettings({ ...settings, staleSeconds: Number(e.target.value) })}
            />
          </label>
        </div>
        <label>
          接口 Bearer Token（可选）
          <input
            type="password"
            value={token}
            placeholder={
              settings.hasToken ? '已保存，留空不更改' : '公开接口无需填写；不是探针分组密码'
            }
            onChange={(e) => setToken(e.target.value)}
          />
        </label>
        {settings.hasToken && (
          <label className="check">
            <input
              type="checkbox"
              checked={removeToken}
              onChange={(e) => setRemoveToken(e.target.checked)}
            />
            清除接口 Token
          </label>
        )}
        <button className="primary" disabled={busy}>
          保存并连接
        </button>
      </form>
      <div className="import-section">
        <h3>
          发现的设备 <span className="count">{snapshot.nodes.length}</span>
        </h3>
        {snapshot.error && <p className="error">{snapshot.error}</p>}
        <div className="import-list">
          {snapshot.nodes.map((n) => (
            <label key={n.id} className="import-row">
              <input
                type="checkbox"
                disabled={bound.has(n.id) || busy}
                checked={selected.includes(n.id)}
                onChange={(e) =>
                  setSelected((v) =>
                    e.target.checked ? [...v, n.id] : v.filter((id) => id !== n.id),
                  )
                }
              />
              <span className={`status-dot ${n.online ? 'online' : 'offline'}`} />
              <span>
                {n.name}
                <small>
                  {n.location.toUpperCase()} · {n.os || 'Linux'}
                </small>
              </span>
              {bound.has(n.id) && <Check size={15} />}
            </label>
          ))}
          {!snapshot.nodes.length && (
            <p className="helper">连接探针后，可以选择已有节点导入画布。</p>
          )}
        </div>
        <button disabled={busy || !selected.length} onClick={importNodes}>
          导入所选设备 {selected.length > 0 && `(${selected.length})`}
        </button>
      </div>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <div className="vault-note">
        <ShieldCheck size={20} />
        <div>
          <strong>{info.vaultAvailable ? '系统凭据加密已就绪' : '系统凭据加密不可用'}</strong>
          <small>本地数据：{info.dataPath}</small>
          <small>Nexus {info.version} · 仅当前系统用户可解密凭据</small>
        </div>
      </div>
    </Modal>
  );
}
