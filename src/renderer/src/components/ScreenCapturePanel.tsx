import { useState, useEffect } from 'react';
import type { DesktopSourceInfo, ScreenshotData } from '@shared/types';

interface ScreenCapturePanelProps {
  sources: DesktopSourceInfo[];
  selectedSourceId: string | undefined;
  onSelectSource: (sourceId: string | undefined) => void;
  pendingScreenshot: ScreenshotData | null;
  activeScreenshot: ScreenshotData | null;
  isCapturing: boolean;
  onCapture: (sourceId?: string) => Promise<void>;
  onConfirm: (screenshotId: string) => Promise<void>;
  onDiscard: (screenshotId?: string) => Promise<void>;
  onClearContext: () => Promise<void>;
  onRefreshSources: () => Promise<void>;
}

export function ScreenCapturePanel({
  sources,
  selectedSourceId,
  onSelectSource,
  pendingScreenshot,
  activeScreenshot,
  isCapturing,
  onCapture,
  onConfirm,
  onDiscard,
  onClearContext,
  onRefreshSources,
}: ScreenCapturePanelProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  useEffect(() => {
    void onRefreshSources();
  }, [onRefreshSources]);

  const activeOrPending = pendingScreenshot ?? activeScreenshot;

  return (
    <section className="screen-panel" aria-label="Screen Intelligence & Visual Context">
      {/* ── Top Bar: Source selection & Capture Button ── */}
      <div className="screen-panel__bar">
        <div className="screen-panel__source-select">
          <label htmlFor="screen-source-dropdown" className="screen-panel__label">
            Target Display:
          </label>
          <select
            id="screen-source-dropdown"
            className="screen-panel__select"
            value={selectedSourceId ?? ''}
            onChange={(e) => onSelectSource(e.target.value ? e.target.value : undefined)}
            onFocus={() => {
              void onRefreshSources();
              setSourcesOpen(true);
            }}
            onBlur={() => setSourcesOpen(false)}
            title="Choose a specific screen or application window to capture"
          >
            <option value="">Primary Screen (Default)</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.isScreen ? `🖥️ ${s.name}` : `🪟 ${s.name}`}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          className="screen-capture-btn"
          onClick={() => void onCapture(selectedSourceId)}
          disabled={isCapturing}
          aria-label="Capture Screen"
          title="Take a single snapshot of your screen or window for Gemini Vision analysis"
        >
          {isCapturing ? (
            <>
              <span className="spinner-icon" />
              <span>Capturing…</span>
            </>
          ) : (
            <>
              <span className="screen-capture-btn__icon" aria-hidden="true">
                📸
              </span>
              <span>Capture Screen</span>
            </>
          )}
        </button>
      </div>

      {/* ── Pending Screenshot Review (Requires explicit confirmation before Gemini use) ── */}
      {pendingScreenshot && (
        <div className="screen-preview-card screen-preview-card--pending animate-fade-in">
          <div className="screen-preview-card__header">
            <div className="screen-preview-card__meta">
              <span className="screen-badge screen-badge--pending">Review Capture</span>
              <span className="screen-preview-card__source" title={pendingScreenshot.sourceName}>
                {pendingScreenshot.sourceName}
              </span>
              <span className="screen-preview-card__res">
                {pendingScreenshot.width} × {pendingScreenshot.height}
              </span>
            </div>
            <span className="screen-preview-card__hint">Confirm before sending to AI</span>
          </div>

          <div
            className="screen-preview-card__img-wrap"
            onClick={() => setLightboxOpen(true)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && setLightboxOpen(true)}
            title="Click to view full-resolution snapshot"
          >
            <img
              src={pendingScreenshot.dataUrl}
              alt="Captured screen preview"
              className="screen-preview-card__img"
              loading="lazy"
            />
            <span className="screen-preview-card__zoom-hint">🔍 Expand Fullscreen</span>
          </div>

          <div className="screen-preview-card__actions">
            <button
              type="button"
              className="screen-action-btn screen-action-btn--confirm"
              onClick={() => void onConfirm(pendingScreenshot.id)}
              title="Activate this screenshot as visual context for AI answers"
            >
              ✓ Use Screenshot
            </button>
            <button
              type="button"
              className="screen-action-btn screen-action-btn--retake"
              onClick={() => void onCapture(selectedSourceId)}
              title="Retake screen capture"
            >
              🔄 Retake
            </button>
            <button
              type="button"
              className="screen-action-btn screen-action-btn--discard"
              onClick={() => void onDiscard(pendingScreenshot.id)}
              title="Discard this capture without using it"
            >
              ✕ Discard
            </button>
          </div>
        </div>
      )}

      {/* ── Active Confirmed Visual Context Bar ── */}
      {!pendingScreenshot && activeScreenshot && (
        <div className="screen-context-active animate-fade-in">
          <div className="screen-context-active__info">
            <span className="screen-pulse-dot" aria-hidden="true" />
            <div
              className="screen-context-active__thumb-wrap"
              onClick={() => setLightboxOpen(true)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && setLightboxOpen(true)}
              title="Click to view full screenshot"
            >
              <img
                src={activeScreenshot.dataUrl}
                alt="Active visual context thumbnail"
                className="screen-context-active__thumb"
              />
            </div>
            <div className="screen-context-active__details">
              <span className="screen-context-active__title">
                🖼️ Visual Context Active
              </span>
              <span className="screen-context-active__sub">
                {activeScreenshot.sourceName} ({activeScreenshot.width} × {activeScreenshot.height})
              </span>
            </div>
          </div>

          <div className="screen-context-active__actions">
            <button
              type="button"
              className="screen-action-btn screen-action-btn--clear"
              onClick={() => void onClearContext()}
              title="Clear active screen context"
            >
              Clear Context
            </button>
            <button
              type="button"
              className="screen-action-btn screen-action-btn--retake"
              onClick={() => void onCapture(selectedSourceId)}
              title="Capture a new screenshot"
            >
              New Capture
            </button>
          </div>
        </div>
      )}

      {/* ── High-Resolution Lightbox Modal ── */}
      {lightboxOpen && activeOrPending && (
        <div
          className="screen-lightbox"
          onClick={() => setLightboxOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="High-resolution screenshot view"
        >
          <div className="screen-lightbox__content" onClick={(e) => e.stopPropagation()}>
            <div className="screen-lightbox__bar">
              <span className="screen-lightbox__title">
                {activeOrPending.sourceName} — {activeOrPending.width} × {activeOrPending.height}
              </span>
              <button
                type="button"
                className="screen-lightbox__close"
                onClick={() => setLightboxOpen(false)}
                aria-label="Close full view"
              >
                ✕
              </button>
            </div>
            <div className="screen-lightbox__body">
              <img
                src={activeOrPending.dataUrl}
                alt="Full resolution screen capture"
                className="screen-lightbox__img"
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
