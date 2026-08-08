import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateTaskEnvelope } from "../envelope.mjs";
import { collectGitState, enforceDirtyTreePolicy, resolveRepository } from "../git.mjs";
import { DelegationError } from "../errors.mjs";
import { cleanupCapsule, prepareCapsule } from "./capsule.mjs";
import { checkCodexCompatibility } from "./compatibility.mjs";
import { requireProviderCredential, resolveWorkerProfile } from "./profile.mjs";
import { checkRouterHealth } from "./router.mjs";
import {
  authorizeCorrection,
  createTaskState,
  readTaskState,
  recordWorkerResult,
  transitionTaskState
} from "./state.mjs";
import { runCodexWorker } from "./worker.mjs";

const DEFAULT_WORKER_SCHEMA = fileURLToPath(new URL("../../contracts/codex-worker-result.schema.json", import.meta.url));

export async function prepareCodexDelegation(input, options = {}) {
  const envelope = validateTaskEnvelope(input.envelope);
  if (typeof input.hostInstanceId !== "string" || input.hostInstanceId.trim().length === 0) {
    throw new DelegationError("host_instance_required", "A distinct coordinating-host instance identity is required.");
  }
  if (typeof envelope.executionProfile !== "string") {
    throw new DelegationError("worker_profile_required", "Codex delegation requires a named worker profile.");
  }
  const profile = resolveWorkerProfile(input.profileRegistry, envelope.executionProfile);
  const environment = options.environment ?? process.env;
  const providerCredential = requireProviderCredential(profile, environment);
  const compatibility = await checkCodexCompatibility(profile, {
    runProcess: options.compatibilityProcess,
    environment
  });
  const router = await checkRouterHealth(profile, { fetch: options.fetch });
  const repository = await resolveRepository(envelope.repository);
  const sourceState = await collectGitState(repository.gitRoot);
  enforceDirtyTreePolicy(sourceState, envelope.repository.dirtyTree);
  const capsule = await prepareCapsule({
    envelope,
    repository,
    profile,
    stateRoot: input.stateRoot,
    workerResultSchemaPath: input.workerResultSchemaPath ?? DEFAULT_WORKER_SCHEMA
  });
  let lifecycle;
  try {
    lifecycle = await createTaskState({ capsule, profile, hostInstanceId: input.hostInstanceId });
  } catch (error) {
    await cleanupCapsule(capsule, repository);
    throw error;
  }
  return { envelope, profile, compatibility, router, providerCredential, repository, sourceState, capsule, statePath: lifecycle.statePath };
}

export async function executeCodexDelegation(prepared, options = {}) {
  await transitionTaskState(prepared.statePath, "running");
  const execution = await runCodexWorker(prepared, options);
  try {
    const state = await recordWorkerResult(prepared.statePath, {
      threadId: execution.threadId,
      result: execution.workerResult
    });
    return { ...execution, state };
  } catch (error) {
    const current = await readTaskState(prepared.statePath);
    const state = current.lifecycleState === "running"
      ? await transitionTaskState(prepared.statePath, "failed")
      : current;
    return { ...execution, state, lifecycleError: { code: error.code ?? "lifecycle_error", message: error.message } };
  }
}

export async function correctCodexDelegation(prepared, correction, options = {}) {
  if (typeof correction?.prompt !== "string" || correction.prompt.trim().length === 0) {
    throw new DelegationError("invalid_correction", "A non-empty correction prompt is required.");
  }
  const environment = options.environment ?? process.env;
  requireProviderCredential(prepared.profile, environment);
  await checkCodexCompatibility(prepared.profile, { runProcess: options.compatibilityProcess, environment });
  await checkRouterHealth(prepared.profile, { fetch: options.fetch });
  const authorized = await authorizeCorrection(prepared.statePath, {
    taskId: correction.taskId,
    profileFingerprint: correction.profileFingerprint,
    capsuleBaseline: correction.capsuleBaseline,
    priorResultIdentity: correction.priorResultIdentity
  });
  await transitionTaskState(prepared.statePath, "running");
  const execution = await runCodexWorker({
    ...prepared,
    correction: {
      threadId: authorized.executorThreadId,
      sequence: authorized.correctionSequence,
      prompt: correction.prompt
    }
  }, options);
  const state = await recordWorkerResult(prepared.statePath, {
    threadId: execution.threadId,
    result: execution.workerResult
  });
  return { ...execution, state };
}

export async function loadCodexDelegation(taskRootInput, profileRegistry) {
  const taskRoot = await realpath(taskRootInput);
  let marker;
  try {
    marker = JSON.parse(await readFile(path.join(taskRoot, "capsule.json"), "utf8"));
  } catch {
    throw new DelegationError("task_state_unavailable", "Task capsule marker is missing or malformed.");
  }
  const statePath = path.join(taskRoot, "state.json");
  const state = await readTaskState(statePath);
  const envelope = validateTaskEnvelope(JSON.parse(await readFile(path.join(taskRoot, "control", "task-envelope.json"), "utf8")));
  if (marker.taskId !== state.taskId || state.taskId !== envelope.taskId) {
    throw new DelegationError("task_state_mismatch", "Task marker, lifecycle state, and envelope identities do not match.");
  }
  const profile = resolveWorkerProfile(profileRegistry, state.profileName);
  if (profile.fingerprint !== state.profileFingerprint) {
    throw new DelegationError("resume_identity_mismatch", "The current named profile does not match the stored profile fingerprint.");
  }
  const repository = await resolveRepository(envelope.repository);
  if (repository.gitRoot !== marker.sourceRoot) {
    throw new DelegationError("task_state_mismatch", "The stored source repository no longer matches the task marker.");
  }
  const capsuleRoot = await realpath(marker.capsuleRoot);
  const relativeCapsule = path.relative(taskRoot, capsuleRoot);
  if (relativeCapsule.startsWith("..") || path.isAbsolute(relativeCapsule)) {
    throw new DelegationError("task_state_mismatch", "The stored capsule is outside its task directory.");
  }
  const controlRoot = path.join(taskRoot, "control");
  const capsule = {
    taskId: state.taskId,
    taskRoot,
    markerPath: path.join(taskRoot, "capsule.json"),
    capsuleRoot,
    controlRoot,
    envelopePath: path.join(controlRoot, "task-envelope.json"),
    resultSchemaPath: path.join(controlRoot, "codex-worker-result.schema.json"),
    mode: marker.mode,
    baseline: state.capsuleBaseline,
    sourceHead: marker.sourceHead,
    sourceStatus: marker.sourceStatus
  };
  return { envelope, profile, repository, capsule, statePath };
}
