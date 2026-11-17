import { memo } from 'react';
import type { GhostState, InvisibilityStatus, WindowMode } from '@shared/types';
import { BrandMark, Icon } from './Icon';

const GHOST_LABEL: Record<GhostState, string> = { off: 'Off', applying: 'Applying…', active: 'On', unsupported: 'Unavailable', error: 'Error' };

interface TitleBarProps {
  ghost: InvisibilityStatus | null;
  onToggleGhost: () => void;
  windowMode: WindowMode;
  onToggleWindowMode: () => void;
  onOpenSettings: () => void;
  onMinimize: () => void;
  onClose: () => void;
}

export const TitleBar = memo(function TitleBar({ ghost, onToggleGhost, windowMode, onToggleWindowMode, onOpenSettings, onMinimize, onClose }: TitleBarProps) {
  const state: GhostState = ghost?.state ?? (ghost?.enabled ? 'active' : 'off');
  const unavailable = state === 'unsupported' || !ghost;
  const expanded = windowMode === 'expanded';
  return (
    <header className="titlebar">
      <div className="titlebar__brand">
        <BrandMark />
        <h1 className="titlebar__name">GigaAgent</h1>
      </div>
      <div className="titlebar__actions">
        <button
          type="button"
          className={`ghost-pill ghost-pill--${state}`}
          onClick={onToggleGhost}
          disabled={unavailable || state === 'applying'}
          aria-pressed={state === 'active'}
          aria-label={`Ghost Mode: ${GHOST_LABEL[state]}. Leaves this window out of screen captures on this computer.`}
          title={
            unavailable
              ? (ghost?.detail ?? 'Ghost Mode is unavailable.')
              : state === 'error'
                ? `Ghost Mode failed: ${ghost?.error ?? 'unknown error'}. Click to retry.`
                : 'Ghost Mode — leaves this window out of screen captures made on this computer (Ctrl+Shift+H)'
          }
        >
          <Icon name="ghost" size={14} filled={state === 'active'} />
          <span className="ghost-pill__label">Ghost</span>
          <span className="ghost-pill__state">{GHOST_LABEL[state]}</span>
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={onToggleWindowMode}
          aria-label={expanded ? 'Return to compact window (Ctrl+E)' : 'Expand to workspace (Ctrl+E)'}
          title={expanded ? 'Compact window (Ctrl+E)' : 'Expand workspace (Ctrl+E)'}
        >
          <Icon name={expanded ? 'collapse' : 'expand'} />
        </button>
        <button type="button" className="icon-btn" onClick={onOpenSettings} aria-label="Settings (Ctrl+,)" title="Settings (Ctrl+,)">
          <Icon name="settings" />
        </button>
        <span className="titlebar__sep" aria-hidden="true" />
        <button type="button" className="icon-btn" onClick={onMinimize} aria-label="Minimise window" title="Minimise">
          <Icon name="minimize" />
        </button>
        <button type="button" className="icon-btn icon-btn--close" onClick={onClose} aria-label="Close GigaAgent" title="Close">
          <Icon name="close" />
        </button>
      </div>
    </header>
  );
});
