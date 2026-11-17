import { useEffect, useRef } from 'react';
import type { WindowMode } from '@shared/types';

const winApi = (window as { api?: typeof window.api }).api ?? null;

/**
 * CSS selector matching elements that require direct mouse interaction.
 * Clicks and hover on these elements are captured by GigaAgent,
 * while clicks on any other region pass straight through to the underlying OS window.
 */
const INTERACTIVE_SELECTOR = [
  'button',
  'input',
  'textarea',
  'select',
  'a',
  'label',
  '[role="button"]',
  '[role="tab"]',
  '[role="switch"]',
  '[role="slider"]',
  '[role="dialog"]',
  '[role="menuitem"]',
  '[data-interactive="true"]',
  '.interactive',
  '.titlebar',
  '.titlebar__brand',
  '.titlebar__actions',
  '.ghost-pill',
  '.icon-btn',
  '.btn',
  '.ask__input',
  '.ask__actions',
  '.ask-bar',
  '.tabs',
  '.tab',
  '.segmented__item',
  '.chip__x',
  '.dialog',
  '.dialog__card',
  '.splitter',
  '.side__tabs',
  '.bottomnav',
  '.level-meter',
  '.callout',
].join(', ');

export interface UseMousePassthroughOptions {
  enabled: boolean;
  windowMode: WindowMode;
  modalOpen: boolean;
}

/**
 * Manages intelligent click-through and cursor pass-through for the floating overlay.
 *
 * When active in compact overlay mode:
 * 1. By default, the window ignores mouse events with { forward: true }, so hardware cursor
 *    rendering and clicks pass completely to background windows (Zoom, Meet, OBS, editors).
 * 2. When the cursor enters an interactive control (buttons, inputs, tabs, title bar controls),
 *    mouse events are immediately enabled for that precise bounding region.
 * 3. When the cursor leaves the interactive region, it smoothly reverts to click-through.
 */
export function useMousePassthrough({ enabled, windowMode, modalOpen }: UseMousePassthroughOptions): void {
  const isIgnoringRef = useRef(false);
  const restoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMouseDownRef = useRef(false);

  useEffect(() => {
    if (!winApi?.window?.setIgnoreMouseEvents) return;

    // Normal window behavior in expanded mode, when passthrough is disabled, or when a modal is open
    if (!enabled || windowMode === 'expanded' || modalOpen) {
      if (isIgnoringRef.current) {
        isIgnoringRef.current = false;
        void winApi.window.setIgnoreMouseEvents(false);
      }
      return;
    }

    // Initialize to click-through with event forwarding in compact overlay mode
    isIgnoringRef.current = true;
    void winApi.window.setIgnoreMouseEvents(true, { forward: true });

    const setIgnoring = (shouldIgnore: boolean): void => {
      if (isIgnoringRef.current === shouldIgnore) return;
      isIgnoringRef.current = shouldIgnore;
      void winApi.window.setIgnoreMouseEvents(shouldIgnore, { forward: true });
    };

    const onMouseDown = (): void => {
      isMouseDownRef.current = true;
      if (restoreTimerRef.current) {
        clearTimeout(restoreTimerRef.current);
        restoreTimerRef.current = null;
      }
      setIgnoring(false);
    };

    const onMouseUp = (): void => {
      isMouseDownRef.current = false;
    };

    const onMouseMove = (e: MouseEvent): void => {
      if (isMouseDownRef.current) return;

      const target = e.target as HTMLElement | null;
      const isInteractive = Boolean(target?.closest?.(INTERACTIVE_SELECTOR));

      if (isInteractive) {
        // Cursor entered an interactive control: immediately capture mouse events
        if (restoreTimerRef.current) {
          clearTimeout(restoreTimerRef.current);
          restoreTimerRef.current = null;
        }
        setIgnoring(false);
      } else {
        // Cursor entered non-interactive / backdrop region: debounce return to click-through
        if (!restoreTimerRef.current && !isIgnoringRef.current) {
          restoreTimerRef.current = setTimeout(() => {
            restoreTimerRef.current = null;
            if (!isMouseDownRef.current) {
              setIgnoring(true);
            }
          }, 35);
        }
      }
    };

    const onMouseLeave = (e: MouseEvent): void => {
      // Revert to click-through immediately when the mouse exits the window bounds
      if (!e.relatedTarget) {
        if (restoreTimerRef.current) {
          clearTimeout(restoreTimerRef.current);
          restoreTimerRef.current = null;
        }
        if (!isMouseDownRef.current) {
          setIgnoring(true);
        }
      }
    };

    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseleave', onMouseLeave);

    return () => {
      if (restoreTimerRef.current) clearTimeout(restoreTimerRef.current);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseleave', onMouseLeave);
      // Ensure normal mouse interaction on cleanup
      void winApi.window.setIgnoreMouseEvents(false);
    };
  }, [enabled, windowMode, modalOpen]);
}
