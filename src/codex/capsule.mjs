import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readlink,
  realpath,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertContextManifestIdentity, planDelegationContext } from "../context/planner.mjs";
import { DelegationError } from "../errors.mjs";
import { getCommittedDiffPaths, getHead, getStatusPaths } from "../git.mjs";
import { evaluatePathScope, globToRegExp, normalizeRelativePath } from "../path-policy.mjs";
import { runProcess } from "../process.mjs";

const PRIVATE_SEGMENTS = new Set([".git", ".pi", ".codex", ".ssh", "node_modules"]);
const PRIVATE_FILES = /^(?:\.env(?:\..*)?|auth\.json|credentials?(?:\..*)?|secrets?(?:\..*)?)$/i;
const GLOB_CHARACTER = /[*?[\]]/;
const EXECUTOR_CAPSULE_ROOT = process.platform === "win32"
  ? "C:\\agent-delegation\\capsule"
  : "/agent-delegation/capsule";

async function updateFileHash(hash, absolute, before) {
  await new Promise((resolve, reject) => {
    const stream = createReadStream(absolute);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  const after = await lstat(absolute);
  if (
    after.size !== before.size ||
    after.mtimeMs !== before.mtimeMs ||
    after.ino !== before.ino ||
    !after.isFile()
  ) {
    throw new DelegationError("source_state_unstable", "Source workspace changed while its private state fingerprint was collected.");
  }
}

async function sourceStateFingerprint(root, statusPaths) {
  const hash = createHash("sha256");
  for (const relative of [...statusPaths].sort()) {
    const absolute = path.resolve(root, relative);
    hash.update(`path:${relative}\0`);
    let info;
    try {
      info = await lstat(absolute);
    } catch (error) {
      if (error?.code === "ENOENT") {
        hash.update("missing\0");
        continue;
      }
      throw new DelegationError("source_state_unreadable", "Source workspace state cannot be fingerprinted safely.");
    }
    hash.update(`mode:${info.mode & 0o7777}\0size:${info.size}\0`);
    try {
      if (info.isSymbolicLink()) {
        hash.update(`symlink:${await readlink(absolute)}\0`);
      } else if (info.isFile()) {
        hash.update("file:\0");
        await updateFileHash(hash, absolute, info);
        hash.update("\0");
      } else {
        hash.update("other\0");
      }
    } catch (error) {
      if (error instanceof DelegationError) throw error;
      throw new DelegationError("source_state_unreadable", "Source workspace state cannot be fingerprinted safely.");
    }
  }
  return `sha256:${hash.digest("hex")}`;
}

function safeTaskName(taskId) {
  return taskId.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 48) || "task";
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isPrivate(relative) {
  const parts = relative.split("/");
  return parts.some((part) => PRIVATE_SEGMENTS.has(part.toLowerCase()) || PRIVATE_FILES.test(part));
}

async function rejectSymlinkComponents(root, relative) {
  let current = root;
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink()) {
      throw new DelegationError("unsafe_capsule_input", `Readable input contains a symlink component: ${relative}.`);
    }
  }
}

async function fileMetadata(root, relative, forbiddenPatterns) {
  if (GLOB_CHARACTER.test(relative)) {
    throw new DelegationError("unsafe_capsule_input", `Readable inputs must be literal paths: ${relative}.`);
  }
  if (isPrivate(relative) || forbiddenPatterns.some((pattern) => pattern.test(relative))) {
    throw new DelegationError("unsafe_capsule_input", `Readable input is private or forbidden: ${relative}.`);
  }
  const absolute = path.resolve(root, relative);
  let resolved;
  try {
    await rejectSymlinkComponents(root, relative);
    resolved = await realpath(absolute);
  } catch (error) {
    if (error instanceof DelegationError) throw error;
    throw new DelegationError("capsule_input_missing", `Readable input does not exist: ${relative}.`);
  }
  if (!isInside(root, resolved)) throw new DelegationError("unsafe_capsule_input", `Readable input escapes the repository: ${relative}.`);
  const info = await stat(resolved);
  if (!info.isFile()) throw new DelegationError("unsafe_capsule_input", `Readable input must be a regular file: ${relative}.`);
  const content = await readFile(resolved);
  return {
    relative,
    absolute: resolved,
    mode: info.mode & 0o777,
    sha256: createHash("sha256").update(content).digest("hex"),
    bytes: content.byteLength
  };
}

function exposureFor(envelope, profile) {
  const mode = envelope.execution?.exposureMode ?? "sanitized";
  if (mode === "trusted-worktree" && envelope.execution?.trustedWorktreeAcknowledged !== true) {
    throw new DelegationError(
      "trusted_worktree_not_acknowledged",
      "trusted-worktree requires explicit acknowledgement that it exposes the broader checkout and is not an operating-system sandbox."
    );
  }
  if (profile.external && envelope.execution?.exposureMode === undefined) return "sanitized";
  return mode;
}

