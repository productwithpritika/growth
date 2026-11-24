// Runs the Phase 1 acceptance suites under bun: `bun test tests/`.
// The same suites run in the app (Brain → Checks). Packs are read from disk because the
// app's runtime pack loader uses a bundler feature bun does not have.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parsePack, type TenantPack } from "@/tenants/schema";
import { parseRegion, type RegionPack } from "@/tenants/region-schema";
import { acceptanceSuites, runCase } from "@/core/checks";

const root = fileURLToPath(new URL("../src/tenants/", import.meta.url));
const read = (p: string) => JSON.parse(readFileSync(root + p, "utf8")) as unknown;
const packs: TenantPack[] = ["clay", "builderco", "apico"].map((id) => {
  const r = parsePack(read(`packs/${id}.json`));
  if (!r.ok) throw new Error(`${id}: ${JSON.stringify(r.issues)}`);
  return r.pack;
});
const regions: RegionPack[] = ["us", "eu", "in"].map((id) => {
  const r = parseRegion(read(`regions/${id}.json`));
  if (!r.ok) throw new Error(`${id}: ${JSON.stringify(r.issues)}`);
  return r.region;
});

for (const suite of acceptanceSuites(packs, regions, "2026-11-23T04:00:00.000Z")) {
  describe(suite.title, () => {
    for (const c of suite.cases) {
      test(c.name, () => {
        const r = runCase(c);
        if (!r.ok) console.error(r.detail);
        expect(r.ok).toBe(true);
      });
    }
  });
}
