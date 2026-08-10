import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { validateTaskEnvelope } from "../envelope.mjs";
import { DelegationError } from "../errors.mjs";
import { globToRegExp, normalizeRelativePath } from "../path-policy.mjs";
import { analyzeSource } from "./analyzer.mjs";
import { analyzeNodeEsm } from "./node-esm.mjs";

const PRIVATE_SEGMENTS = new Set([".git", ".pi", ".codex", ".ssh", "node_modules", "private", "credentials"]);
const PRIVATE_FILES = /^(?:\.env(?:\..*)?|auth\.json|credentials?(?:\..*)?|secrets?(?:\..*)?)$/iu;

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value) {
  return `sha256:${sha256(canonicalize(value))}`;
}

export function assertContextManifestIdentity(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw error("context_manifest_invalid", "Context manifest is missing or malformed.");
  }
  const { fingerprint: recorded, ...identityInput } = manifest;
  if (typeof recorded !== "string" || recorded !== fingerprint(identityInput)) {
    throw error("context_manifest_mismatch", "Context manifest fingerprint does not match its canonical contents.");
  }
  return manifest;
}

function relativePathFor(value) {
  return normalizeRelativePath(value, "relative path");
}

function matchesAny(relativePath, patterns) {
  return patterns.some((pattern) => globToRegExp(pattern).test(relativePath));
}

function isPrivatePath(relativePath) {
  const parts = relativePath.split("/");
  return parts.some((part) => PRIVATE_SEGMENTS.has(part.toLowerCase()) || PRIVATE_FILES.test(part));
}

function isRelativeSpecifier(specifier) {
  return specifier === "." || specifier === ".." || specifier.startsWith("./") || specifier.startsWith("../");
}

function isExternalSpecifier(specifier) {
  return specifier.startsWith("node:") || (!isRelativeSpecifier(specifier) && !path.posix.isAbsolute(specifier) && !path.win32.isAbsolute(specifier));
}

function error(code, message) {
  return new DelegationError(code, message);
}

function budgetError(limit, maximum, observed) {
  return new DelegationError(
    "context_budget_exceeded",
    `Context ${limit} budget would be exceeded.`,
    { limit, maximum, observed }
  );
}

function statIsSymlink(stat) {
  return typeof stat?.isSymbolicLink === "function" && stat.isSymbolicLink();
}

function statIsDirectory(stat) {
  return typeof stat?.isDirectory === "function" && stat.isDirectory();
}

function statIsFile(stat) {
  return typeof stat?.isFile === "function" && stat.isFile();
}

function isMissing(errorValue) {
  return errorValue?.code === "ENOENT" || errorValue?.code === "ENOTDIR";
}

function normalizeOptions(envelope, repositoryRootOrOptions, maybeOptions) {
  let repositoryRoot = envelope.repository.root;
  let options = maybeOptions ?? {};
  if (typeof repositoryRootOrOptions === "string") {
    repositoryRoot = repositoryRootOrOptions;
  } else if (repositoryRootOrOptions && typeof repositoryRootOrOptions === "object") {
    options = repositoryRootOrOptions;
    repositoryRoot = repositoryRootOrOptions.repositoryRoot ?? repositoryRootOrOptions.root ?? repositoryRoot;
  }
  const injected = options.fs ?? options.filesystem ?? options;
  return {
    repositoryRoot: path.resolve(repositoryRoot),
    lstat: injected.lstat ?? injected.stat ?? fs.lstat,
    readFile: injected.readFile ?? fs.readFile,
    analyze: options.analyze ?? analyzeNodeEsm
  };
}