async function checkedGit(args, cwd, options = {}) {
  const result = await runProcess("git", args, { cwd, timeoutMs: 30_000, ...options });
  if (result.exitCode !== 0) throw new DelegationError("capsule_git_error", `Capsule Git command failed: git ${args.join(" ")}.`);
  return result;
}

export async function preflightCapsule({ envelope, repository, profile, stateRoot, workerResultSchemaPath }) {
  const mode = exposureFor(envelope, profile);
  const requestedStateRoot = stateRoot ?? os.tmpdir();
  if (!path.isAbsolute(requestedStateRoot)) throw new DelegationError("invalid_state_root", "State root must be absolute.");
  const resolvedStateRoot = path.resolve(requestedStateRoot);

  let schemaPath;
  try {
    schemaPath = await realpath(workerResultSchemaPath);
    if (!(await stat(schemaPath)).isFile()) throw new Error("not a file");
  } catch {
    throw new DelegationError("worker_schema_missing", "Codex worker result schema is unavailable.");
  }

  const contextManifest = envelope.contextPlanning
    ? await planDelegationContext(envelope, repository.gitRoot)
    : null;
  const readablePaths = contextManifest
    ? contextManifest.selectedFiles.map((item) => item.relativePath)
    : (envelope.scope.readablePaths ?? []).map((item) => normalizeRelativePath(item, "readable path"));
  const forbiddenPatterns = envelope.scope.forbiddenPaths.map(globToRegExp);
  const inputs = [];
  for (const relative of readablePaths) inputs.push(await fileMetadata(repository.gitRoot, relative, forbiddenPatterns));
  if (contextManifest) {
    for (const input of inputs) {
      const planned = contextManifest.selectedFiles.find((item) => item.relativePath === input.relative);
      if (!planned || planned.sha256 !== input.sha256 || planned.bytes !== input.bytes) {
        throw new DelegationError("context_source_changed", "Selected context changed while the capsule was being preflighted.");
      }
    }
  }

  const head = await getHead(repository.gitRoot);
  if (mode === "trusted-worktree" && !head) {
    throw new DelegationError("trusted_worktree_requires_head", "trusted-worktree requires a committed Git HEAD.");
  }

  const sourceStatus = await getStatusPaths(repository.gitRoot);
  const sourceStateFingerprintValue = await sourceStateFingerprint(repository.gitRoot, sourceStatus);
  const [headAfterFingerprint, statusAfterFingerprint] = await Promise.all([
    getHead(repository.gitRoot),
    getStatusPaths(repository.gitRoot)
  ]);
  if (headAfterFingerprint !== head || JSON.stringify(statusAfterFingerprint) !== JSON.stringify(sourceStatus)) {
    throw new DelegationError("source_state_unstable", "Source workspace changed during capsule preflight.");
  }

  return {
    mode,
    stateRoot: resolvedStateRoot,
    schemaPath,
    inputs,
    contextManifest,
    sourceHead: head,
    sourceStatus,
    sourceStateFingerprint: sourceStateFingerprintValue
  };
}

async function writeControlFiles(taskRoot, envelope, schemaPath, contextManifest) {
  const controlRoot = path.join(taskRoot, "control");
  await mkdir(controlRoot, { recursive: true, mode: 0o700 });
  const envelopePath = path.join(controlRoot, "task-envelope.json");
  const resultSchemaPath = path.join(controlRoot, "codex-worker-result.schema.json");
  const contextManifestPath = contextManifest ? path.join(controlRoot, "context-manifest.json") : null;
  await writeFile(envelopePath, `${JSON.stringify(envelope, null, 2)}\n`, { mode: 0o600 });
  await copyFile(schemaPath, resultSchemaPath);
  await chmod(resultSchemaPath, 0o600);
  if (contextManifestPath) {
    await writeFile(contextManifestPath, `${JSON.stringify(contextManifest, null, 2)}\n`, { mode: 0o600 });
    await chmod(contextManifestPath, 0o600);
  }
  return { controlRoot, envelopePath, resultSchemaPath, contextManifestPath };
}

function containsSourceRoot(value, sourceRoots) {
  if (typeof value === "string") {
    const candidate = value.toLowerCase();
    return sourceRoots.some((sourceRoot) => candidate.includes(sourceRoot.toLowerCase()));
  }
  if (Array.isArray(value)) return value.some((item) => containsSourceRoot(item, sourceRoots));
  if (value && typeof value === "object") {
    return Object.values(value).some((item) => containsSourceRoot(item, sourceRoots));
  }
  return false;
}

