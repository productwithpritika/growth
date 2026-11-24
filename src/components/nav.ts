import { Activity, BookOpenText, Bot, Boxes, BrainCircuit, CalendarCheck, Coins, CreditCard, FlaskConical, Gauge, Gift, Grid2x2, House, LayoutGrid, Lightbulb, LifeBuoy, ListChecks, Lock, Map as MapIcon, MessagesSquare, PanelRight, PiggyBank, PlugZap, Rocket, Route, Scale, ShieldCheck, SlidersHorizontal, Sparkles, Table2, Wallet, Wand2, Vault, Workflow, type LucideIcon } from "lucide-react";
import type { TenantPack, WorkbenchTab } from "@/tenants/schema";
import type { BrainTab, Horizon, HubTab } from "@/lib/cockpit-store";
import { copy } from "@/core/pack";
import { enabledAt, type FeatureKey } from "@/ui/horizon";
import type { Capability } from "@/core/team";

export interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  path: "/" | "/brain" | "/gallery" | "/roadmap" | "/portfolio" | "/health" | "/trust";
  /** Side-nav subgroup on the Workbench. */
  group?: string;
  hubTab?: HubTab;
  wbTab?: WorkbenchTab;
  brainTab?: BrainTab;
  feature?: FeatureKey;
}

/** The Credits Hub sections. `need` is the role capability a section requires; Members see what they can act on. */
export function hubNav(pack: TenantPack, opts: { can?: (c: Capability) => boolean; lifecycle?: boolean; member?: boolean } = {}): NavItem[] {
  const can = opts.can ?? (() => true);
  const items: (NavItem & { need?: Capability })[] = [
    { id: "home", label: "Home", icon: House, path: "/", hubTab: "home", feature: "hub.home" },
    { id: "usage", label: "Usage", icon: Gauge, path: "/", hubTab: "usage", feature: "hub.usage" },
    { id: "tables", label: "Tables", icon: Table2, path: "/", hubTab: "tables", feature: "hub.tables", need: "run" },
    { id: "topups", label: copy(pack, "topups.title", "Top-ups"), icon: Coins, path: "/", hubTab: "topups", feature: "hub.topups", need: "buy" },
    { id: "limits", label: opts.member ? "Limits and requests" : "Limits", icon: SlidersHorizontal, path: "/", hubTab: "limits", feature: "hub.limits" },
    { id: "rewards", label: "Rewards", icon: Gift, path: "/", hubTab: "rewards", feature: "hub.rewards" },
    { id: "plan", label: "Plan", icon: Wallet, path: "/", hubTab: "plan", feature: "hub.plan", need: "plan" },
    { id: "billing", label: "Billing", icon: CreditCard, path: "/", hubTab: "billing", feature: "hub.billing", need: "payment" },
  ];
  if (opts.lifecycle) items.push({ id: "lifecycle", label: "Lifecycle", icon: Route, path: "/", hubTab: "lifecycle", feature: "hub.lifecycle" });
  return items.filter((i) => !i.need || can(i.need));
}

export const WB_NAV: NavItem[] = [
  { id: "start", label: "Get started", icon: PlugZap, path: "/", wbTab: "start", feature: "wb.start", group: "Growth loop" },
  { id: "today", label: "Today", icon: CalendarCheck, path: "/", wbTab: "today", feature: "wb.today", group: "Growth loop" },
  { id: "overview", label: "Cohorts", icon: LayoutGrid, path: "/", wbTab: "overview", feature: "wb.overview", group: "Growth loop" },
  { id: "hypotheses", label: "Hypotheses", icon: Lightbulb, path: "/", wbTab: "hypotheses", feature: "wb.hypotheses", group: "Growth loop" },
  { id: "experiments", label: "Experiments", icon: FlaskConical, path: "/", wbTab: "experiments", feature: "wb.experiments", group: "Growth loop" },
  { id: "plays", label: "Experiment plays", icon: Sparkles, path: "/", wbTab: "plays", feature: "wb.plays", group: "Growth loop" },
  { id: "ask", label: "Ask CB", icon: MessagesSquare, path: "/", wbTab: "ask", feature: "wb.ask", group: "Growth loop" },
  { id: "churn", label: "Churn arrest", icon: LifeBuoy, path: "/", wbTab: "churn", feature: "wb.churn", group: "Money" },
  { id: "optimiser", label: "Plan optimiser", icon: ListChecks, path: "/", wbTab: "optimiser", feature: "wb.optimiser", group: "Money" },
  { id: "breakage", label: "Breakage pool", icon: Vault, path: "/", wbTab: "breakage", feature: "wb.breakage", group: "Money" },
  { id: "rewards", label: "Rewards studio", icon: Gift, path: "/", wbTab: "rewards", feature: "wb.rewards", group: "Money" },
  { id: "economics", label: "Unit economics", icon: PiggyBank, path: "/", wbTab: "economics", feature: "wb.economics", group: "Money" },
  { id: "evals", label: "Evals", icon: Scale, path: "/", wbTab: "evals", feature: "wb.evals", group: "AI and platform" },
  { id: "mcp", label: "MCP Console", icon: Workflow, path: "/", wbTab: "mcp", feature: "wb.mcp", group: "AI and platform" },
  { id: "agents", label: "Agents", icon: Bot, path: "/", wbTab: "agents", feature: "wb.agents", group: "AI and platform" },
  { id: "experiences", label: "Portal experiences", icon: Wand2, path: "/", wbTab: "experiences", feature: "wb.experiences", group: "AI and platform" },
  { id: "embed", label: "Embed SDK", icon: PanelRight, path: "/", wbTab: "embed", feature: "wb.embed", group: "AI and platform" },
  { id: "controls", label: "MCP usage and caps", icon: ShieldCheck, path: "/", wbTab: "controls", feature: "wb.controls", group: "AI and platform" },
  { id: "packs", label: "Pack Builder", icon: Boxes, path: "/", wbTab: "packs", feature: "wb.packs", group: "Tenants" },
  { id: "onboard", label: "Onboard a tenant", icon: Rocket, path: "/", wbTab: "onboard", feature: "wb.onboard", group: "Tenants" },
];

/** Program pages for the presenter and leadership: same for every persona. */
export const PROGRAM_NAV: NavItem[] = [
  { id: "roadmap", label: "Roadmap and flags", icon: MapIcon, path: "/roadmap" },
  { id: "portfolio", label: "Portfolio", icon: Grid2x2, path: "/portfolio" },
  { id: "health", label: "Product health", icon: Activity, path: "/health" },
  { id: "trust", label: "Trust and security", icon: Lock, path: "/trust" },
];

export const SYSTEM_NAV: NavItem[] = [
  { id: "brain", label: "Brain", icon: BrainCircuit, path: "/brain" },
  { id: "gallery", label: "Component gallery", icon: BookOpenText, path: "/gallery" },
];

/** Shown when the Horizon reaches the module's maturity and its feature flag is not killed. */
export function visible(items: NavItem[], horizon: Horizon, killed: (key: string) => boolean = () => false): NavItem[] {
  return items.filter((i) => !i.feature || (enabledAt(horizon, i.feature) && !killed(i.feature)));
}

