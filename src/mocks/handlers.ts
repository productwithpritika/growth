// MSW-style request handlers for the cockpit's API. The msw package is not in this app's
// locked dependency set, so the same handler shape is served in-process by ./router.
// Swapping in MSW (or a real backend) means re-registering these with msw's `http`.
import type { TenantState } from "@/core/types";
import { parsePack } from "@/tenants/schema";
import { balanceOf, heldOf } from "@/core/ledger";
import { meterTimeline } from "@/core/forecasting";
import { bestFit, cohortDefs, workbenchStats } from "@/core/economics";
import { planOf } from "@/core/pack";
import { previewPack } from "@/sim/preview";

export interface MockRequest {
  method: "GET" | "POST";
  path: string;
  params: Record<string, string>;
  body?: unknown;
  state: TenantState;
}

export interface MockHandler {
  method: MockRequest["method"];
  path: string;
  resolve: (req: MockRequest) => { status: number; json: unknown };
}

const ok = (json: unknown) => ({ status: 200, json });
const bad = (status: number, message: string) => ({ status, json: { error: message } });

export const http = {
  get: (path: string, resolve: MockHandler["resolve"]): MockHandler => ({ method: "GET", path, resolve }),
  post: (path: string, resolve: MockHandler["resolve"]): MockHandler => ({ method: "POST", path, resolve }),
};

export const handlers: MockHandler[] = [
  http.get("/api/tenant/pack", ({ state }) => ok(state.pack)),
  http.get("/api/accounts/:account/balances", ({ params, state }) => {
    if (!state.hub[params.account]) return bad(404, "Unknown account");
    return ok(state.pack.meters.map((m) => ({ meter: m.id, balance: balanceOf(state.ledger, params.account, m.id), held: heldOf(state.ledger, params.account, m.id) })));
  }),
  http.get("/api/accounts/:account/ledger", ({ params, state }) => ok(state.ledger.filter((e) => e.account === params.account).slice(-50))),
  http.get("/api/accounts/:account/forecast/:meter", ({ params, state }) => {
    if (!state.hub[params.account]) return bad(404, "Unknown account");
    const tl = meterTimeline(state, params.account, params.meter);
    return ok({ balance: tl.balance, ratePerDay: tl.rate, runsOutDay: tl.runsOutDay, early: tl.runsOutEarly, late: tl.runsOutLate, ranOutAt: tl.ranOutAt });
  }),
  http.get("/api/cohorts", ({ state }) => {
    const w = workbenchStats(state.pack);
    return ok(cohortDefs(state.pack).map((c) => ({ id: c.id, label: c.label, accounts: w.accounts.filter((a) => c.test(a, w.projections.get(a.id)!, planOf(state.pack, a.planId))).length })));
  }),
  http.post("/api/plan-fit", ({ body, state }) => {
    const b = (body ?? {}) as { demand?: Record<string, number>; needs?: string[] };
    return ok({ today: bestFit(state.pack, { demand: b.demand ?? {}, needs: b.needs ?? [] }, "today"), cockpit: bestFit(state.pack, { demand: b.demand ?? {}, needs: b.needs ?? [] }, "cockpit") });
  }),
  http.post("/api/packs/validate", ({ body }) => {
    const r = parsePack(body);
    return r.ok ? ok({ valid: true }) : ok({ valid: false, issues: r.issues });
  }),
  http.post("/api/packs/preview", ({ body }) => {
    const r = parsePack(body);
    return r.ok ? ok(previewPack(r.pack)) : bad(422, "Pack does not validate");
  }),
];
