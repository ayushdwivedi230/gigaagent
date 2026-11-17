import { useRef } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';

interface SplitterProps {
  label: string;
  value: number;
  min: number;
  max: number;
  /** +1 when dragging right grows the panel (left panel), -1 for a right-hand panel. */
  direction: 1 | -1;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
}

/** Draggable, keyboard-operable panel divider (arrow keys, Home/End). */
export function Splitter({ label, value, min, max, direction, onChange, onCommit }: SplitterProps) {
  const drag = useRef<{ x: number; start: number; last: number } | null>(null);
  const clamp = (v: number): number => Math.min(max, Math.max(min, Math.round(v)));

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    drag.current = { x: e.clientX, start: value, last: value };
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return;
    const next = clamp(drag.current.start + (e.clientX - drag.current.x) * direction);
    drag.current.last = next;
    onChange(next);
  };
  const onPointerUp = (): void => {
    if (!drag.current) return;
    onCommit(drag.current.last);
    drag.current = null;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const step = e.shiftKey ? 48 : 16;
    let next: number | null = null;
    if (e.key === 'ArrowLeft') next = value - step * direction;
    else if (e.key === 'ArrowRight') next = value + step * direction;
    else if (e.key === 'Home') next = min;
    else if (e.key === 'End') next = max;
    if (next === null) return;
    e.preventDefault();
    const clamped = clamp(next);
    onChange(clamped);
    onCommit(clamped);
  };

  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    />
  );
}
