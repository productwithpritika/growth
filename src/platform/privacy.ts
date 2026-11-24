// PII masking for logs and prompts (Phase 8 §8.5). Everything an agent, tool or person types is
// masked before it is written to an activity log, an audit entry or a prompt sent to a model.

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const CARD = /\b(?:\d[ -]?){13,19}\b/g;
const PHONE = /(?<![\w.])\+?\d[\d ().-]{8,}\d\b/g;
const SECRET = /\b(?:sk|pk|cbmcp|cbx|tok|key|secret)_[A-Za-z0-9_-]{8,}\b/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._-]{12,}/g;

/** Replace emails, card numbers, phone numbers and secrets with typed placeholders. */
export function maskPII(text: string): string {
  return text.replace(SECRET, "[secret]").replace(BEARER, "Bearer [secret]").replace(EMAIL, "[email]").replace(CARD, "[card]").replace(PHONE, "[phone]");
}

/** Mask every string inside a value (arguments, results). */
export function maskDeep<T>(v: T): T {
  if (typeof v === "string") return maskPII(v) as T;
  if (Array.isArray(v)) return v.map((x) => maskDeep(x)) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, maskDeep(x)])) as T;
  return v;
}

/** True when a masked string still contains something that looks personal. */
export function leaksPII(text: string): boolean {
  return new RegExp(EMAIL.source).test(text) || new RegExp(SECRET.source, "i").test(text) || new RegExp(CARD.source).test(text);
}
