/**
 * Console + runtime-error capture.
 *
 *  (1) During authoring, forwards console.log/warn/error to the Cowork
 *      parent frame via postMessage so the UX can display console output
 *      alongside the preview: only to an audited Cowork host origin, never
 *      in a published build.
 *  (2) During authoring, POSTs errors (console.error, window.onerror, unhandledrejection)
 *      to the Vite dev server at `./__dev/console` — under the preview
 *      iframe that resolves onto the runtime preview proxy, whose POST arm
 *      forwards exactly this path (#24067). The dev-reload SSE plugin
 *      appends them to `.browser-errors.log` in the app root so the
 *      app-builder agent can inspect runtime failures that never surface
 *      to `bun run check` — notably React's "Maximum update depth
 *      exceeded" and other re-render loops caught by ErrorBoundary.
 */

const originalConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

const DEV_CONSOLE_PATH = "./__dev/console";

// The iframe's own document URL carries the preview bearer token
// (/v1/preview/{token}/dev/...) — a live 4 h credential. location.href,
// error.filename and stack-frame URLs would otherwise persist it into
// .browser-errors.log, which the app-builder agent reads. Scrub the token
// segment from the serialized body: ONE chokepoint covers url, stack,
// filename, message and componentStack alike (the dev-reload plugin repeats
// the scrub server-side before writing). JSON.stringify never escapes "/",
// so the segment survives serialization intact for the regex to find.
const PREVIEW_TOKEN_RE = /\/v1\/preview\/[^/\s"'\\]+/g;
const scrubPreviewToken = (s: string): string =>
  s.replace(PREVIEW_TOKEN_RE, "/v1/preview/<token>");

// The Cowork host origins console lines may be forwarded to: a pinned copy of
// `COWORK_PARENT_ORIGINS` (cowork-parent-transport.ts), pinned equal by
// `.aether-container-tests/console-capture.test.ts`. A copy, not an import:
// the tests execute this file alone, with no module graph behind it.
export const CONSOLE_PARENT_ORIGINS: readonly string[] = [
  "https://agentbuilder.local.microsoft.com:44300",
  "http://localhost:44300",
  "https://local.loop.microsoft.com:8080",
  "https://m365.cloud.microsoft",
  "https://copilot.cloud.microsoft",
  "https://m365copilotapp.svc.cloud.microsoft",
  "https://cr.m365copilotapp.svc.cloud.microsoft",
  "https://www.microsoft365.com",
  "https://outlook.office.com",
];

// Target origin for ``window.parent.postMessage``, or null to forward nothing.
// Console lines are the app's unscrubbed output, so they go only to the
// embedding Cowork host, and only while authoring:
//   - Never in a published build: Vite supplies `import.meta.hot` during
//     serve only.
//   - The candidates, in order, are ``window.location.ancestorOrigins[0]``
//     (the actual embedding origin, which the child cannot spoof) and
//     ``VITE_COWORK_PARENT_ORIGIN`` (normalized to its origin, so a trailing
//     slash or an upper-case host still matches). Nothing sets that variable
//     today: it is the audited hook for a browser with no ``ancestorOrigins``
//     (Firefox), which forwards nothing until something does. Before this
//     list, Firefox posted to the runtime's own origin, never a Cowork host.
//   - The first candidate in CONSOLE_PARENT_ORIGINS is the target. Any other
//     embedder (a page that framed a leaked preview URL) gets nothing, and so
//     does a browser with no ``ancestorOrigins`` unless the override names an
//     audited host.
// Computed once at module load; the ancestor never changes for the life of
// the iframe.
const originOf = (value: unknown): string | null => {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const PARENT_ORIGIN: string | null = (() => {
  if (!import.meta.hot) {
    return null;
  }
  const candidates = [
    window.location.ancestorOrigins?.[0] ?? null,
    originOf(import.meta.env.VITE_COWORK_PARENT_ORIGIN),
  ];
  return candidates.find(
    (origin): origin is string => origin !== null && CONSOLE_PARENT_ORIGINS.includes(origin),
  ) ?? null;
})();

// Dedup identical errors fired in bursts — an infinite-loop component
// can emit the same stack 1000 times per second. Keyed on (kind + first
// stack line). 500ms quiet window is short enough to still catch a
// legitimate retry and long enough to suppress render-loop spam.
const DEDUP_WINDOW_MS = 500;
let lastSignature: string | null = null;
let lastSignatureTime = 0;

function postToParent(level: string, args: unknown[]) {
  if (PARENT_ORIGIN === null) return;
  try {
    const message = args
      .map((a) => (typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)))
      .join(" ");
    window.parent.postMessage(
      { type: "console", level, message, timestamp: Date.now() },
      PARENT_ORIGIN
    );
  } catch {
    /* ignore serialization errors */
  }
}

function postToDevServer(kind: string, payload: Record<string, unknown>) {
  // Vite supplies this context during serve (even with hmr:false), never build.
  if (!import.meta.hot) return;

  const sig = `${kind}|${(payload.stack as string | undefined)?.split("\n", 2)[0] ?? payload.message ?? ""}`;
  const now = Date.now();
  if (sig === lastSignature && now - lastSignatureTime < DEDUP_WINDOW_MS) {
    return;
  }
  lastSignature = sig;
  lastSignatureTime = now;

  try {
    void fetch(DEV_CONSOLE_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: scrubPreviewToken(
        JSON.stringify({
          kind,
          time: now,
          url: location.href,
          ...payload,
        }),
      ),
      keepalive: true,
    }).catch(() => {
      /* dev server may be restarting — drop silently */
    });
  } catch {
    /* ignore */
  }
}

