import type { SessionMode } from '@shared/types';

interface HeaderProps {
  mode: SessionMode;
  onSelectMode: (mode: SessionMode) => void;
  disabledModes: boolean;
  onOpenSettings: () => void;
  onMinimize: () => void;
  onClose: () => void;
  isInvisible?: boolean;
  onToggleInvisibility?: () => void;
}

const MODES: Array<{ id: SessionMode; label: string; icon: string }> = [
  { id: 'mock-interview', label: 'Interview', icon: '🎯' },
  { id: 'meeting', label: 'Meeting', icon: '👥' },
  { id: 'general', label: 'General', icon: '✦' },
];

export function Header({
  mode,
  onSelectMode,
  disabledModes,
  onOpenSettings,
  onMinimize,
  onClose,
  isInvisible = true,
  onToggleInvisibility,
}: HeaderProps) {
  return (
    <header className="copilot-header">
      {/* ── Brand & Drag Region ── */}
      <div className="copilot-brand">
        <span className="brand-dot" aria-hidden="true" />
        <span className="brand-name">GigaAgent</span>
        <button
          type="button"
          className={`ghost-toggle-btn ${isInvisible ? 'ghost-toggle-btn--active' : 'ghost-toggle-btn--inactive'}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleInvisibility?.();
          }}
          title={
            isInvisible
              ? "Ghost Mode Active: Window is hidden from Zoom, Teams, Meet, OBS & screenshots. Click to turn OFF."
              : "Ghost Mode Inactive: Window is visible to screen sharing. Click to turn ON."
          }
          aria-label={isInvisible ? "Disable Ghost Mode" : "Enable Ghost Mode"}
        >
          <span className="ghost-icon" aria-hidden="true">{isInvisible ? '🛡️' : '👁️'}</span>
          <span className="ghost-label">{isInvisible ? 'Ghost On' : 'Ghost Off'}</span>
        </button>
      </div>

      {/* ── Mode Selector ── */}
      <nav className="mode-nav" role="tablist" aria-label="Copilot Mode">
        {MODES.map((m) => {
          const isActive = mode === m.id || (m.id === 'general' && mode === 'study');
          return (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`mode-tab${isActive ? ' mode-tab--active' : ''}`}
              disabled={disabledModes}
              onClick={() => onSelectMode(m.id)}
              title={`Switch to ${m.label} mode`}
            >
              <span className="mode-tab__icon">{m.icon}</span>
              <span className="mode-tab__label">{m.label}</span>
            </button>
          );
        })}
      </nav>

      {/* ── Window Controls ── */}
      <div className="window-controls">
        <button
          type="button"
          className="win-btn win-btn--settings"
          onClick={onOpenSettings}
          title="Settings & Credentials"
          aria-label="Settings"
        >
          ⚙
        </button>
        <button
          type="button"
          className="win-btn"
          onClick={onMinimize}
          title="Minimize"
          aria-label="Minimize window"
        >
          −
        </button>
        <button
          type="button"
          className="win-btn win-btn--close"
          onClick={onClose}
          title="Close"
          aria-label="Close window"
        >
          ×
        </button>
      </div>
    </header>
  );
}

