import { conciseOutput } from "./redact.mjs";
import { validateTaskEnvelope } from "./envelope.mjs";
import {
  collectGitState,
  enforceDirtyTreePolicy,
  getCommittedDiffPaths,
  resolveRepository
} from "./git.mjs";
import { evaluatePathScope } from "./path-policy.mjs";
import { runExecutor } from "./executor.mjs";
import { runProcess } from "./process.mjs";

function skippedValidations(commands, reason) {
  return commands.map((command) => ({
    id: command.id,
    argv: command.argv,
    status: "not_run",
    exitCode: null,
    output: "",
    reason
  }));
}

async function runValidations(commands, workingDirectory) {
  const results = [];
  for (const command of commands) {
    let processResult;
    try {
      processResult = await runProcess(command.argv[0], command.argv.slice(1), {
        cwd: workingDirectory,
        timeoutMs: command.timeoutMs ?? 120_000
      });
    } catch (error) {
      results.push({
        id: command.id,
        argv: command.argv,
        status: "not_run",
        exitCode: null,
        output: conciseOutput(error.message),
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
      output: conciseOutput(`${processResult.stdout}\n${processResult.stderr}`),
      reason: processResult.timedOut ? "timeout" : processResult.signal ? `signal:${processResult.signal}` : null
    });
  }
  return results;
}

function mergePaths(...collections) {
  return [...new Set(collections.flat())].sort();
}

export async function runDelegation(input, options = {}) {
  const envelope = validateTaskEnvelope(input);
  const repository = await resolveRepository(envelope.repository);
  const before = await collectGitState(repository.gitRoot);
  enforceDirtyTreePolicy(before, envelope.repository.dirtyTree);

  const executor = await runExecutor(envelope, {
    ...options,
    workingDirectory: repository.workingDirectory
  });

  let after = await collectGitState(repository.gitRoot);
  let committedPaths = await getCommittedDiffPaths(repository.gitRoot, before.head, after.head);
  let changedPaths = mergePaths(after.dirtyPaths, committedPaths);
  let breaches = evaluatePathScope(changedPaths, envelope.scope);
  if (before.head !== after.head) breaches.push("git:HEAD changed during delegated execution");
  if (before.branch !== after.branch) breaches.push("git:branch changed during delegated execution");
  breaches = [...new Set(breaches)].sort();

  let validations;
  if (breaches.length > 0) {
    validations = skippedValidations(envelope.validation, "scope_breach");
  } else if (executor.reportedStatus !== "completed") {
    validations = skippedValidations(envelope.validation, `executor_${executor.reportedStatus}`);
  } else {
    validations = await runValidations(envelope.validation, repository.workingDirectory);
    after = await collectGitState(repository.gitRoot);
    committedPaths = await getCommittedDiffPaths(repository.gitRoot, before.head, after.head);
    changedPaths = mergePaths(after.dirtyPaths, committedPaths);
    breaches = evaluatePathScope(changedPaths, envelope.scope);
    if (before.head !== after.head) breaches.push("git:HEAD changed during delegated execution");
    if (before.branch !== after.branch) breaches.push("git:branch changed during delegated execution");
    breaches = [...new Set(breaches)].sort();
  }

  const validationFailed = validations.some((item) => item.status !== "passed");
  let status;
  if (breaches.length > 0) status = "rejected";
  else if (executor.reportedStatus === "blocked") status = "blocked";
  else if (executor.reportedStatus !== "completed" || validationFailed) status = "failed";
  else status = "completed";

  const residualRisks = [...executor.residualRisks];
  if (before.dirtyPaths.length > 0) residualRisks.push("Target repository began with explicitly acknowledged uncommitted changes.");
  if (breaches.length > 0) residualRisks.push("Scope breach requires host review and explicit recovery instructions.");
  if (validationFailed) residualRisks.push("One or more required validations did not pass or were not run.");

  return {
    schemaVersion: "1.0.0",
    taskId: envelope.taskId,
    status,
    summary: status === "completed"
      ? "Executor completed the bounded task; host acceptance is still pending."
      : status === "rejected"
        ? "Execution was rejected by independent postflight checks."
        : executor.summary,
    baseline: {
      gitRoot: repository.gitRoot,
      branch: before.branch,
      headBefore: before.head,
      headAfter: after.head,
      dirtyPathsBefore: before.dirtyPaths
    },
    changedPaths,
    scope: {
      compliant: breaches.length === 0,
      breaches
    },
    validations,
    executor: {
      reportedStatus: executor.reportedStatus,
      exitCode: executor.exitCode,
      signal: executor.signal,
      summary: executor.summary
    },
    hostAcceptance: {
      status: "pending",
      eligible: status === "completed",
      decidedBy: null
    },
    residualRisks
  };
}
