import { createHash } from "node:crypto";
import { DelegationError } from "../errors.mjs";
import { normalizeRelativePath } from "../path-policy.mjs";

const RESULT_KEYS = new Set([
  "schemaVersion", "taskId", "status", "summary", "changedFiles", "validations", "residualRisks", "blocking"
]);
const VALIDATION_KEYS = new Set(["id", "status", "summary"]);

function requireString(value, field, { empty = false } = {}) {
  if (typeof value !== "string" || (!empty && value.trim().length === 0)) {
    throw new DelegationError("malformed_worker_result", `${field} must be a ${empty ? "string" : "non-empty string"}.`);
  }
  return value;
}

function exactKeys(value, allowed, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DelegationError("malformed_worker_result", `${field} must be an object.`);
  }
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new DelegationError("malformed_worker_result", `${field} has unknown field(s): ${unknown.join(", ")}.`);
}

function stringArray(value, field, { paths = false } = {}) {
  if (!Array.isArray(value)) throw new DelegationError("malformed_worker_result", `${field} must be an array.`);
  const normalized = value.map((item, index) => {
    requireString(item, `${field}[${index}]`, { empty: paths === false });
    return paths ? normalizeRelativePath(item, `${field}[${index}]`) : item;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new DelegationError("malformed_worker_result", `${field} must not contain duplicates.`);
  }
  return normalized;
}

export function validateCodexWorkerResult(input, expectedTaskId) {
  exactKeys(input, RESULT_KEYS, "worker result");
  if (input.schemaVersion !== "1.0.0") throw new DelegationError("malformed_worker_result", "Worker result schemaVersion must be 1.0.0.");
  requireString(input.taskId, "worker result taskId");
  if (input.taskId !== expectedTaskId) throw new DelegationError("worker_task_mismatch", "Worker result taskId does not match the delegated task.");
  if (!["completed", "blocked", "failed"].includes(input.status)) throw new DelegationError("malformed_worker_result", "Worker result status is invalid.");
  requireString(input.summary, "worker result summary", { empty: true });
  const changedFiles = stringArray(input.changedFiles, "worker result changedFiles", { paths: true });
  if (!Array.isArray(input.validations)) throw new DelegationError("malformed_worker_result", "Worker result validations must be an array.");
  const validations = input.validations.map((entry, index) => {
    exactKeys(entry, VALIDATION_KEYS, `worker result validations[${index}]`);
    requireString(entry.id, `worker result validations[${index}].id`);
    if (!["passed", "failed", "not_run"].includes(entry.status)) throw new DelegationError("malformed_worker_result", `worker result validations[${index}].status is invalid.`);
    requireString(entry.summary, `worker result validations[${index}].summary`, { empty: true });
    return { id: entry.id, status: entry.status, summary: entry.summary };
  });
  const residualRisks = stringArray(input.residualRisks, "worker result residualRisks");
  if (input.blocking !== null) {
    exactKeys(input.blocking, new Set(["code", "message"]), "worker result blocking");
    requireString(input.blocking.code, "worker result blocking.code");
    requireString(input.blocking.message, "worker result blocking.message");
  }
  if (input.status === "completed" && input.blocking !== null) throw new DelegationError("malformed_worker_result", "A completed worker result cannot contain blocking details.");
  if (input.status !== "completed" && input.blocking === null) throw new DelegationError("malformed_worker_result", "A blocked or failed worker result requires blocking details.");
  return { ...input, changedFiles, validations, residualRisks };
}

export function failedWorkerResult(taskId, code, message) {
  return {
    schemaVersion: "1.0.0",
    taskId,
    status: "failed",
    summary: "The delegated Codex turn did not produce an acceptable structured result.",
    changedFiles: [],
    validations: [],
    residualRisks: ["Host-observed postflight evidence is still required."],
    blocking: { code, message }
  };
}

export function resultIdentity(result) {
  return `sha256:${createHash("sha256").update(JSON.stringify(result)).digest("hex")}`;
}
