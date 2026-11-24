// Region and policy packs (Phase 1 §1.7): currency, tax display, strong authentication on card
// payments, recurring-payment consent and auto-renewal disclosure. Like Tenant Packs these are
// JSON validated at runtime, so a new region is a new file. Copy may use {company}, {plan},
// {price}, {date}, {amount} and {max}.
import { z } from "zod";

const Id = z.string().regex(/^[a-z]{2,8}$/, "Use a short lowercase id");

export const RegionPackSchema = z.object({
  id: Id,
  name: z.string().min(1).max(40),
  shortName: z.string().min(1).max(12),
  currency: z.object({
    code: z.string().regex(/^[A-Z]{3}$/),
    locale: z.string().min(2).max(12),
    /** Illustrative conversion from the pack's USD list prices. */
    perUsd: z.number().positive(),
    decimals: z.number().int().min(0).max(2),
  }),
  tax: z.object({
    name: z.string().min(1).max(20),
    /** Null when the rate depends on the billing address. */
    rate: z.number().min(0).max(0.5).nullable(),
    display: z.enum(["inclusive", "exclusive"]),
    note: z.string().max(240),
    idLabel: z.string().max(20).nullable(),
  }),
  strongAuth: z.object({
    required: z.boolean(),
    method: z.enum(["none", "3ds", "otp"]),
    /** Payments below this amount (in the region's currency) are exempt. */
    exemptBelow: z.number().nonnegative().nullable(),
    title: z.string().max(60),
    body: z.string().max(320),
    approve: z.string().max(40),
    cancel: z.string().max(40),
    rule: z.string().max(220),
  }),
  recurring: z.object({
    consentRequired: z.boolean(),
    title: z.string().max(60),
    body: z.string().max(420),
    checkbox: z.string().max(200),
    /** Charges above this (region currency) need authentication each time; null for no limit. */
    maxPerCharge: z.number().positive().nullable(),
    preDebitNoticeHours: z.number().int().nonnegative().nullable(),
  }),
  autoRenewal: z.object({ title: z.string().max(60), body: z.string().max(420) }),
});

export type RegionPack = z.output<typeof RegionPackSchema>;

export function parseRegion(json: unknown): { ok: true; region: RegionPack } | { ok: false; issues: { path: string; message: string }[] } {
  const r = RegionPackSchema.safeParse(json);
  return r.success ? { ok: true, region: r.data } : { ok: false, issues: r.error.issues.slice(0, 20).map((i) => ({ path: i.path.join(".") || "(root)", message: i.message })) };
}
