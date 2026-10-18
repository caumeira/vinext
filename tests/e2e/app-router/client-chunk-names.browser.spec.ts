import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createBuilder } from "vite";
import {
  startChildProductionServer,
  stopChildProductionServer,
  type ChildProductionServer,
} from "../production-server";

let root: string;
let server: ChildProductionServer | undefined;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vinext-neutral-client-chunks-"));
  await fs.symlink(path.resolve("node_modules"), path.join(root, "node_modules"), "junction");
  await fs.mkdir(path.join(root, "app", "other"), { recursive: true });
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ type: "module" }));
  await fs.writeFile(
    path.join(root, "app", "layout.tsx"),
    `import ConsentBanner from "./consent-banner";
export default function Layout({ children }: { children: React.ReactNode }) {
  return <html><body><ConsentBanner />{children}</body></html>;
}`,
  );
  await fs.writeFile(
    path.join(root, "app", "consent-banner.tsx"),
    `"use client";
import { useState } from "react";
export default function ConsentBanner() {
  const [accepted, setAccepted] = useState(false);
  const [message, setMessage] = useState("");
  return <div>
    <button onClick={() => setAccepted(true)}>{accepted ? "Accepted" : "Accept cookies"}</button>
    <button onClick={async () => setMessage((await import("./cookie-banner")).message)}>Load details</button>
    <p>{message}</p>
  </div>;
}`,
  );
  await fs.writeFile(
    path.join(root, "app", "cookie-banner.ts"),
    'export const message = "Cookie details loaded";',
  );
  await fs.writeFile(
    path.join(root, "app", "page.tsx"),
    `import Link from "next/link";
export default function Page() { return <Link href="/other">Other page</Link>; }`,
  );
  await fs.writeFile(
    path.join(root, "app", "other", "page.tsx"),
    "export default function Page() { return <h1>Other page loaded</h1>; }",
  );

  const vinext = (await import("../../../packages/vinext/src/index.js")).default;
  const builder = await createBuilder({
    root,
    configFile: false,
    plugins: [vinext({ appDir: root })],
    logLevel: "silent",
  });
  await builder.buildApp();
  server = await startChildProductionServer(root);
});

test.afterAll(async () => {
  try {
    if (server) await stopChildProductionServer(server);
  } finally {
    if (root) await fs.rm(root, { recursive: true, force: true });
  }
});

// Next.js reference: test/e2e/app-dir/dynamic-chunk-dedupe/dynamic-chunk-dedupe.test.ts
// https://github.com/vercel/next.js/blob/canary/test/e2e/app-dir/dynamic-chunk-dedupe/dynamic-chunk-dedupe.test.ts
test("hydrates and loads dynamic chunks with cookie-notice URL filters enabled", async ({
  page,
}) => {
  const errors: string[] = [];
  const blocked: string[] = [];
  const scripts: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith(".js")) scripts.push(pathname);
    // EasyList Cookie List has these generic network filters, independent of domain.
    // https://github.com/easylist/easylist/blob/master/easylist_cookie/easylist_cookie_general_block.txt
    if (pathname.includes("/consent-banner-") || pathname.includes("/cookie-banner-")) {
      blocked.push(pathname);
      await route.abort("blockedbyclient");
    } else {
      await route.continue();
    }
  });

  await page.goto(`http://127.0.0.1:${server!.port}/`);
  expect(blocked).toEqual([]);
  await page.getByRole("button", { name: "Accept cookies", exact: true }).click();
  await expect(page.getByRole("button", { name: "Accepted", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Load details", exact: true }).click();
  await expect(page.getByText("Cookie details loaded", { exact: true })).toBeVisible();
  await page.evaluate(() => (document.documentElement.dataset.navigationMarker = "preserved"));
  await page.getByRole("link", { name: "Other page", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Other page loaded" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-navigation-marker", "preserved");
  expect(scripts.some((pathname) => /\/chunk-[\w-]+\.js$/.test(pathname))).toBe(true);
  expect(blocked).toEqual([]);
  expect(errors).toEqual([]);
});
