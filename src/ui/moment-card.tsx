import { useState, type ReactNode } from "react";
import { X } from "lucide-react";
import type { Tone } from "@/core/types";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TONE_BORDER, TONE_SOFT } from "@/ui/tone";
import { cn } from "@/lib/utils";

export interface MomentAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  hint?: string;
}

export interface MomentCardProps {
  tone: Tone;
  /** What fired the moment, e.g. "Ledger · Data Credits reached 0". */
  trigger: string;
  headline: string;
  evidence: ReactNode;
  primary?: MomentAction;
  secondary?: MomentAction;
  options?: ReactNode;
  onDismiss?: (reason: string) => void;
  dismissReasons?: string[];
}

const DEFAULT_REASONS = ["Not now", "Already handled", "Not relevant to me"];

/** The designed-moment container: trigger, headline, evidence, actions and a dismiss reason. */
export function MomentCard({ tone, trigger, headline, evidence, primary, secondary, options, onDismiss, dismissReasons = DEFAULT_REASONS }: MomentCardProps) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-label={headline} className={cn("rounded-xl border-l-4 border border-border bg-card p-4", TONE_BORDER[tone])}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("rounded-full px-2 py-0.5 type-caption font-medium", TONE_SOFT[tone])}>{trigger}</span>
          </div>
          <h2 className="type-heading">{headline}</h2>
          <div className="type-body text-muted-foreground">{evidence}</div>
        </div>
        {onDismiss && (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label="Dismiss">
                <X aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 p-2">
              <p className="px-2 pb-1 type-caption font-medium text-muted-foreground">Why dismiss?</p>
              {dismissReasons.map((r) => (
                <Button
                  key={r}
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => {
                    setOpen(false);
                    onDismiss(r);
                  }}
                >
                  {r}
                </Button>
              ))}
            </PopoverContent>
          </Popover>
        )}
      </div>
      {options && <div className="mt-3">{options}</div>}
      {(primary || secondary) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {primary && (
            <Button size="sm" onClick={primary.onClick} disabled={primary.disabled}>
              {primary.label}
            </Button>
          )}
          {secondary && (
            <Button size="sm" variant="outline" onClick={secondary.onClick} disabled={secondary.disabled}>
              {secondary.label}
            </Button>
          )}
          {(primary?.disabled && primary.hint) || (secondary?.disabled && secondary.hint) ? (
            <span className="type-caption">{primary?.disabled ? primary.hint : secondary?.hint}</span>
          ) : null}
        </div>
      )}
    </section>
  );
}