async function assertSafeRegularFile(relativePath, repositoryRoot, lstat) {
  if (relativePath === "." || isPrivatePath(relativePath)) {
    throw error("context_private_path", `Private repository path is not eligible: ${relativePath}.`);
  }
  const absolute = path.resolve(repositoryRoot, ...relativePath.split("/"));
  const rootAbsolute = path.resolve(repositoryRoot);
  const relativeFromRoot = path.relative(rootAbsolute, absolute);
  if (relativeFromRoot.startsWith(`..${path.sep}`) || relativeFromRoot === ".." || path.isAbsolute(relativeFromRoot)) {
    throw error("context_path_escape", `Dependency path escapes the repository: ${relativePath}.`);
  }

  let current = rootAbsolute;
  let rootStat;
  try {
    rootStat = await lstat(current);
  } catch (cause) {
    if (isMissing(cause)) throw error("context_repository_missing", "Repository root is not available.");
    throw error("context_repository_unreadable", "Repository root cannot be inspected safely.");
  }
  if (statIsSymlink(rootStat)) throw error("context_symlink", "Repository root contains an unsafe symlink component.");
  for (const [index, segment] of relativePath.split("/").entries()) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = await lstat(current);
    } catch (cause) {
      if (isMissing(cause)) throw error("context_file_missing", `Required local file is missing: ${relativePath}.`);
      throw error("context_file_unreadable", `Required local file cannot be inspected: ${relativePath}.`);
    }
    if (statIsSymlink(stat)) throw error("context_symlink", `Symlink component is not eligible: ${relativePath}.`);
    if (index < relativePath.split("/").length - 1 && !statIsDirectory(stat)) {
      throw error("context_file_missing", `Required local file is missing: ${relativePath}.`);
    }
    if (index === relativePath.split("/").length - 1 && !statIsFile(stat)) {
      throw error("context_not_regular_file", `Required path is not a regular file: ${relativePath}.`);
    }
  }
  return absolute;
}

function dependencyPath(parent, specifier) {
  if (specifier.includes("\\") || specifier.includes("\0") || specifier.includes("?") || specifier.includes("#") || path.posix.isAbsolute(specifier) || path.win32.isAbsolute(specifier)) {
    throw error("context_path_escape", `Dependency specifier is not a safe repository-relative path from ${parent}.`);
  }
  const joined = path.posix.normalize(path.posix.join(path.posix.dirname(parent), specifier));
  if (joined === "." || joined.startsWith("../") || joined.includes("/../") || joined.endsWith("/..")) {
    throw error("context_path_escape", `Dependency path escapes the repository from ${parent}.`);
  }
  return relativePathFor(joined);
}

function reasonKey(reason) {
  return canonicalize(reason);
}

