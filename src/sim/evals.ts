// Skill endpoints, eval suites and eval runs for the tenant's model-backed work: what a cheaper
// model would cost in quality. Deterministic for a seed; used next to model-choice data.
import type { SimConfig, TenantPack } from "@/tenants/schema";
import { addDays, fnv1a, mulberry32, r2 } from "@/core/time";
import { primaryMeter, rateOf } from "@/core/pack";
import type { EvalRun, EvalSuite, SkillEndpoint } from "@/sim/usage90-types";

export function evalsFor(pack: TenantPack, cfg: SimConfig, anchor: Date): { skills: SkillEndpoint[]; suites: EvalSuite[]; runs: EvalRun[] } {
  const rng = mulberry32(parseInt(fnv1a(`evals:${cfg.seed}`), 16));
  const prim = primaryMeter(pack).id;
  const cost = new Map(pack.models.map((m) => [m.id, m.providerCostPerRun]));
  const skills: SkillEndpoint[] = [];
  const suites: EvalSuite[] = [];
  const runs: EvalRun[] = [];
  for (const e of cfg.enrichments) {
    if (!e.models.length) continue;
    skills.push({ id: e.id, name: e.label, kind: "agent-skill", path: `/v1/skills/${e.id}`, rateItem: e.step, models: e.models });
    const suite: EvalSuite = { id: `${e.id}-quality`, skillId: e.id, name: `${e.label} quality`, cases: 40 + Math.floor(rng() * 4) * 10, metric: "Share of cases matching the labelled answer" };
    suites.push(suite);
    const def = e.models[0];
    const defCost = cost.get(def) ?? 1;
    const base = 0.86 + rng() * 0.08;
    e.models.forEach((m, i) => {
      const ratio = Math.max(1, defCost / Math.max(1e-6, cost.get(m) ?? defCost));
      const pass = Math.min(0.99, Math.max(0.4, base - 0.045 * Math.log2(ratio) + (rng() - 0.5) * 0.02));
      const item = rateOf(pack, e.modelSteps[m] ?? e.step);
      runs.push({
        id: `${suite.id}-${m}`,
        suiteId: suite.id,
        model: m,
        at: addDays(anchor, -(2 + i)).toISOString(),
        passRate: r2(pass),
        creditsPerCase: r2(item?.costs[prim] ?? 0),
        vsDefault: 0,
      });
    });
    const d = runs.find((r) => r.suiteId === suite.id && r.model === def);
    for (const r of runs) if (r.suiteId === suite.id && d) r.vsDefault = r2(r.passRate - d.passRate);
  }
  return { skills, suites, runs };
}
