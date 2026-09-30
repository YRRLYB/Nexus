import { resolveLocation } from '../shared/location';
const flags = import.meta.glob<string>('./assets/flags/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
});
export function LocationBadge({ location }: { location?: string }) {
  const region = resolveLocation(location);
  if (!region) return null;
  const flag = flags[`./assets/flags/${region.code}.svg`];
  if (!flag) return null;
  return (
    <span className="device-location" title={`所在地：${region.label}`} data-location={region.code}>
      <img src={flag} alt={`所在地：${region.label}`} draggable={false} />
    </span>
  );
}
