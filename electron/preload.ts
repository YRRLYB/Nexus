import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  NexusAPI,
  TransferProgress,
  SessionInfo,
  SessionOutput,
  TransferTask,
} from '../shared/types';
function subscribe<T>(name: string, callback: (value: T) => void) {
  const listener = (_: unknown, value: T) => callback(value);
  ipcRenderer.on(name, listener);
  return () => {
    ipcRenderer.removeListener(name, listener);
  };
}
const api: NexusAPI = {
  discover: (id, refresh) => ipcRenderer.invoke('device:discover', id, refresh),
  windowState: () => ipcRenderer.invoke('window:state'),
  setFullScreen: (value) => ipcRenderer.invoke('window:fullscreen', value),
  hideToTray: () => ipcRenderer.invoke('window:tray'),
  quit: () => ipcRenderer.invoke('app:quit'),
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  writeClipboard: (text) => ipcRenderer.invoke('clipboard:write', text),
  onWindowState: (callback) => {
    const listener = (_: unknown, state: { fullScreen: boolean }) => callback(state);
    ipcRenderer.on('window:state', listener);
    return () => {
      ipcRenderer.removeListener('window:state', listener);
    };
  },
  bootstrap: () => ipcRenderer.invoke('bootstrap'),
  saveDevice: (input) => ipcRenderer.invoke('device:save', input),
  deleteDevice: (id) => ipcRenderer.invoke('device:delete', id),
  moveDevice: (id, position) => ipcRenderer.invoke('device:move', id, position),
  saveSettings: (settings, token) => ipcRenderer.invoke('settings:save', settings, token),
  pollProbe: () => ipcRenderer.invoke('probe:poll'),
  copy: (id, field) => ipcRenderer.invoke('copy', id, field),
  openSSH: (id) => ipcRenderer.invoke('ssh:open', id),
  sshStatus: () => ipcRenderer.invoke('ssh:status'),
  copyInstallCommand: (id, tool) => ipcRenderer.invoke('install:copy', id, tool),
  prepareDeployment: (id, tool) => ipcRenderer.invoke('deploy:prepare', id, tool),
  startDeployment: (id, options) => ipcRenderer.invoke('deploy:start', id, options),
  openTerminal: (id) => ipcRenderer.invoke('session:open', id),
  sessions: () => ipcRenderer.invoke('session:list'),
  attachSession: (id) => ipcRenderer.invoke('session:attach', id),
  detachSession: (id) => ipcRenderer.invoke('session:detach', id),
  writeSession: (id, data) => ipcRenderer.invoke('session:input', id, data),
  resizeSession: (id, cols, rows) => ipcRenderer.invoke('session:resize', id, cols, rows),
  acknowledgeSession: (id, bytes) => ipcRenderer.invoke('session:ack', id, bytes),
  closeSession: (id) => ipcRenderer.invoke('session:close', id),
  onSessionOutput: (callback) => subscribe<SessionOutput>('session:output', callback),
  onSessionState: (callback) => subscribe<SessionInfo>('session:state', callback),
  power: (id, action) => ipcRenderer.invoke('power', id, action),
  powerStates: () => ipcRenderer.invoke('power:states'),
  quickAction: (id, action) => ipcRenderer.invoke('quick', id, action),
  pickKey: () => ipcRenderer.invoke('key:pick'),
  listRemote: (id, path) => ipcRenderer.invoke('remote:list', id, path),
  listLocal: (path) => ipcRenderer.invoke('local:list', path),
  previewRemote: (id, path) => ipcRenderer.invoke('remote:preview', id, path),
  previewLocal: (path) => ipcRenderer.invoke('local:preview', path),
  pickLocalFolder: () => ipcRenderer.invoke('local:folder'),
  upload: (id, remoteDir, paths, folders) =>
    ipcRenderer.invoke('remote:upload', id, remoteDir, paths, folders),
  download: (id, path) => ipcRenderer.invoke('remote:download', id, path),
  transfers: () => ipcRenderer.invoke('transfer:list'),
  cancelTransfer: (id) => ipcRenderer.invoke('transfer:cancel', id),
  retryTransfer: (id) => ipcRenderer.invoke('transfer:retry', id),
  clearTransfers: (id) => ipcRenderer.invoke('transfer:clear', id),
  onTransfer: (callback) => subscribe<TransferTask>('transfer:state', callback),
  mutateRemote: (id, action, path, target) =>
    ipcRenderer.invoke('remote:mutate', id, action, path, target),
  onProgress: (callback) => {
    const listener = (_: unknown, progress: TransferProgress) => callback(progress);
    ipcRenderer.on('transfer:progress', listener);
    return () => {
      ipcRenderer.removeListener('transfer:progress', listener);
    };
  },
  droppedPaths: (files) => files.map((file) => webUtils.getPathForFile(file)).filter(Boolean),
};
contextBridge.exposeInMainWorld('nexus', api);
