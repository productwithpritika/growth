import { cn } from "@/lib/utils";

/** A native range input: labelled by its <Label htmlFor> or aria-label, keyboard and screen-reader ready. */
export function Range({ id, min, max, step = 1, value, onValueChange, className, "aria-label": ariaLabel, "aria-valuetext": valueText }: { id?: string; min: number; max: number; step?: number; value: number; onValueChange: (v: number) => void; className?: string; "aria-label"?: string; "aria-valuetext"?: string }) {
  return <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onValueChange(Number(e.target.value))} aria-label={ariaLabel} aria-valuetext={valueText} className={cn("h-5 w-full cursor-pointer accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", className)} />;
}
