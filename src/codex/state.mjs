import { createHash, randomUUID } from "node:crypto";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { DelegationError } from "../errors.mjs";
import { resultIdentity } from "./result.mjs";

const TRANSITIONS = {
  prepared: new Set(["running", "failed", "abandoned"]),
  running: new Set(["awaiting_review", "failed"]),
  awaiting_review: new Set(["correction_requested", "accepted", "rejected", "abandoned"]),
  correction_requested: new Set(["running", "abandoned"]),
  accepted: new Set(),
  rejected: new Set(),
  abandoned: new Set(),
  failed: new Set()
};

async function persist(statePath, state) {
  const temporary = `${statePath}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, statePath);
  await chmod(statePath, 0o600);
}

export async function createTaskState({ capsule, profile, hostInstanceId }) {
  if (typeof hostInstanceId !== "string" || hostInstanceId.trim().length === 0) {
    throw new DelegationError("host_instance_required", "A distinct coordinating-host instance identity is required.");
  }
  const statePath = path.join(capsule.taskRoot, "state.json");
  const state = {
    schemaVersion: "1.0.0",
    taskId: capsule.taskId,
    lifecycleState: "prepared",
    hostInstanceId,
    executorThreadId: null,
    profileName: profile.name,
    profileFingerprint: profile.fingerprint,
    capsuleBaseline: capsule.baseline,
    resultIdentity: null,
    correctionSequence: 0
  };
  await persist(statePath, state);
  return { statePath, state };
}

export async function readTaskState(statePath) {
  let state;
  try {
    state = JSON.parse(await readFile(statePath, "utf8"));
  } catch {
    throw new DelegationError("task_state_unavailable", "Task lifecycle state is missing or malformed.");
  }
  return state;
}

export async function transitionTaskState(statePath, next, updates = {}) {
  const state = await readTaskState(statePath);
  if (!TRANSITIONS[state.lifecycleState]?.has(next)) {
    throw new DelegationError("invalid_lifecycle_transition", `Cannot transition task from ${state.lifecycleState} to ${next}.`);
  }
  const updated = { ...state, ...updates, lifecycleState: next };
  await persist(statePath, updated);
  return updated;
}

export async function recordWorkerResult(statePath, { threadId, result }) {
  const state = await readTaskState(statePath);
  if (typeof threadId !== "string" || threadId.trim().length === 0 || threadId === state.hostInstanceId) {
    throw new DelegationError("executor_identity_unavailable", "A distinct delegated Codex thread identity was not evidenced.");
  }
  if (state.executorThreadId !== null && state.executorThreadId !== threadId) {
    throw new DelegationError("executor_identity_mismatch", "The delegated Codex thread changed during the task lifecycle.");
  }
  const identity = resultIdentity(result);
  return transitionTaskState(statePath, "awaiting_review", {
    executorThreadId: threadId,
    resultIdentity: identity
  });
}

export async function authorizeCorrection(statePath, identity) {
  const state = await readTaskState(statePath);
  const mismatches = [
    ["taskId", identity.taskId],
    ["profileFingerprint", identity.profileFingerprint],
    ["capsuleBaseline", identity.capsuleBaseline],
    ["resultIdentity", identity.priorResultIdentity]
  ].filter(([field, value]) => state[field] !== value).map(([field]) => field);
  if (mismatches.length > 0 || !state.executorThreadId) {
    throw new DelegationError("resume_identity_mismatch", `Correction resume identity mismatch: ${mismatches.join(", ") || "executorThreadId"}.`);
  }
  return transitionTaskState(statePath, "correction_requested", {
    correctionSequence: state.correctionSequence + 1
  });
}

export function opaqueTaskMetricId(taskId) {
  return createHash("sha256").update(taskId).digest("hex").slice(0, 16);
}
