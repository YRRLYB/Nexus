import type { Device, QuickAction } from '../shared/types';
import { devicePlatform } from '../shared/device';

export function quickCommand(device: Pick<Device, 'type' | 'os'>, action: QuickAction) {
  const platform = devicePlatform(device);
  if (platform === 'windows') {
    const command = {
      docker: 'docker ps -a --no-trunc; if ($LASTEXITCODE) { exit $LASTEXITCODE }',
      services: 'Get-Service | Where-Object Status -eq Running | Format-Table -AutoSize',
      logs: 'Get-WinEvent -LogName System -MaxEvents 50 | Select-Object TimeCreated, Id, LevelDisplayName, Message | Format-List',
      sysinfo: '(Get-CimInstance Win32_OperatingSystem).Caption',
    }[action];
    return (
      'powershell.exe -NoProfile -NonInteractive -EncodedCommand ' +
      Buffer.from('$ErrorActionPreference = "Stop"; ' + command, 'utf16le').toString('base64')
    );
  }
  if (platform === 'macos')
    return {
      docker: 'docker ps -a --no-trunc',
      services: 'launchctl list',
      logs: '/usr/bin/log show --last 1m --style compact',
      sysinfo: 'printf "macOS "; sw_vers -productVersion',
    }[action];
  if (platform === 'unknown') {
    if (action === 'sysinfo') return 'uname -srm';
    throw new Error('请先填写 NAS 的实际系统；未知系统不执行专用快捷命令');
  }
  return {
    docker:
      'command -v docker >/dev/null || { echo "Docker 未安装或不在 PATH 中" >&2; exit 1; }; docker ps -a --no-trunc',
    services:
      'if command -v systemctl >/dev/null && [ -d /run/systemd/system ]; then systemctl --no-pager --type=service --state=running; elif command -v rc-status >/dev/null; then rc-status; elif command -v service >/dev/null; then service --status-all; else echo "没有可用的服务管理工具" >&2; exit 1; fi',
    logs: 'if command -v journalctl >/dev/null && [ -d /run/systemd/system ]; then journalctl --no-pager -n 100; elif command -v logread >/dev/null; then logread; elif [ -r /var/log/messages ]; then tail -n 100 /var/log/messages; else echo "系统日志不可读，请检查权限" >&2; exit 1; fi',
    sysinfo:
      'if [ -r /etc/os-release ]; then . /etc/os-release; printf "%s" "$PRETTY_NAME"; else uname -srm; fi',
  }[action];
}

export function installCommand(tool: 'docker' | 'probe') {
  const path = tool === 'docker' ? 'scripts/install-docker.sh' : 'scripts/probe/install.sh';
  return `(set -eu; installer=$(mktemp); trap 'rm -f -- "$installer"' EXIT; curl --fail --show-error --location --proto '=https' --tlsv1.2 'https://raw.githubusercontent.com/YRRLYB/Nexus/main/${path}' -o "$installer"; cat "$installer"; if [ "$(id -u)" -eq 0 ]; then sh "$installer"; else sudo sh "$installer"; fi)`;
}
