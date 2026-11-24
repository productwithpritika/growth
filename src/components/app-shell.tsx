import { useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { MotionConfig, motion } from "motion/react";
import { Gauge, Menu, RotateCcw, Search } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useConfirm } from "@/hooks/use-confirm";
import { useCockpit, useTenant, useTenantList, type Horizon } from "@/lib/cockpit-store";
import { PERSONAS, personaName, personaRole, type PersonaId } from "@/tenants/personas";
import { planOf } from "@/core/pack";
import { StoredNote } from "@/ui/primitives";
import { DemoScript } from "@/components/demo-script";
import { ThemeToggle } from "@/components/theme-toggle";
import { CommandPalette } from "@/components/command-palette";
import { AskDrawer, AskLauncher } from "@/surfaces/ask/drawer";
import { PresenterButton, PresenterOverlay } from "@/components/presenter";
import { PROGRAM_NAV, SYSTEM_NAV, type NavItem } from "@/components/nav";
import { useGo, useNavItems } from "@/components/nav-hooks";
import { cn } from "@/lib/utils";

const SAVE_WARNINGS = {
  failed: "Your latest changes couldn't be saved in this browser. Keep this page open to avoid losing them.",
  unreadable: "Saved cockpit data in this browser couldn't be loaded. It is left untouched; changes in this session stay in memory only.",
  unavailable: "This browser isn't allowing the cockpit to save. Changes stay in memory until you close the page.",
} as const;

const HORIZONS: { id: Horizon; label: string }[] = [
  { id: "crawl", label: "Crawl" },
  { id: "walk", label: "Walk" },
  { id: "run", label: "Run" },
];

function isActive(item: NavItem, pathname: string, s: { hubTab: string; wbTab: string; surface: string }) {
  if (item.path !== pathname) return false;
  if (item.hubTab) return s.surface === "hub" && s.hubTab === item.hubTab;
  if (item.wbTab) return s.surface === "workbench" && s.wbTab === item.wbTab;
  return true;
}

function SideNav({ onPick }: { onPick?: () => void }) {
  const { pathname } = useLocation();
  const go = useGo();
  const { surface, items } = useNavItems();
  const hubTab = useCockpit((s) => s.hubTab);
  const wbTab = useCockpit((s) => s.wbTab);
  const t = useTenant();
  const group = (title: string, list: NavItem[]) => (
    <div className="space-y-1">
      <div className="px-3 pt-3 pb-1 type-caption font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      {list.map((i) => {
        const active = isActive(i, pathname, { hubTab, wbTab, surface });
        const Icon = i.icon;
        return (
          <button
            key={i.id}
            type="button"
            data-tour={`nav-${i.id}`}
            aria-current={active ? "page" : undefined}
            onClick={() => {
              go(i);
              onPick?.();
            }}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left type-body font-medium transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
              active ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon aria-hidden="true" className={cn("size-4", active && "text-primary")} />
            {i.label}
          </button>
        );
      })}
    </div>
  );
  const groups = surface === "hub" ? [{ title: `${t.pack.brand.wordmark} · ${t.pack.copy["hub.title"] ?? "Credits Hub"}`, list: items }] : [...new Set(items.map((i) => i.group ?? "Growth Workbench"))].map((g) => ({ title: g, list: items.filter((i) => (i.group ?? "Growth Workbench") === g) }));
  return (
    <nav aria-label="Sections" className="space-y-2">
      {groups.map((g) => (
        <div key={g.title}>{group(g.title, g.list)}</div>
      ))}
      {group("Program", PROGRAM_NAV)}
      {group("System", SYSTEM_NAV)}
    </nav>
  );
}

function HorizonToggle({ className }: { className?: string }) {
  const horizon = useCockpit((s) => s.horizon);
  const setUi = useCockpit((s) => s.setUi);
  return (
    <div role="group" aria-label="Horizon" className={cn("inline-flex rounded-md border border-zinc-700 p-0.5", className)}>
      {HORIZONS.map((h) => (
        <button
          key={h.id}
          type="button"
          aria-pressed={horizon === h.id}
          onClick={() => setUi({ horizon: h.id })}
          className={cn(
            "rounded px-2 py-1 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white",
            horizon === h.id ? "bg-zinc-100 text-zinc-950" : "text-zinc-300 hover:text-white",
          )}
        >
          {h.label}
        </button>
      ))}
    </div>
  );
}

