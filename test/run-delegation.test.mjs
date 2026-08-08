import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { validateTaskEnvelope } from "../src/envelope.mjs";
import { runDelegation } from "../src/run-delegation.mjs";
import { createDirectory, createGitRepository, makeEnvelope } from "./helpers.mjs";

const fakePi = fileURLToPath(new URL("./fixtures/fake-pi.mjs", import.meta.url));
const cli = fileURLToPath(new URL("../bin/agent-delegation-kit.mjs", import.meta.url));
const execFileAsync = promisify(execFile);
const execute = (envelope, scenario) => runDelegation(envelope, {
  executorCommand: fakePi,
  executorEnv: { FAKE_PI_SCENARIO: scenario }
});

test("successful execution remains pending host acceptance", async () => {
  const root = await createGitRepository();
  const result = await execute(makeEnvelope(root), "success");
  assert.equal(result.status, "completed");
  assert.deepEqual(result.changedPaths, ["allowed.txt"]);
  assert.equal(result.scope.compliant, true);
  assert.equal(result.validations[0].status, "passed");
  assert.deepEqual(result.hostAcceptance, { status: "pending", eligible: true, decidedBy: null });
});

test("CLI reads an envelope file and emits a structured result", async () => {
  const root = await createGitRepository();
  const envelopeFile = path.join(root, "..", `envelope-${path.basename(root)}.json`);
  await writeFile(envelopeFile, JSON.stringify(makeEnvelope(root)));
  const { stdout } = await execFileAsync(process.execPath, [cli, "run", "--envelope", envelopeFile, "--executor", fakePi], {
    env: { ...process.env, FAKE_PI_SCENARIO: "success" }
  });
  const result = JSON.parse(stdout);
  assert.equal(result.status, "completed");
  assert.equal(result.hostAcceptance.status, "pending");
});

test("missing required envelope field is rejected before execution", () => {
  const envelope = makeEnvelope("/absolute/repository");
  delete envelope.objective;
  assert.throws(() => validateTaskEnvelope(envelope), (error) => error.code === "invalid_envelope");
});

test("non-Git target is rejected", async () => {
  const root = await createDirectory();
  await assert.rejects(execute(makeEnvelope(root), "success"), (error) => error.code === "not_git_repository");
});

test("dirty tree is refused by default", async () => {
  const root = await createGitRepository();
  await writeFile(path.join(root, "README.md"), "dirty\n");
  await assert.rejects(execute(makeEnvelope(root), "nochange"), (error) => error.code === "dirty_tree");
});

test("dirty tree override requires and records acknowledged paths", async () => {
  const root = await createGitRepository();
  await writeFile(path.join(root, "README.md"), "dirty\n");
  const envelope = makeEnvelope(root, {
    repository: { dirtyTree: { allow: true, acknowledgedPaths: ["README.md"] } }
  });
  const result = await execute(envelope, "nochange");
  assert.equal(result.status, "completed");
  assert.deepEqual(result.baseline.dirtyPathsBefore, ["README.md"]);
  assert(result.residualRisks.some((item) => item.includes("acknowledged uncommitted changes")));
});

test("executor blocked result skips validation", async () => {
  const root = await createGitRepository();
  const result = await execute(makeEnvelope(root), "blocked");
  assert.equal(result.status, "blocked");
  assert.equal(result.validations[0].status, "not_run");
  assert.equal(result.hostAcceptance.eligible, false);
});

test("executor process failure redacts credential-like output", async () => {
  const root = await createGitRepository();
  const result = await execute(makeEnvelope(root), "failed");
  assert.equal(result.status, "failed");
  assert.equal(result.executor.reportedStatus, "failed");
  assert(!JSON.stringify(result).includes(["top", "secret"].join("-")));
});

test("malformed executor output is normalized as failed", async () => {
  const root = await createGitRepository();
  const result = await execute(makeEnvelope(root), "malformed");
  assert.equal(result.status, "failed");
  assert.equal(result.executor.reportedStatus, "malformed");
});

test("executor interruption is normalized as failed", async () => {
  const root = await createGitRepository();
  const envelope = makeEnvelope(root, { execution: { timeoutMs: 50 } });
  const result = await execute(envelope, "hang");
  assert.equal(result.status, "failed");
  assert.match(result.executor.summary, /timed out/i);
});

test("validation failure makes work ineligible for acceptance", async () => {
  const root = await createGitRepository();
  const envelope = makeEnvelope(root, {
    validation: [{ id: "fail", argv: [process.execPath, "-e", "process.exit(2)"], timeoutMs: 10_000 }]
  });
  const result = await execute(envelope, "success");
  assert.equal(result.status, "failed");
  assert.equal(result.validations[0].status, "failed");
  assert.equal(result.hostAcceptance.eligible, false);
});

test("missing validation executable is recorded as not run", async () => {
  const root = await createGitRepository();
  const envelope = makeEnvelope(root, {
    validation: [{ id: "missing", argv: ["definitely-not-an-installed-command"] }]
  });
  const result = await execute(envelope, "success");
  assert.equal(result.status, "failed");
  assert.equal(result.validations[0].status, "not_run");
  assert.equal(result.validations[0].reason, "spawn_error");
});

test("missing executor executable is normalized as failed", async () => {
  const root = await createGitRepository();
  const result = await runDelegation(makeEnvelope(root), {
    executorCommand: "definitely-not-an-installed-executor"
  });
  assert.equal(result.status, "failed");
  assert.equal(result.executor.reportedStatus, "failed");
  assert.match(result.executor.summary, /could not start/i);
});

test("out-of-scope edit is independently rejected", async () => {
  const root = await createGitRepository();
  const result = await execute(makeEnvelope(root), "breach");
  assert.equal(result.status, "rejected");
  assert.deepEqual(result.scope.breaches, ["private.txt"]);
  assert.equal(result.validations[0].reason, "scope_breach");
  assert.equal(result.hostAcceptance.eligible, false);
});

test("branch changes are rejected as baseline breaches", async () => {
  const root = await createGitRepository();
  const result = await execute(makeEnvelope(root), "branch-change");
  assert.equal(result.status, "rejected");
  assert(result.scope.breaches.includes("git:branch changed during delegated execution"));
});

test("credential-like fields are rejected from the envelope", () => {
  const envelope = makeEnvelope("/absolute/repository", {
    executionProfile: { provider: "example", [["api", "Key"].join("")]: "do-not-store" }
  });
  assert.throws(() => validateTaskEnvelope(envelope), (error) => error.code === "invalid_envelope" || error.code === "credential_in_envelope");
});

test("credential-like validation arguments are rejected", () => {
  const envelope = makeEnvelope("/absolute/repository", {
    validation: [{ id: "unsafe", argv: ["tool", "--api-key", "do-not-store"] }]
  });
  assert.throws(() => validateTaskEnvelope(envelope), (error) => error.code === "credential_in_envelope");
});
