import { realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DelegationError } from "./errors.mjs";
import { minimalEnvironment } from "./environment.mjs";
import { normalizeRelativePath } from "./path-policy.mjs";
import { runProcess } from "./process.mjs";

function controlledArgs(args, gitControl) {
  return [
    ...(gitControl?.gitDir ? [`--git-dir=${gitControl.gitDir}`, `--work-tree=${gitControl.workTree}`] : []),
    "-c", "core.fsmonitor=false",
    "-c", `core.hooksPath=${os.devNull}`,
    ...args
  ];
}

async function runGit(args, cwd, { allowFailure = false, gitControl = undefined } = {}) {
  const env = minimalEnvironment(process.env, {
    grants: {
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: os.devNull,
      GIT_TERMINAL_PROMPT: "0",
      GIT_OPTIONAL_LOCKS: "0"
    }
  });
  const result = await runProcess("git", controlledArgs(args, gitControl), { cwd, env, timeoutMs: 30_000 });
  if (result.stdoutTruncated || result.stderrTruncated) {
    throw new DelegationError("git_output_truncated", `Git command output exceeded the evidence capture bound: git ${args.join(" ")}.`);
  }
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

export async function getHead(gitRoot, gitControl = undefined) {
  const result = await runGit(["rev-parse", "HEAD"], gitRoot, { allowFailure: true, gitControl });
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

export async function getBranch(gitRoot, gitControl = undefined) {
  const result = await runGit(["symbolic-ref", "--quiet", "--short", "HEAD"], gitRoot, { allowFailure: true, gitControl });
  return result.exitCode === 0 ? result.stdout.trim() : "detached";
}

export function parseStatusPaths(output) {
  const records = output.split("\0");
  const paths = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    const status = record.slice(0, 2);
    const candidate = record.slice(3);
    if (candidate) paths.push(normalizeRelativePath(candidate, "Git status path"));
    if (status.includes("R") || status.includes("C")) {
      const source = records[index + 1];
      if (!source) {
        throw new DelegationError("git_error", "Git status rename or copy record is incomplete.");
      }
      paths.push(normalizeRelativePath(source, "Git status source path"));
      index += 1;
    }
  }
  return [...new Set(paths)].sort();
}

export async function getStatusPaths(gitRoot, gitControl = undefined) {
  const result = await runGit(["status", "--porcelain=v1", "-z", "--untracked-files=all"], gitRoot, { gitControl });
  return parseStatusPaths(result.stdout);
}

export async function getCommittedDiffPaths(gitRoot, headBefore, headAfter, gitControl = undefined) {
  if (!headBefore || !headAfter || headBefore === headAfter) return [];
  const result = await runGit(["diff", "--name-only", "-z", `${headBefore}..${headAfter}`], gitRoot, { gitControl });
  return result.stdout
    .split("\0")
    .filter(Boolean)
    .map((item) => normalizeRelativePath(item, "Git diff path"));
}

export async function collectGitState(gitRoot, gitControl = undefined) {
  const [head, branch, dirtyPaths] = await Promise.all([
    getHead(gitRoot, gitControl),
    getBranch(gitRoot, gitControl),
    getStatusPaths(gitRoot, gitControl)
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
