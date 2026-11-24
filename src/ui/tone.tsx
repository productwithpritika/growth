import type { ReactNode } from "react";
import type { Tone } from "@/core/types";
import { cn } from "@/lib/utils";

// The one state-tone map: every status, health or severity value renders through it.
export const TONE_SOFT: Record<Tone, string> = {
  healthy: "bg-healthy-soft text-healthy-ink",
  watch: "bg-watch-soft text-watch-ink",
  atRisk: "bg-at-risk-soft text-at-risk-ink",
  blocked: "bg-blocked-soft text-blocked-ink",
  reward: "bg-reward-soft text-reward-ink",
  info: "bg-info-soft text-info-ink",
  neutral: "bg-muted text-foreground",
};
export const TONE_MARK: Record<Tone, string> = {
  healthy: "bg-healthy",
  watch: "bg-watch",
  atRisk: "bg-at-risk",
  blocked: "bg-blocked",
  reward: "bg-reward",
  info: "bg-info",
  neutral: "bg-muted-foreground",
};
export const TONE_BORDER: Record<Tone, string> = {
  healthy: "border-healthy",
  watch: "border-watch",
  atRisk: "border-at-risk",
  blocked: "border-blocked",
  reward: "border-reward",
  info: "border-info",
  neutral: "border-border",
};
export const TONE_NAME: Record<Tone, string> = {
  healthy: "Healthy",
  watch: "Watch",
  atRisk: "At risk",
  blocked: "Blocked",
  reward: "Reward",
  info: "Info",
  neutral: "Neutral",
};

export function ToneBadge({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", TONE_SOFT[tone], className)}>
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", TONE_MARK[tone])} />
      {children}
    </span>
  );
}

export function ToneDot({ tone, className }: { tone: Tone; className?: string }) {
  return <span aria-hidden="true" className={cn("mt-1.5 size-2 shrink-0 rounded-full", TONE_MARK[tone], className)} />;
}