export function projectExecutorEnvelope(envelope, sourceRoot) {
  const projection = {
    ...envelope,
    repository: {
      root: EXECUTOR_CAPSULE_ROOT,
      workingDirectory: ".",
      dirtyTree: { allow: false, acknowledgedPaths: [] }
    }
  };
  const sourceRoots = [...new Set([sourceRoot, envelope.repository.root].filter(Boolean))];
  if (containsSourceRoot(projection, sourceRoots)) {
    throw new DelegationError(
      "unsafe_executor_envelope",
      "The sanitized executor envelope still contains the host source root."
    );
  }
  return projection;
}

async function copyCapsuleControls(capsuleRoot, control, envelope, sourceRoot) {
  const destinationRoot = path.join(capsuleRoot, ".agent-delegation");
  await mkdir(destinationRoot, { recursive: true, mode: 0o700 });
  const envelopeDestination = path.join(destinationRoot, "task-envelope.json");
  const schemaDestination = path.join(destinationRoot, "codex-worker-result.schema.json");
  const contextManifestDestination = control.contextManifestPath
    ? path.join(destinationRoot, "context-manifest.json")
    : null;
  const executorEnvelope = projectExecutorEnvelope(envelope, sourceRoot);
  await writeFile(envelopeDestination, `${JSON.stringify(executorEnvelope, null, 2)}\n`, { mode: 0o600 });
  await copyFile(control.resultSchemaPath, schemaDestination);
  await chmod(envelopeDestination, 0o600);
  await chmod(schemaDestination, 0o600);
  if (contextManifestDestination) {
    await copyFile(control.contextManifestPath, contextManifestDestination);
    await chmod(contextManifestDestination, 0o600);
  }
  return { contextManifestDestination };
}

async function prepareSanitized(preflight, taskRoot, control, envelope, sourceRoot) {
  const capsuleRoot = path.join(taskRoot, "capsule");
  await mkdir(capsuleRoot, { recursive: true, mode: 0o700 });
  for (const input of preflight.inputs) {
    const destination = path.join(capsuleRoot, input.relative);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await copyFile(input.absolute, destination);
    await chmod(destination, input.mode);
  }
  const copiedControls = await copyCapsuleControls(capsuleRoot, control, envelope, sourceRoot);
  await checkedGit(["init", "-b", "delegated-task"], capsuleRoot);
  await checkedGit(["add", "--", "."], capsuleRoot);
  const deterministicGitEnv = {
    ...process.env,
    GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
    GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z"
  };
  await checkedGit([
    "-c", "user.name=Agent Delegation Kit",
    "-c", "user.email=agent-delegation-kit@example.invalid",
    "commit", "--allow-empty", "-m", "delegation: capsule baseline"
  ], capsuleRoot, { env: deterministicGitEnv });
  const baseline = (await checkedGit(["rev-parse", "HEAD"], capsuleRoot)).stdout.trim();
  return { capsuleRoot, baseline, executorContextManifestPath: copiedControls.contextManifestDestination };
}

async function prepareTrusted(preflight, repository, taskRoot) {
  const capsuleRoot = path.join(taskRoot, "worktree");
  await checkedGit(["worktree", "add", "--detach", capsuleRoot, preflight.sourceHead], repository.gitRoot);
  return { capsuleRoot, baseline: preflight.sourceHead };
}

export async function prepareCapsule(options) {
  const preflight = await preflightCapsule(options);
  await mkdir(preflight.stateRoot, { recursive: true, mode: 0o700 });
  const taskRoot = path.join(preflight.stateRoot, `adk-${safeTaskName(options.envelope.taskId)}-${randomUUID()}`);
  await mkdir(taskRoot, { mode: 0o700 });
  const control = await writeControlFiles(taskRoot, options.envelope, preflight.schemaPath, preflight.contextManifest);
  let prepared;
  try {
    prepared = preflight.mode === "trusted-worktree"
      ? await prepareTrusted(preflight, options.repository, taskRoot)
      : await prepareSanitized(
        preflight,
        taskRoot,
        control,
        options.envelope,
        options.repository.gitRoot
      );
  } catch (error) {
    await rm(taskRoot, { recursive: true, force: true });
    throw error;
  }
  const inputMetadata = preflight.inputs.map(({ relative, mode, sha256, bytes }) => ({ path: relative, mode, sha256, bytes }));
  const marker = {
    schemaVersion: "1.0.0",
    taskId: options.envelope.taskId,
    mode: preflight.mode,
    capsuleRoot: prepared.capsuleRoot,
    sourceRoot: options.repository.gitRoot,
    sourceHead: preflight.sourceHead,
    sourceStatus: preflight.sourceStatus,
    sourceStateFingerprint: preflight.sourceStateFingerprint,
    inputMetadata,
    contextManifestFingerprint: preflight.contextManifest?.fingerprint ?? null
  };
  const markerPath = path.join(taskRoot, "capsule.json");
  await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600 });
  return {
    ...prepared,
    ...control,
    taskId: options.envelope.taskId,
    taskRoot,
    markerPath,
    mode: preflight.mode,
    sourceHead: preflight.sourceHead,
    sourceStatus: preflight.sourceStatus,
    sourceStateFingerprint: preflight.sourceStateFingerprint,
    contextManifest: preflight.contextManifest,
    contextManifestFingerprint: preflight.contextManifest?.fingerprint ?? null,
    inputMetadata
  };
}