function TenantSelect({ className }: { className?: string }) {
  const active = useCockpit((s) => s.data.activeTenant);
  const setTenant = useCockpit((s) => s.setTenant);
  const list = useTenantList();
  return (
    <Select value={active} onValueChange={setTenant}>
      <SelectTrigger aria-label="Tenant" size="sm" className={cn("h-8 border-zinc-700 bg-zinc-900 text-zinc-50 [&_svg]:text-zinc-300", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {list.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.company}
            {p.custom ? " · onboarded" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PersonaSelect({ className }: { className?: string }) {
  const persona = useCockpit((s) => s.persona);
  const setPersona = useCockpit((s) => s.setPersona);
  const navigate = useNavigate();
  const t = useTenant();
  return (
    <Select
      value={persona}
      onValueChange={(v) => {
        setPersona(v as PersonaId);
        navigate("/");
      }}
    >
      <SelectTrigger aria-label="Persona" size="sm" className={cn("h-8 border-zinc-700 bg-zinc-900 text-zinc-50 [&_svg]:text-zinc-300", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PERSONAS.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            <span className="font-medium">{personaName(t.pack, p.id)}</span>
            <span className="text-muted-foreground"> · {personaRole(t.pack, p.id, p.id === "maya" || p.id === "dev" ? planOf(t.pack, t.hub[p.id]?.planId ?? t.pack.demo.hub[p.id].planId).name : undefined)}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ResetButton({ className, variant = "ghost" }: { className?: string; variant?: "ghost" | "outline" }) {
  const confirm = useConfirm();
  const resetDemo = useCockpit((s) => s.resetDemo);
  return (
    <Button
      size="sm"
      variant={variant}
      className={className}
      onClick={async () => {
        if (await confirm({ title: "Reset the cockpit?", description: "Ledgers, events, limits, experiments, approvals and onboarded tenants go back to the seeded state, dated today.", confirmLabel: "Reset", destructive: true })) resetDemo();
      }}
    >
      <RotateCcw aria-hidden="true" />
      Reset demo
    </Button>
  );
}

export function AppShell() {
  const { pathname } = useLocation();
  const saveState = useCockpit((s) => s.saveState);
  const [menu, setMenu] = useState(false);
  const [palette, setPalette] = useState(false);

  return (
    <TooltipProvider delayDuration={200}>
      <MotionConfig reducedMotion="user">
      <div className="flex min-h-screen flex-col bg-background">
        <a href="#work" className="sr-only z-50 rounded-md bg-background px-3 py-2 text-sm font-medium text-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:outline-2 focus:outline-ring">
          Skip to content
        </a>
        <header className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950 text-zinc-50">
          <div className="flex items-center gap-2 px-3 py-2 sm:px-4">
            <Button size="icon-sm" variant="ghost" className="text-zinc-200 hover:bg-zinc-800 hover:text-white lg:hidden" aria-label="Open menu" aria-expanded={menu} onClick={() => setMenu(true)}>
              <Menu aria-hidden="true" />
            </Button>
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-md bg-rose-700 text-white">
                <Gauge className="size-4" />
              </span>
              <span className="hidden text-sm font-semibold tracking-tight xl:inline">Monetization Cockpit</span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <PersonaSelect className="w-[150px] sm:w-[200px] xl:w-[230px]" />
              <TenantSelect className="hidden w-[140px] lg:flex xl:w-[170px]" />
              <HorizonToggle className="hidden xl:inline-flex" />
              <AskLauncher className="h-8 text-zinc-200 hover:bg-zinc-800 hover:text-white" />
              <PresenterButton className="hidden h-8 text-zinc-200 hover:bg-zinc-800 hover:text-white lg:inline-flex" />
              <Button size="sm" variant="ghost" className="h-8 text-zinc-200 hover:bg-zinc-800 hover:text-white" onClick={() => setPalette(true)} aria-label="Open command palette (Ctrl or Cmd + K)">
                <Search aria-hidden="true" />
                <span className="hidden xl:inline">Search</span>
                <kbd className="hidden rounded border border-zinc-700 px-1 text-[0.7rem] text-zinc-300 xl:inline">⌘K</kbd>
              </Button>
              <ThemeToggle className="hidden text-zinc-200 hover:bg-zinc-800 hover:text-white lg:inline-flex" />
              <div className="hidden items-center gap-1 lg:flex">
                <ResetButton className="text-zinc-200 hover:bg-zinc-800 hover:text-white" />
                <DemoScript />
              </div>
            </div>
          </div>
        </header>
        {saveState !== "saved" && (
          <div role="alert" className="border-b border-watch bg-watch-soft px-4 py-2 text-sm text-watch-ink">
            {SAVE_WARNINGS[saveState]}
          </div>
        )}
        <div className="flex flex-1">
          <aside className="sticky top-12 hidden h-[calc(100dvh-3rem)] w-60 shrink-0 flex-col overflow-y-auto border-r border-border bg-muted/40 px-2 pb-4 lg:flex">
            <SideNav />
            <div className="mt-auto pt-4">
              <StoredNote className="text-muted-foreground hover:text-foreground" />
            </div>
          </aside>
          <main className="flex min-w-0 flex-1 flex-col">
            <motion.div key={pathname} id="work" tabIndex={-1} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15, ease: "easeOut" }} className="flex-1 outline-none">
              <Outlet />
            </motion.div>
          </main>
        </div>
        <Sheet open={menu} onOpenChange={setMenu}>
          <SheetContent side="left" className="w-[300px] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Monetization Cockpit</SheetTitle>
            </SheetHeader>
            <div className="space-y-4 px-4 pb-6">
              <div className="space-y-2 rounded-lg bg-zinc-950 p-3">
                <TenantSelect className="w-full" />
                <HorizonToggle className="w-full justify-between" />
              </div>
              <SideNav onPick={() => setMenu(false)} />
              <div className="flex flex-wrap gap-2">
                <ResetButton variant="outline" />
                <DemoScript />
                <PresenterButton className="border border-border" />
                <ThemeToggle className="border border-border" />
              </div>
              <StoredNote className="text-muted-foreground" />
            </div>
          </SheetContent>
        </Sheet>
        <CommandPalette open={palette} onOpenChange={setPalette} />
        <AskDrawer />
        <PresenterOverlay />
        <Toaster />
      </div>
      </MotionConfig>
    </TooltipProvider>
  );
}

export default AppShell;
