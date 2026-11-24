// A tiny test harness with no runner dependency: the same suites run in the Brain's Checks tab
// and under `bun test` (tests/acceptance.test.ts).

export class CheckFailure extends Error {}

export interface CheckCase {
  id: string;
  name: string;
  /** Throws on failure; may return a short detail for the report. */
  run: () => string | void;
}

export interface Suite {
  id: string;
  title: string;
  covers: string;
  cases: CheckCase[];
}

export interface CaseResult {
  id: string;
  name: string;
  ok: boolean;
  detail: string;
  ms: number;
}

export interface SuiteResult {
  id: string;
  title: string;
  covers: string;
  results: CaseResult[];
  passed: number;
  failed: number;
  ms: number;
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function runCase(c: CheckCase): CaseResult {
  const t = now();
  try {
    const detail = c.run() ?? "";
    return { id: c.id, name: c.name, ok: true, detail, ms: Math.round(now() - t) };
  } catch (e) {
    return { id: c.id, name: c.name, ok: false, detail: e instanceof Error ? e.message : String(e), ms: Math.round(now() - t) };
  }
}

export function runSuite(s: Suite): SuiteResult {
  const t = now();
  const results = s.cases.map(runCase);
  return { id: s.id, title: s.title, covers: s.covers, results, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, ms: Math.round(now() - t) };
}

export function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new CheckFailure(msg);
}

export function eq<T>(actual: T, expected: T, what: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new CheckFailure(`${what}: expected ${b}, got ${a}`);
}

export function close(actual: number, expected: number, what: string, eps = 0.011) {
  if (Math.abs(actual - expected) > eps) throw new CheckFailure(`${what}: expected ${expected}, got ${actual}`);
}

/** Expects `fn` to throw an error whose `code` matches. Returns the error. */
export function throwsCode<E extends { code: string }>(fn: () => unknown, code: string, what: string): E {
  try {
    fn();
  } catch (e) {
    const c = (e as { code?: string }).code;
    if (c === code) return e as E;
    throw new CheckFailure(`${what}: expected error ${code}, got ${c ?? String(e)}`);
  }
  throw new CheckFailure(`${what}: expected error ${code}, nothing was thrown`);
}
