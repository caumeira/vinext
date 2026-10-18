import { describe, expect, it } from "vite-plus/test";
import { createClientFileNameConfig } from "../packages/vinext/src/build/client-build-config.js";
import { etagFromFilenameHash } from "../packages/vinext/src/server/static-file-cache.js";

function patternFor(fileName: string | ((chunk: { name: string }) => string), name: string) {
  const pattern = typeof fileName === "function" ? fileName({ name }) : fileName;
  return pattern.replaceAll("[name]", name);
}

describe("client chunk filenames", () => {
  it.each(["_next/static", "cdn/_next/static"])(
    "does not expose application module names under %s",
    (assetsDir) => {
      const output = createClientFileNameConfig(assetsDir);
      for (const name of [
        "consent-banner",
        "cookie-banner",
        "analytics-provider",
        "referral-tracker",
        "vinext-consent-banner",
      ]) {
        for (const fileName of [output.entryFileNames, output.chunkFileNames]) {
          expect(patternFor(fileName, name)).toBe(`${assetsDir}/chunks/chunk-[hash].js`);
        }
      }
    },
  );

  it.each([
    "framework",
    "vinext",
    "vinext-client-entry",
    "vinext-app-browser-entry",
    "_virtual_vinext-client-entry",
    "_virtual_vinext-app-browser-entry",
  ])("preserves the %s runtime name used by Pages Router shared-chunk discovery", (name) => {
    const output = createClientFileNameConfig("_next/static");
    expect(patternFor(output.entryFileNames, name)).toBe(`_next/static/chunks/${name}-[hash].js`);
    expect(patternFor(output.chunkFileNames, name)).toBe(`_next/static/chunks/${name}-[hash].js`);
  });

  it("keeps content-hash ETags for neutral filenames", () => {
    expect(etagFromFilenameHash("_next/static/chunks/chunk-AbCd1234.js", ".js")).toBe(
      'W/"AbCd1234"',
    );
  });
});
