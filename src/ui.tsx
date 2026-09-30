import { Box, Cloud, Database, Monitor, Server, X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Device, ProbeNode, ProbeSnapshot } from '../shared/types';
export const api = window.nexus;
export const icons = {
  server: Server,
  cloud: Cloud,
  database: Database,
  monitor: Monitor,
  box: Box,
};
export function DeviceIcon({ icon, size = 24 }: { icon: string; size?: number }) {
  const Icon = icons[icon as keyof typeof icons] || Server;
  return <Icon size={size} strokeWidth={1.6} />;
}
export const bytes = (n: number | null | undefined) =>
  n === null || n === undefined
    ? '—'
    : n < 1024
      ? `${n} B`
      : n < 1024 ** 2
        ? `${(n / 1024).toFixed(1)} KB`
        : n < 1024 ** 3
          ? `${(n / 1024 ** 2).toFixed(1)} MB`
          : `${(n / 1024 ** 3).toFixed(1)} GB`;
export const pct = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `${n.toFixed(0)}%`;
export function nodeFor(d: Device, snapshot: ProbeSnapshot) {
  return d.probe.enabled ? snapshot.nodes.find((n) => n.id === d.probe.deviceId) : undefined;
}
export function status(d: Device, node: ProbeNode | undefined, snapshot: ProbeSnapshot) {
  if (!d.probe.enabled || !d.probe.deviceId) return { label: '未绑定探针', kind: 'unknown' };
  if (snapshot.error) return { label: '状态未知', kind: 'unknown' };
  if (!node) return { label: snapshot.fetchedAt ? '未找到节点' : '同步中', kind: 'unknown' };
  return node.online
    ? { label: '在线', kind: 'online' }
    : { label: node.stale ? '离线 · 数据过期' : '离线', kind: 'offline' };
}
export function Modal({
  title,
  subtitle,
  children,
  close,
  wide,
  className = '',
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
  className?: string;
}) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    if (panel.current && !panel.current.contains(previous)) panel.current.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return createPortal(
    <div
      className={`modal-backdrop ${className}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close();
        }
        if (e.key === 'Tab' && panel.current) {
          const focusable = Array.from(
            panel.current.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]',
            ),
          ).filter((element) => element.offsetParent !== null);
          const first = focusable[0];
          const last = focusable.at(-1);
          if (
            e.shiftKey &&
            (document.activeElement === first || document.activeElement === panel.current)
          ) {
            e.preventDefault();
            last?.focus();
          } else if (
            !e.shiftKey &&
            (document.activeElement === last || document.activeElement === panel.current)
          ) {
            e.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <section
        ref={panel}
        tabIndex={-1}
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" aria-label="关闭窗口" onClick={close}>
            <X size={19} />
          </button>
        </header>
        {children}
      </section>
    </div>,
    document.body,
  );
}
export function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: number | null;
  detail?: string;
}) {
  return (
    <div className="metric">
      <div>
        <span>{label}</span>
        <strong>{pct(value)}</strong>
      </div>
      <div className="meter">
        <i style={{ width: `${value || 0}%` }} className={(value || 0) > 85 ? 'hot' : ''} />
      </div>
      {detail && <small>{detail}</small>}
    </div>
  );
}
export function errorText(e: unknown) {
  return (e instanceof Error ? e.message : String(e)).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    '',
  );
}
