import path from "node:path";
import { DelegationError } from "./errors.mjs";
import { normalizeRelativePath } from "./path-policy.mjs";

const TOP_LEVEL_KEYS = new Set([
  "schemaVersion",
  "taskId",
  "objective",
  "expectedOutcome",
  "repository",
  "scope",
  "instructions",
  "constraints",
  "validation",
  "requiredEvidence",
  "stopConditions",
  "resultFormat",
  "executionProfile",
  "execution"
]);
const REQUIRED_EVIDENCE = new Set([
  "git_preflight",
  "changed_paths",
  "validation_results",
  "executor_report"
]);
const REASONING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const CREDENTIAL_KEY = /(api.?key|access.?token|auth.?token|password|secret|credential)/i;
const CREDENTIAL_ARGUMENT = /^--?(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret|credential)(?:=|$)/i;

function requireObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DelegationError("invalid_envelope", `${field} must be an object.`);
  }
  return value;
}

function requireString(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DelegationError("invalid_envelope", `${field} must be a non-empty string.`);
  }
  return value;
}

function requireStringArray(value, field, { min = 0 } = {}) {
  if (!Array.isArray(value) || value.length < min) {
    throw new DelegationError("invalid_envelope", `${field} must contain at least ${min} item(s).`);
  }
  value.forEach((item, index) => requireString(item, `${field}[${index}]`));
  if (new Set(value).size !== value.length) {
    throw new DelegationError("invalid_envelope", `${field} must not contain duplicates.`);
  }
  return value;
}

function rejectCredentials(value, trail = []) {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (CREDENTIAL_KEY.test(key)) {
      throw new DelegationError(
        "credential_in_envelope",
        `Credential-like field is not allowed in the task envelope: ${[...trail, key].join(".")}.`
      );
    }
    rejectCredentials(nested, [...trail, key]);
  }
}

export function validateTaskEnvelope(input) {
  const envelope = requireObject(input, "envelope");
  const unknown = Object.keys(envelope).filter((key) => !TOP_LEVEL_KEYS.has(key));
  if (unknown.length > 0) {
    throw new DelegationError("invalid_envelope", `Unknown envelope field(s): ${unknown.join(", ")}.`);
  }
  if (envelope.schemaVersion !== "1.0.0") {
    throw new DelegationError("invalid_envelope", "schemaVersion must be 1.0.0.");
  }
  requireString(envelope.taskId, "taskId");
  requireString(envelope.objective, "objective");
  requireString(envelope.expectedOutcome, "expectedOutcome");

  const repository = requireObject(envelope.repository, "repository");
  const root = requireString(repository.root, "repository.root");
  if (!path.isAbsolute(root) && !path.win32.isAbsolute(root)) {
    throw new DelegationError("invalid_envelope", "repository.root must be absolute.");
  }
  normalizeRelativePath(requireString(repository.workingDirectory, "repository.workingDirectory"), "repository.workingDirectory");
  const dirtyTree = requireObject(repository.dirtyTree, "repository.dirtyTree");
  if (typeof dirtyTree.allow !== "boolean") {
    throw new DelegationError("invalid_envelope", "repository.dirtyTree.allow must be boolean.");
  }
  requireStringArray(dirtyTree.acknowledgedPaths, "repository.dirtyTree.acknowledgedPaths");
  dirtyTree.acknowledgedPaths.forEach((item) => normalizeRelativePath(item, "acknowledged dirty path"));

  const scope = requireObject(envelope.scope, "scope");
  requireStringArray(scope.allowedPaths, "scope.allowedPaths", { min: 1 });
  requireStringArray(scope.forbiddenPaths, "scope.forbiddenPaths");
  if (scope.readablePaths !== undefined) requireStringArray(scope.readablePaths, "scope.readablePaths");
  [...scope.allowedPaths, ...scope.forbiddenPaths, ...(scope.readablePaths ?? [])].forEach((item) => normalizeRelativePath(item, "scope pattern"));

  requireStringArray(envelope.instructions, "instructions", { min: 1 });
  requireStringArray(envelope.constraints, "constraints");
  requireStringArray(envelope.stopConditions, "stopConditions", { min: 1 });
  requireStringArray(envelope.requiredEvidence, "requiredEvidence", { min: 1 });
  for (const item of envelope.requiredEvidence) {
    if (!REQUIRED_EVIDENCE.has(item)) {
      throw new DelegationError("invalid_envelope", `Unsupported requiredEvidence value: ${item}.`);
    }
  }

  if (!Array.isArray(envelope.validation)) {
    throw new DelegationError("invalid_envelope", "validation must be an array.");
  }
  envelope.validation.forEach((entry, index) => {
    requireObject(entry, `validation[${index}]`);
    requireString(entry.id, `validation[${index}].id`);
    requireStringArray(entry.argv, `validation[${index}].argv`, { min: 1 });
    if (entry.argv.some((argument) => CREDENTIAL_ARGUMENT.test(argument))) {
      throw new DelegationError("credential_in_envelope", `validation[${index}].argv contains a credential-like argument.`);
    }
    if (entry.timeoutMs !== undefined && (!Number.isInteger(entry.timeoutMs) || entry.timeoutMs < 1 || entry.timeoutMs > 3_600_000)) {
      throw new DelegationError("invalid_envelope", `validation[${index}].timeoutMs is invalid.`);
    }
  });

  const resultFormat = requireObject(envelope.resultFormat, "resultFormat");
  if (resultFormat.schemaVersion !== "1.0.0") {
    throw new DelegationError("invalid_envelope", "resultFormat.schemaVersion must be 1.0.0.");
  }

  if (typeof envelope.executionProfile === "string") {
    requireString(envelope.executionProfile, "executionProfile");
  } else if (envelope.executionProfile !== undefined) {
    const profile = requireObject(envelope.executionProfile, "executionProfile");
    for (const key of Object.keys(profile)) {
      if (!["provider", "model", "reasoning"].includes(key)) {
        throw new DelegationError("invalid_envelope", `Unknown executionProfile field: ${key}.`);
      }
    }
    if (profile.provider !== undefined) requireString(profile.provider, "executionProfile.provider");
    if (profile.model !== undefined) requireString(profile.model, "executionProfile.model");
    if (profile.reasoning !== undefined && !REASONING_LEVELS.has(profile.reasoning)) {
      throw new DelegationError("invalid_envelope", "executionProfile.reasoning is invalid.");
    }
  }

  if (envelope.execution !== undefined) {
    const execution = requireObject(envelope.execution, "execution");
    for (const key of Object.keys(execution)) {
      if (!["timeoutMs", "exposureMode", "trustedWorktreeAcknowledged"].includes(key)) {
        throw new DelegationError("invalid_envelope", `Unknown execution field: ${key}.`);
      }
    }
    if (execution.timeoutMs !== undefined && (!Number.isInteger(execution.timeoutMs) || execution.timeoutMs < 1 || execution.timeoutMs > 3_600_000)) {
      throw new DelegationError("invalid_envelope", "execution.timeoutMs is invalid.");
    }
    if (execution.exposureMode !== undefined && !["sanitized", "trusted-worktree"].includes(execution.exposureMode)) {
      throw new DelegationError("invalid_envelope", "execution.exposureMode is invalid.");
    }
    if (execution.trustedWorktreeAcknowledged !== undefined && typeof execution.trustedWorktreeAcknowledged !== "boolean") {
      throw new DelegationError("invalid_envelope", "execution.trustedWorktreeAcknowledged must be boolean.");
    }
  }

  rejectCredentials(envelope);
  return envelope;
}