function sortReasons(reasons) {
  return [...reasons].sort((left, right) => {
    const a = reasonKey(left);
    const b = reasonKey(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

function sortReferences(references) {
  return [...references].sort((left, right) => {
    const a = canonicalize(left);
    const b = canonicalize(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

/**
 * Plan a provider-neutral dependency closure. This function only reads bytes,
 * tokenizes source, and hashes data; it never imports or executes a fixture.
 */
export async function planDelegationContext(envelope, repositoryRootOrOptions = undefined, maybeOptions = undefined) {
  if (!envelope || typeof envelope !== "object") throw error("invalid_envelope", "A validated task envelope is required.");
  validateTaskEnvelope(envelope);
  if (!envelope.contextPlanning) throw error("invalid_envelope", "contextPlanning authority is required.");
  const { repositoryRoot, lstat, readFile, analyze } = normalizeOptions(envelope, repositoryRootOrOptions, maybeOptions);
  const planning = envelope.contextPlanning;
  const scope = envelope.scope;
  const discoverable = scope.discoverablePaths ?? [];
  const forbidden = scope.forbiddenPaths ?? [];
  const readablePaths = (scope.readablePaths ?? []).map(relativePathFor);
  const seedPaths = planning.seeds.map(relativePathFor);
  const explicitPaths = [...readablePaths, ...seedPaths];
  const roots = [...new Set(explicitPaths)].sort();
  const reasons = new Map();
  const records = new Map();
  const externalReferences = new Map();
  const queue = [];
  let selectedBytes = 0;

  if (roots.length === 0) throw error("invalid_envelope", "At least one readable path or seed is required.");
  for (const root of roots) {
    if (isPrivatePath(root)) throw error("context_private_path", `Private repository path is not eligible: ${root}.`);
    const isReadable = readablePaths.includes(root);
    const isSeed = seedPaths.includes(root);
    if (!isReadable && isSeed && !matchesAny(root, discoverable)) {
      throw error("context_unauthorized", `Seed is outside discovery authority: ${root}.`);
    }
    if (matchesAny(root, forbidden)) throw error("context_forbidden_path", `Repository path is forbidden: ${root}.`);
    const rootReasons = [];
    if (isReadable) rootReasons.push({ kind: "explicit" });
    if (isSeed) rootReasons.push({ kind: "seed" });
    reasons.set(root, new Map(rootReasons.map((reason) => [reasonKey(reason), reason])));
    queue.push({ relativePath: root, depth: 0 });
  }

  const visited = new Set();
  while (queue.length > 0) {
    queue.sort((left, right) => left.depth - right.depth || left.relativePath.localeCompare(right.relativePath));
    const current = queue.shift();
    if (visited.has(current.relativePath)) continue;
    visited.add(current.relativePath);
    if (visited.size > planning.budget.maxFiles) {
      throw budgetError("maxFiles", planning.budget.maxFiles, visited.size);
    }
    const absolute = await assertSafeRegularFile(current.relativePath, repositoryRoot, lstat);
    let raw;
    try {
      raw = await readFile(absolute);
    } catch (cause) {
      if (isMissing(cause)) throw error("context_file_missing", `Required local file is missing: ${current.relativePath}.`);
      throw error("context_file_unreadable", `Required local file cannot be read: ${current.relativePath}.`);
    }
    const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    selectedBytes += bytes.byteLength;
    if (selectedBytes > planning.budget.maxBytes) {
      throw budgetError("maxBytes", planning.budget.maxBytes, selectedBytes);
    }
    records.set(current.relativePath, { sha256: sha256(bytes), bytes: bytes.byteLength });

    const extension = path.posix.extname(current.relativePath);
    if (extension !== ".js" && extension !== ".mjs") continue;
    const analyzed = analyzeSource(
      { relativePath: current.relativePath, source: bytes.toString("utf8") },
      analyze
    );
    if (!planning.analyzers.includes(analyzed.analyzer)) {
      throw error("invalid_analyzer_result", `Analyzer identity is not authorized for ${current.relativePath}.`);
    }
    for (const ref of analyzed.references) {
      const specifier = ref?.specifier;
      const kind = ref?.kind;
      if (typeof specifier !== "string" || specifier.length === 0) {
        throw error("context_unresolved_dependency", `Analyzer returned an unsafe reference from ${current.relativePath}.`);
      }
      if (kind === "unresolved" || ref.classification === "unresolved") {
        throw error("context_unresolved_dependency", `Unresolved dependency syntax in ${current.relativePath}.`);
      }
      if (isExternalSpecifier(specifier)) {
        const external = { from: current.relativePath, specifier };
        externalReferences.set(canonicalize(external), external);
        continue;
      }
      const child = dependencyPath(current.relativePath, specifier);
      if (isPrivatePath(child)) throw error("context_private_path", `Private repository path is not eligible: ${child}.`);
      if (matchesAny(child, forbidden)) throw error("context_forbidden_path", `Dependency is forbidden: ${child}.`);
      if (!matchesAny(child, discoverable)) throw error("context_unauthorized", `Dependency is outside discovery authority: ${child}.`);
      if (!visited.has(child) && current.depth + 1 > planning.budget.maxDepth) {
        throw budgetError("maxDepth", planning.budget.maxDepth, current.depth + 1);
      }
      const dependencyReason = { kind: "dependency", parent: current.relativePath, specifier };
      if (!reasons.has(child)) reasons.set(child, new Map());
      reasons.get(child).set(reasonKey(dependencyReason), dependencyReason);
      if (!visited.has(child)) queue.push({ relativePath: child, depth: current.depth + 1 });
    }
  }

  const selectedFiles = [...records.keys()].sort().map((relativePath) => ({
    relativePath,
    sha256: records.get(relativePath).sha256,
    bytes: records.get(relativePath).bytes,
    inclusionReasons: sortReasons([...reasons.get(relativePath).values()])
  }));
  const readiness = (planning.readiness ?? []).slice().sort((left, right) => left.id.localeCompare(right.id)).map((entry) => ({
    id: entry.id,
    commandFingerprint: fingerprint(entry.argv),
    timeoutMs: entry.timeoutMs,
    acceptableExitCodes: [...entry.acceptableExitCodes].sort((left, right) => left - right)
  }));
  const manifest = {
    schemaVersion: "1.0.0",
    strategy: "dependency-closure",
    analyzers: [...new Set(planning.analyzers)].sort(),
    selectedFiles,
    externalReferences: sortReferences([...externalReferences.values()]),
    unresolvedReferences: [],
    excludedReferences: [],
    totals: {
      selectedFiles: selectedFiles.length,
      selectedBytes,
      externalReferences: externalReferences.size,
      unresolvedReferences: 0,
      excludedReferences: 0
    },
    budget: { ...planning.budget },
    readiness,
    fingerprint: ""
  };
  const { fingerprint: ignoredFingerprint, ...fingerprintInput } = manifest;
  void ignoredFingerprint;
  manifest.fingerprint = fingerprint(fingerprintInput);
  return manifest;
}

export { canonicalize, fingerprint };
