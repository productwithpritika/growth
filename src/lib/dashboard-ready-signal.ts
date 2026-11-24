/**
 * When a spec dashboard is drawn, for the Cowork preview's loading screen.
 *
 * The generated spec home page (`spec-dashboard-wire.sh`) loads this module
 * through `import.meta.glob`, so an app scaffolded before it existed builds
 * unchanged and sends nothing. As the page module evaluates, before the iframe
 * `load` event, it calls `postDashboardPendingToCoworkParent`, which sends
 * `dashboard-pending` only when the document opened on the home route (the
 * only route that mounts the dashboard). `HomePage` then calls
 * `useDashboardReadySignal`, which sends `dashboard-ready`:
 *   - "problems": the page shows what the spec needs fixed;
 *   - "drawn": two frames after the dashboard commits, so its layout is
 *     painted; tiles still loading their data show their own loading state.
 *   - "none": the skeleton, still being built; nothing is sent.
 * If the home page never commits after pending (an error boundary replaced
 * it), `dashboard-ready` follows `MOUNT_GRACE_MS` after the window `load`; if
 * it commits and then stays unmounted (an error boundary, a page swapped in
 * without this hook), `dashboard-ready` follows at once.
 */

import { useEffect } from "react";

import {
  postDashboardPendingToCoworkParent as postPending,
  postDashboardReadyToCoworkParent as postReady,
  resetDashboardSignalForTests,
} from "./dashboard-ready-transport";

export type DashboardReadyState = "none" | "problems" | "drawn";

const MOUNT_GRACE_MS = 1_000;

let homeCommitted = false;
let mountedPages = 0;

// The router basename rule of `App.tsx`: the baked base when the URL is under
// it, else the URL's first segment.
function onHomeRoute(): boolean {
  const path = window.location.pathname.replace(/\/+$/, "");
  const base = import.meta.env.BASE_URL.replace(/\/+$/, "");
  if (base.startsWith("/") && (path === base || path.startsWith(`${base}/`))) {
    return path === base;
  }
  return path.split("/").filter(Boolean).length <= 1;
}

/** Hold the host's loading screen, when the document opened on the home route. */
export function postDashboardPendingToCoworkParent(): void {
  if (!onHomeRoute()) return;
  postPending();
  const fallback = () =>
    setTimeout(() => {
      if (!homeCommitted) postReady();
    }, MOUNT_GRACE_MS);
  if (document.readyState === "complete") fallback();
  else window.addEventListener("load", fallback, { once: true });
}

export function useDashboardReadySignal(state: DashboardReadyState): void {
  useEffect(() => {
    mountedPages += 1;
    return () => {
      mountedPages -= 1;
      // Deferred a task so StrictMode's immediate remount is not taken for a page that left.
      window.setTimeout(() => {
        if (mountedPages === 0) postReady();
      }, 0);
    };
  }, []);
  useEffect(() => {
    homeCommitted = true;
    if (state === "none") return;
    if (state === "problems") {
      postReady();
      return;
    }
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(postReady);
    });
    return () => cancelAnimationFrame(frame);
  }, [state]);
}

/** Forget what was sent and whether the home page committed, for container tests only. */
export function resetDashboardReadySignalForTests(): void {
  homeCommitted = false;
  mountedPages = 0;
  resetDashboardSignalForTests();
}
