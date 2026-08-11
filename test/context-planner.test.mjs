import assert from "node:assert/strict";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { analyzeSource } from "../src/context/analyzer.mjs";
import { analyzeNodeEsm } from "../src/context/node-esm.mjs";
import { planDelegationContext } from "../src/context/planner.mjs";
import { createDirectory, makeEnvelope } from "./helpers.mjs";

async function fixture(files) {
  const root = await createDirectory();
  for (const [relativePath, source] of Object.entries(files)) {
    const absolute = path.join(root, relativePath);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, source);
  }
  return root;
}

function envelope(root, overrides = {}) {
  const { scope: scopeOverrides = {}, contextPlanning: planningOverrides = {}, ...rest } = overrides;
  return makeEnvelope(root, {
    scope: {
      allowedPaths: ["src/**/*.mjs", "lib/**/*.mjs"],
      forbiddenPaths: [".env", ".env.*", "private/**", "credentials/**", "auth.json"],
      discoverablePaths: ["src/**/*.mjs", "lib/**/*.mjs"],
      ...scopeOverrides
    },
    contextPlanning: {
      strategy: "dependency-closure",
      seeds: ["src/entry.mjs"],
      analyzers: ["node-esm"],
      budget: { maxFiles: 20, maxBytes: 100_000, maxDepth: 10 },
      readiness: [{ id: "node", argv: [process.execPath, "--version"], timeoutMs: 1000, acceptableExitCodes: [0] }],
      ...planningOverrides
    },
    ...rest
  });
}

test("node-esm ignores lexical false positives and classifies supported forms", () => {
  const source = `
    // import './comment.mjs'
    const string = "export * from './string.mjs'";
    const template = \`import('./template.mjs')\`;
    const regex = /import\\(\\".\\/regex.mjs\\"\\)/;
    import './side.mjs';
    import { value }\n      from './multiline.mjs';
    export { value } from './reexport.mjs';
    import('./dynamic.mjs');
    import(name);
    import.meta.url;
    import 'node:fs';
    import packageName from 'package-name';
  `;
  assert.deepEqual(analyzeNodeEsm({ relativePath: "src/entry.mjs", source }).references, [
    { kind: "static", classification: "local", specifier: "./side.mjs" },
    { kind: "static", classification: "local", specifier: "./multiline.mjs" },
    { kind: "reexport", classification: "local", specifier: "./reexport.mjs" },
    { kind: "dynamic", classification: "local", specifier: "./dynamic.mjs" },
    { kind: "unresolved", classification: "unresolved", specifier: "<non-literal>", reason: "non-literal dynamic import" },
    { kind: "static", classification: "external", specifier: "node:fs" },
    { kind: "static", classification: "external", specifier: "package-name" }
  ]);
});

test("node-esm fails closed on unsupported dependency syntax and malformed lexical input", () => {
  const result = analyzeNodeEsm({
    relativePath: "src/entry.mjs",
    source: [
      "export const value = './not-a-dependency.mjs';",
      "const template = `safe text ${import('./inside-template.mjs')}`;",
      "/* unterminated"
    ].join("\n")
  });
  assert.deepEqual(result.references, [
    {
      kind: "unresolved",
      classification: "unresolved",
      specifier: "<lexical-error>",
      reason: "dependency syntax inside template interpolation is unsupported"
    },
    {
      kind: "unresolved",
      classification: "unresolved",
      specifier: "<lexical-error>",
      reason: "unterminated block comment"
    }
  ]);
});

test("node-esm does not guess package-import maps or URL schemes", () => {
  assert.deepEqual(analyzeNodeEsm({
    relativePath: "src/entry.mjs",
    source: "import '#internal'; import 'file:///private/module.mjs'; import 'https://example.invalid/module.mjs';"
  }).references, [
    { kind: "static", classification: "unresolved", specifier: "#internal" },
    { kind: "static", classification: "unresolved", specifier: "file:///private/module.mjs" },
    { kind: "static", classification: "unresolved", specifier: "https://example.invalid/module.mjs" }
  ]);
});

