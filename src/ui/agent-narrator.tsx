import { Check, CircleDashed, Hand, Loader2, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface NarratorStep {
  id: string;
  label: string;
  status: StepStatus;
  detail?: string;
  /** Who did the step: the agent, a deterministic tool, or the person who took over. */
  by?: "agent" | "tool" | "you";
}

export interface AgentNarratorProps {
  steps: NarratorStep[];
  running: boolean;
  takenOver: boolean;
  canUndo: boolean;
  onTakeOver?: () => void;
  onUndo?: () => void;
  live?: string;
}

const ICON = { pending: CircleDashed, running: Loader2, done: Check, failed: X, skipped: CircleDashed } as const;
const LABEL = { pending: "Waiting", running: "Working", done: "Done", failed: "Failed", skipped: "Skipped" } as const;

/** An agent's plan as a step list with live status, plus take-over and undo. */
export function AgentNarrator({ steps, running, takenOver, canUndo, onTakeOver, onUndo, live }: AgentNarratorProps) {
  return (
    <div className="space-y-3">
      <ol className="space-y-1">
        {steps.map((s, i) => {
          const Icon = ICON[s.status];
          return (
            <li key={s.id} className={cn("flex gap-3 rounded-lg px-2 py-2", s.status === "running" && "bg-muted")}>
              <span
                className={cn(
                  "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border",
                  s.status === "done" && "border-healthy bg-healthy-soft text-healthy-ink",
                  s.status === "failed" && "border-blocked bg-blocked-soft text-blocked-ink",
                  s.status === "running" && "border-info bg-info-soft text-info-ink",
                  (s.status === "pending" || s.status === "skipped") && "border-border text-muted-foreground",
                )}
              >
                <Icon aria-hidden="true" className={cn("size-3.5", s.status === "running" && "animate-spin motion-reduce:animate-none")} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 type-body font-medium">
                  <span>
                    {i + 1}. {s.label}
                  </span>
                  <span className="type-caption font-normal text-muted-foreground">
                    {LABEL[s.status]}
                    {s.by ? ` · ${s.by === "agent" ? "agent" : s.by === "tool" ? "tool" : "you"}` : ""}
                  </span>
                </div>
                {s.detail && <p className="type-caption text-muted-foreground">{s.detail}</p>}
              </div>
            </li>
          );
        })}
      </ol>
      {(onTakeOver || onUndo) && (
        <div className="flex flex-wrap gap-2">
          {onTakeOver && (
            <Button size="sm" variant="outline" disabled={!running || takenOver} onClick={onTakeOver}>
              <Hand aria-hidden="true" />
              {takenOver ? "You have control" : "Take over"}
            </Button>
          )}
          {onUndo && (
            <Button size="sm" variant="ghost" disabled={!canUndo} onClick={onUndo}>
              <RotateCcw aria-hidden="true" />
              Undo last step
            </Button>
          )}
        </div>
      )}
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {live ?? ""}
      </p>
    </div>
  );
}
