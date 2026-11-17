import { memo } from 'react';

/** One consistent icon family: 24px grid, 1.75 stroke, round joins. Decorative by default. */
const PATHS = {
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM5 11a7 7 0 0 0 14 0M12 18v3',
  speaker: 'M4 9v6h4l5 4V5L8 9H4ZM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12',
  ghost: 'M5 20V11a7 7 0 0 1 14 0v9l-2.3-2-2.3 2-2.4-2-2.4 2-2.3-2L5 20ZM9.5 10.5h.01M14.5 10.5h.01',
  expand: 'M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7',
  collapse: 'M20 10h-6V4M4 14h6v6M14 10l6-6M10 14l-6 6',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.5-2-3.4-2.3.9a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.5 2.5a7.6 7.6 0 0 0-2.6 1.5l-2.3-.9-2 3.4 2 1.5a7.6 7.6 0 0 0 0 3l-2 1.5 2 3.4 2.3-.9a7.6 7.6 0 0 0 2.6 1.5l.5 2.5h4l.5-2.5a7.6 7.6 0 0 0 2.6-1.5l2.3.9 2-3.4-2-1.5Z',
  minimize: 'M5 12h14',
  close: 'M6 6l12 12M18 6 6 18',
  play: 'M7 4.5v15l12-7.5-12-7.5Z',
  stop: 'M6.5 6.5h11v11h-11z',
  pause: 'M8 5v14M16 5v14',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  bookmark: 'M7 4h10v16l-5-3.5L7 20V4Z',
  refresh: 'M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4',
  sparkles: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3ZM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z',
  send: 'M5 12h13M12.5 6l6 6-6 6',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6',
  screen: 'M3.5 5h17v11h-17zM9 20h6M12 16v4',
  download: 'M12 4v11M7.5 11l4.5 4.5 4.5-4.5M5 20h14',
  chevronDown: 'm6 9 6 6 6-6',
  chevronRight: 'm9 6 6 6-6 6',
  chevronLeft: 'm15 6-6 6 6 6',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2',
  alert: 'M12 4 2.5 20h19L12 4ZM12 10v4.5M12 17.5h.01',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v6M12 7.5h.01',
  plus: 'M12 5v14M5 12h14',
  transcript: 'M5 6h14M5 10h10M5 14h14M5 18h8',
  book: 'M5 4.5h10a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3V4.5ZM5 17a3 3 0 0 1 3-3h10',
  panelLeft: 'M3.5 5h17v14h-17zM9 5v14',
  panelRight: 'M3.5 5h17v14h-17zM15 5v14',
  history: 'M4 12a8 8 0 1 0 2.5-5.8L4 8.5M4 4v4.5h4.5M12 8v4.5l3 1.5',
  note: 'M6 3.5h9l4 4V20.5H6zM14.5 3.5V8H19M9 12.5h6M9 16h4',
  wand: 'M5 19 16 8M14 6l4 4M18 3v3M16.5 4.5h3M7 4v2M6 5h2',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20a7.5 7.5 0 0 1 15 0',
  keyboard: 'M3 7h18v10H3zM7 11h.01M11 11h.01M15 11h.01M8 14h8',
  shield: 'M12 3l7.5 3v6c0 4.5-3.2 7.8-7.5 9-4.3-1.2-7.5-4.5-7.5-9V6L12 3Z',
  activity: 'M3 12h4l2.5-7 5 14 2.5-7h4',
  pin: 'M9 4h6l-1 6 3.5 3.5h-11L10 10 9 4ZM12 13.5V20',
  external: 'M14 5h5v5M19 5l-8 8M11 6H5v13h13v-6',
} as const;

export type IconName = keyof typeof PATHS;

export const Icon = memo(function Icon({ name, size = 16, filled = false }: { name: IconName; size?: number; filled?: boolean }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
});

/** GigaAgent mark: a layered "G" aperture. Pure SVG so it stays crisp at any text scale. */
export function BrandMark({ size = 20 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="gm" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--accent-2)" />
          <stop offset="1" stopColor="var(--accent)" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="21" height="21" rx="6.5" fill="url(#gm)" />
      <path d="M16.2 9.2A5 5 0 1 0 17 12h-4.6" fill="none" stroke="var(--on-accent)" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
