import { randomUUID } from 'node:crypto';
import type { Client, ClientChannel } from 'ssh2';
import type { SessionInfo, SessionOutput } from '../shared/types';

interface Session {
  info: SessionInfo;
  client: Client;
  channel: ClientChannel;
  history: Buffer[];
  historyBytes: number;
  sequence: number;
  pending: number;
  attached: boolean;
  ended: boolean;
}
export class Sessions {
  private entries = new Map<string, Session>();
  constructor(
    private output: (value: SessionOutput) => void,
    private state: (value: SessionInfo) => void,
  ) {}
  list() {
    return [...this.entries.values()].map((session) => ({ ...session.info }));
  }
  assertCapacity() {
    if (this.list().filter((item) => ['running', 'verifying'].includes(item.state)).length >= 12)
      throw new Error('最多同时打开 12 个会话，请先关闭不使用的会话');
  }
  async open(
    client: Client,
    details: Pick<SessionInfo, 'deviceId' | 'title' | 'kind' | 'tool'>,
    command?: string,
    onExit?: (id: string, code: number | undefined, error?: string) => Promise<void>,
  ): Promise<SessionInfo> {
    try {
      this.assertCapacity();
      const channel = await new Promise<ClientChannel>((resolve, reject) => {
        let settled = false;
        const closed = () => ready(new Error('SSH 会话建立失败'));
        const errored = (error: Error) => ready(error);
        const timer = setTimeout(() => ready(new Error('SSH 会话建立超时')), 30_000);
        client.once('close', closed);
        client.once('error', errored);
        const ready = (error?: Error, stream?: ClientChannel) => {
          if (settled) {
            stream?.close();
            return;
          }
          settled = true;
          clearTimeout(timer);
          client.removeListener('close', closed);
          client.removeListener('error', errored);
          if (error) reject(error);
          else resolve(stream!);
        };
        const pty = { term: 'xterm-256color', cols: 100, rows: 28 };
        if (command) client.exec(command, { pty }, ready);
        else client.shell(pty, ready);
      });
      const session: Session = {
        info: { id: randomUUID(), ...details, state: 'running' },
        client,
        channel,
        history: [],
        historyBytes: 0,
        sequence: 0,
        pending: 0,
        attached: false,
        ended: false,
      };
      for (const [id, previous] of this.entries)
        if (this.entries.size >= 32 && previous.ended) this.entries.delete(id);
      this.entries.set(session.info.id, session);
      const finish = (code?: number, error?: string) => {
        if (session.ended) return;
        session.ended = true;
        client.end();
        if (onExit) {
          this.update(session.info.id, { state: 'verifying', exitCode: code });
          void onExit(session.info.id, code, error).catch((failure) =>
            this.update(session.info.id, { state: 'failed', message: String(failure) }),
          );
        } else
          this.update(session.info.id, {
            state: error || (code !== undefined && code !== 0) ? 'failed' : 'closed',
            exitCode: code,
            message: error,
          });
      };
      channel.on('data', (data: Buffer) => this.record(session, data));
      channel.stderr.on('data', (data: Buffer) => this.record(session, data));
      channel.once('error', (error: Error) => finish(undefined, error.message));
      channel.once('close', (code: number | undefined) => finish(code));
      client.once('error', (error: Error) => finish(undefined, error.message));
      client.once('close', () => finish(undefined, 'SSH 连接中断，远程进程状态未知'));
      this.state({ ...session.info });
      return { ...session.info };
    } catch (error) {
      client.destroy();
      throw error;
    }
  }
  private record(session: Session, data: Buffer) {
    for (let offset = 0; offset < data.length; offset += 64 * 1024) {
      const chunk = data.subarray(offset, offset + 64 * 1024);
      session.history.push(Buffer.from(chunk));
      session.historyBytes += chunk.length;
      while (session.historyBytes > 1024 * 1024)
        session.historyBytes -= session.history.shift()!.length;
      session.sequence++;
      if (!session.attached) continue;
      session.pending += chunk.length;
      this.output({
        id: session.info.id,
        sequence: session.sequence,
        data: chunk.toString('base64'),
        bytes: chunk.length,
      });
      if (session.pending >= 256 * 1024) {
        session.channel.pause();
        session.channel.stderr.pause();
      }
    }
  }
  private get(id: string) {
    const session = this.entries.get(id);
    if (!session) throw new Error('会话不存在或已释放');
    return session;
  }
  attach(id: string): SessionOutput {
    const session = this.get(id);
    const output = {
      id,
      sequence: session.sequence,
      data: Buffer.concat(session.history, session.historyBytes).toString('base64'),
      bytes: 0,
    };
    session.pending = 0;
    session.attached = true;
    session.channel.resume();
    session.channel.stderr.resume();
    return output;
  }
  detach(id: string) {
    const session = this.get(id);
    session.attached = false;
    session.pending = 0;
    session.channel.resume();
    session.channel.stderr.resume();
  }
  acknowledge(id: string, bytes: number) {
    const session = this.get(id);
    session.pending = Math.max(0, session.pending - bytes);
    if (session.pending < 64 * 1024) {
      session.channel.resume();
      session.channel.stderr.resume();
    }
  }
  write(id: string, data: string) {
    const session = this.get(id);
    if (session.ended) throw new Error('会话已结束');
    if (session.channel.writableLength >= 64 * 1024)
      throw new Error('服务器暂时无法接收输入，请稍候');
    session.channel.write(data);
  }
  resize(id: string, cols: number, rows: number) {
    const session = this.get(id);
    if (!session.ended) session.channel.setWindow(rows, cols, 0, 0);
  }
  update(id: string, value: Partial<SessionInfo>) {
    const session = this.get(id);
    Object.assign(session.info, value);
    this.state({ ...session.info });
  }
  close(id: string) {
    const session = this.get(id);
    if (!session.ended) {
      session.ended = true;
      if (session.info.kind === 'deployment') {
        session.channel.write('\x03');
        session.channel.signal('INT');
        setTimeout(() => session.client.destroy(), 1500).unref();
        this.update(id, {
          state: 'cancelled',
          message: '已请求中断安装；部分改动或后台进程可能保留，请检查服务器。',
        });
      } else {
        session.channel.close();
        session.client.end();
        this.update(id, { state: 'closed' });
      }
    }
    if (session.info.kind === 'shell') this.entries.delete(id);
  }
  dispose() {
    for (const session of this.entries.values()) {
      session.ended = true;
      session.client.destroy();
    }
    this.entries.clear();
  }
}
