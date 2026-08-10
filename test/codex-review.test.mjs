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

async function executeFixture(overrides = {}) {
  const root = await createGitRepository();
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "adk-review-state-"));
  const resolvedOverrides = typeof overrides === "function" ? overrides(root) : overrides;
  const envelope = makeEnvelope(root, {
    executionProfile: "worker",
    scope: { readablePaths: ["README.md"] },
    ...resolvedOverrides
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
  assert.equal(review.packet.contextEvidence.plan.mode, "explicit");
  assert.equal(review.packet.contextEvidence.readiness.outcome, "not_configured");
  assert.equal(review.packet.contextEvidence.executorContextGap, null);
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

test("validation-time source mutation makes completion ineligible", async () => {
  const fixture = await executeFixture();
  await writeFile(path.join(fixture.prepared.capsule.capsuleRoot, "allowed.txt"), "bounded change\n");
  const review = await buildHostReviewPacket(fixture.prepared, fixture.execution, {
    runProcess: async () => {
      await writeFile(path.join(fixture.root, "README.md"), "mutated\n");
      return { exitCode: 0, signal: null, timedOut: false, stdout: "passed", stderr: "" };
    }
  });
  assert.equal(review.packet.validations[0].status, "passed");
  assert.equal(review.sourceUnchanged, false);
  assert.equal(review.packet.hostObserved.evidenceAvailable, false);
  assert.equal(review.packet.acceptance.eligible, false);
  assert.match(await readFile(path.join(fixture.root, "README.md"), "utf8"), /mutated/);
  assert(review.packet.unresolvedRisks.some((item) => item.includes("source workspace changed")));
});

test("validation-time out-of-scope capsule mutation is final scope evidence", async () => {
  const fixture = await executeFixture({
    validation: [{
      id: "mutate-capsule",
      argv: [
        process.execPath,
        "-e",
        "require('node:fs').writeFileSync('private.txt', 'validation mutation\\n')"
      ],
      timeoutMs: 10_000
    }]
  });
  await writeFile(path.join(fixture.prepared.capsule.capsuleRoot, "allowed.txt"), "bounded change\n");
  const review = await buildHostReviewPacket(fixture.prepared, fixture.execution);
  assert.equal(review.packet.validations[0].status, "passed");
  assert.deepEqual(review.packet.hostObserved.changedPaths, ["allowed.txt", "private.txt"]);
  assert.deepEqual(review.packet.hostObserved.scopeBreaches, ["private.txt"]);
  assert.equal(review.packet.acceptance.eligible, false);
  assert.match(review.candidatePatch, /validation mutation/);
});

test("metrics keep only bounded aggregates and mark unavailable usage", () => {
  const metrics = extractAggregateMetrics({
    taskId: "private/task/path",
    profile: { fingerprint: "sha256:1234567890abcdef9999" },
    execution: {
      eventCount: 2,
      usage: { input_tokens: 8, prompt: "secret prompt", sourcePath: path.join(path.sep, "private", "source"), apiKey: "secret" }
    },
    contextEvidence: {
      plan: {
        mode: "planned",
        strategy: "dependency-closure",
        fingerprint: "sha256:private-path-and-fingerprint",
        selectedFileCount: 4,
        selectedBytes: 2048,
        unresolvedReferenceCount: 0,
        budgetUtilization: { files: 0.4, bytes: 0.2, maxDepth: 7 }
      },
      readiness: { outcome: "passed", summary: "raw readiness output" },
      executorContextGap: { code: "context_gap", message: "missing /private/secret.mjs" }
    }
  });
  assert.equal(metrics.inputTokens, 8);
  assert.equal(metrics.outputTokens, "unavailable");
  assert.equal(metrics.durationMs, "unavailable");
  assert.equal(metrics.contextMode, "planned");
  assert.equal(metrics.selectedFileCount, 4);
  assert.equal(metrics.readinessOutcome, "passed");
  assert.equal(metrics.contextBlockCategory, "executor_context_gap");
  assert.equal(metrics.newTaskRequired, true);
  const serialized = JSON.stringify(metrics);
  assert.doesNotMatch(serialized, /secret prompt|sourcePath|apiKey|private\/task|private-path|raw readiness|private\/secret/);
});

test("host review keeps executor context gaps separate from readiness and validation", async () => {
  const fixture = await executeFixture();
  const execution = {
    ...fixture.execution,
    workerResult: {
      ...completed,
      status: "blocked",
      summary: "Required task context is missing.",
      changedFiles: [],
      blocking: { code: "context_gap", message: "Missing repository-relative fixture data/example.json." }
    }
  };
  const review = await buildHostReviewPacket(fixture.prepared, execution);
  assert.deepEqual(review.packet.contextEvidence.executorContextGap, {
    code: "context_gap",
    message: "Missing repository-relative fixture data/example.json."
  });
  assert.equal(review.packet.contextEvidence.readiness.outcome, "not_configured");
  assert.equal(review.packet.validations[0].status, "not_run");
  assert.equal(review.packet.acceptance.eligible, false);
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
