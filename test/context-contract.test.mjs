import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateTaskEnvelope } from "../src/envelope.mjs";
import { makeEnvelope } from "./helpers.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function plannedEnvelope(overrides = {}) {
  const { scope = {}, contextPlanning = {}, ...rest } = overrides;
  return makeEnvelope("/absolute/repository", {
    ...rest,
    scope: { discoverablePaths: ["src/**/*.mjs", "package.json"], ...scope },
    contextPlanning: {
      strategy: "dependency-closure",
      seeds: ["src/index.mjs"],
      analyzers: ["node-esm"],
      budget: { maxFiles: 100, maxBytes: 1_000_000, maxDepth: 20 },
      readiness: [{
        id: "node",
        argv: [process.execPath, "--version"],
        timeoutMs: 10_000,
        acceptableExitCodes: [0]
      }],
      ...contextPlanning
    }
  });
}

function assertInvalid(envelope, expectedCode = null) {
  assert.throws(() => validateTaskEnvelope(envelope), (error) => {
    if (expectedCode) assert.equal(error.code, expectedCode);
    else assert(["invalid_envelope", "invalid_path"].includes(error.code));
    return true;
  });
}

test("valid planned mode requires and accepts bounded context authority", () => {
  const envelope = plannedEnvelope();
  assert.equal(validateTaskEnvelope(envelope), envelope);
});

test("explicit mode remains valid without planning fields", () => {
  const envelope = makeEnvelope("/absolute/repository");
  assert.equal(validateTaskEnvelope(envelope), envelope);
  assert.equal(envelope.scope.discoverablePaths, undefined);
  assert.equal(envelope.contextPlanning, undefined);
});

test("planned mode requires discovery authority", () => {
  const envelope = makeEnvelope("/absolute/repository", {
    contextPlanning: plannedEnvelope().contextPlanning
  });
  assertInvalid(envelope);
});

test("seeds are literal normalized repository-relative paths", () => {
  for (const seeds of [
    ["src/*.mjs"],
    ["../src/index.mjs"],
    ["."],
    ["./src/index.mjs"],
    ["src\\index.mjs"],
    ["src/index.mjs", "src/index.mjs"]
  ]) {
    assertInvalid(plannedEnvelope({ contextPlanning: { seeds } }));
  }
});

test("unknown fields are rejected at every contract boundary", () => {
  const cases = [
    { repository: { extra: true } },
    { repository: { dirtyTree: { extra: true } } },
    { scope: { extra: true } },
    { contextPlanning: { extra: true } },
    { contextPlanning: { budget: { extra: true } } },
    { contextPlanning: { readiness: [{ extra: true }] } },
    { resultFormat: { extra: true } },
    { validation: [{ id: "x", argv: ["node"], extra: true }] }
  ];
  for (const overrides of cases) assertInvalid(plannedEnvelope(overrides));
});

test("analyzers, budgets, and readiness are constrained", () => {
  assertInvalid(plannedEnvelope({ contextPlanning: { analyzers: ["unknown"] } }));
  assertInvalid(plannedEnvelope({ contextPlanning: { budget: { maxFiles: 0 } } }));
  assertInvalid(plannedEnvelope({ contextPlanning: { budget: { maxBytes: 1_073_741_825 } } }));
  assertInvalid(plannedEnvelope({ contextPlanning: { budget: { maxDepth: 1.5 } } }));
  assertInvalid(plannedEnvelope({ contextPlanning: { readiness: [{
    id: "node",
    argv: [process.execPath, "--version"],
    timeoutMs: 10_000,
    acceptableExitCodes: []
  }] } }));
  assertInvalid(plannedEnvelope({ contextPlanning: { readiness: [{
    id: "node",
    argv: [process.execPath, "--version"],
    timeoutMs: 10_000,
    acceptableExitCodes: [0, 0]
  }] } }));
  assertInvalid(plannedEnvelope({ execution: { exposureMode: "trusted-worktree" } }));
});

test("readiness uses non-shell argv and rejects credential-like arguments", () => {
  assertInvalid(plannedEnvelope({ contextPlanning: { readiness: [{
    id: "shell",
    argv: ["sh", "-c", "true"],
    timeoutMs: 10_000,
    acceptableExitCodes: [0]
  }] } }));
  assertInvalid(plannedEnvelope({ contextPlanning: { readiness: [{
    id: "unsafe",
    argv: [process.execPath, "--token=not-a-token"],
    timeoutMs: 10_000,
    acceptableExitCodes: [0]
  }] } }), "credential_in_envelope");
  assertInvalid(plannedEnvelope({ contextPlanning: { readiness: [{
    id: "unsafe-env",
    argv: ["env", "OPENAI_API_KEY=not-a-key", process.execPath, "--version"],
    timeoutMs: 10_000,
    acceptableExitCodes: [0]
  }] } }), "credential_in_envelope");
});

test("public JSON schemas are parseable and expose strict context contracts", async () => {
  const taskSchema = JSON.parse(await readFile(path.join(packageRoot, "contracts/task-envelope.schema.json"), "utf8"));
  const manifestSchema = JSON.parse(await readFile(path.join(packageRoot, "contracts/context-manifest.schema.json"), "utf8"));
  assert.equal(taskSchema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(taskSchema.additionalProperties, false);
  assert.equal(taskSchema.properties.contextPlanning.additionalProperties, false);
  assert.equal(taskSchema.properties.contextPlanning.properties.strategy.const, "dependency-closure");
  assert.match(taskSchema.$defs.readiness.properties.argv.items.pattern, /credential/);
  assert.match(taskSchema.$defs.readiness.properties.argv.prefixItems[0].pattern, /powershell/);
  assert.equal(manifestSchema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(manifestSchema.additionalProperties, false);
  assert.deepEqual(manifestSchema.required, [
    "schemaVersion",
    "strategy",
    "analyzers",
    "selectedFiles",
    "externalReferences",
    "unresolvedReferences",
    "excludedReferences",
    "totals",
    "budget",
    "readiness",
    "fingerprint"
  ]);
  assert.equal(manifestSchema.properties.selectedFiles.minItems, 1);
  assert.deepEqual(manifestSchema.$defs.inclusionReason.properties.kind.enum, [
    "explicit", "seed", "dependency", "instruction"
  ]);
  assert.equal(manifestSchema.$defs.readiness.properties.argv, undefined);
  assert.equal(manifestSchema.$defs.readiness.properties.commandFingerprint.pattern, "^sha256:[a-f0-9]{64}$");
  assert.equal(manifestSchema.properties.fingerprint.pattern, "^sha256:[a-f0-9]{64}$");
});