test("neutral analyzer contract requires an explicit validated adapter", () => {
  const input = { relativePath: "src/entry.mjs", source: "export const value = 1;" };
  assert.throws(() => analyzeSource(input), (error) => error.code === "invalid_analyzer_input");
  assert.throws(
    () => analyzeSource(input, () => ({
      analyzer: "bad",
      references: [{ kind: "guess", classification: "local", specifier: "./x.mjs" }]
    })),
    (error) => error.code === "invalid_analyzer_result"
  );
  assert.deepEqual(analyzeSource(input, analyzeNodeEsm), { analyzer: "node-esm", references: [] });
});

test("planner is reproducible and aggregates provenance through a cycle", async () => {
  const root = await fixture({
    "src/entry.mjs": "import './dep.mjs'; import('./lazy.mjs'); import 'node:fs'; import pkg from 'pkg';",
    "src/dep.mjs": "export { value } from './entry.mjs'; export const value = 1;",
    "src/lazy.mjs": "export const lazy = true;"
  });
  const task = envelope(root);
  const first = await planDelegationContext(task, root);
  const second = await planDelegationContext(task, { repositoryRoot: root });
  assert.deepEqual(first, second);
  assert.deepEqual(first.selectedFiles.map((file) => file.relativePath), ["src/dep.mjs", "src/entry.mjs", "src/lazy.mjs"]);
  assert.deepEqual(first.selectedFiles.find((file) => file.relativePath === "src/entry.mjs").inclusionReasons, [
    { kind: "dependency", parent: "src/dep.mjs", specifier: "./entry.mjs" },
    { kind: "seed" }
  ]);
  assert.deepEqual(first.externalReferences, [
    { from: "src/entry.mjs", specifier: "node:fs" },
    { from: "src/entry.mjs", specifier: "pkg" }
  ]);
  assert.match(first.fingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.equal(first.readiness[0].argv, undefined);
  assert.match(first.readiness[0].commandFingerprint, /^sha256:/);
});

test("planner accepts injectable filesystem functions without executing source", async () => {
  const root = await fixture({ "src/entry.mjs": "globalThis.__must_not_run = true;" });
  const calls = [];
  const fakeFs = {
    lstat: async (file) => {
      calls.push(["lstat", path.relative(root, file)]);
      const real = await import("node:fs/promises");
      return real.lstat(file);
    },
    readFile: async (file) => {
      calls.push(["readFile", path.relative(root, file)]);
      return readFile(file);
    }
  };
  const manifest = await planDelegationContext(envelope(root), root, { fs: fakeFs });
  assert.equal(globalThis.__must_not_run, undefined);
  assert.ok(calls.some(([kind]) => kind === "readFile"));
  assert.equal(manifest.selectedFiles.length, 1);
});

for (const [name, source, code] of [
  ["missing target", "import './missing.mjs';", "context_file_missing"],
  ["path escape", "import '../../outside.mjs';", "context_path_escape"],
  ["non-literal dynamic import", "import(name);", "context_unresolved_dependency"]
]) {
  test(`planner fails closed for ${name}`, async () => {
    const root = await fixture({ "src/entry.mjs": source });
    await assert.rejects(() => planDelegationContext(envelope(root), root), (error) => error.code === code);
  });
}

test("planner fails closed at discovery and forbidden boundaries", async () => {
  const root = await fixture({
    "src/entry.mjs": "import '../lib/allowed.mjs';",
    "lib/allowed.mjs": "export const ok = true;"
  });
  await assert.rejects(() => planDelegationContext(envelope(root, {
    scope: { discoverablePaths: ["src/**/*.mjs"] }
  }), root), (error) => error.code === "context_unauthorized");

  const privateRoot = await fixture({
    "src/entry.mjs": "import '../private/secret.mjs';",
    "private/secret.mjs": "export const secret = true;"
  });
  await assert.rejects(() => planDelegationContext(envelope(privateRoot), privateRoot), (error) => error.code === "context_private_path");
});

test("planner requires seed authority and rejects reserved private paths", async () => {
  const root = await fixture({
    "src/entry.mjs": "export const value = true;",
    ".codex/private.mjs": "export const secret = true;",
    ".CoDeX/mixed-case-private.mjs": "export const secret = true;"
  });
  await assert.rejects(() => planDelegationContext(envelope(root, {
    scope: { discoverablePaths: ["lib/**/*.mjs"] }
  }), root), (error) => error.code === "context_unauthorized");
  await assert.rejects(() => planDelegationContext(envelope(root, {
    scope: { discoverablePaths: ["src/**/*.mjs", ".codex/**/*.mjs"] },
    contextPlanning: { seeds: [".codex/private.mjs"] }
  }), root), (error) => error.code === "context_private_path");
  await assert.rejects(() => planDelegationContext(envelope(root, {
    scope: { discoverablePaths: ["src/**/*.mjs", ".CoDeX/**/*.mjs"] },
    contextPlanning: { seeds: [".CoDeX/mixed-case-private.mjs"] }
  }), root), (error) => error.code === "context_private_path");
});

test("planner rejects symlinks and enforces file, byte, and depth budgets", async () => {
  const root = await fixture({
    "src/entry.mjs": "import './link.mjs';",
    "src/real.mjs": "export const real = true;"
  });
  await symlink(path.join(root, "src/real.mjs"), path.join(root, "src/link.mjs"));
  await assert.rejects(() => planDelegationContext(envelope(root), root), (error) => error.code === "context_symlink");

  const budgetRoot = await fixture({
    "src/entry.mjs": "import './one.mjs';",
    "src/one.mjs": "import './two.mjs';",
    "src/two.mjs": "export const two = true;"
  });
  const limited = (budget) => envelope(budgetRoot, { contextPlanning: { budget: { maxFiles: 20, maxBytes: 100_000, maxDepth: 10, ...budget } } });
  for (const [budget, limit] of [[{ maxFiles: 2 }, "maxFiles"], [{ maxBytes: 50 }, "maxBytes"], [{ maxDepth: 1 }, "maxDepth"]]) {
    await assert.rejects(
      () => planDelegationContext(limited(budget), budgetRoot),
      (error) => error.code === "context_budget_exceeded" && error.details.limit === limit && error.details.observed > error.details.maximum
    );
  }
});

test("planner evaluates maxDepth from the deterministic shortest closure path", async () => {
  const root = await fixture({
    "src/entry.mjs": "import './a.mjs'; import './z.mjs';",
    "src/a.mjs": "import './b.mjs';",
    "src/b.mjs": "import './z.mjs';",
    "src/z.mjs": "export const value = true;"
  });
  const manifest = await planDelegationContext(envelope(root, {
    contextPlanning: { budget: { maxFiles: 20, maxBytes: 100_000, maxDepth: 2 } }
  }), root);
  assert.deepEqual(manifest.selectedFiles.map((item) => item.relativePath), [
    "src/a.mjs",
    "src/b.mjs",
    "src/entry.mjs",
    "src/z.mjs"
  ]);
});

test("planner suppresses duplicate pending dependencies before queueing", async () => {
  const root = await fixture({
    "src/entry.mjs": "entry",
    "src/dep.mjs": "dep"
  });
  const duplicateReferences = Array.from({ length: 10_000 }, () => ({
    kind: "static",
    classification: "local",
    specifier: "./dep.mjs"
  }));
  const manifest = await planDelegationContext(envelope(root), root, {
    analyze: ({ relativePath }) => ({
      analyzer: "node-esm",
      references: relativePath === "src/entry.mjs" ? duplicateReferences : []
    })
  });
  assert.deepEqual(manifest.selectedFiles.map((item) => item.relativePath), ["src/dep.mjs", "src/entry.mjs"]);
  assert.equal(manifest.selectedFiles.find((item) => item.relativePath === "src/dep.mjs").inclusionReasons.length, 1);
});
