// Mock MCP tool registry: typed tools agents can call. Each tool validates its input,
// calls the mock API and returns a traced result the UI can show (ToolCallTrace).
import { z } from "zod";
import type { TenantState } from "@/core/types";
import { mockFetch } from "@/mocks/router";
import type { ToolCall } from "@/mcp/types";

interface ToolDef {
  name: string;
  description: string;
  input: z.ZodType;
  run: (args: Record<string, unknown>, state: TenantState) => { status: number; json: unknown };
  summarise: (json: unknown) => string;
}

const count = (x: unknown) => (Array.isArray(x) ? `${x.length} rows` : "ok");

export const TOOLS: ToolDef[] = [
  {
    name: "tenant.get_pack",
    description: "Read the active Tenant Pack",
    input: z.object({}),
    run: (_a, s) => mockFetch(s, "GET", "/api/tenant/pack"),
    summarise: (j) => {
      const p = j as { meters?: unknown[]; plans?: unknown[] };
      return `${p.meters?.length ?? 0} meters · ${p.plans?.length ?? 0} plans`;
    },
  },
  {
    name: "tenant.validate_pack",
    description: "Validate a Tenant Pack against the schema",
    input: z.object({ pack: z.unknown() }),
    run: (a, s) => mockFetch(s, "POST", "/api/packs/validate", a.pack),
    summarise: (j) => {
      const r = j as { valid: boolean; issues?: unknown[] };
      return r.valid ? "Valid" : `${r.issues?.length ?? 0} issues`;
    },
  },
  {
    name: "sim.preview_pack",
    description: "Simulate a first month for a pack before loading it",
    input: z.object({ pack: z.unknown() }),
    run: (a, s) => mockFetch(s, "POST", "/api/packs/preview", a.pack),
    summarise: (j) => {
      const r = j as { accounts?: number; mrr?: number };
      return r.accounts != null ? `${r.accounts} accounts · $${(r.mrr ?? 0).toLocaleString("en-US")} MRR` : "Failed";
    },
  },
  {
    name: "ledger.get_balance",
    description: "Balances and holds for an account",
    input: z.object({ account: z.string() }),
    run: (a, s) => mockFetch(s, "GET", `/api/accounts/${String(a.account)}/balances`),
    summarise: count,
  },
  {
    name: "usage.forecast",
    description: "Run-out forecast for one meter",
    input: z.object({ account: z.string(), meter: z.string() }),
    run: (a, s) => mockFetch(s, "GET", `/api/accounts/${String(a.account)}/forecast/${String(a.meter)}`),
    summarise: (j) => {
      const r = j as { runsOutDay?: number | null; ranOutAt?: string | null };
      return r.ranOutAt ? "Already ran out" : r.runsOutDay != null ? `Runs out on day ${r.runsOutDay + 1}` : "Lasts the cycle";
    },
  },
  {
    name: "cohorts.list",
    description: "Cohort sizes for the tenant",
    input: z.object({}),
    run: (_a, s) => mockFetch(s, "GET", "/api/cohorts"),
    summarise: count,
  },
  {
    name: "pricing.plan_fit",
    description: "Cheapest plan for a monthly demand, today and with proposals",
    input: z.object({ demand: z.record(z.string(), z.number()), needs: z.array(z.string()).default([]) }),
    run: (a, s) => mockFetch(s, "POST", "/api/plan-fit", a),
    summarise: (j) => {
      const r = j as { today?: { planId: string }; cockpit?: { planId: string } };
      return `Today ${r.today?.planId ?? "?"} · proposals ${r.cockpit?.planId ?? "?"}`;
    },
  },
];

let seq = 0;

export function callTool(name: string, args: Record<string, unknown>, state: TenantState): ToolCall {
  const tool = TOOLS.find((t) => t.name === name);
  const id = `call_${++seq}`;
  const started = performance.now();
  if (!tool) return { id, tool: name, args, status: "error", ms: 0, summary: "Unknown tool", result: null };
  const parsed = tool.input.safeParse(args);
  if (!parsed.success) return { id, tool: name, args, status: "error", ms: 0, summary: "Invalid arguments", result: parsed.error.issues };
  const res = tool.run(args, state);
  const ms = Math.max(1, Math.round(performance.now() - started));
  const shownArgs = Object.fromEntries(Object.entries(args).map(([k, v]) => [k, k === "pack" ? "(pack JSON)" : v]));
  return { id, tool: name, args: shownArgs, status: res.status < 300 ? "ok" : "error", ms, summary: res.status < 300 ? tool.summarise(res.json) : `HTTP ${res.status}`, result: res.json };
}
