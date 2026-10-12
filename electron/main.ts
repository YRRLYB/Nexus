import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  clipboard,
  safeStorage,
  Menu,
  net,
  Tray,
  nativeImage,
} from 'electron';
import { join, resolve } from 'node:path';
import { readFile, readdir, lstat, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { Store } from './store';
import { fetchProbe, advancePower } from './probe';
import { connectSSH, executeSSH, listSFTP, withSFTP } from './ssh';
import { discoverServer, DiscoveryCache } from './discovery';
import { previewLocal, previewSFTP } from './preview';
import { installCommand, quickCommand } from './device';
import { devicePlatform } from '../shared/device';
import { systemSSHStatus } from './terminal';
import { Sessions } from './sessions';
import { Deployments, fetchInstaller, toolNames, probeInstallSchema } from './deployment';
import { Transfers } from './transfers';
import probeInstaller from '../scripts/probe/install.sh';
import trayIcon from '../assets/icon.png';
import {
  deviceSchema,
  inputSchema,
  settingsSchema,
  remotePath,
  sshArgs,
  psQuote,
} from '../shared/validation';
import type { Capability, FileListing, PowerState, ProbeSnapshot } from '../shared/types';

if (process.env.NEXUS_DATA_DIR) app.setPath('userData', resolve(process.env.NEXUS_DATA_DIR));
let window: BrowserWindow;
let store: Store;
let quitting = false;
let tray: Tray | undefined;
let trayNoticeShown = false;
function showWindow() {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}
function hideToTray() {
  if (!tray || tray.isDestroyed()) throw new Error('系统托盘不可用');
  window.hide();
  if (!trayNoticeShown && process.platform === 'win32') {
    tray.displayBalloon({
      title: 'Nexus 正在后台运行',
      content: 'SSH、传输和部署任务继续运行。双击托盘图标返回，右键菜单可完全退出。',
      iconType: 'info',
    });
    trayNoticeShown = true;
  }
}
async function requestQuit() {
  const sessionCount = sessions
    .list()
    .filter((item) => ['running', 'verifying'].includes(item.state)).length;
  const transferCount = transfers
    .list()
    .filter((item) => ['queued', 'running', 'waiting'].includes(item.state)).length;
  if (sessionCount || transferCount) {
    showWindow();
    if (
      !(await confirm(
        '完全退出 Nexus？',
        `仍有 ${sessionCount} 个会话和 ${transferCount} 个传输任务。退出会关闭连接；远程安装的后台进程可能继续运行。`,
        true,
      ))
    )
      return;
  }
  app.quit();
}
const states: Record<string, PowerState> = {};
const discoveryCache = new DiscoveryCache();
let probeFlight: Promise<ProbeSnapshot> | undefined;
let probeFlightRevision = -1;
let probeController: AbortController | undefined;
let settingsRevision = 0;
const uid = (id: unknown) => z.string().uuid().parse(id);
function send(name: string, value: unknown) {
  if (window && !window.isDestroyed()) window.webContents.send(name, value);
}
const sessions = new Sessions(
  (output) => send('session:output', output),
  (session) => send('session:state', session),
);
const deployments = new Deployments(
  (id) => connection(id, 'ssh'),
  (id) => JSON.stringify(deviceWith(id, 'ssh').connection),
  sessions,
  (tool) =>
    tool === 'probe'
      ? Promise.resolve(probeInstaller)
      : fetchInstaller(tool, net.fetch as typeof fetch),
);
const transfers = new Transfers(
  (id, signal) => connection(id, 'sftp', signal),
  (task) => send('transfer:state', task),
  (id) => JSON.stringify(deviceWith(id, 'sftp').connection),
  async (conflict, signal) => {
    if (signal.aborted) throw new Error('传输已取消');
    showWindow();
    const differentType = conflict.directory !== conflict.targetDirectory;
    const choices = differentType
      ? (['skip', 'keep-both'] as const)
      : (['skip', 'replace', 'keep-both'] as const);
    const result = await dialog.showMessageBox(window, {
      type: 'question',
      message: conflict.directory ? '目标有同名目录，如何处理？' : '目标有同名文件，如何处理？',
      detail: `${store.device(conflict.task.deviceId).name} · ${conflict.task.direction === 'upload' ? '上传' : '下载'}\n${conflict.path}\n${differentType ? '同名项目分别是文件和目录，可以跳过或保留两份。' : conflict.directory ? '合并保留目标目录中的其他文件，同名项目会继续询问。' : `源文件：${conflict.sourceSize} 字节；目标文件：${conflict.targetSize} 字节。覆盖会替换原内容。`}`,
      buttons: differentType
        ? ['跳过', '保留两份']
        : ['跳过', conflict.directory ? '合并目录' : '覆盖', '保留两份'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      checkboxLabel: conflict.directory ? '应用到此任务中的同名目录' : '应用到此任务中的同名文件',
      signal,
    });
    return { choice: choices[result.response] || 'skip', applyToAll: result.checkboxChecked };
  },
);
function vaultAvailable() {
  return (
    safeStorage.isEncryptionAvailable() &&
    (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')
  );
}
async function confirm(message: string, detail: string, danger = false) {
  const result = await dialog.showMessageBox(window, {
    type: danger ? 'warning' : 'question',
    message,
    detail,
    buttons: ['取消', '确认'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  return result.response === 1;
}
function deviceWith(id: unknown, capability: Capability) {
  const d = store.device(uid(id));
  if (!d.capabilities[capability]) throw new Error('该设备未启用此能力');
  if (!d.connection.host) throw new Error('请先编辑设备，填写 SSH 地址');
  return d;
}
async function connection(id: string, capability: Capability, signal?: AbortSignal) {
  if (quitting) throw new Error('应用正在退出');
  const d = deviceWith(id, capability);
  return connectSSH(
    d,
    store.credential(d.id),
    async (address, fingerprint) => {
      const previous = store.hostKey(address);
      if (previous === fingerprint) return true;
      if (previous)
        throw new Error(
          'SSH 主机密钥已变化。请核实服务器身份后，在数据目录中备份并人工处理主机信任记录。',
        );
      const accepted = await confirm(
        '信任这台服务器的 SSH 主机密钥？',
        `${d.name}\n${address}\n\n${fingerprint}\n\n请与服务器提供的指纹核对。信任记录保存在本机。`,
      );
      if (accepted) store.trustHost(address, fingerprint);
      return accepted;
    },
    signal,
  );
}
function register(name: string, handler: (...args: any[]) => any) {
  ipcMain.handle(name, (event, ...args) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame)
      throw new Error('不受信任的调用来源');
    return handler(...args);
  });
}
async function pollProbe(): Promise<ProbeSnapshot> {
  if (probeFlight && probeFlightRevision === settingsRevision) return probeFlight;
  probeController?.abort();
  const controller = new AbortController();
  probeController = controller;
  const revision = settingsRevision;
  probeFlightRevision = revision;
  const request: Promise<ProbeSnapshot> = (async () => {
    let snapshot: ProbeSnapshot;
    try {
      snapshot = await fetchProbe(store.settings(), store.token(), controller.signal);
    } catch (error) {
      snapshot = {
        nodes: [],
        fetchedAt: Date.now(),
        error: error instanceof Error ? error.message : '探针连接失败',
      };
    }
    if (revision !== settingsRevision) return pollProbe();
    for (const [id, state] of Object.entries(states)) {
      const d = store.devices().find((d) => d.id === id);
      states[id] = advancePower(
        state,
        snapshot.error ? undefined : snapshot.nodes.find((n) => n.id === d?.probe.deviceId),
      );
    }
    return snapshot;
  })().finally(() => {
    if (probeFlight === request) probeFlight = undefined;
  });
  probeFlight = request;
  return request;
}
function setupIPC() {
  register('window:tray', hideToTray);
  register('app:quit', requestQuit);
  register('clipboard:read', () => {
    const text = clipboard.readText();
    if (text.length > 64 * 1024) throw new Error('剪贴板文本超过 64 KB，请分段粘贴');
    return text;
  });
  register('clipboard:write', (text) =>
    clipboard.writeText(
      z
        .string()
        .max(1024 * 1024)
        .parse(text),
    ),
  );
  register('window:state', () => ({ fullScreen: window.isFullScreen() }));
  register('window:fullscreen', (value) => window.setFullScreen(z.boolean().parse(value)));
  register('bootstrap', () => ({
    devices: store.devices(),
    settings: store.settings(),
    vaultAvailable: vaultAvailable(),
    dataPath: app.getPath('userData'),
    version: app.getVersion(),
  }));
  register('device:save', async (raw) => {
    const input = inputSchema.parse(raw);
    let credential = input.credential;
    const old = store.devices().find((d) => d.id === input.device.id);
    if (
      !input.clearCredential &&
      input.device.connection.auth === 'key' &&
      input.device.connection.keyPath &&
      (!old ||
        old.connection.keyPath !== input.device.connection.keyPath ||
        old.connection.auth !== 'key' ||
        credential ||
        !old.hasCredential)
    ) {
      const info = await stat(input.device.connection.keyPath);
      if (!info.isFile() || info.size > 65536) throw new Error('私钥文件无效或过大');
      credential = {
        ...credential,
        privateKey: await readFile(input.device.connection.keyPath, 'utf8'),
      };
    }
    if (credential && !vaultAvailable())
      throw new Error('系统安全凭据存储不可用，未保存任何密码或私钥');
    const authChanged = old && old.connection.auth !== input.device.connection.auth;
    const saved = store.saveDevice(
      input.device,
      credential,
      !!input.clearCredential || !!authChanged,
    );
    discoveryCache.invalidate(saved.id);
    return saved;
  });
  register('device:move', (id, position) => {
    store.move(uid(id), deviceSchema.shape.position.parse(position));
  });
  register('device:delete', async (id) => {
    const d = store.device(uid(id));
    if (
      !(await confirm(`删除 ${d.name}？`, '只删除本机设备配置及其凭据，不会更改远程服务器。', true))
    )
      return false;
    store.deleteDevice(d.id);
    transfers.cancelDevice(d.id);
    deployments.cancelled(d.id);
    for (const session of sessions.list())
      if (session.deviceId === d.id) sessions.close(session.id);
    discoveryCache.invalidate(d.id);
    delete states[d.id];
    return true;
  });
  register('settings:save', (settings, token) => {
    const saved = store.saveSettings(
      settingsSchema.parse(settings),
      token === undefined ? undefined : z.string().max(16384).parse(token),
    );
    settingsRevision++;
    return saved;
  });
  register('probe:poll', pollProbe);
  register('session:list', () => sessions.list());
  register('session:open', async (id) => {
    const device = deviceWith(id, 'ssh');
    sessions.assertCapacity();
    return sessions.open(await connection(device.id, 'ssh'), {
      deviceId: device.id,
      title: device.name,
      kind: 'shell',
    });
  });
  register('session:attach', (id) => sessions.attach(uid(id)));
  register('session:detach', (id) => sessions.detach(uid(id)));
  register('session:input', (id, data) =>
    sessions.write(uid(id), z.string().max(8192).parse(data)),
  );
  register('session:resize', (id, cols, rows) =>
    sessions.resize(
      uid(id),
      z.number().int().min(2).max(500).parse(cols),
      z.number().int().min(1).max(200).parse(rows),
    ),
  );
  register('session:ack', (id, bytes) =>
    sessions.acknowledge(
      uid(id),
      z
        .number()
        .int()
        .min(0)
        .max(1024 * 1024)
        .parse(bytes),
    ),
  );
  register('session:close', (id) => {
    const session = sessions.list().find((item) => item.id === uid(id));
    sessions.close(uid(id));
    if (session?.kind === 'deployment') deployments.cancelled(session.deviceId);
  });
  register('deploy:prepare', async (id, tool) => {
    const device = deviceWith(id, 'ssh');
    deviceWith(id, 'sftp');
    if (devicePlatform(device) !== 'linux') throw new Error('自动部署仅支持 Linux 设备');
    return deployments.prepare(
      device.id,
      z.enum(['docker', 'baota', 'probe', '3x-ui']).parse(tool),
    );
  });
  register('deploy:start', async (id, options) => {
    const plan = deployments.get(uid(id));
    const device = deviceWith(plan.deviceId, 'ssh');
    deviceWith(plan.deviceId, 'sftp');
    const parameters = plan.tool === 'probe' ? probeInstallSchema.parse(options) : undefined;
    if (
      !(await confirm(
        `在 ${device.name} 上安装 ${toolNames[plan.tool]}？`,
        `${device.connection.username}@${device.connection.host}:${device.connection.port}\n来源：${plan.source}\nSHA-256：${plan.sha256}\n\n安装将修改软件包、服务和系统配置。第三方脚本还会下载组件；请先检查脚本并备份服务器。取消不会回滚已完成的改动。`,
        true,
      ))
    )
      return null;
    return deployments.start(plan.id, parameters);
  });
  register('transfer:list', () => transfers.list());
  register('transfer:cancel', (id) => transfers.cancel(uid(id)));
  register('transfer:retry', (id) => transfers.retry(uid(id)));
  register('transfer:clear', (id) => {
    transfers.clear(uid(id));
  });
  register('device:discover', async (id, refresh = false) => {
    const d = deviceWith(id, 'ssh');
    if (devicePlatform(d) !== 'linux') throw new Error('运行识别目前支持 Linux 服务器');
    if (d.connection.auth !== 'agent' && !d.hasCredential)
      throw new Error('请先保存 SSH 密码或私钥，或选择系统 SSH Agent');
    return discoveryCache.get(
      d.id,
      JSON.stringify(d.connection),
      z.boolean().parse(refresh),
      async () => discoverServer(await connection(d.id, 'ssh')),
    );
  });
  register('copy', async (id, field) => {
    const d = store.device(uid(id));
    const selected = z.enum(['host', 'port', 'username', 'password', 'ssh', 'info']).parse(field);
    let value = '';
    if (selected === 'password') {
      value = store.credential(d.id).password || '';
      if (!value) throw new Error('此设备尚未保存密码');
      if (
        !(await confirm(
          '复制设备密码？',
          '密码将进入系统剪贴板，30 秒后自动清除（若剪贴板仍为此密码）。',
        ))
      )
        return;
      clipboard.writeText(value);
      setTimeout(() => {
        if (clipboard.readText() === value) clipboard.clear();
      }, 30_000).unref();
      return;
    }
    if (selected === 'host') value = d.connection.host;
    if (selected === 'port') value = String(d.connection.port);
    if (selected === 'username') value = d.connection.username;
    if (selected === 'ssh') value = 'ssh ' + sshArgs(d).map(psQuote).join(' ');
    if (selected === 'info')
      value = `${d.name}\n${d.os}\nIP: ${d.connection.host}\nPort: ${d.connection.port}\nUser: ${d.connection.username}`;
    clipboard.writeText(value);
  });
  register('ssh:open', async (id) => {
    const d = deviceWith(id, 'ssh');
    if (process.platform !== 'win32') throw new Error('此版本的系统终端启动仅支持 Windows');
    if (!(await systemSSHStatus()).available)
      throw new Error(
        '本机未安装 OpenSSH Client，请在“探针与连接 → Windows 可以使用 SSH”查看启用方法',
      );
    const script =
      '& ssh.exe ' + sshArgs(d).map(psQuote).join(' ') + '; Write-Host "`nSSH session ended."';
    const exe = join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    await new Promise<void>((done, reject) => {
      const child = spawn(
        exe,
        [
          '-NoProfile',
          '-NoExit',
          '-EncodedCommand',
          Buffer.from(script, 'utf16le').toString('base64'),
        ],
        { detached: true, stdio: 'ignore', windowsHide: false },
      );
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        done();
      });
    });
  });
  register('ssh:status', systemSSHStatus);
  register('install:copy', async (id, tool) => {
    const d = deviceWith(id, 'ssh');
    if (devicePlatform(d) !== 'linux') throw new Error('自动安装脚本目前仅适用于 Linux 设备');
    const selected = z.enum(['docker', 'probe']).parse(tool);
    clipboard.writeText(installCommand(selected));
  });
  register('power', async (id, action) => {
    const selected = z.enum(['restart', 'shutdown']).parse(action);
    const d = deviceWith(id, selected);
    if (devicePlatform(d) !== 'linux') throw new Error('电源操作仅适用于 Linux 设备');
    if (states[d.id] && !['complete', 'timeout'].includes(states[d.id].phase))
      throw new Error('此设备已有待完成的电源操作');
    if (
      !(await confirm(
        `${selected === 'restart' ? '重启' : '关闭'} ${d.name}？`,
        `目标：${d.connection.username}@${d.connection.host}:${d.connection.port}\n将在约 1 分钟后执行，运行中的任务会被中断。需要 root 或免密码 sudo 权限。`,
        true,
      ))
    )
      return false;
    await executeSSH(
      await connection(id, selected),
      `${d.connection.username === 'root' ? '' : 'sudo -n '}shutdown ${selected === 'restart' ? '-r' : '-h'} +1`,
    );
    states[d.id] = { action: selected, phase: 'waiting-offline', startedAt: Date.now() };
    return true;
  });
  register('power:states', () => states);
  register('quick', async (id, action) => {
    const selected = z.enum(['docker', 'services', 'logs', 'sysinfo']).parse(action);
    const d = deviceWith(id, 'ssh');
    const output = await executeSSH(await connection(d.id, 'ssh'), quickCommand(d, selected));
    if (selected === 'sysinfo') {
      const d = store.device(id);
      d.os = output.trim().slice(0, 160);
      store.saveDevice(d);
    }
    return output;
  });
  register('key:pick', async () => {
    const r = await dialog.showOpenDialog(window, {
      title: '选择 SSH 私钥',
      properties: ['openFile'],
    });
    return r.canceled ? null : r.filePaths[0];
  });
  register('local:folder', async () => {
    const r = await dialog.showOpenDialog(window, { properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  register('local:list', async (path) => {
    const directory =
      path === undefined ? app.getPath('home') : z.string().min(1).max(4096).parse(path);
    const files = await readdir(directory, { withFileTypes: true });
    const entries = await Promise.all(
      files.map(async (file) => {
        try {
          const info = await lstat(join(directory, file.name));
          return {
            name: file.name,
            directory: info.isDirectory(),
            symlink: info.isSymbolicLink(),
            size: info.size,
            mode: (info.mode & 0o7777).toString(8),
            modified: info.mtimeMs,
          };
        } catch {
          return null;
        }
      }),
    );
    return {
      path: resolve(directory),
      entries: entries
        .filter((e) => e !== null)
        .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name)),
    } satisfies FileListing;
  });
  register('local:preview', async (path) => previewLocal(z.string().min(1).max(4096).parse(path)));
  register('remote:list', async (id, path) => {
    const p = remotePath(path);
    return withSFTP(await connection(uid(id), 'sftp'), (s) => listSFTP(s, p), 30_000);
  });
  register('remote:preview', async (id, path) => {
    const p = remotePath(path);
    return withSFTP(await connection(uid(id), 'sftp'), (s) => previewSFTP(s, p), 30_000);
  });
  register('remote:upload', async (id, remoteDir, paths, folders = false) => {
    const device = deviceWith(id, 'sftp');
    const directory = remotePath(remoteDir);
    const folder = z.boolean().parse(folders);
    const selected =
      paths === undefined
        ? (
            await dialog.showOpenDialog(window, {
              title: folder ? '选择上传的目录' : '选择上传的文件',
              properties: [folder ? 'openDirectory' : 'openFile', 'multiSelections'],
            })
          ).filePaths
        : z.array(z.string().min(1).max(4096)).max(200).parse(paths);
    return selected.map((source) =>
      transfers.enqueue(device.id, 'upload', resolve(source), directory),
    );
  });
  register('remote:download', async (id, path) => {
    const device = deviceWith(id, 'sftp');
    const source = remotePath(path);
    const result = await dialog.showOpenDialog(window, {
      title: '选择下载到的文件夹',
      defaultPath: app.getPath('downloads'),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return transfers.enqueue(device.id, 'download', source, result.filePaths[0]);
  });
  register('remote:mutate', async (id, action, path, target) => {
    uid(id);
    const selected = z.enum(['mkdir', 'rename', 'delete']).parse(action);
    const source = remotePath(path);
    const destination = selected === 'rename' ? remotePath(target) : undefined;
    if (
      selected === 'delete' &&
      !(await confirm('删除远程项目？', `${source}\n此操作不可撤销。目录只允许删除空目录。`, true))
    )
      return false;
    await withSFTP(
      await connection(id, 'sftp'),
      async (sftp) => {
        await new Promise<void>((done, reject) => {
          const cb = (e?: Error | null) => (e ? reject(e) : done());
          if (selected === 'mkdir') sftp.mkdir(source, cb);
          else if (selected === 'rename')
            sftp.lstat(destination!, (e) => {
              if (!e) return reject(new Error('目标名称已存在，请选择其他名称'));
              if ((e as any).code !== 2) return reject(e);
              sftp.rename(source, destination!, cb);
            });
          else
            sftp.lstat(source, (e, attrs) =>
              e
                ? reject(e)
                : attrs.isDirectory()
                  ? sftp.rmdir(source, cb)
                  : sftp.unlink(source, cb),
            );
        });
      },
      30_000,
    );
    return true;
  });
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    showWindow();
  });
  app
    .whenReady()
    .then(async () => {
      store = await Store.open(join(app.getPath('userData'), 'nexus.sqlite'), {
        encrypt: (value) => {
          if (!vaultAvailable()) throw new Error('系统凭据库不可用');
          return safeStorage.encryptString(value).toString('base64');
        },
        decrypt: (value) => {
          if (!vaultAvailable()) throw new Error('系统凭据库不可用');
          return safeStorage.decryptString(Buffer.from(value, 'base64'));
        },
      });
      Menu.setApplicationMenu(null);
      window = new BrowserWindow({
        width: 1440,
        height: 940,
        minWidth: 860,
        minHeight: 600,
        backgroundColor: '#e8edf5',
        titleBarStyle: 'hidden',
        titleBarOverlay: { color: '#00000000', symbolColor: '#566074', height: 42 },
        title: 'Nexus',
        show: false,
        webPreferences: {
          preload: join(__dirname, 'preload.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          backgroundThrottling: false,
        },
      });
      try {
        tray = new Tray(nativeImage.createFromDataURL(trayIcon).resize({ width: 20, height: 20 }));
        tray.setToolTip('Nexus');
        tray.setContextMenu(
          Menu.buildFromTemplate([
            { label: '打开 Nexus', click: showWindow },
            { type: 'separator' },
            {
              label: '完全退出',
              click: () => {
                void requestQuit();
              },
            },
          ]),
        );
        tray.on('click', showWindow);
        tray.on('double-click', showWindow);
      } catch {
        tray = undefined;
      }
      window.on('close', (event) => {
        if (quitting) return;
        event.preventDefault();
        if (tray && !tray.isDestroyed() && store.settings().closeToTray !== false) {
          hideToTray();
        } else void requestQuit();
      });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event) => event.preventDefault());
      window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) =>
        callback(false),
      );
      setupIPC();
      // On Windows these events fire before isFullScreen() reflects the new value.
      window.on('enter-full-screen', () =>
        window.webContents.send('window:state', { fullScreen: true }),
      );
      window.on('leave-full-screen', () =>
        window.webContents.send('window:state', { fullScreen: false }),
      );
      window.webContents.on('before-input-event', (event, input) => {
        if (input.type === 'keyDown' && input.key === 'F11') {
          event.preventDefault();
          window.setFullScreen(!window.isFullScreen());
        }
      });
      window.once('ready-to-show', () => window.show());
      const dev = !app.isPackaged && process.env.NEXUS_DEV_URL;
      if (dev === 'http://127.0.0.1:5173') await window.loadURL(dev);
      else await window.loadURL(pathToFileURL(join(__dirname, '../dist/index.html')).toString());
    })
    .catch((error) => {
      dialog.showErrorBox('Nexus 启动失败', error.message);
      app.quit();
    });
}
app.on('before-quit', () => {
  quitting = true;
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  quitting = true;
  sessions.dispose();
  transfers.dispose();
  tray?.destroy();
  store?.close();
});
