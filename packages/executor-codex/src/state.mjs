import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DelegationError } from "../../contracts/src/errors.mjs";
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
const STATE_KEYS = new Set([
  "schemaVersion", "taskId", "lifecycleState", "hostInstanceId", "executorThreadId",
  "profileName", "profileFingerprint", "capsuleBaseline", "contextManifestFingerprint",
  "privateControlFingerprint", "resultIdentity", "workerSensitiveGrantFingerprint",
  "validationSensitiveGrantFingerprint", "correctionSequence", "stateRevision", "integrity"
]);
const SENSITIVE_GRANT_FIELDS = {
  worker: "workerSensitiveGrantFingerprint",
  validation: "validationSensitiveGrantFingerprint"
};
const MAX_CORRECTION_SEQUENCE = 1_000_000;

function nonemptyString(value) {
  return typeof value === "string" && value.trim().length > 0 && !value.includes("\0");
}

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function integrityRoot(statePath) {
  return path.join(path.dirname(path.dirname(statePath)), ".agent-delegation-integrity");
}

function integrityKeyPath(statePath) {
  const task = createHash("sha256").update(path.resolve(path.dirname(statePath))).digest("hex");
  return path.join(integrityRoot(statePath), `${task}.key`);
}

async function loadIntegrityKey(statePath, { create = false } = {}) {
  const root = integrityRoot(statePath);
  const keyPath = integrityKeyPath(statePath);
  if (create) await mkdir(root, { recursive: true, mode: 0o700 });
  if (create) {
    try {
      await writeFile(keyPath, randomBytes(32), { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  let info;
  try {
    info = await lstat(keyPath);
  } catch {
    throw new DelegationError("task_state_unavailable", "Host lifecycle integrity key is unavailable.");
  }
  if (!info.isFile() || info.isSymbolicLink() || info.size !== 32 || (info.mode & 0o777) !== 0o600) {
    throw new DelegationError("task_state_unavailable", "Host lifecycle integrity key has an unsafe type, size, or mode.");
  }
  return readFile(keyPath);
}

function unsignedState(state) {
  const { integrity: ignored, ...unsigned } = state;
  void ignored;
  return unsigned;
}

function stateMac(state, key) {
  return `hmac-sha256:${createHmac("sha256", key).update(canonicalize(unsignedState(state))).digest("hex")}`;
}

function sensitiveGrantFingerprint(channel, values, key) {
  if (!Object.hasOwn(SENSITIVE_GRANT_FIELDS, channel) || !Array.isArray(values)) {
    throw new DelegationError("sensitive_grant_invalid", "Sensitive grant evidence is missing or malformed.");
  }
  const normalized = [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))].sort();
  return `hmac-sha256:${createHmac("sha256", key).update(canonicalize({ channel, values: normalized })).digest("hex")}`;
}

export function validateTaskState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new DelegationError("task_state_unavailable", "Task lifecycle state is missing or malformed.");
  }
  const unknown = Object.keys(state).filter((key) => !STATE_KEYS.has(key));
  const requiredStrings = ["taskId", "hostInstanceId", "profileName", "profileFingerprint", "capsuleBaseline", "privateControlFingerprint"];
  const optionalStrings = [
    "executorThreadId", "contextManifestFingerprint", "resultIdentity",
    "workerSensitiveGrantFingerprint", "validationSensitiveGrantFingerprint"
  ];
  if (
    unknown.length > 0 ||
    state.schemaVersion !== "1.0.0" ||
    !Object.hasOwn(TRANSITIONS, state.lifecycleState) ||
    requiredStrings.some((key) => !nonemptyString(state[key])) ||
    optionalStrings.some((key) => state[key] !== null && !nonemptyString(state[key])) ||
    [state.workerSensitiveGrantFingerprint, state.validationSensitiveGrantFingerprint]
      .some((value) => value !== null && !/^hmac-sha256:[a-f0-9]{64}$/u.test(value)) ||
    !Number.isSafeInteger(state.correctionSequence) ||
    state.correctionSequence < 0 ||
    state.correctionSequence > MAX_CORRECTION_SEQUENCE ||
    !Number.isSafeInteger(state.stateRevision) ||
    state.stateRevision < 0 ||
    typeof state.integrity !== "string" ||
    !/^hmac-sha256:[a-f0-9]{64}$/u.test(state.integrity)
  ) {
    throw new DelegationError("task_state_unavailable", "Task lifecycle state failed schema validation.");
  }
  return state;
}

