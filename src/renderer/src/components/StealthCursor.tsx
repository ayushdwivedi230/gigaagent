import { useEffect, useRef } from 'react';

interface StealthCursorProps {
  enabled?: boolean;
}

/**
 * Stealth Cursor: Private In-Window Hardware Cursor Replacement
 *
 * Problem it solves:
 * When a window is excluded from screen share using WDA_EXCLUDEFROMCAPTURE / NSWindowSharingNone,
 * the OS hardware cursor is still drawn globally by Windows DWM at the mouse coordinates.
 * Spectators on Google Meet / Zoom would see the mouse cursor moving in the middle of nowhere.
 *
 * Solution:
 * 1. Applies `cursor: none !important;` to the overlay window, prompting Windows to hide the OS hardware cursor.
 * 2. Renders this private custom cursor inside GigaAgent's DOM at the exact (clientX, clientY) coordinates.
 * 3. Because GigaAgent has WDA_EXCLUDEFROMCAPTURE, GigaAgent AND this custom cursor are 100% invisible to Google Meet/Zoom/Teams.
 * 4. Spectators see ZERO cursor movement over this area, while the user sees and controls their cursor with 0ms latency.
 */
export function StealthCursor({ enabled = true }: StealthCursorProps) {
  const cursorRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<SVGSVGElement>(null);
  const pointerRef = useRef<SVGSVGElement>(null);
  const textRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!enabled) {
      document.documentElement.classList.remove('stealth-cursor-active');
      return;
    }

    document.documentElement.classList.add('stealth-cursor-active');

    const cursor = cursorRef.current;
    if (!cursor) return;

    let isVisible = false;

    const onMouseMove = (e: MouseEvent) => {
      if (!cursor) return;
      if (!isVisible) {
        isVisible = true;
        cursor.style.opacity = '1';
      }
      cursor.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;

      const target = e.target as HTMLElement | null;
      if (!target) return;

      const isText = Boolean(target.closest('input, textarea, [contenteditable="true"]'));
      const isPointer = Boolean(
        target.closest('button, a, [role="button"], [role="tab"], [role="switch"], .icon-btn, .btn, .ghost-pill, select, label')
      );

      if (isText) {
        if (arrowRef.current) arrowRef.current.style.display = 'none';
        if (pointerRef.current) pointerRef.current.style.display = 'none';
        if (textRef.current) textRef.current.style.display = 'block';
      } else if (isPointer) {
        if (arrowRef.current) arrowRef.current.style.display = 'none';
        if (pointerRef.current) pointerRef.current.style.display = 'block';
        if (textRef.current) textRef.current.style.display = 'none';
      } else {
        if (arrowRef.current) arrowRef.current.style.display = 'block';
        if (pointerRef.current) pointerRef.current.style.display = 'none';
        if (textRef.current) textRef.current.style.display = 'none';
      }
    };

    const onMouseLeave = (e: MouseEvent) => {
      if (!e.relatedTarget && cursor) {
        isVisible = false;
        cursor.style.opacity = '0';
      }
    };

    window.addEventListener('mousemove', onMouseMove, { passive: true });
    document.addEventListener('mouseleave', onMouseLeave);

    return () => {
      document.documentElement.classList.remove('stealth-cursor-active');
      window.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseleave', onMouseLeave);
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div
      ref={cursorRef}
      className="stealth-cursor"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        pointerEvents: 'none',
        zIndex: 999999,
        opacity: 0,
        willChange: 'transform',
        transition: 'opacity 0.06s ease',
      }}
    >
      {/* 1. Default Arrow Cursor */}
      <svg
        ref={arrowRef}
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        style={{ display: 'block', filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.6))' }}
      >
        <path
          d="M4.5 3L11.5 20.5L14.2 13.8L21 11L4.5 3Z"
          fill="#ffffff"
          stroke="#111111"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>

      {/* 2. Interactive Hand Pointer */}
      <svg
        ref={pointerRef}
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        style={{ display: 'none', filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.6))' }}
      >
        <path
          d="M8.5 12V4.5C8.5 3.67 9.17 3 10 3C10.83 3 11.5 3.67 11.5 4.5V10.5M11.5 5.5C11.5 4.67 12.17 4 13 4C13.83 4 14.5 4.67 14.5 5.5V10.5M14.5 7C14.5 6.17 15.17 5.5 16 5.5C16.83 5.5 17.5 6.17 17.5 7V11M17.5 9.5C17.5 8.67 18.17 8 19 8C19.83 8 20.5 8.67 20.5 9.5V14.5C20.5 18.09 17.59 21 14 21H12.5C9.64 21 7.1 19.19 6.18 16.48L4.77 12.35C4.54 11.66 4.91 10.91 5.61 10.72C6.21 10.56 6.82 10.85 7.1 11.41L8.5 14.2V12"
          fill="#ffffff"
          stroke="#111111"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      {/* 3. Text I-Beam Cursor */}
      <svg
        ref={textRef}
        width="16"
        height="22"
        viewBox="0 0 16 22"
        fill="none"
        style={{
          display: 'none',
          marginLeft: -8,
          marginTop: -11,
          filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))',
        }}
      >
        <path d="M4 3H12M8 3V19M4 19H12" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M4 3H12M8 3V19M4 19H12" stroke="#111111" strokeWidth="1" strokeLinecap="round" />
      </svg>
    </div>
  );
}
