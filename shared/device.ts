import type { Device, QuickAction } from './types';
import { resolveOS } from './os';

export function devicePlatform(device: Pick<Device, 'type' | 'os'>) {
  const family = resolveOS(device).family;
  if (family === 'windows') return 'windows';
  if (family === 'apple') return 'macos';
  if (family === 'unknown') return 'unknown';
  return 'linux';
}

export function deviceProfile(device: Pick<Device, 'type' | 'os'>) {
  const platform = devicePlatform(device);
  return {
    platform,
    discovery: platform === 'linux',
    deployment: platform === 'linux',
    power: platform === 'linux',
    hint: {
      linux: 'Linux：支持 SSH / SFTP、运行识别和软件部署。安装入口会检查实际发行版、架构与权限。',
      windows:
        'Windows 也支持 SSH / SFTP，目标电脑需启用 OpenSSH Server。快捷操作使用 PowerShell，默认关闭电源操作。',
      macos:
        'macOS：请启用“系统设置 → 通用 → 共享 → 远程登录”。快捷操作使用 launchctl 和系统日志。',
      unknown:
        'NAS：先在管理面板启用 SSH / SFTP；填写实际系统后再启用 Linux 专用功能，默认关闭电源操作。',
    }[platform],
  };
}

export function quickActionLabel(device: Pick<Device, 'type' | 'os'>, action: QuickAction) {
  if (action === 'services' && devicePlatform(device) === 'macos') return '启动服务';
  return { docker: 'Docker', services: '系统服务', logs: '最近日志', sysinfo: '读取系统版本' }[
    action
  ];
}
