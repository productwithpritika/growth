import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from "@/components/ui/command";
import { APP_SHORTCUTS, useAppShortcut } from "@/components/shortcut-provider";
import { useCockpit, useTenant, useTenantList, type Horizon } from "@/lib/cockpit-store";
import { PERSONAS, type PersonaId } from "@/tenants/personas";
import { verifyChain } from "@/core/ledger";
import { advanceDay } from "@/sim/seed";
import { SYSTEM_NAV } from "@/components/nav";
import { useGo, useNavItems } from "@/components/nav-hooks";
import { commandsFor } from "@/agents/cb/engine";

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const go = useGo();
  const { items } = useNavItems();
  const t = useTenant();
  const tenants = useTenantList();
  const setPersona = useCockpit((s) => s.setPersona);
  const setTenant = useCockpit((s) => s.setTenant);
  const setUi = useCockpit((s) => s.setUi);
  const apply = useCockpit((s) => s.apply);
  const persona = useCockpit((s) => s.persona);
  const horizon = useCockpit((s) => s.horizon);
  const [q, setQ] = useState("");
  const scope = PERSONAS.find((p) => p.id === persona)?.surface === "workbench" ? "merchant" : "enduser";
  const slash = (text: string) =>
    run(() => {
      setUi({ askOpen: true, askPrompt: { text, via: "palette", n: Date.now() } });
      setQ("");
    });
  useAppShortcut(APP_SHORTCUTS.commandPalette, () => onOpenChange(!open));

  const run = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Command palette" description="Jump to a section, switch persona or tenant, run a demo action, or type / for an Ask CB command">
      <CommandInput placeholder="Type a section, persona or action, or / for commands…" value={q} onValueChange={setQ} />
      <CommandList>
        <CommandEmpty>Nothing matches.</CommandEmpty>
        <CommandGroup heading={scope === "merchant" ? "Ask CB commands" : "Credits assistant commands"}>
          {q.startsWith("/") && q.trim().length > 1 && (
            <CommandItem value={q} onSelect={() => slash(q.trim())}>
              Run {q.trim()}
            </CommandItem>
          )}
          {commandsFor(scope, horizon).map((c) => (
            <CommandItem key={c.name} value={`/${c.name} ${c.help}`} onSelect={() => slash(`/${c.name}`)}>
              <span className="font-mono">/{c.name}</span>
              <span className="text-muted-foreground">{c.help}</span>
              {c.args && <CommandShortcut>{c.args}</CommandShortcut>}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Go to">
          {[...items, ...SYSTEM_NAV].map((i) => (
            <CommandItem key={i.id} value={`go ${i.label}`} onSelect={() => run(() => go(i))}>
              <i.icon aria-hidden="true" />
              {i.label}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Persona">
          {PERSONAS.map((p) => (
            <CommandItem key={p.id} value={`persona ${p.name}`} onSelect={() => run(() => { setPersona(p.id as PersonaId); navigate("/"); })}>
              Be {p.name}
              <CommandShortcut>{p.surface === "hub" ? "Credits Hub" : "Workbench"}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Tenant">
          {tenants.map((p) => (
            <CommandItem key={p.id} value={`tenant ${p.company}`} onSelect={() => run(() => setTenant(p.id))}>
              Switch to {p.company}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Horizon">
          {(["crawl", "walk", "run"] as Horizon[]).map((h) => (
            <CommandItem key={h} value={`horizon ${h}`} onSelect={() => run(() => setUi({ horizon: h }))}>
              Show the {h[0].toUpperCase() + h.slice(1)} horizon
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem
            value="advance simulator one day"
            onSelect={() =>
              run(() => {
                const ok = apply((s) => advanceDay(s));
                toast.success(ok ? "Simulator moved forward one day." : "Moved forward one day. Not saved in this browser.");
              })
            }
          >
            Advance the simulator one day
          </CommandItem>
          <CommandItem
            value="verify ledger hash chain"
            onSelect={() =>
              run(() => {
                const r = verifyChain(t.ledger);
                setUi({ brainTab: "ledger" });
                navigate("/brain");
                toast[r.ok ? "success" : "error"](r.ok ? `Ledger chain verified across ${t.ledger.length} entries.` : `Ledger chain broken at entry ${r.brokenAt}.`);
              })
            }
          >
            Verify the ledger hash chain
          </CommandItem>
          {(
            [
              ["checks", "Run the acceptance checks"],
              ["population", "Open the 90-day population"],
              ["chats", "Read the help chats"],
              ["regions", "Compare region packs"],
              ["domain", "Open the domain model"],
            ] as const
          ).map(([tab, label]) => (
            <CommandItem
              key={tab}
              value={label}
              onSelect={() =>
                run(() => {
                  setUi({ brainTab: tab });
                  navigate("/brain");
                })
              }
            >
              {label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
