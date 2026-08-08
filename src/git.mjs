import { realpath } from "node:fs/promises";
import path from "node:path";
import { DelegationError } from "./errors.mjs";
import { normalizeRelativePath } from "./path-policy.mjs";
import { runProcess } from "./process.mjs";

async function runGit(args, cwd, { allowFailure = false } = {}) {
  const result = await runProcess("git", args, { cwd, timeoutMs: 30_000 });
  if (!allowFailure && result.exitCode !== 0) {
    throw new DelegationError("git_error", `Git command failed: git ${args.join(" ")}.`);
  }
  return result;
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function resolveRepository(repository) {
  let requestedRoot;
  try {
    requestedRoot = await realpath(repository.root);
  } catch {
    throw new DelegationError("repository_not_found", "repository.root does not resolve to an existing path.");
  }

  const rootResult = await runGit(["rev-parse", "--show-toplevel"], requestedRoot, { allowFailure: true });
  if (rootResult.exitCode !== 0) {
    throw new DelegationError("not_git_repository", "repository.root is not a Git repository.");
  }
  const gitRoot = await realpath(rootResult.stdout.trim());
  if (gitRoot !== requestedRoot) {
    throw new DelegationError("repository_root_mismatch", "repository.root must be the explicit Git root.");
  }

  let workingDirectory;
  try {
    workingDirectory = await realpath(path.resolve(gitRoot, repository.workingDirectory));
  } catch {
    throw new DelegationError("working_directory_not_found", "repository.workingDirectory does not exist.");
  }
  if (!isInside(gitRoot, workingDirectory)) {
    throw new DelegationError("working_directory_escape", "repository.workingDirectory resolves outside the Git root.");
  }

  return { gitRoot, workingDirectory };
}

export async function getHead(gitRoot) {
  const result = await runGit(["rev-parse", "HEAD"], gitRoot, { allowFailure: true });
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

export async function getBranch(gitRoot) {
  const result = await runGit(["symbolic-ref", "--quiet", "--short", "HEAD"], gitRoot, { allowFailure: true });
  return result.exitCode === 0 ? result.stdout.trim() : "detached";
}

export async function getStatusPaths(gitRoot) {
  const result = await runGit(["status", "--porcelain=v1", "-z", "--untracked-files=all"], gitRoot);
  const records = result.stdout.split("\0");
  const paths = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    const status = record.slice(0, 2);
    const candidate = record.slice(3);
    if (candidate) paths.push(normalizeRelativePath(candidate, "Git status path"));
    if (status.includes("R") || status.includes("C")) index += 1;
  }
  return [...new Set(paths)].sort();
}

export async function getCommittedDiffPaths(gitRoot, headBefore, headAfter) {
  if (!headBefore || !headAfter || headBefore === headAfter) return [];
  const result = await runGit(["diff", "--name-only", "-z", `${headBefore}..${headAfter}`], gitRoot);
  return result.stdout
    .split("\0")
    .filter(Boolean)
    .map((item) => normalizeRelativePath(item, "Git diff path"));
}

export async function collectGitState(gitRoot) {
  const [head, branch, dirtyPaths] = await Promise.all([
    getHead(gitRoot),
    getBranch(gitRoot),
    getStatusPaths(gitRoot)
  ]);
  return { head, branch, dirtyPaths };
}

export function enforceDirtyTreePolicy(state, dirtyTree) {
  if (state.dirtyPaths.length === 0) return;
  if (!dirtyTree.allow) {
    throw new DelegationError("dirty_tree", "Target repository has pre-existing uncommitted changes.", {
      paths: state.dirtyPaths
    });
  }
  const acknowledged = new Set(dirtyTree.acknowledgedPaths.map((item) => normalizeRelativePath(item)));
  const missing = state.dirtyPaths.filter((item) => !acknowledged.has(item));
  if (missing.length > 0) {
    throw new DelegationError("dirty_tree_unacknowledged", "Dirty-tree override does not acknowledge every pre-existing path.", {
      paths: missing
    });
  }
}
