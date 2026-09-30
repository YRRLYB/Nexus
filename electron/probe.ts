import type { ProbeNode, ProbeSnapshot, Settings, PowerState } from '../shared/types';
const number = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
const percent = (v: unknown) => {
  const n = number(v);
  return n === null ? null : Math.min(100, n);
};
const ratio = (used: unknown, total: unknown) => {
  const u = number(used),
    t = number(total);
  return u !== null && t !== null && t > 0 ? Math.min(100, (u / t) * 100) : null;
};
export function normalizeProbe(
  payload: unknown,
  staleSeconds: number,
  now = Date.now(),
): ProbeNode[] {
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('servers' in payload) ||
    !Array.isArray(payload.servers)
  )
    throw new Error('不是 ServerStatus 的 JSON 数据：缺少 servers 数组');
  const updated = number((payload as { updated?: unknown }).updated);
  const sourceStale =
    updated === null || now / 1000 - updated > staleSeconds || updated > now / 1000 + 300;
  return payload.servers
    .filter((v) => v && typeof v === 'object' && typeof v.name === 'string')
    .map((row) => {
      const lastSeen = number(row.latest_ts) || 0;
      const stale = sourceStale || !lastSeen || now / 1000 - lastSeen > staleSeconds;
      const os =
        typeof row.labels === 'string' ? /(?:^|;)os=([^;]+)/.exec(row.labels)?.[1] || '' : '';
      const diskUnit = row.si === true ? 1000 ** 2 : 1024 ** 2;
      const bytes = (value: unknown, unit: number) => {
        const n = number(value);
        return n === null ? null : n * unit;
      };
      return {
        id: row.name,
        name: typeof row.alias === 'string' && row.alias ? row.alias : row.name,
        location: String(row.location || ''),
        online: !stale && (row.online4 === true || row.online6 === true),
        stale,
        cpu: percent(row.cpu),
        memory: ratio(row.memory_used, row.memory_total),
        disk: ratio(row.hdd_used, row.hdd_total),
        memoryUsed: bytes(row.memory_used, 1024),
        memoryTotal: bytes(row.memory_total, 1024),
        diskUsed: bytes(row.hdd_used, diskUnit),
        diskTotal: bytes(row.hdd_total, diskUnit),
        os,
        uptime: typeof row.uptime === 'string' ? row.uptime : '',
        rx: number(row.network_rx),
        tx: number(row.network_tx),
        lastSeen,
        latency: number(row.time_10010),
      };
    });
}
export async function fetchProbe(
  settings: Settings,
  token?: string,
  signal?: AbortSignal,
): Promise<ProbeSnapshot> {
  const response = await fetch(settings.probeUrl, {
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(12000)])
      : AbortSignal.timeout(12000),
    redirect: 'error',
    headers: {
      Accept: 'application/json',
      'Cache-Control': 'no-cache',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) throw new Error(`探针接口返回 HTTP ${response.status}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('探针返回空响应');
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 5 * 1024 * 1024) throw new Error('探针响应超过 5 MB');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const updated = number(payload?.updated);
  if (
    updated === null ||
    Date.now() / 1000 - updated > settings.staleSeconds ||
    updated > Date.now() / 1000 + 300
  )
    throw new Error('探针数据源时间戳异常或已过期，无法确认设备状态');
  return { nodes: normalizeProbe(payload, settings.staleSeconds), fetchedAt: Date.now() };
}
export function advancePower(
  state: PowerState,
  node: ProbeNode | undefined,
  now = Date.now(),
): PowerState {
  if (state.phase === 'complete' || state.phase === 'timeout') return state;
  if (now - state.startedAt > 5 * 60_000) return { ...state, phase: 'timeout' };
  if (!node) return state;
  if (state.phase === 'waiting-offline' && !node.online)
    return { ...state, phase: state.action === 'shutdown' ? 'complete' : 'waiting-online' };
  if (state.phase === 'waiting-online' && node.online && node.lastSeen * 1000 > state.startedAt)
    return { ...state, phase: 'complete' };
  return state;
}
