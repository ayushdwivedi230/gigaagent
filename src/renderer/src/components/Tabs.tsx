import type { KeyboardEvent } from 'react';
import { Icon } from './Icon';
import type { IconName } from './Icon';

export interface TabDef<T extends string> {
  id: T;
  label: string;
  icon: IconName;
  badge?: number | undefined;
}

interface TabsProps<T extends string> {
  tabs: ReadonlyArray<TabDef<T>>;
  value: T;
  onChange: (id: T) => void;
  label: string;
  idPrefix: string;
  variant?: 'bar' | 'nav';
}

/** WAI-ARIA tabs with roving focus (arrow keys, Home, End). */
export function Tabs<T extends string>({ tabs, value, onChange, label, idPrefix, variant = 'bar' }: TabsProps<T>) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const i = tabs.findIndex((t) => t.id === value);
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const target = tabs[(next + tabs.length) % tabs.length]!;
    onChange(target.id);
    document.getElementById(`${idPrefix}-tab-${target.id}`)?.focus();
  };
  return (
    <div className={`tabs tabs--${variant}`} role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`${idPrefix}-tab-${t.id}`}
          aria-selected={value === t.id}
          aria-controls={`${idPrefix}-panel`}
          tabIndex={value === t.id ? 0 : -1}
          className="tab"
          onClick={() => onChange(t.id)}
        >
          <Icon name={t.icon} size={variant === 'nav' ? 17 : 14} />
          <span className="tab__label">{t.label}</span>
          {t.badge ? <span className="tab__badge">{t.badge > 99 ? '99+' : t.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}