async function readContextManifestFile(file) {
  let info;
  let parsed;
  try {
    info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("unsafe file type");
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw new DelegationError("context_manifest_missing", "Stored context manifest is missing or malformed.");
  }
  return assertContextManifestIdentity(parsed);
}

export async function verifyContextManifestIdentity(capsule, expectedFingerprint = capsule.contextManifestFingerprint) {
  if (expectedFingerprint === null || expectedFingerprint === undefined) return { verified: false, fingerprint: null };
  if (!capsule.contextManifestPath) {
    throw new DelegationError("context_manifest_missing", "Private context manifest is unavailable.");
  }
  const visiblePath = capsule.executorContextManifestPath
    ?? path.join(capsule.capsuleRoot, ".agent-delegation", "context-manifest.json");
  const [privateManifest, visibleManifest] = await Promise.all([
    readContextManifestFile(capsule.contextManifestPath),
    readContextManifestFile(visiblePath)
  ]);
  if (
    privateManifest.fingerprint !== expectedFingerprint ||
    visibleManifest.fingerprint !== expectedFingerprint
  ) {
    throw new DelegationError("context_manifest_mismatch", "Stored context manifest identity no longer matches the task.");
  }
  return { verified: true, fingerprint: expectedFingerprint };
}

export async function collectCandidateEvidence(capsule, scope) {
  const head = await getHead(capsule.capsuleRoot);
  const dirtyPaths = await getStatusPaths(capsule.capsuleRoot);
  const committedPaths = await getCommittedDiffPaths(capsule.capsuleRoot, capsule.baseline, head);
  const changedPaths = [...new Set([...dirtyPaths, ...committedPaths])].sort();
  const baselineConsistent = head === capsule.baseline;
  const scopeBreaches = evaluatePathScope(changedPaths, scope);
  if (!baselineConsistent) scopeBreaches.push("git:HEAD changed from capsule baseline");
  await checkedGit(["add", "-N", "--", "."], capsule.capsuleRoot);
  const patchResult = await checkedGit(["diff", "--binary", "--no-ext-diff", capsule.baseline], capsule.capsuleRoot);
  const candidatePatch = patchResult.stdout;
  const candidatePatchSha256 = candidatePatch.length === 0
    ? null
    : `sha256:${createHash("sha256").update(candidatePatch).digest("hex")}`;
  return { head, baselineConsistent, changedPaths, scopeBreaches: [...new Set(scopeBreaches)].sort(), candidatePatch, candidatePatchSha256 };
}

export async function verifySourceUnchanged(repository, capsule) {
  const [head, statusPaths] = await Promise.all([getHead(repository.gitRoot), getStatusPaths(repository.gitRoot)]);
  const sameStatus = JSON.stringify(statusPaths) === JSON.stringify(capsule.sourceStatus);
  const currentFingerprint = sameStatus
    ? await sourceStateFingerprint(repository.gitRoot, statusPaths)
    : null;
  const sameFingerprint = capsule.sourceStateFingerprint === undefined
    ? true
    : currentFingerprint === capsule.sourceStateFingerprint;
  return { unchanged: head === capsule.sourceHead && sameStatus && sameFingerprint, head, statusPaths };
}

export async function cleanupCapsule(capsule, repository) {
  const resolvedTaskRoot = await realpath(capsule.taskRoot);
  const marker = JSON.parse(await readFile(path.join(resolvedTaskRoot, "capsule.json"), "utf8"));
  if (marker.taskId !== capsule.taskId && capsule.taskId !== undefined) {
    throw new DelegationError("cleanup_refused", "Capsule marker does not match the requested task.");
  }
  if (capsule.mode === "trusted-worktree") {
    await checkedGit(["worktree", "remove", "--force", capsule.capsuleRoot], repository.gitRoot);
  }
  await rm(resolvedTaskRoot, { recursive: true, force: true });
}
