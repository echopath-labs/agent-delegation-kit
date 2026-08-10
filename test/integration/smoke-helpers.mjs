import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { archiveAndCleanupTerminalTask, recordTerminalDecision } from "../../src/codex/actions.mjs";
import { correctCodexDelegation, executeCodexDelegation, prepareCodexDelegation } from "../../src/codex/controller.mjs";
import { buildHostReviewPacket } from "../../src/codex/review.mjs";
import { createGitRepository, makeEnvelope } from "../helpers.mjs";

export async function runRealCodexSmoke(profile, diagnostic, scenario = {}) {
  const root = await createGitRepository();
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "adk-real-smoke-state-"));
  const archiveRoot = await mkdtemp(path.join(os.tmpdir(), "adk-real-smoke-archive-"));
  const outputFile = scenario.outputFile ?? "allowed.txt";
  const outputContent = scenario.outputContent ?? "delegated smoke ok\n";
  const envelope = makeEnvelope(root, {
    taskId: scenario.taskId ?? "test-task",
    objective: scenario.objective ?? `Create ${outputFile} with the exact requested content.`,
    expectedOutcome: `${outputFile} contains the requested content and validation passes.`,
    executionProfile: "smoke-worker",
    scope: {
      readablePaths: ["README.md"],
      allowedPaths: [outputFile],
      forbiddenPaths: [".git/**", ".env", ".env.*"]
    },
    instructions: [`Create only ${outputFile} with the exact requested content: ${JSON.stringify(outputContent)}.`],
    validation: [{
      id: "smoke-content",
      argv: [
        process.execPath,
        "-e",
        `const fs=require('fs');process.exit(fs.readFileSync(${JSON.stringify(outputFile)},'utf8')===${JSON.stringify(outputContent)}?0:1)`
      ],
      timeoutMs: 30_000
    }],
    execution: { timeoutMs: 300_000, exposureMode: "sanitized" }
  });
  const profileRegistry = { schemaVersion: "1.0.0", profiles: { "smoke-worker": profile } };
  let prepared;
  try {
    prepared = await prepareCodexDelegation({ envelope, profileRegistry, stateRoot, hostInstanceId: "integration-smoke-host" });
    let execution = await executeCodexDelegation(prepared);
    if (execution.workerResult.blocking?.code === "malformed_worker_result") {
      execution = await correctCodexDelegation(prepared, {
        taskId: envelope.taskId,
        profileFingerprint: prepared.profile.fingerprint,
        capsuleBaseline: prepared.capsule.baseline,
        contextManifestFingerprint: prepared.capsule.contextManifestFingerprint,
        priorResultIdentity: execution.state.resultIdentity,
        prompt: [
          "Do not change any file. Re-emit only the structured result for the completed task.",
          `The local validator rejected the prior shape: ${execution.workerResult.blocking.message}`,
          "Use schemaVersion string 1.0.0, the exact taskId, only schema keys, and JSON null for blocking when completed."
        ].join(" ")
      });
      diagnostic(JSON.stringify({ correctionSequence: execution.state.correctionSequence }));
    }
    let review = await buildHostReviewPacket(prepared, execution);
    if (execution.workerResult.status === "completed" && review.packet.validations.some((item) => item.status !== "passed")) {
      execution = await correctCodexDelegation(prepared, {
        taskId: envelope.taskId,
        profileFingerprint: prepared.profile.fingerprint,
        capsuleBaseline: prepared.capsule.baseline,
        contextManifestFingerprint: prepared.capsule.contextManifestFingerprint,
        priorResultIdentity: execution.state.resultIdentity,
        prompt: [
          "Host-controlled validation failed. Stay within the original path authority.",
          `Rewrite ${outputFile} so its full content is exactly ${JSON.stringify(outputContent)}, with no additional characters or newline.`,
          "Rerun the relevant check and return the strict structured result."
        ].join(" ")
      });
      diagnostic(JSON.stringify({ validationCorrectionSequence: execution.state.correctionSequence }));
      review = await buildHostReviewPacket(prepared, execution);
    }
    diagnostic(JSON.stringify(review.packet.metrics));
    diagnostic(JSON.stringify({
      workerStatus: execution.workerResult.status,
      blockingCode: execution.workerResult.blocking?.code ?? null,
      blockingMessage: execution.workerResult.blocking?.message ?? null,
      lifecycleState: execution.state.lifecycleState
    }));
    diagnostic(JSON.stringify({
      changedPathCount: review.packet.hostObserved.changedPaths.length,
      scopeBreachCount: review.packet.hostObserved.scopeBreaches.length,
      evidenceAvailable: review.packet.hostObserved.evidenceAvailable,
      validationStatuses: review.packet.validations.map((item) => item.status),
      sourceUnchanged: review.sourceUnchanged,
      unresolvedRiskCount: review.packet.unresolvedRisks.length
    }));
    assert.equal(execution.workerResult.status, "completed");
    assert.equal(review.packet.acceptance.status, "pending");
    assert.equal(review.packet.acceptance.eligible, true);
    assert.equal(review.sourceUnchanged, true);
    const decided = await recordTerminalDecision(prepared, review, "abandon", "integration-smoke-host");
    await archiveAndCleanupTerminalTask(prepared, decided, archiveRoot);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
    await rm(archiveRoot, { recursive: true, force: true });
  }
}
