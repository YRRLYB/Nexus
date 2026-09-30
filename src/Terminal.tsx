import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Plus, RotateCw, X } from 'lucide-react';
import type { Device, SessionInfo, SessionOutput } from '../shared/types';
import { api, errorText, Modal } from './ui';
import '@xterm/xterm/css/xterm.css';
import './operations.css';

export const sessionLabels = {
  running: '运行中',
  verifying: '验证结果',
  complete: '已完成',
  failed: '失败',
  cancelled: '已请求中断',
  closed: '已断开',
};
export function TerminalPane({
  session,
  active = true,
}: {
  session: SessionInfo;
  active?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const resize = useRef<() => void>(() => {});
  const [error, setError] = useState('');
  useEffect(() => {
    const terminal = new XTerm({
      cursorBlink: true,
      fontSize: 15,
      fontFamily: 'Cascadia Mono, Consolas, monospace',
      scrollback: 3000,
      allowProposedApi: false,
      theme: {
        background: '#111827',
        foreground: '#e5e7eb',
        cursor: '#93c5fd',
        selectionBackground: '#334155',
      },
      linkHandler: { activate: () => {} },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container.current!);
    let alive = true;
    let initialized = false;
    let sequence = -1;
    const backlog: SessionOutput[] = [];
    let pendingInput = 0;
    let writes = Promise.resolve();
    const input = terminal.onData((data) => {
      if (pendingInput + data.length > 64 * 1024) {
        setError('粘贴内容过大或服务器繁忙，请分段发送');
        return;
      }
      pendingInput += data.length;
      writes = writes
        .then(async () => {
          for (let offset = 0; offset < data.length;) {
            let end = Math.min(data.length, offset + 4096);
            if (end < data.length && /[\uD800-\uDBFF]/.test(data[end - 1])) end--;
            await api.writeSession(session.id, data.slice(offset, end));
            offset = end;
          }
        })
        .catch((failure) => {
          if (alive) setError(errorText(failure));
        })
        .finally(() => {
          pendingInput -= data.length;
        });
    });
    const display = (output: SessionOutput) => {
      if (output.sequence <= sequence) return;
      sequence = output.sequence;
      terminal.write(
        Uint8Array.from(atob(output.data), (character) => character.charCodeAt(0)),
        () => {
          if (alive && output.bytes)
            void api.acknowledgeSession(session.id, output.bytes).catch(() => {});
        },
      );
    };
    const unsubscribe = api.onSessionOutput((output) => {
      if (output.id !== session.id) return;
      if (!initialized) backlog.push(output);
      else display(output);
    });
    void api
      .attachSession(session.id)
      .then((snapshot) => {
        if (!alive) return;
        display(snapshot);
        initialized = true;
        for (const output of backlog) display(output);
        backlog.length = 0;
      })
      .catch((failure) => {
        if (alive) setError(errorText(failure));
      });
    resize.current = () => {
      if (!alive || !container.current?.offsetWidth) return;
      fit.fit();
      terminal.resize(Math.min(500, terminal.cols), Math.min(200, terminal.rows));
      void api.resizeSession(session.id, terminal.cols, terminal.rows).catch(() => {});
    };
    const observer = new ResizeObserver(() => resize.current());
    observer.observe(container.current!);
    resize.current();
    return () => {
      alive = false;
      unsubscribe();
      observer.disconnect();
      input.dispose();
      terminal.dispose();
      void api.detachSession(session.id).catch(() => {});
    };
  }, [session.id]);
  useEffect(() => {
    if (active) resize.current();
  }, [active]);
  return (
    <div className="terminal-pane" hidden={!active} data-session-id={session.id}>
      <div
        className="terminal-screen"
        ref={container}
        onKeyDown={(event) => event.stopPropagation()}
      />
      <div className={`session-status ${session.state}`} role="status">
        {sessionLabels[session.state]}
        {session.exitCode !== undefined && ` · 退出码 ${session.exitCode}`}
        {session.message && ` · ${session.message}`}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function TerminalWorkspace({
  initial,
  devices,
  close,
}: {
  initial: string;
  devices: Device[];
  close: () => void;
}) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [selected, setSelected] = useState(initial);
  const [deviceId, setDeviceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const unsubscribe = api.onSessionState((session) => {
      if (session.kind !== 'shell') return;
      setSessions((previous) =>
        previous.some((item) => item.id === session.id)
          ? previous.map((item) => (item.id === session.id ? session : item))
          : [...previous, session],
      );
    });
    void api
      .sessions()
      .then((items) => {
        setSessions(items.filter((item) => item.kind === 'shell'));
        setDeviceId(
          items.find((item) => item.id === initial)?.deviceId ||
            devices.find((item) => item.capabilities.ssh)?.id ||
            '',
        );
      })
      .catch((failure) => setError(errorText(failure)));
    return unsubscribe;
  }, []);
  async function open(id: string) {
    setBusy(true);
    setError('');
    try {
      const session = await api.openTerminal(id);
      setSessions((previous) =>
        previous.some((item) => item.id === session.id) ? previous : [...previous, session],
      );
      setSelected(session.id);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }
  const current = sessions.find((item) => item.id === selected);
  return (
    <Modal
      wide
      title="SSH 终端"
      subtitle="收起窗口不关闭会话；关闭会话请使用标签上的 ×。"
      close={close}
      className="terminal-modal"
    >
      <div className="terminal-toolbar">
        <select
          aria-label="连接设备"
          value={deviceId}
          onChange={(event) => setDeviceId(event.target.value)}
        >
          {devices
            .filter((item) => item.capabilities.ssh)
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
        </select>
        <button disabled={busy || !deviceId} onClick={() => void open(deviceId)}>
          <Plus size={15} />
          新会话
        </button>
        {current && current.state !== 'running' && (
          <button disabled={busy} onClick={() => void open(current.deviceId)}>
            <RotateCw size={15} />
            重新连接
          </button>
        )}
      </div>
      <div className="session-tabs" role="tablist" aria-label="SSH 会话">
        {sessions.map((session) => (
          <div key={session.id} className={session.id === selected ? 'selected' : ''}>
            <button
              role="tab"
              aria-selected={session.id === selected}
              onClick={() => setSelected(session.id)}
            >
              {session.title} · {sessionLabels[session.state]}
            </button>
            <button
              aria-label={`关闭会话 ${session.title}`}
              onClick={() => {
                void api
                  .closeSession(session.id)
                  .then(() => {
                    setSessions((previous) => previous.filter((item) => item.id !== session.id));
                    if (selected === session.id)
                      setSelected(sessions.find((item) => item.id !== session.id)?.id || '');
                  })
                  .catch((failure) => setError(errorText(failure)));
              }}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      {sessions.map((session) => (
        <TerminalPane key={session.id} session={session} active={session.id === selected} />
      ))}
      {!sessions.length && <p className="helper">选择设备，然后打开新会话。</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="helper">
        终端内的 Esc、Tab、Ctrl+C 会发送到服务器。密码输入由远端控制是否回显。
      </p>
    </Modal>
  );
}
