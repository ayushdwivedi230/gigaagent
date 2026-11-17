import { useEffect, useRef } from 'react';
import { subscribeLevel } from '../state/levels';
import type { LevelSource } from '../state/levels';
import { Icon } from './Icon';

/**
 * Live input level. Paints directly to the DOM (no React re-render per audio chunk).
 * The numeric value is exposed through role="meter" at a low update rate for assistive tech.
 */
export function LevelMeter({ source, label, active }: { source: LevelSource; label: string; active: boolean }) {
  const fill = useRef<HTMLSpanElement>(null);
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let lastAria = 0;
    return subscribeLevel(source, (level) => {
      if (fill.current) fill.current.style.transform = `scaleX(${active ? Math.max(0.02, level).toFixed(3) : 0})`;
      const now = Date.now();
      if (root.current && now - lastAria > 1000) {
        lastAria = now;
        root.current.setAttribute('aria-valuenow', String(Math.round(level * 100)));
      }
    });
  }, [source, active]);

  return (
    <span className={`meter${active ? '' : ' meter--off'}`} title={label}>
      <Icon name={source === 'mic' ? 'mic' : 'speaker'} size={13} />
      <span ref={root} className="meter__track" role="meter" aria-label={`${label} level`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={0}>
        <span ref={fill} className="meter__fill" />
      </span>
    </span>
  );
}
