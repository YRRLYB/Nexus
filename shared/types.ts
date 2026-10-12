export type DeviceType = 'linux-server' | 'linux-vps' | 'windows' | 'macos' | 'nas';
export type Capability = 'ssh' | 'sftp' | 'restart' | 'shutdown';
export interface Device {
  id: string;
  name: string;
  type: DeviceType;
  icon: string;
  tags: string[];
  notes: string;
  os: string;
  location?: string;
  position: { x: number; y: number };
  connection: {
    host: string;
    port: number;
    username: string;
    auth: 'password' | 'key' | 'agent';
    keyPath: string;
  };
  probe: { enabled: boolean; deviceId: string };
  capabilities: Record<Capability, boolean>;
  hasCredential?: boolean;
}
export interface Credential {
  password?: string;
  passphrase?: string;
  privateKey?: string;
}
export interface DeviceInput {
  device: Device;
  credential?: Credential;
  clearCredential?: boolean;
}
export interface Settings {
  probeUrl: string;
  pollSeconds: number;
  staleSeconds: number;
  closeToTray?: boolean;
  hasToken?: boolean;
}
export interface ProbeNode {
  id: string;
  name: string;
  location: string;
  online: boolean;
  stale: boolean;
  cpu: number | null;
  memory: number | null;
  disk: number | null;
  memoryUsed: number | null;
  memoryTotal: number | null;
  diskUsed: number | null;
  diskTotal: number | null;
  os: string;
  uptime: string;
  rx: number | null;
  tx: number | null;
  lastSeen: number;
  latency: number | null;
}
export interface ProbeSnapshot {
  nodes: ProbeNode[];
  fetchedAt: number;
  error?: string;
}
export interface FileEntry {
  name: string;
  directory: boolean;
  symlink: boolean;
  size: number;
  mode: string;
  modified: number;
}
export interface FileListing {
  path: string;
  entries: FileEntry[];
}
export interface TransferProgress {
  name: string;
  transferred: number;
  total: number;
}
export type InstallTool = 'docker' | 'baota' | 'probe' | '3x-ui';
export interface DeploymentCheck {
  system: string;
  distribution: string;
  version: string;
  architecture: string;
  user: string;
  root: boolean;
  sudo: boolean;
  systemd: boolean;
  installed: boolean;
  blockers: string[];
}
export interface DeploymentPlan {
  id: string;
  deviceId: string;
  tool: InstallTool;
  source: string;
  sha256: string;
  script: string;
  check: DeploymentCheck;
  expiresAt: number;
}
export interface ProbeInstallOptions {
  server: string;
  group: string;
  alias: string;
  location: string;
}
export interface SessionInfo {
  id: string;
  deviceId: string;
  title: string;
  kind: 'shell' | 'deployment';
  tool?: InstallTool;
  state: 'running' | 'verifying' | 'complete' | 'failed' | 'cancelled' | 'closed';
  message?: string;
  exitCode?: number;
}
export interface SessionOutput {
  id: string;
  sequence: number;
  data: string;
  bytes: number;
}
export interface TransferTask {
  id: string;
  deviceId: string;
  direction: 'upload' | 'download';
  name: string;
  state: 'queued' | 'running' | 'waiting' | 'complete' | 'failed' | 'cancelled';
  transferred: number;
  total: number;
  files: number;
  skipped?: number;
  error?: string;
}
export interface TransferConflict {
  task: TransferTask;
  path: string;
  directory: boolean;
  sourceSize: number;
  targetDirectory: boolean;
  targetSize: number;
}
export type ConflictChoice = 'skip' | 'replace' | 'keep-both';
export interface ConflictDecision {
  choice: ConflictChoice;
  applyToAll?: boolean;
}
export type QuickAction = 'docker' | 'services' | 'logs' | 'sysinfo';
export type FilePreview = {
  path: string;
  size: number;
  truncated: boolean;
} & ({ kind: 'image'; mime: string; data: string } | { kind: 'text'; text: string });
export interface SSHStatus {
  available: boolean;
  version: string;
  platform: string;
}
export type PowerAction = 'restart' | 'shutdown';
export interface PowerState {
  action: PowerAction;
  phase: 'waiting-offline' | 'waiting-online' | 'complete' | 'timeout';
  startedAt: number;
}
export interface Bootstrap {
  devices: Device[];
  settings: Settings;
  vaultAvailable: boolean;
  dataPath: string;
  version: string;
}
export type DiscoverySource = 'processes' | 'services' | 'containers' | 'ports' | 'timers' | 'cron';
export interface RunningProcess {
  pid: number;
  parentPid: number;
  cpu: number;
  memory: number;
  name: string;
  directory: string;
  executable: string;
}
export interface RunningService {
  name: string;
  description: string;
}
export interface RunningContainer {
  name: string;
  image: string;
  state: string;
  ports: string;
  project: string;
}
export interface ListeningPort {
  protocol: string;
  address: string;
  pids: number[];
}
export interface DiscoveredProject {
  name: string;
  kind: string;
  evidence: string;
  confidence: 'confirmed' | 'candidate';
  directory?: string;
  ports?: string;
}
export interface DiscoveryReport {
  scannedAt: number;
  sources: {
    source: DiscoverySource;
    status: 'ok' | 'limited' | 'unavailable';
    message?: string;
  }[];
  projects: DiscoveredProject[];
  processes: RunningProcess[];
  services: RunningService[];
  containers: RunningContainer[];
  ports: ListeningPort[];
  timers: string[];
  cron: string[];
}
export interface NexusAPI {
  discover(id: string, refresh?: boolean): Promise<DiscoveryReport>;
  windowState(): Promise<{ fullScreen: boolean }>;
  setFullScreen(value: boolean): Promise<void>;
  hideToTray(): Promise<void>;
  quit(): Promise<void>;
  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<void>;
  onWindowState(callback: (state: { fullScreen: boolean }) => void): () => void;
  bootstrap(): Promise<Bootstrap>;
  saveDevice(input: DeviceInput): Promise<Device>;
  deleteDevice(id: string): Promise<boolean>;
  moveDevice(id: string, position: Device['position']): Promise<void>;
  saveSettings(settings: Settings, token?: string): Promise<Settings>;
  pollProbe(): Promise<ProbeSnapshot>;
  copy(
    id: string,
    field: 'host' | 'port' | 'username' | 'password' | 'ssh' | 'info',
  ): Promise<void>;
  openSSH(id: string): Promise<void>;
  sshStatus(): Promise<SSHStatus>;
  copyInstallCommand(id: string, tool: 'docker' | 'probe'): Promise<void>;
  prepareDeployment(id: string, tool: InstallTool): Promise<DeploymentPlan>;
  startDeployment(planId: string, options?: ProbeInstallOptions): Promise<SessionInfo | null>;
  openTerminal(id: string): Promise<SessionInfo>;
  sessions(): Promise<SessionInfo[]>;
  attachSession(id: string): Promise<SessionOutput>;
  detachSession(id: string): Promise<void>;
  writeSession(id: string, data: string): Promise<void>;
  resizeSession(id: string, cols: number, rows: number): Promise<void>;
  acknowledgeSession(id: string, bytes: number): Promise<void>;
  closeSession(id: string): Promise<void>;
  onSessionOutput(callback: (output: SessionOutput) => void): () => void;
  onSessionState(callback: (session: SessionInfo) => void): () => void;
  power(id: string, action: PowerAction): Promise<boolean>;
  powerStates(): Promise<Record<string, PowerState>>;
  quickAction(id: string, action: QuickAction): Promise<string>;
  pickKey(): Promise<string | null>;
  listRemote(id: string, path: string): Promise<FileListing>;
  listLocal(path?: string): Promise<FileListing>;
  previewRemote(id: string, path: string): Promise<FilePreview>;
  previewLocal(path: string): Promise<FilePreview>;
  pickLocalFolder(): Promise<string | null>;
  upload(
    id: string,
    remoteDir: string,
    paths?: string[],
    folders?: boolean,
  ): Promise<TransferTask[]>;
  download(id: string, path: string): Promise<TransferTask | null>;
  transfers(): Promise<TransferTask[]>;
  cancelTransfer(id: string): Promise<void>;
  retryTransfer(id: string): Promise<void>;
  clearTransfers(deviceId: string): Promise<void>;
  onTransfer(callback: (task: TransferTask) => void): () => void;
  mutateRemote(
    id: string,
    action: 'mkdir' | 'rename' | 'delete',
    path: string,
    target?: string,
  ): Promise<boolean>;
  onProgress(callback: (progress: TransferProgress) => void): () => void;
  droppedPaths(files: File[]): string[];
}
