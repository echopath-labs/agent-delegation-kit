import { chmod, mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { conciseOutput } from "../redact.mjs";
import { runProcess } from "../process.mjs";
import { collectCandidateEvidence, verifySourceUnchanged } from "./capsule.mjs";
import { opaqueTaskMetricId, readTaskState } from "./state.mjs";

function unavailable(value) {
  return Number.isFinite(value) && value >= 0 ? value : "unavailable";
}

function usageValue(usage, ...keys) {
  for (const key of keys) {
    if (Number.isFinite(usage?.[key])) return usage[key];
  }
  return undefined;
}

function boundedRatio(value, maximum) {
  return Number.isFinite(value) && Number.isFinite(maximum) && maximum > 0
    ? Math.min(1, Math.max(0, value / maximum))
    : "unavailable";
}

function contextPlanEvidence(capsule) {
  const manifest = capsule.contextManifest;
  if (!manifest) {
    return {
      mode: "explicit",
      strategy: null,
      fingerprint: null,
      selectedFileCount: capsule.inputMetadata?.length ?? 0,
      selectedBytes: (capsule.inputMetadata ?? []).reduce((sum, item) => sum + (item.bytes ?? 0), 0),
      unresolvedReferenceCount: 0,
      budgetUtilization: null
    };
  }
  return {
    mode: "planned",
    strategy: manifest.strategy,
    fingerprint: manifest.fingerprint,
    selectedFileCount: manifest.totals.selectedFiles,
    selectedBytes: manifest.totals.selectedBytes,
    unresolvedReferenceCount: manifest.totals.unresolvedReferences,
    budgetUtilization: {
      files: boundedRatio(manifest.totals.selectedFiles, manifest.budget.maxFiles),
      bytes: boundedRatio(manifest.totals.selectedBytes, manifest.budget.maxBytes),
      maxDepth: manifest.budget.maxDepth
    }
  };
}

function executorContextGap(workerResult) {
  if (workerResult.status !== "blocked" || workerResult.blocking?.code !== "context_gap") return null;
  return {
    code: "context_gap",
    message: conciseOutput(workerResult.blocking.message, 1000)
  };
}

function contextEvidenceFor(prepared, execution) {
  return {
    plan: contextPlanEvidence(prepared.capsule),
    readiness: prepared.readiness ?? {
      outcome: "not_configured",
      commandCount: 0,
      passedCount: 0,
      failedCount: 0,
      mutationDetected: false,
      commands: []
    },
    executorContextGap: executorContextGap(execution.workerResult)
  };
}

export function extractAggregateMetrics({ taskId, profile, execution, durationMs, contextEvidence = undefined }) {
  const usage = execution.usage;
  const plan = contextEvidence?.plan;
  const readiness = contextEvidence?.readiness;
  return {
    task: opaqueTaskMetricId(taskId),
    profile: profile.fingerprint.slice("sha256:".length, "sha256:".length + 16),
    requestCount: 1,
    eventCount: Number.isInteger(execution.eventCount) ? execution.eventCount : 0,
    durationMs: unavailable(durationMs),
    inputTokens: unavailable(usageValue(usage, "input_tokens", "inputTokens")),
    outputTokens: unavailable(usageValue(usage, "output_tokens", "outputTokens")),
    cachedInputTokens: unavailable(usageValue(usage, "cached_input_tokens", "cachedInputTokens")),
    reasoningTokens: unavailable(usageValue(usage, "reasoning_tokens", "reasoningTokens")),
    cost: "unavailable",
    contextMode: plan?.mode === "planned" ? "planned" : "explicit",
    contextStrategy: plan?.strategy === "dependency-closure" ? "dependency-closure" : plan?.mode === "planned" ? "unavailable" : "explicit",
    selectedFileCount: unavailable(plan?.selectedFileCount),
    selectedBytes: unavailable(plan?.selectedBytes),
    unresolvedReferenceCount: unavailable(plan?.unresolvedReferenceCount),
    fileBudgetUtilization: unavailable(plan?.budgetUtilization?.files),
    byteBudgetUtilization: unavailable(plan?.budgetUtilization?.bytes),
    readinessOutcome: new Set(["not_configured", "passed", "failed"]).has(readiness?.outcome)
      ? readiness.outcome
      : "unavailable",
    contextBlockCategory: contextEvidence?.executorContextGap ? "executor_context_gap" : "none",
    newTaskRequired: Boolean(contextEvidence?.executorContextGap)
  };
}

export async function runHostValidations(envelope, capsule, options = {}) {
  const runner = options.runProcess ?? runProcess;
  const results = [];
  for (const command of envelope.validation) {
    const started = performance.now();
    let processResult;
    try {
      processResult = await runner(command.argv[0], command.argv.slice(1), {
        cwd: capsule.capsuleRoot,
        timeoutMs: command.timeoutMs ?? 120_000
      });
    } catch (error) {
      results.push({
        id: command.id,
        argv: command.argv,
        status: "not_run",
        exitCode: null,
        durationMs: Math.round(performance.now() - started),
        summary: conciseOutput(error.message),
        reason: "spawn_error"
      });
      continue;
    }
    const passed = processResult.exitCode === 0 && !processResult.signal && !processResult.timedOut;
    results.push({
      id: command.id,
      argv: command.argv,
      status: passed ? "passed" : "failed",
      exitCode: processResult.exitCode,
      durationMs: Math.round(performance.now() - started),
      summary: conciseOutput(`${processResult.stdout}\n${processResult.stderr}`),
      reason: processResult.timedOut ? "timeout" : processResult.signal ? `signal:${processResult.signal}` : null
    });
  }
  return results;
}

export async function buildHostReviewPacket(prepared, execution, options = {}) {
  const contextEvidence = contextEvidenceFor(prepared, execution);
  let [state, evidence, source] = await Promise.all([
    readTaskState(prepared.statePath),
    collectCandidateEvidence(prepared.capsule, prepared.envelope.scope),
    verifySourceUnchanged(prepared.repository, prepared.capsule)
  ]);
  const canValidate = execution.workerResult.status === "completed" &&
    evidence.baselineConsistent && evidence.scopeBreaches.length === 0 && source.unchanged;
  const validations = canValidate
    ? await runHostValidations(prepared.envelope, prepared.capsule, options)
    : prepared.envelope.validation.map((command) => ({
      id: command.id,
      argv: command.argv,
      status: "not_run",
      exitCode: null,
      durationMs: 0,
      summary: "Validation was skipped because required postflight evidence was not eligible.",
      reason: "postflight_ineligible"
    }));
  if (canValidate) {
    [state, evidence, source] = await Promise.all([
      readTaskState(prepared.statePath),
      collectCandidateEvidence(prepared.capsule, prepared.envelope.scope),
      verifySourceUnchanged(prepared.repository, prepared.capsule)
    ]);
  }
  const validationPassed = validations.every((item) => item.status === "passed");
  const unresolvedRisks = [...execution.workerResult.residualRisks];
  if (!evidence.baselineConsistent) unresolvedRisks.push("The task capsule HEAD changed from its host-recorded baseline.");
  if (!source.unchanged) unresolvedRisks.push("The source workspace changed during delegated execution.");
  if (evidence.scopeBreaches.length > 0) unresolvedRisks.push("One or more host-observed scope breaches require recovery review.");
  if (!validationPassed) unresolvedRisks.push("One or more host-controlled validations failed or did not run.");
  const evidenceAvailable = typeof evidence.candidatePatch === "string" && source.unchanged;
  const eligible = execution.workerResult.status === "completed" && evidenceAvailable &&
    evidence.baselineConsistent && evidence.scopeBreaches.length === 0 && validationPassed;
  const packet = {
    schemaVersion: "1.0.0",
    taskId: prepared.envelope.taskId,
    lifecycleState: state.lifecycleState,
    profile: {
      name: prepared.profile.name,
      fingerprint: prepared.profile.fingerprint,
      effectiveModel: prepared.profile.model ?? null
    },
    contextEvidence,
    executorSelfReport: execution.workerResult,
    hostObserved: {
      baseline: prepared.capsule.baseline,
      changedPaths: evidence.changedPaths,
      scopeBreaches: evidence.scopeBreaches,
      candidatePatchSha256: evidence.candidatePatchSha256,
      evidenceAvailable
    },
    validations,
    unresolvedRisks: [...new Set(unresolvedRisks)],
    metrics: extractAggregateMetrics({
      taskId: prepared.envelope.taskId,
      profile: prepared.profile,
      execution,
      durationMs: options.durationMs,
      contextEvidence
    }),
    acceptance: { status: "pending", eligible, decidedBy: null }
  };
  return { packet, candidatePatch: evidence.candidatePatch, sourceUnchanged: source.unchanged };
}

export async function persistPendingReview(prepared, review) {
  const state = await readTaskState(prepared.statePath);
  const evidenceRoot = path.join(prepared.capsule.taskRoot, "evidence");
  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
  const suffix = String(state.correctionSequence);
  const packetPath = path.join(evidenceRoot, `host-review-packet-${suffix}.json`);
  const patchPath = path.join(evidenceRoot, `candidate-${suffix}.patch`);
  await writeFile(packetPath, `${JSON.stringify(review.packet, null, 2)}\n`, { mode: 0o600 });
  await writeFile(patchPath, review.candidatePatch ?? "", { mode: 0o600 });
  await chmod(packetPath, 0o600);
  await chmod(patchPath, 0o600);
  return { packetPath, patchPath };
}
