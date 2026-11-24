import { useCockpit, type Horizon } from "@/lib/cockpit-store";
import { atHorizon, FEATURE_HORIZON, type FeatureKey } from "@/platform/features";

// Feature maturity lives in platform/features (pure). A module shows when the Horizon toggle
// reaches its maturity and its feature flag is not killed (Phase 8 §8.2).
export { FEATURE_HORIZON, type FeatureKey };

export function enabledAt(horizon: Horizon, key: FeatureKey): boolean {
  return atHorizon(horizon, key);
}

export function useFeature(key: FeatureKey): boolean {
  return useCockpit((s) => atHorizon(s.horizon, key) && !s.data.tenants[s.data.activeTenant]?.platform?.flags[key]?.killed);
}
