import type { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToneBadge } from "@/ui/tone";

export interface DiffRow {
  path: string;
  before: string;
  after: string;
}

export interface ApprovalSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  preview: ReactNode;
  diff: DiffRow[];
  risk: { level: "low" | "medium" | "high"; reasons: string[] };
  auditId: string;
  onApprove: () => void;
  onReject: () => void;
  approveLabel?: string;
}

const RISK_TONE = { low: "healthy", medium: "watch", high: "blocked" } as const;

/** Preview, diff, risk and an audit id: everything a human needs before approving an agent's change. */
export function ApprovalSheet({ open, onOpenChange, title, description, preview, diff, risk, auditId, onApprove, onReject, approveLabel = "Approve" }: ApprovalSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div className="space-y-5 px-4">
          <section aria-labelledby="ap-preview" className="space-y-2">
            <h3 id="ap-preview" className="type-caption font-semibold uppercase tracking-wide text-muted-foreground">Preview</h3>
            <div className="rounded-lg border border-border p-3">{preview}</div>
          </section>
          <section aria-labelledby="ap-diff" className="space-y-2">
            <h3 id="ap-diff" className="type-caption font-semibold uppercase tracking-wide text-muted-foreground">Changes</h3>
            <Table>
              <TableCaption className="sr-only">Fields changed by this approval</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Field</TableHead>
                  <TableHead scope="col">Before</TableHead>
                  <TableHead scope="col">After</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {diff.map((d) => (
                  <TableRow key={d.path}>
                    <TableHead scope="row" className="font-mono type-caption font-normal">{d.path}</TableHead>
                    <TableCell className="type-caption text-blocked-ink line-through decoration-1">{d.before || "—"}</TableCell>
                    <TableCell className="type-caption font-medium text-healthy-ink">{d.after}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
          <section aria-labelledby="ap-risk" className="space-y-2">
            <h3 id="ap-risk" className="flex items-center gap-2 type-caption font-semibold uppercase tracking-wide text-muted-foreground">
              Risk <ToneBadge tone={RISK_TONE[risk.level]}>{risk.level}</ToneBadge>
            </h3>
            <ul className="list-disc space-y-1 pl-5 type-body">
              {risk.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </section>
          <p className="flex items-center gap-2 type-caption text-muted-foreground">
            <ShieldCheck aria-hidden="true" className="size-4" />
            Audit id <span className="font-mono text-foreground">{auditId}</span>
          </p>
        </div>
        <SheetFooter className="flex-row justify-end gap-2">
          <Button variant="outline" onClick={onReject}>
            Reject
          </Button>
          <Button onClick={onApprove}>{approveLabel}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