async function persist(statePath, state, { exclusive = false, expectedRevision = undefined } = {}) {
  const key = await loadIntegrityKey(statePath, { create: exclusive });
  const signed = { ...state, integrity: stateMac(state, key) };
  validateTaskState(signed);
  if (exclusive) {
    await writeFile(statePath, `${JSON.stringify(signed, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await chmod(statePath, 0o600);
    return signed;
  }
  if (expectedRevision !== undefined) {
    const current = await readTaskStateUnlocked(statePath);
    if (current.stateRevision !== expectedRevision) {
      throw new DelegationError("task_state_conflict", "Task lifecycle changed before the state update could commit.");
    }
  }
  const temporary = `${statePath}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(signed, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  await rename(temporary, statePath);
  await chmod(statePath, 0o600);
  return signed;
}

async function readTaskStateUnlocked(statePath) {
  let state;
  try {
    state = JSON.parse(await readFile(statePath, "utf8"));
  } catch {
    throw new DelegationError("task_state_unavailable", "Task lifecycle state is missing or malformed.");
  }
  validateTaskState(state);
  const key = await loadIntegrityKey(statePath);
  const expected = Buffer.from(stateMac(state, key));
  const actual = Buffer.from(state.integrity);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new DelegationError("task_state_unavailable", "Task lifecycle state failed host integrity verification.");
  }
  return state;
}

async function withTaskStateLock(statePath, operation) {
  const lockRoot = path.join(integrityRoot(statePath), "locks");
  await mkdir(lockRoot, { recursive: true, mode: 0o700 });
  const lockPath = path.join(lockRoot, `${path.basename(integrityKeyPath(statePath), ".key")}.lock`);
  let handle;
  let lockIdentity;
  try {
    handle = await open(lockPath, "wx", 0o600);
    lockIdentity = await handle.stat();
    try {
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`);
    } catch (error) {
      await handle.close().catch(() => {});
      await rm(lockPath, { force: true }).catch(() => {});
      throw error;
    }
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new DelegationError("task_state_busy", "Task lifecycle state is being updated by another host action.");
    }
    throw error;
  }
  try {
    return await operation();
  } finally {
    await handle.close().catch(() => {});
    const current = await lstat(lockPath).catch(() => null);
    if (current && current.dev === lockIdentity.dev && current.ino === lockIdentity.ino) {
      await rm(lockPath, { force: true }).catch(() => {});
    }
  }
}

async function transitionUnlocked(statePath, state, next, updates = {}) {
  if (!TRANSITIONS[state.lifecycleState]?.has(next)) {
    throw new DelegationError("invalid_lifecycle_transition", `Cannot transition task from ${state.lifecycleState} to ${next}.`);
  }
  const updated = { ...state, ...updates, lifecycleState: next, stateRevision: state.stateRevision + 1 };
  return persist(statePath, updated, { expectedRevision: state.stateRevision });
}

function assertCorrectionIdentityValue(state, identity) {
  const dimensions = [
    ["taskId", identity.taskId],
    ["profileFingerprint", identity.profileFingerprint],
    ["capsuleBaseline", identity.capsuleBaseline],
    ["resultIdentity", identity.priorResultIdentity]
  ];
  if (state.contextManifestFingerprint !== null && state.contextManifestFingerprint !== undefined) {
    dimensions.push(["contextManifestFingerprint", identity.contextManifestFingerprint]);
  }
  const mismatches = dimensions.filter(([field, value]) => state[field] !== value).map(([field]) => field);
  if (mismatches.length > 0 || !state.executorThreadId) {
    throw new DelegationError("resume_identity_mismatch", `Correction resume identity mismatch: ${mismatches.join(", ") || "executorThreadId"}.`);
  }
  return state;
}

export async function createTaskState({ capsule, profile, hostInstanceId }) {
  if (typeof hostInstanceId !== "string" || hostInstanceId.trim().length === 0) {
    throw new DelegationError("host_instance_required", "A distinct coordinating-host instance identity is required.");
  }
  if (!nonemptyString(capsule.privateControlBaseline?.fingerprint)) {
    throw new DelegationError("task_state_unavailable", "Private control baseline identity is required before task lifecycle creation.");
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
    contextManifestFingerprint: capsule.contextManifestFingerprint ?? null,
    privateControlFingerprint: capsule.privateControlBaseline.fingerprint,
    resultIdentity: null,
    workerSensitiveGrantFingerprint: null,
    validationSensitiveGrantFingerprint: null,
    correctionSequence: 0,
    stateRevision: 0,
    integrity: "hmac-sha256:0000000000000000000000000000000000000000000000000000000000000000"
  };
  const persistedState = await persist(statePath, state, { exclusive: true });
  return { statePath, state: persistedState };
}

export async function readTaskState(statePath) {
  return readTaskStateUnlocked(statePath);
}

export async function transitionTaskState(statePath, next, updates = {}) {
  return withTaskStateLock(statePath, async () => {
    const state = await readTaskStateUnlocked(statePath);
    return transitionUnlocked(statePath, state, next, updates);
  });
}

export async function bindTaskSensitiveGrant(statePath, channel, values) {
  const field = SENSITIVE_GRANT_FIELDS[channel];
  if (!field) throw new DelegationError("sensitive_grant_invalid", "Sensitive grant channel is unsupported.");
  return withTaskStateLock(statePath, async () => {
    const state = await readTaskStateUnlocked(statePath);
    const key = await loadIntegrityKey(statePath);
    const fingerprint = sensitiveGrantFingerprint(channel, values, key);
    if (state[field] !== null) {
      return { consistent: state[field] === fingerprint, fingerprint: state[field], state };
    }
    const updated = await persist(statePath, {
      ...state,
      [field]: fingerprint,
      stateRevision: state.stateRevision + 1
    }, { expectedRevision: state.stateRevision });
    return { consistent: true, fingerprint, state: updated };
  });
}

export async function taskSensitiveGrantMatches(statePath, channel, values) {
  const field = SENSITIVE_GRANT_FIELDS[channel];
  if (!field) throw new DelegationError("sensitive_grant_invalid", "Sensitive grant channel is unsupported.");
  const state = await readTaskStateUnlocked(statePath);
  if (state[field] === null) return false;
  const key = await loadIntegrityKey(statePath);
  return state[field] === sensitiveGrantFingerprint(channel, values, key);
}

export async function transitionTaskStateMatching(statePath, next, expected, updates = {}) {
  const allowed = new Set([
    "taskId", "lifecycleState", "stateRevision", "correctionSequence",
    "resultIdentity", "privateControlFingerprint"
  ]);
  if (!expected || typeof expected !== "object" || Array.isArray(expected) || Object.keys(expected).some((key) => !allowed.has(key))) {
    throw new DelegationError("review_identity_mismatch", "Terminal state expectations are missing or malformed.");
  }
  return withTaskStateLock(statePath, async () => {
    const state = await readTaskStateUnlocked(statePath);
    const mismatches = Object.entries(expected)
      .filter(([key, value]) => state[key] !== value)
      .map(([key]) => key);
    if (mismatches.length > 0) {
      throw new DelegationError("stale_review", `Review no longer matches current task state: ${mismatches.join(", ")}.`);
    }
    return transitionUnlocked(statePath, state, next, updates);
  });
}

export async function recordWorkerResult(statePath, { threadId, result }) {
  return withTaskStateLock(statePath, async () => {
    const state = await readTaskStateUnlocked(statePath);
    if (typeof threadId !== "string" || threadId.trim().length === 0 || threadId === state.hostInstanceId) {
      throw new DelegationError("executor_identity_unavailable", "A distinct delegated Codex thread identity was not evidenced.");
    }
    if (state.executorThreadId !== null && state.executorThreadId !== threadId) {
      throw new DelegationError("executor_identity_mismatch", "The delegated Codex thread changed during the task lifecycle.");
    }
    return transitionUnlocked(statePath, state, "awaiting_review", {
      executorThreadId: threadId,
      resultIdentity: resultIdentity(result)
    });
  });
}

export async function assertCorrectionIdentity(statePath, identity) {
  return assertCorrectionIdentityValue(await readTaskStateUnlocked(statePath), identity);
}

export async function authorizeCorrection(statePath, identity) {
  return withTaskStateLock(statePath, async () => {
    const state = assertCorrectionIdentityValue(await readTaskStateUnlocked(statePath), identity);
    if (state.correctionSequence >= MAX_CORRECTION_SEQUENCE) {
      throw new DelegationError("correction_sequence_exhausted", "Correction sequence limit has been reached.");
    }
    return transitionUnlocked(statePath, state, "correction_requested", {
      correctionSequence: state.correctionSequence + 1
    });
  });
}

export function opaqueTaskMetricId(taskId) {
  return createHash("sha256").update(taskId).digest("hex").slice(0, 16);
}

export async function removeTaskIntegrityAnchor(statePath) {
  await rm(integrityKeyPath(statePath), { force: true });
}
