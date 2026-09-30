import { app, BrowserWindow, ipcMain, dialog, clipboard, safeStorage, Menu } from 'electron';
import { join, basename, posix, resolve } from 'node:path';
import { readFile, readdir, lstat, stat, rename, unlink } from 'node:fs/promises';
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
import {
  deviceSchema,
  inputSchema,
  settingsSchema,
  remotePath,
  sshArgs,
  psQuote,
} from '../shared/validation';
import type {
  Capability,
  FileListing,
  PowerState,
  ProbeSnapshot,
  TransferProgress,
} from '../shared/types';

if (process.env.NEXUS_DATA_DIR) app.setPath('userData', resolve(process.env.NEXUS_DATA_DIR));
let window: BrowserWindow;
let store: Store;
const states: Record<string, PowerState> = {};
const discoveryCache = new DiscoveryCache();
let probeFlight: Promise<ProbeSnapshot> | undefined;
let probeFlightRevision = -1;
let probeController: AbortController | undefined;
let settingsRevision = 0;
const uid = (id: unknown) => z.string().uuid().parse(id);
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
async function connection(id: string, capability: Capability) {
  const d = deviceWith(id, capability);
  return connectSSH(d, store.credential(d.id), async (address, fingerprint) => {
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
  });
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
  register('remote:upload', async (id, remoteDir, paths) => {
    uid(id);
    const directory = remotePath(remoteDir);
    const selected =
      paths === undefined
        ? (
            await dialog.showOpenDialog(window, {
              title: '选择上传的文件',
              properties: ['openFile', 'multiSelections'],
            })
          ).filePaths
        : z.array(z.string().min(1).max(4096)).max(200).parse(paths);
    if (!selected.length) return 0;
    const locals = await Promise.all(
      selected.map(async (path) => {
        const info = await stat(path);
        if (!info.isFile()) throw new Error('当前仅支持上传文件，请先将目录打包');
        return path;
      }),
    );
    return withSFTP(await connection(id, 'sftp'), async (sftp) => {
      let count = 0;
      for (const local of locals) {
        const target = posix.join(directory, basename(local));
        const existing = await new Promise<boolean>((done, reject) =>
          sftp.lstat(target, (e) =>
            e ? ((e as any).code === 2 ? done(false) : reject(e)) : done(true),
          ),
        );
        if (existing && !(await confirm('覆盖远程文件？', target, true))) continue;
        await new Promise<void>((done, reject) =>
          sftp.fastPut(
            local,
            target,
            {
              step: (transferred, _, total) =>
                progress({ name: basename(local), transferred, total }),
            },
            (error) => (error ? reject(error) : done()),
          ),
        );
        count++;
      }
      return count;
    });
  });
  register('remote:download', async (id, path) => {
    uid(id);
    const source = remotePath(path);
    const result = await dialog.showSaveDialog(window, {
      defaultPath: join(app.getPath('downloads'), posix.basename(source)),
    });
    if (result.canceled || !result.filePath) return false;
    const dest = result.filePath;
    const temp = dest + '.' + crypto.randomUUID() + '.nexus-part';
    try {
      await withSFTP(
        await connection(id, 'sftp'),
        (sftp) =>
          new Promise<void>((done, reject) =>
            sftp.fastGet(
              source,
              temp,
              {
                step: (transferred, _, total) =>
                  progress({ name: posix.basename(source), transferred, total }),
              },
              (error) => (error ? reject(error) : done()),
            ),
          ),
      );
      await rename(temp, dest);
      return true;
    } finally {
      await unlink(temp).catch(() => {});
    }
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
function progress(value: TransferProgress) {
  if (!window.isDestroyed()) window.webContents.send('transfer:progress', value);
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
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
        },
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
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => store?.close());
