import { useNavigate } from "react-router-dom";
import { useCockpit, useTenant } from "@/lib/cockpit-store";
import { personaById } from "@/tenants/personas";
import { WB_NAV, hubNav, visible, type NavItem } from "@/components/nav";
import { hubViewer } from "@/surfaces/credits-hub/viewer";
import { isKilled } from "@/platform/release";

export function useGo() {
  const navigate = useNavigate();
  const setUi = useCockpit((s) => s.setUi);
  return (item: NavItem) => {
    if (item.hubTab) setUi({ hubTab: item.hubTab });
    if (item.wbTab) setUi({ wbTab: item.wbTab });
    if (item.brainTab) setUi({ brainTab: item.brainTab });
    navigate(item.path);
  };
}

export function useNavItems() {
  const t = useTenant();
  const persona = useCockpit((s) => s.persona);
  const horizon = useCockpit((s) => s.horizon);
  const surface = personaById(persona).surface;
  const killed = (k: string) => isKilled(t.platform, k);
  if (surface !== "hub") return { surface, items: visible(WB_NAV, horizon, killed) };
  const v = hubViewer(t, persona);
  return { surface, items: visible(hubNav(t.pack, { can: v.can, lifecycle: v.account === "maya", member: v.role === "member" }), horizon, killed) };
}

