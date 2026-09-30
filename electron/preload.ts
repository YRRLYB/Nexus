import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { NexusAPI, TransferProgress } from '../shared/types';
const api: NexusAPI = {
  discover: (id, refresh) => ipcRenderer.invoke('device:discover', id, refresh),
  windowState: () => ipcRenderer.invoke('window:state'),
  setFullScreen: (value) => ipcRenderer.invoke('window:fullscreen', value),
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
  power: (id, action) => ipcRenderer.invoke('power', id, action),
  powerStates: () => ipcRenderer.invoke('power:states'),
  quickAction: (id, action) => ipcRenderer.invoke('quick', id, action),
  pickKey: () => ipcRenderer.invoke('key:pick'),
  listRemote: (id, path) => ipcRenderer.invoke('remote:list', id, path),
  listLocal: (path) => ipcRenderer.invoke('local:list', path),
  previewRemote: (id, path) => ipcRenderer.invoke('remote:preview', id, path),
  previewLocal: (path) => ipcRenderer.invoke('local:preview', path),
  pickLocalFolder: () => ipcRenderer.invoke('local:folder'),
  upload: (id, remoteDir, paths) => ipcRenderer.invoke('remote:upload', id, remoteDir, paths),
  download: (id, path) => ipcRenderer.invoke('remote:download', id, path),
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
