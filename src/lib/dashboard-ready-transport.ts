/**
 * Dashboard pending/ready transport to the embedding Cowork host.
 *
 * A spec dashboard's first paint is a skeleton and its tiles fill in as their
 * queries settle, so `app-mounted` (first paint) is too early to lift the
 * host's loading screen. This module sends two fixed signals instead, both
 * scheduled by `dashboard-ready-signal.ts`:
 *   - `dashboard-pending`: "hold the loading screen until I say ready";
 *   - `dashboard-ready`: the dashboard is drawn.
 * A host that never sees `dashboard-pending` (any other app, or a dashboard
 * whose generated page does not call the signal) keeps its own load timing.
 *
 * Security posture mirrors `app-mounted-transport.ts` (do not weaken):
 *   - No wildcard (`"*"`) target origin: each message is posted to every
 *     origin in the audited `COWORK_PARENT_ORIGINS` allow-list; only the one
 *     matching the real parent delivers.
 *   - No inferred-origin logic (no `ancestorOrigins`, `document.referrer` or
 *     `location.origin` fallback).
 *   - Fixed-shape, detail-free messages: a type and a timestamp, nothing else.
 */

import { COWORK_PARENT_ORIGINS } from "./cowork-parent-transport";
import {
  DASHBOARD_PENDING_TYPE,
  DASHBOARD_READY_TYPE,
  type DashboardSignalMessage,
} from "@/types/app-message";

const sent = new Set<DashboardSignalMessage["type"]>();

function post(type: DashboardSignalMessage["type"]): void {
  if (window.parent === window || sent.has(type)) {
    return;
  }
  sent.add(type);
  const message: DashboardSignalMessage = { type, timestamp: Date.now() };
  for (const targetOrigin of COWORK_PARENT_ORIGINS) {
    window.parent.postMessage(message, targetOrigin);
  }
}

/** Tell the host to keep its loading screen up until `dashboard-ready`. Once per document. */
export function postDashboardPendingToCoworkParent(): void {
  post(DASHBOARD_PENDING_TYPE);
}

/** Tell the host the dashboard is drawn. Once per document. */
export function postDashboardReadyToCoworkParent(): void {
  post(DASHBOARD_READY_TYPE);
}

/** Forget what was sent, for container tests only. */
export function resetDashboardSignalForTests(): void {
  sent.clear();
}
