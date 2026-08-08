import assert from "node:assert/strict";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { archiveAndCleanupTerminalTask, recordTerminalDecision } from "../src/codex/actions.mjs";
import { executeCodexDelegation, prepareCodexDelegation } from "../src/codex/controller.mjs";
import { buildHostReviewPacket, extractAggregateMetrics } from "../src/codex/review.mjs";
import { createGitRepository, makeEnvelope } from "./helpers.mjs";

const profileRegistry = {
  schemaVersion: "1.0.0",
  profiles: { worker: { model: "worker-model", external: true } }
};

const compatibilityProcess = async (_command, args) => {
  if (args[0] === "--version") return { exitCode: 0, stdout: "codex-cli 0.147.0", stderr: "" };
  if (args[1] === "resume") return { exitCode: 0, stdout: "Resume --json", stderr: "" };
  return { exitCode: 0, stdout: "--json --output-schema --profile --sandbox", stderr: "" };
};

const completed = {
  schemaVersion: "1.0.0",
  taskId: "test-task",
  status: "completed",
  summary: "Completed the bounded edit.",
  changedFiles: ["allowed.txt"],
  validations: [],
  residualRisks: [],
  blocking: null
};

async function executeFixture() {
  const root = await createGitRepository();
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "adk-review-state-"));
  const envelope = makeEnvelope(root, {
    executionProfile: "worker",
    scope: { readablePaths: ["README.md"] }
  });
  const prepared = await prepareCodexDelegation({ envelope, profileRegistry, stateRoot, hostInstanceId: "desktop-host-1" }, { compatibilityProcess });
  const execution = await executeCodexDelegation(prepared, {
    codexHome: path.join(prepared.capsule.taskRoot, "codex-home"),
    runProcess: async () => ({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stderr: "",
      stdout: `${JSON.stringify({ type: "thread.started", thread_id: "worker-thread-1" })}\n${JSON.stringify({ type: "turn.completed", usage: { input_tokens: 9 } })}\n`
    }),
    readResultFile: async () => JSON.stringify(completed)
  });
  return { root, prepared, execution };
}

test("host review separates worker claims, observed evidence, and validation", async () => {
  const fixture = await executeFixture();
  await writeFile(path.join(fixture.prepared.capsule.capsuleRoot, "allowed.txt"), "bounded change\n");
  const review = await buildHostReviewPacket(fixture.prepared, fixture.execution, { durationMs: 125 });
  assert.equal(review.packet.executorSelfReport.summary, completed.summary);
  assert.deepEqual(review.packet.hostObserved.changedPaths, ["allowed.txt"]);
  assert.deepEqual(review.packet.hostObserved.scopeBreaches, []);
  assert.equal(review.packet.validations[0].status, "passed");
  assert.equal(review.packet.acceptance.status, "pending");
  assert.equal(review.packet.acceptance.eligible, true);
  assert.match(review.candidatePatch, /bounded change/);
});

test("host-observed scope breach makes completion ineligible", async () => {
  const fixture = await executeFixture();
  await writeFile(path.join(fixture.prepared.capsule.capsuleRoot, "private.txt"), "breach\n");
  const review = await buildHostReviewPacket(fixture.prepared, fixture.execution);
  assert.deepEqual(review.packet.hostObserved.scopeBreaches, ["private.txt"]);
  assert.equal(review.packet.acceptance.eligible, false);
  assert.equal(review.packet.validations[0].status, "not_run");
  await assert.rejects(
    recordTerminalDecision(fixture.prepared, review, "accept", "desktop-host-1"),
    (error) => error.code === "acceptance_ineligible"
  );
});

test("metrics keep only bounded aggregates and mark unavailable usage", () => {
  const metrics = extractAggregateMetrics({
    taskId: "private/task/path",
    profile: { fingerprint: "sha256:1234567890abcdef9999" },
    execution: {
      eventCount: 2,
      usage: { input_tokens: 8, prompt: "secret prompt", sourcePath: path.join(path.sep, "private", "source"), apiKey: "secret" }
    }
  });
  assert.equal(metrics.inputTokens, 8);
  assert.equal(metrics.outputTokens, "unavailable");
  assert.equal(metrics.durationMs, "unavailable");
  const serialized = JSON.stringify(metrics);
  assert.doesNotMatch(serialized, /secret prompt|sourcePath|apiKey|private\/task/);
});

test("terminal host decision archives review evidence before task-scoped cleanup", async () => {
  const fixture = await executeFixture();
  await writeFile(path.join(fixture.prepared.capsule.capsuleRoot, "allowed.txt"), "accepted change\n");
  const review = await buildHostReviewPacket(fixture.prepared, fixture.execution);
  const decided = await recordTerminalDecision(fixture.prepared, review, "accept", "desktop-host-1");
  assert.equal(decided.packet.acceptance.status, "accepted");
  const archiveRoot = await mkdtemp(path.join(os.tmpdir(), "adk-review-archive-"));
  const archive = await archiveAndCleanupTerminalTask(fixture.prepared, decided, archiveRoot);
  assert.equal(JSON.parse(await readFile(archive.packetPath, "utf8")).acceptance.status, "accepted");
  assert.match(await readFile(archive.patchPath, "utf8"), /accepted change/);
  await assert.rejects(access(fixture.prepared.capsule.taskRoot));
  await access(fixture.root);
});
