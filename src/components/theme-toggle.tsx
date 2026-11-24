import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ThemeChoice = "system" | "light" | "dark";
const KEY = "monetization-cockpit:theme";
const NEXT: Record<ThemeChoice, ThemeChoice> = { system: "light", light: "dark", dark: "system" };
const LABEL: Record<ThemeChoice, string> = { system: "Theme: system", light: "Theme: light", dark: "Theme: dark" };

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function applyTheme(c: ThemeChoice) {
  const root = document.documentElement;
  root.classList.toggle("dark", c === "dark");
  root.classList.toggle("light", c === "light");
}

let listeners: ((c: ThemeChoice) => void)[] = [];
let current: ThemeChoice = typeof window === "undefined" ? "system" : read();
if (typeof window !== "undefined") applyTheme(current);

export function setTheme(c: ThemeChoice) {
  current = c;
  applyTheme(c);
  try {
    localStorage.setItem(KEY, c);
  } catch {
    // The choice still applies for this visit.
  }
  listeners.forEach((l) => l(c));
}

export function useTheme(): ThemeChoice {
  const [c, setC] = useState(current);
  useEffect(() => {
    listeners.push(setC);
    return () => {
      listeners = listeners.filter((l) => l !== setC);
    };
  }, []);
  return c;
}

/** Cycles system → light → dark. */
export function ThemeToggle({ className }: { className?: string }) {
  const c = useTheme();
  const Icon = c === "dark" ? Moon : c === "light" ? Sun : Monitor;
  return (
    <Button size="icon-sm" variant="ghost" className={cn(className)} aria-label={`${LABEL[c]}. Switch to ${NEXT[c]}.`} title={LABEL[c]} onClick={() => setTheme(NEXT[c])}>
      <Icon aria-hidden="true" />
    </Button>
  );
}
