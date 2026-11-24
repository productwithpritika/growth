import { readFile } from "node:fs/promises";
import type { Plugin } from "vite";

// @microsoft/managed-apps-common 0.19.0 (@microsoft/managed-apps 0.5.11) returns
// an `image/*` connector response's `data` as the base64 string the host sent
// ("matches the existing API surface that returns base64 for images"). From
// 0.30.0 (managed-apps 0.6.0), and in @microsoft/cmr-apps-common 0.34.0 (the
// cmr-apps 0.7.0 the template loads as @microsoft/managed-apps), runtimeDataClient.js
// folds `image/*` into its `application/octet-stream` branch and returns a
// Uint8Array instead. The generated connector services still declare those
// operations as `IOperationResult<string>` (Office 365 Users `UserPhoto_V2`, for
// example), and apps built against them read a string, so every connector image
// silently fell back once the template moved to the newer SDK. This plugin
// restores the 0.19.0 result for `image/*`: the host's base64 body, returned as
// is (a body the host sent without base64 encoding is encoded from the same
// bytes the SDK would have returned). `application/octet-stream` keeps its
// Uint8Array, as it had in 0.19.0, and
// so do the Spatial Services map tiles (GetMapTile, GetMapTileV2), whose
// validated byte contract the SDK added with the merge and the template's
// spatial tile layer reads either way (src/lib/spatial-tile-bytes.ts).
//
// The patch is keyed on the shape of runtimeDataClient.js, not on a version: a
// file with the merged image/octet-stream branch is patched, one whose `image/*`
// branch already returns `response.body` (0.19.0, or this patch's own output) is
// loaded untouched, and any other shape fails the build, in dev and in publish
// alike, rather than shipping an app whose connector images silently disappear.
// The image build's template tests (.aether-container-tests/sdk-imagefix.test.ts)
// patch the installed SDK and run the patched client, so an SDK bump to a shape
// this file does not know fails the image build first.
//
// Template scaffold file, registered in the app's vite.config.ts, which both the
// live preview and the server-side publish build load, so an app's preview and
// its published build always agree. Like aether-sdk-sqlfix.ts it ships only with
// apps created with this file: existing apps are not refreshed with it on reopen
// (`aether_orch_appdev::provision::refresh_existing_app` refreshes only the
// dev-reload client and the parent transport). vite.config.ts and this file are
// protected scaffold files.

export const PLUGIN_NAME = "aether-sdk-imagefix";

export const TARGET =
  /[\\/]@microsoft[\\/](?:managed-apps-common|cmr-apps-common)[\\/]dist[\\/]dataClient[\\/]data[\\/]runtimeDataClient\.js$/;

const MARKER = "/* aether-sdk-imagefix: an image response's data is the host's base64 body */";

// The 0.30.0+ merged branch, up to the non-spatial `bytes =` assignment.
const MERGED_BRANCH =
  /(else if \(contentType\.indexOf\('image\/'\) !== -1 \|\|\s*contentType\.indexOf\('application\/octet-stream'\) !== -1\) \{\s*let bytes;\s*if \(usesSpatialTileBinaryContract\(config\.apiId, options\.operationName\)\) \{[\s\S]*?\}(\s*))else \{(\s*)bytes =/;

// 0.19.0's own `image/*` branch, which already returns the base64 body.
const STRING_BRANCH =
  /else if \(contentType\.indexOf\('image\/'\) !== -1\) \{\s*(?:\/\/[^\n]*\s*)?return \{\s*success: true,\s*data: response\.body,?\s*\};/;

export const UNPATCHABLE =
  "[aether-sdk-imagefix] @microsoft/managed-apps runtimeDataClient.js is in neither the 0.30.0+ shape " +
  "this patch rewrites nor the 0.19.0 shape that returns image/* data as base64; failing the build " +
  "rather than shipping connector images the app cannot read. Update aether-sdk-imagefix.ts for the installed SDK.";

function occurrences(code: string, pattern: RegExp): number {
  return code.match(new RegExp(pattern.source, "g"))?.length ?? 0;
}

/**
 * `code` with its non-spatial `image/*` responses returning the host's base64
 * body; `code` itself when that is already so (0.19.0, or this patch's output);
 * `null` when the file is in neither known shape.
 */
export function patchRuntimeDataClient(code: string): string | null {
  if (code.includes(MARKER)) return code;
  const merged = occurrences(code, MERGED_BRANCH);
  const returnsBody = occurrences(code, STRING_BRANCH);
  if (merged === 0 && returnsBody === 1) return code;
  if (merged !== 1 || returnsBody !== 0) return null;
  return code.replace(
    MERGED_BRANCH,
    (_match, head: string, gap: string, indent: string) =>
      `${head}else if (contentType.indexOf('image/') !== -1) {${indent}${MARKER}${indent}` +
      `return {${indent}    success: true,${indent}    data: response.bodyEncoding === 'base64'` +
      `${indent}        ? response.body${indent}        : uint8ArrayToBase64(new TextEncoder().encode(response.body)),` +
      `${indent}};${indent.replace(/ {4}$/, "")}}${gap}else {${indent}bytes =`,
  );
}

export default function aetherSdkImageFix(): Plugin {
  return {
    name: PLUGIN_NAME,
    enforce: "pre",
    config() {
      // Dev pre-bundling runs esbuild over node_modules and never calls Vite's
      // `transform`, so the patch is applied there as well.
      return {
        optimizeDeps: {
          esbuildOptions: {
            plugins: [
              {
                name: PLUGIN_NAME,
                setup(build) {
                  build.onLoad({ filter: TARGET }, async (args) => {
                    const code = await readFile(args.path, "utf8");
                    const patched = patchRuntimeDataClient(code);
                    if (patched === null) return { errors: [{ text: UNPATCHABLE }] };
                    return { contents: patched, loader: "js" };
                  });
                },
              },
            ],
          },
        },
      };
    },
    transform(code, id) {
      const file = id.split("?")[0];
      if (!TARGET.test(file)) return null;
      const patched = patchRuntimeDataClient(code);
      if (patched === null) this.error(UNPATCHABLE);
      return patched === code ? null : { code: patched, map: null };
    },
  };
}
