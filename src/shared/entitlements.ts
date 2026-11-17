/**
 * Commercial-readiness abstraction: features, tiers and usage limits.
 *
 * IMPORTANT: this file only defines the *shape* of entitlements. The shipped provider
 * (LocalEntitlementProvider) grants everything, because any check performed purely on the
 * client can be patched out and must never be presented as licence enforcement.
 * Real enforcement needs a trusted backend that (a) authenticates the account,
 * (b) issues short-lived signed entitlement tokens, and (c) gates paid *server-side*
 * resources (hosted AI, sync). See MASTER_ARCHITECTURE.md → "Commercial architecture".
 */
export const FEATURES = [
  'live-transcription',
  'ai-answers',
  'screen-context',
  'mode-tools',
  'library',
  'export',
  'ghost-mode',
  'cloud-sync',
  'team-workspaces',
] as const;
export type FeatureId = (typeof FEATURES)[number];

export type Tier = 'local' | 'free' | 'pro' | 'team';

export interface UsageLimits {
  /** null = unlimited. */
  aiRequestsPerDay: number | null;
  sessionMinutesPerDay: number | null;
}

export interface Entitlements {
  tier: Tier;
  features: Record<FeatureId, boolean>;
  limits: UsageLimits;
  /** Where the entitlement came from. 'local' means "no account system exists yet". */
  source: 'local' | 'server';
  /** ISO timestamp after which a server-issued entitlement must be refreshed. */
  expiresAt: string | null;
}

export interface EntitlementProvider {
  get(): Entitlements;
  has(feature: FeatureId): boolean;
}

const ALL_LOCAL = Object.fromEntries(FEATURES.map((f) => [f, f !== 'cloud-sync' && f !== 'team-workspaces'])) as Record<FeatureId, boolean>;

/** Default provider: the app is fully functional offline with the user's own API keys. */
export class LocalEntitlementProvider implements EntitlementProvider {
  get(): Entitlements {
    return {
      tier: 'local',
      features: { ...ALL_LOCAL },
      limits: { aiRequestsPerDay: null, sessionMinutesPerDay: null },
      source: 'local',
      expiresAt: null,
    };
  }
  has(feature: FeatureId): boolean {
    return ALL_LOCAL[feature];
  }
}

/** Build-time/runtime feature flags for staged rollouts. Unknown flags are off. */
export const DEFAULT_FLAGS = { streamingAnswers: true, modeTools: true, performanceHud: true } as const;
export type FlagId = keyof typeof DEFAULT_FLAGS;
export function isFlagEnabled(flag: FlagId, overrides: Partial<Record<FlagId, boolean>> = {}): boolean {
  return overrides[flag] ?? DEFAULT_FLAGS[flag] ?? false;
}
