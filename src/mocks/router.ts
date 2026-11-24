import type { TenantState } from "@/core/types";
import { handlers, type MockRequest } from "@/mocks/handlers";

/** Resolve a request against the mock handlers, as MSW would in a service worker. */
export function mockFetch(state: TenantState, method: MockRequest["method"], path: string, body?: unknown): { status: number; json: unknown } {
  for (const h of handlers) {
    if (h.method !== method) continue;
    const want = h.path.split("/");
    const got = path.split("?")[0].split("/");
    if (want.length !== got.length) continue;
    const params: Record<string, string> = {};
    let match = true;
    want.forEach((seg, i) => {
      if (seg.startsWith(":")) params[seg.slice(1)] = decodeURIComponent(got[i]);
      else if (seg !== got[i]) match = false;
    });
    if (match) return h.resolve({ method, path, params, body, state });
  }
  return { status: 404, json: { error: `No mock handler for ${method} ${path}` } };
}
