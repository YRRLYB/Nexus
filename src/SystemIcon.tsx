import type { Device } from '../shared/types';
import { resolveOS } from '../shared/os';
import { DeviceIcon } from './ui';
const assets = import.meta.glob<string>('./assets/os/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
});
export function SystemIcon({ device, probeOS }: { device: Device; probeOS?: string }) {
  const os = resolveOS(device, probeOS);
  const asset = assets[`./assets/os/${os.family}.svg`];
  return (
    <span className={`system-icon os-${os.family}`} data-os={os.family}>
      {asset ? (
        <img src={asset} alt={`${os.label} 系统图标`} draggable={false} />
      ) : (
        <DeviceIcon icon={device.icon} size={32} />
      )}
    </span>
  );
}
