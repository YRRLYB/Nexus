import type { Device } from './types';
export type OSFamily =
  | 'windows'
  | 'ubuntu'
  | 'debian'
  | 'archlinux'
  | 'fedora'
  | 'centos'
  | 'rockylinux'
  | 'almalinux'
  | 'alpinelinux'
  | 'apple'
  | 'linux'
  | 'unknown';
export function resolveOS(
  device: Pick<Device, 'type' | 'os'>,
  probeOS = '',
): { family: OSFamily; label: string } {
  const text = `${device.os} ${probeOS}`.toLowerCase();
  if (device.type === 'windows' || /windows/.test(text))
    return { family: 'windows', label: 'Windows' };
  if (device.type === 'macos' || /macos|mac os|darwin/.test(text))
    return { family: 'apple', label: 'macOS' };
  const distributions: [RegExp, OSFamily, string][] = [
    [/ubuntu|乌班图|乌邦图/, 'ubuntu', 'Ubuntu'],
    [/debian/, 'debian', 'Debian'],
    [/arch/, 'archlinux', 'Arch Linux'],
    [/fedora/, 'fedora', 'Fedora'],
    [/centos/, 'centos', 'CentOS'],
    [/rocky/, 'rockylinux', 'Rocky Linux'],
    [/alma/, 'almalinux', 'AlmaLinux'],
    [/alpine/, 'alpinelinux', 'Alpine Linux'],
  ];
  for (const [pattern, family, label] of distributions)
    if (pattern.test(text)) return { family, label };
  if (device.type.startsWith('linux') || /linux/.test(text))
    return { family: 'linux', label: 'Linux' };
  return { family: 'unknown', label: device.type === 'nas' ? 'NAS' : '设备' };
}