function serializeArgs(args: unknown[]): { message: string; stack: string | null } {
  let stack: string | null = null;
  const parts: string[] = [];
  for (const a of args) {
    if (a instanceof Error) {
      parts.push(a.message);
      stack = stack ?? a.stack ?? null;
    } else if (typeof a === "object" && a !== null) {
      try {
        parts.push(JSON.stringify(a));
      } catch {
        parts.push(String(a));
      }
    } else {
      parts.push(String(a));
    }
  }
  return { message: parts.join(" "), stack };
}

/**
 * Private-only runtime-error reporter for the ErrorBoundary.
 *
 * Routes the *real* error and React component stack to the console
 * implementation captured before this module installs its parent-forwarding
 * wrappers, plus an authoring-only best-effort POST to `./__dev/console`.
 * It deliberately does NOT call `postToParent`, so render-crash details never
 * reach the parent frame through the retained console-forwarding channel
 * above. The parent frame receives only the fixed, detail-free crash signal
 * emitted separately by `cowork-parent-transport.ts`.
 */
export function reportPrivateRuntimeError(
  label: string,
  error: unknown,
  detail?: string | null,
): void {
  // Bypass this module's parent-forwarding wrapper. An earlier bootstrap script
  // may already have wrapped console.error for local websocket noise filtering.
  originalConsole.error(label, error, detail ?? "");
  const { message, stack } = serializeArgs([error]);
  postToDevServer("app.error", {
    label,
    message,
    stack,
    componentStack: detail ?? null,
  });
}
console.log = (...args: unknown[]) => {
  originalConsole.log(...args);
  postToParent("log", args);
};
console.warn = (...args: unknown[]) => {
  originalConsole.warn(...args);
  postToParent("warn", args);
};
console.error = (...args: unknown[]) => {
  originalConsole.error(...args);
  postToParent("error", args);
  const { message, stack } = serializeArgs(args);
  postToDevServer("console.error", { message, stack });
};

window.addEventListener("error", (ev) => {
  postToDevServer("window.error", {
    message: ev.message,
    filename: ev.filename,
    lineno: ev.lineno,
    colno: ev.colno,
    stack: ev.error?.stack ?? null,
  });
});

window.addEventListener("unhandledrejection", (ev) => {
  const reason = ev.reason;
  const hasMessage = typeof reason === "object" && reason !== null && "message" in reason;
  postToDevServer("unhandledrejection", {
    message: hasMessage ? String((reason as { message: unknown }).message) : String(reason),
    stack: (reason as { stack?: string } | null)?.stack ?? null,
  });
});
