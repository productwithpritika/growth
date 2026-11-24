// Brain → Domain model: every entity in Phase 1 §1.4 with its fields, where it lives and how
// many the active tenant has right now.
import { SectionTitle } from "@/ui/primitives";
import { ToneBadge } from "@/ui/tone";
import { fmtNum } from "@/core/format";
import { domainCatalog, type EntityInfo } from "@/core/domain";
import type { TenantState } from "@/core";
import { usePopulation } from "@/surfaces/brain/population";

const HOME_TONE: Record<EntityInfo["home"], "info" | "healthy" | "watch" | "reward" | "neutral"> = {
  "Tenant Pack": "info",
  Ledger: "healthy",
  "Event stream": "healthy",
  Population: "watch",
  Derived: "reward",
  Store: "neutral",
};

export function DomainTab({ t }: { t: TenantState }) {
  const out = usePopulation(t);
  const items = domainCatalog(t, out);
  const groups = [...new Set(items.map((i) => i.group))];
  return (
    <section aria-labelledby="domain-title" className="space-y-4">
      <SectionTitle id="domain-title" aside={`${items.length} entities · counts for ${t.pack.company}${out ? "" : " (population loading)"}`}>
        Domain model
      </SectionTitle>
      <p className="type-body text-muted-foreground">
        Config lives in the Tenant Pack, value in the ledger, behaviour in the event stream; the 90-day population supplies history. Types are in <span className="font-mono">src/core/domain.ts</span>.
      </p>
      {groups.map((g) => (
        <div key={g} className="space-y-2">
          <h3 className="type-body font-semibold">{g}</h3>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items
              .filter((i) => i.group === g)
              .map((i) => (
                <li key={i.name} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-mono type-body font-semibold">{i.name}</span>
                    <span className="type-heading num">{fmtNum(i.count)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <ToneBadge tone={HOME_TONE[i.home]}>{i.home}</ToneBadge>
                    <span className="type-caption text-muted-foreground">{i.where}</span>
                  </div>
                  <p className="font-mono type-caption text-muted-foreground">{i.fields.join(" · ")}</p>
                  <p className="type-caption">{i.example}</p>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
