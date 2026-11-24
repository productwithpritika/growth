// Embed SDK snippet (Phase 7 §7.6): a web component plus a script tag, themed from the Tenant Pack,
// with a single sign-on token and event hooks. Not an iframe.
import type { EmbedState } from "@/platform/types";

export function snippet(tenant: string, e: Pick<EmbedState, "modules" | "mode" | "hooks">, accent: string, ssoPreview: string): string {
  const hooks = e.hooks.map((h) => `  hub.addEventListener("${h.replace(/^on/, "").replace(/^./, (c) => c.toLowerCase())}", (ev) => ${h}(ev.detail));`).join("\n");
  return [
    `<script src="https://js.chargebee.example/credits-hub/v1.js" defer></script>`,
    ``,
    `<cb-credits-hub`,
    `  tenant="${tenant}"`,
    `  modules="${e.modules.join(",")}"`,
    `  mode="${e.mode}"`,
    `  theme="pack"            <!-- accent ${accent} from the Tenant Pack -->`,
    `  sso-token="${ssoPreview}">`,
    `</cb-credits-hub>`,
    ``,
    `<script>`,
    `  const hub = document.querySelector("cb-credits-hub");`,
    hooks,
    `  // hub.open() / hub.close() from your own "Credits" button`,
    `</script>`,
  ].join("\n");
}

