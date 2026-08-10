import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validatePackage } from "../scripts/validate-package.mjs";
import { makeMinimalPlugin } from "./helpers.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const validManifest = {
  $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  name: "fixture-plugin"
};

test("current package layout is valid", async () => {
  assert.deepEqual(await validatePackage(packageRoot), []);
});

test("invalid manifest schema is rejected", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "adk-package-"));
  await makeMinimalPlugin(root, { ...validManifest, $schema: "https://example.invalid/schema.json" });
  const errors = await validatePackage(root);
  assert(errors.some((item) => item.includes("Agent Plugins 1.0.0")));
  await rm(root, { recursive: true });
});

test("missing immediate skill is rejected", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "adk-package-"));
  await makeMinimalPlugin(root, validManifest);
  await rm(path.join(root, "skills", "demo", "SKILL.md"));
  const errors = await validatePackage(root);
  assert(errors.some((item) => item.includes("SKILL.md is missing")));
  await rm(root, { recursive: true });
});

test("invalid local marketplace metadata is rejected", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "adk-package-"));
  await makeMinimalPlugin(root, validManifest);
  await writeFile(path.join(root, ".agents", "plugins", "marketplace.json"), JSON.stringify({
    name: "fixture-marketplace",
    plugins: [{ name: "different-plugin", source: { source: "local", path: "./nested" } }]
  }));
  const errors = await validatePackage(root);
  assert(errors.some((item) => item.includes("must expose the root plugin")));
  await rm(root, { recursive: true });
});

test("unexpected private workspace files are rejected", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "adk-package-"));
  await makeMinimalPlugin(root, validManifest);
  await mkdir(path.join(root, "openspec"));
  await writeFile(path.join(root, "openspec", "private.md"), "private\n");
  const errors = await validatePackage(root);
  assert(errors.some((item) => item.includes("Unexpected top-level")));
  assert(errors.some((item) => item.includes("Private or generated path")));
  await rm(root, { recursive: true });
});
