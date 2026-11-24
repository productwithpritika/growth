import { ChevronDown } from "lucide-react";
import type { ToolCall } from "@/mcp/types";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ToneBadge } from "@/ui/tone";

/** Every tool an agent called: name, arguments, result summary, status and latency. */
export function ToolCallTrace({ calls, empty = "No tool calls yet." }: { calls: ToolCall[]; empty?: string }) {
  if (!calls.length) return <p className="type-body text-muted-foreground">{empty}</p>;
  return (
    <ol className="divide-y divide-border rounded-lg border border-border">
      {calls.map((c) => (
        <li key={c.id}>
          <Collapsible>
            <CollapsibleTrigger className="group flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
              <span className="font-mono type-caption font-medium">{c.tool}</span>
              <span className="min-w-0 flex-1 truncate type-caption text-muted-foreground">{c.summary}</span>
              <ToneBadge tone={c.status === "ok" ? "healthy" : c.status === "error" ? "blocked" : c.status === "pending" ? "watch" : "info"}>{c.status === "pending" ? "needs approval" : c.status}</ToneBadge>
              <span className="w-14 shrink-0 text-right type-caption num text-muted-foreground">{c.status === "running" || c.status === "pending" ? "…" : `${c.ms} ms`}</span>
              <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="grid gap-2 px-3 pb-3 sm:grid-cols-2">
                <div>
                  <div className="type-caption font-medium text-muted-foreground">Arguments</div>
                  <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-muted p-2 font-mono text-xs">{JSON.stringify(c.args, null, 2)}</pre>
                </div>
                <div>
                  <div className="type-caption font-medium text-muted-foreground">Result</div>
                  <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-muted p-2 font-mono text-xs">{JSON.stringify(c.result ?? null, null, 2)?.slice(0, 1500)}</pre>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </li>
      ))}
    </ol>
  );
}
