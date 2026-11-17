import { ACCENTS, ANSWER_FORMATS, SESSION_MODES, SOURCE_KINDS, SPEAKING_TARGETS, THEMES } from './types';
import type { Preferences, WindowBounds } from './types';

/** Pure defaults + validation for user preferences. No Node/Electron/DOM imports. */
export const DEFAULT_PREFERENCES: Preferences = {
  appearance: { theme: 'dark', accent: 'violet', textScale: 1, reducedMotion: 'system' },
  ai: {
    answerFormat: 'natural',
    speakingTargetSec: 0,
    autoAnswer: true,
    attachScreenToAuto: false,
    model: '',
    customInstructions: '',
    activeProfileId: null,
  },
  privacy: { allowCloudAi: true, allowCloudScreenshots: true, allowCloudTranscription: true },
  shortcuts: {
    toggleWindow: 'CommandOrControl+Shift+G',
    quickAsk: 'CommandOrControl+Shift+K',
    captureScreen: 'CommandOrControl+Shift+J',
  },
  layout: {
    expanded: false,
    leftWidth: 320,
    rightWidth: 320,
    leftCollapsed: false,
    rightCollapsed: false,
    alwaysOnTop: true,
    compactBounds: null,
    expandedBounds: null,
    clickThrough: true,
  },
  audio: { micDeviceId: null, defaultSource: 'both', defaultMode: 'mock-interview' },
};

export const MAX_CUSTOM_INSTRUCTIONS = 2000;
export const TEXT_SCALE_MIN = 0.9;
export const TEXT_SCALE_MAX = 2;
export const PANEL_MIN = 220;
export const PANEL_MAX = 560;

const MODIFIERS = new Set(['CommandOrControl', 'CmdOrCtrl', 'Control', 'Ctrl', 'Alt', 'Option', 'Shift', 'Super', 'Meta', 'Command', 'Cmd']);
const KEY = /^([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Space|Tab|Enter|Return|Escape|Esc|Up|Down|Left|Right|Home|End|PageUp|PageDown|Insert|Delete|Backspace|Plus|[`\-=\[\]\;',./])$/;

/**
 * Validates an Electron accelerator. Requires at least one non-Shift modifier so a global
 * shortcut can never swallow ordinary typing. Empty string means "disabled" and is valid.
 */
export function isValidAccelerator(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value === '') return true;
  if (value.length > 60) return false;
  const parts = value.split('+');
  const key = parts.pop();
  if (!key || !KEY.test(key)) return false;
  if (parts.length === 0 || new Set(parts).size !== parts.length) return false;
  if (!parts.every((p) => MODIFIERS.has(p))) return false;
  return parts.some((p) => p !== 'Shift');
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const oneOf = <T extends string | number>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly unknown[]).includes(v) ? (v as T) : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const num = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const str = (v: unknown, max: number, fallback: string): string => (typeof v === 'string' ? v.slice(0, max) : fallback);

function bounds(v: unknown, fallback: WindowBounds | null): WindowBounds | null {
  if (v === null) return null;
  if (!isObj(v)) return fallback;
  const { x, y, width, height } = v;
  if (![x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n))) return fallback;
  return {
    x: Math.round(x as number),
    y: Math.round(y as number),
    width: Math.round(num(width, 320, 8000, 400)),
    height: Math.round(num(height, 400, 8000, 640)),
  };
}

/**
 * Merges an untrusted partial update over a known-good base and returns a fully valid object.
 * Unknown keys are dropped; invalid values fall back to the base value. Never throws.
 */
export function sanitizePreferences(input: unknown, base: Preferences = DEFAULT_PREFERENCES): Preferences {
  const src = isObj(input) ? input : {};
  const a = isObj(src.appearance) ? src.appearance : {};
  const ai = isObj(src.ai) ? src.ai : {};
  const p = isObj(src.privacy) ? src.privacy : {};
  const sc = isObj(src.shortcuts) ? src.shortcuts : {};
  const l = isObj(src.layout) ? src.layout : {};
  const au = isObj(src.audio) ? src.audio : {};
  const accel = (v: unknown, fallback: string): string => (isValidAccelerator(v) ? v : fallback);
  const profileId = ai.activeProfileId;
  const mic = au.micDeviceId;

  return {
    appearance: {
      theme: oneOf(a.theme, THEMES, base.appearance.theme),
      accent: oneOf(a.accent, ACCENTS, base.appearance.accent),
      textScale: Math.round(num(a.textScale, TEXT_SCALE_MIN, TEXT_SCALE_MAX, base.appearance.textScale) * 100) / 100,
      reducedMotion: oneOf(a.reducedMotion, ['system', 'on', 'off'] as const, base.appearance.reducedMotion),
    },
    ai: {
      answerFormat: oneOf(ai.answerFormat, ANSWER_FORMATS, base.ai.answerFormat),
      speakingTargetSec: oneOf(ai.speakingTargetSec, SPEAKING_TARGETS, base.ai.speakingTargetSec as 0),
      autoAnswer: bool(ai.autoAnswer, base.ai.autoAnswer),
      attachScreenToAuto: bool(ai.attachScreenToAuto, base.ai.attachScreenToAuto),
      model: /^[a-z0-9.\-]{0,60}$/.test(str(ai.model, 61, base.ai.model)) ? str(ai.model, 60, base.ai.model) : base.ai.model,
      customInstructions: str(ai.customInstructions, MAX_CUSTOM_INSTRUCTIONS, base.ai.customInstructions),
      activeProfileId:
        profileId === null ? null : typeof profileId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(profileId) ? profileId : base.ai.activeProfileId,
    },
    privacy: {
      allowCloudAi: bool(p.allowCloudAi, base.privacy.allowCloudAi),
      allowCloudScreenshots: bool(p.allowCloudScreenshots, base.privacy.allowCloudScreenshots),
      allowCloudTranscription: bool(p.allowCloudTranscription, base.privacy.allowCloudTranscription),
    },
    shortcuts: {
      toggleWindow: accel(sc.toggleWindow, base.shortcuts.toggleWindow),
      quickAsk: accel(sc.quickAsk, base.shortcuts.quickAsk),
      captureScreen: accel(sc.captureScreen, base.shortcuts.captureScreen),
    },
    layout: {
      expanded: bool(l.expanded, base.layout.expanded),
      leftWidth: Math.round(num(l.leftWidth, PANEL_MIN, PANEL_MAX, base.layout.leftWidth)),
      rightWidth: Math.round(num(l.rightWidth, PANEL_MIN, PANEL_MAX, base.layout.rightWidth)),
      leftCollapsed: bool(l.leftCollapsed, base.layout.leftCollapsed),
      rightCollapsed: bool(l.rightCollapsed, base.layout.rightCollapsed),
      alwaysOnTop: bool(l.alwaysOnTop, base.layout.alwaysOnTop),
      compactBounds: 'compactBounds' in l ? bounds(l.compactBounds, base.layout.compactBounds) : base.layout.compactBounds,
      expandedBounds: 'expandedBounds' in l ? bounds(l.expandedBounds, base.layout.expandedBounds) : base.layout.expandedBounds,
      clickThrough: bool(l.clickThrough, base.layout.clickThrough ?? true),
    },
    audio: {
      micDeviceId: mic === null ? null : typeof mic === 'string' && mic.length <= 256 ? mic : base.audio.micDeviceId,
      defaultSource: oneOf(au.defaultSource, SOURCE_KINDS, base.audio.defaultSource),
      defaultMode: oneOf(au.defaultMode, SESSION_MODES, base.audio.defaultMode),
    },
  };
}
