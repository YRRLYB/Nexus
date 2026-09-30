import { useEffect, useRef, useState } from 'react';
import {
  ChevronUp,
  LayoutGrid,
  Maximize,
  Minus,
  Monitor,
  Palette,
  Plus,
  Radio,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
export interface DesktopPreferences {
  wallpaper: 'pearl' | 'dusk' | 'sand';
  iconSize: number;
  autoHide: boolean;
  showClock: boolean;
}
export function readPreferences(): DesktopPreferences {
  let saved: Partial<DesktopPreferences> = {};
  try {
    saved = JSON.parse(localStorage.getItem('nexus.desktop') || '{}') || {};
  } catch {
    /* Keep a usable desktop if preferences are damaged. */
  }
  return {
    wallpaper: ['pearl', 'dusk', 'sand'].includes(saved.wallpaper || '')
      ? saved.wallpaper!
      : 'pearl',
    iconSize:
      typeof saved.iconSize === 'number' && saved.iconSize >= 44 && saved.iconSize <= 76
        ? saved.iconSize
        : 56,
    autoHide: typeof saved.autoHide === 'boolean' ? saved.autoHide : false,
    showClock: typeof saved.showClock === 'boolean' ? saved.showClock : false,
  };
}
export function DesktopClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="desktop-clock" aria-label="桌面时钟">
      <span>
        {now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}
      </span>
      <time>
        {now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}
      </time>
    </div>
  );
}
export function DesktopTools({
  preferences,
  changePreferences,
  zoom,
  changeZoom,
  search,
  setSearch,
  query,
  setQuery,
  filter,
  setFilter,
  fullScreen,
  toggleFullScreen,
  add,
  settings,
  refresh,
  polling,
  arrange,
  resetView,
}: {
  preferences: DesktopPreferences;
  changePreferences: (value: DesktopPreferences) => void;
  zoom: number;
  changeZoom: (value: number) => void;
  search: boolean;
  setSearch: (value: boolean) => void;
  query: string;
  setQuery: (value: string) => void;
  filter: string;
  setFilter: (value: string) => void;
  fullScreen: boolean;
  toggleFullScreen: () => void;
  add: () => void;
  settings: () => void;
  refresh: () => void;
  polling: boolean;
  arrange: () => void;
  resetView: () => void;
}) {
  const [appearance, setAppearance] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function reveal() {
    clearTimeout(hideTimer.current);
    setRevealed(true);
  }
  useEffect(() => () => clearTimeout(hideTimer.current), []);
  const searchInput = useRef<HTMLInputElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (search) searchInput.current?.focus();
  }, [search]);
  useEffect(() => {
    if (!appearance && !search) return;
    const click = (e: PointerEvent) => {
      if (dock.current && !dock.current.contains(e.target as Node)) {
        setAppearance(false);
        setSearch(false);
      }
    };
    document.addEventListener('pointerdown', click);
    return () => document.removeEventListener('pointerdown', click);
  }, [appearance, search, setSearch]);
  const hidden = preferences.autoHide && !revealed && !appearance && !search;
  return (
    <div
      ref={dock}
      className={`desktop-tools ${hidden ? 'tools-hidden' : ''}`}
      onMouseEnter={reveal}
      onMouseLeave={() => {
        hideTimer.current = setTimeout(() => setRevealed(false), 350);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          setAppearance(false);
          setSearch(false);
          e.stopPropagation();
        }
      }}
    >
      {search && (
        <section className="spotlight glass" aria-label="查找设备">
          <div className="spotlight-input">
            <Search size={19} />
            <input
              ref={searchInput}
              aria-label="搜索设备"
              placeholder="搜索设备、地址或标签"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button aria-label="关闭搜索" onClick={() => setSearch(false)}>
              <X size={17} />
            </button>
          </div>
          <div className="desktop-filters">
            {[
              ['all', '全部'],
              ['online', '在线'],
              ['offline', '离线'],
              ['unknown', '未连接探针'],
            ].map(([value, label]) => (
              <button
                key={value}
                className={filter === value ? 'active' : ''}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
            <small>⌘ / Ctrl K 快速查找</small>
          </div>
        </section>
      )}
      {appearance && (
        <section className="appearance-panel glass" aria-label="桌面外观">
          <header>
            <h3>让空间属于你</h3>
            <button aria-label="关闭外观" onClick={() => setAppearance(false)}>
              <X size={16} />
            </button>
          </header>
          <span className="preference-label">桌面背景</span>
          <div className="wallpaper-picker">
            {[
              ['pearl', '雾光'],
              ['dusk', '暮色'],
              ['sand', '暖沙'],
            ].map(([value, label]) => (
              <button
                key={value}
                className={`wallpaper-swatch ${value} ${preferences.wallpaper === value ? 'active' : ''}`}
                aria-label={`背景 ${label}`}
                aria-pressed={preferences.wallpaper === value}
                onClick={() =>
                  changePreferences({
                    ...preferences,
                    wallpaper: value as DesktopPreferences['wallpaper'],
                  })
                }
              >
                <span />
                {label}
              </button>
            ))}
          </div>
          <label className="size-preference">
            图标大小
            <input
              type="range"
              min={44}
              max={76}
              step={4}
              value={preferences.iconSize}
              onChange={(e) =>
                changePreferences({ ...preferences, iconSize: Number(e.target.value) })
              }
            />
            <span>{preferences.iconSize}</span>
          </label>
          <label className="toggle-preference">
            自动隐藏程序坞
            <input
              type="checkbox"
              checked={preferences.autoHide}
              onChange={(e) => changePreferences({ ...preferences, autoHide: e.target.checked })}
            />
          </label>
          <label className="toggle-preference">
            显示桌面时钟
            <input
              type="checkbox"
              checked={preferences.showClock}
              onChange={(e) => changePreferences({ ...preferences, showClock: e.target.checked })}
            />
          </label>
          <div className="desktop-view-controls">
            <button aria-label="缩小" onClick={() => changeZoom(Math.max(0.25, zoom - 0.1))}>
              <Minus size={16} />
            </button>
            <span>{Math.round(zoom * 100)}%</span>
            <button aria-label="放大" onClick={() => changeZoom(Math.min(2, zoom + 0.1))}>
              <Plus size={16} />
            </button>
            <button title="定位全部设备" onClick={resetView}>
              <Maximize size={15} />
            </button>
            <button onClick={arrange}>
              <LayoutGrid size={15} />
              舒展排列
            </button>
          </div>
        </section>
      )}
      <nav className="desktop-dock glass" aria-label="桌面程序坞" inert={hidden}>
        <button
          className="dock-home"
          aria-label={fullScreen ? '退出沉浸桌面' : '沉浸桌面'}
          data-tooltip={fullScreen ? '退出全屏 · F11' : '沉浸桌面 · F11'}
          onClick={toggleFullScreen}
        >
          <Monitor size={22} />
        </button>
        <i />
        <button aria-label="添加设备" data-tooltip="添加设备" onClick={add}>
          <Plus size={22} />
        </button>
        <button
          aria-label="查找设备"
          aria-expanded={search}
          className={search ? 'active' : ''}
          data-tooltip="查找 · Ctrl K"
          onClick={() => {
            setAppearance(false);
            setSearch(!search);
          }}
        >
          <Search size={21} />
        </button>
        <button aria-label="探针与连接" data-tooltip="探针与连接" onClick={settings}>
          <Radio size={21} />
        </button>
        <button aria-label="刷新探针" disabled={polling} data-tooltip="刷新状态" onClick={refresh}>
          <RefreshCw size={19} className={polling ? 'spin' : ''} />
        </button>
        <i />
        <button
          aria-label="桌面外观"
          aria-expanded={appearance}
          className={appearance ? 'active' : ''}
          data-tooltip="桌面外观"
          onClick={() => {
            setSearch(false);
            setAppearance(!appearance);
          }}
        >
          <Palette size={21} />
        </button>
      </nav>
      {preferences.autoHide && (
        <button
          className="dock-reveal"
          aria-label="显示工具栏"
          aria-expanded={!hidden}
          onFocus={reveal}
          onClick={reveal}
        >
          <ChevronUp size={15} />
        </button>
      )}
    </div>
  );
}
