import type { SessionMode } from '@shared/types';

interface HeaderProps {
  mode: SessionMode;
  onSelectMode: (mode: SessionMode) => void;
  disabledModes: boolean;
  onOpenSettings: () => void;
  onMinimize: () => void;
  onClose: () => void;
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
}: HeaderProps) {
  return (
    <header className="copilot-header">
      {/* ── Brand & Drag Region ── */}
      <div className="copilot-brand">
        <span className="brand-dot" aria-hidden="true" />
        <span className="brand-name">GigaAgent</span>
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
