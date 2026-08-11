import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { DelegationError } from "../errors.mjs";
import { minimalEnvironment } from "../environment.mjs";
import { getHead } from "../git.mjs";
import { runProcess } from "../process.mjs";
import { conciseOutput } from "../redact.mjs";
import { getCapsuleFilesystemChanges, getPrivateControlChanges } from "./capsule.mjs";

function readinessEnvironment(source, home, temporary) {
  return minimalEnvironment(source, { home, temporary });
}

function evidence(outcome, commands, mutationDetected = false) {
  return {
    outcome,
    commandCount: commands.length,
    passedCount: commands.filter((item) => item.status === "passed").length,
    failedCount: commands.filter((item) => item.status === "failed").length,
    mutationDetected,
    commands
  };
}

async function capsuleMutation(capsule) {
  const [head, changedPaths, privateControlPaths] = await Promise.all([
    getHead(capsule.capsuleRoot, capsule.gitControl),
    getCapsuleFilesystemChanges(capsule),
    getPrivateControlChanges(capsule)
  ]);
  return head !== capsule.baseline || changedPaths.length > 0 || privateControlPaths.length > 0;
}

export async function runCapsuleReadiness({ envelope, capsule }, options = {}) {
  const plan = envelope.contextPlanning;
  if (!plan || plan.readiness.length === 0) return evidence("not_configured", []);
  const runner = options.runProcess ?? runProcess;
  const environmentSource = options.environment ?? process.env;
  const home = path.join(capsule.taskRoot, "readiness-home");
  const temporary = path.join(capsule.taskRoot, "readiness-tmp");
  await mkdir(home, { recursive: true, mode: 0o700 });
  await mkdir(temporary, { recursive: true, mode: 0o700 });
  const env = readinessEnvironment(environmentSource, home, temporary);
  const commands = [];
  let mutationDetected = false;

  for (const command of plan.readiness) {
    const started = performance.now();
    let processResult;
    try {
      processResult = await runner(command.argv[0], command.argv.slice(1), {
        cwd: capsule.capsuleRoot,
        env,
        timeoutMs: command.timeoutMs
      });
    } catch (error) {
      commands.push({
        id: command.id,
        status: "failed",
        exitCode: null,
        durationMs: Math.round(performance.now() - started),
        summary: conciseOutput(error?.message ?? "Readiness command could not be started.", 2000),
        reason: "spawn_error"
      });
      break;
    }
    mutationDetected = await capsuleMutation(capsule);
    const truncated = processResult.stdoutTruncated || processResult.stderrTruncated;
    const passed = !processResult.timedOut && !processResult.signal && !truncated &&
      command.acceptableExitCodes.includes(processResult.exitCode) && !mutationDetected;
    commands.push({
      id: command.id,
      status: passed ? "passed" : "failed",
      exitCode: Number.isInteger(processResult.exitCode) ? processResult.exitCode : null,
      durationMs: Math.round(performance.now() - started),
      summary: conciseOutput(`${processResult.stdout ?? ""}\n${processResult.stderr ?? ""}`, 2000),
      reason: mutationDetected
        ? "capsule_mutation"
        : truncated
          ? "output_truncated"
        : processResult.timedOut
          ? "timeout"
          : processResult.signal
            ? `signal:${processResult.signal}`
            : passed ? null : "exit_code"
    });
    if (!passed) break;
  }

  const outcome = commands.length === plan.readiness.length && commands.every((item) => item.status === "passed")
    ? "passed"
    : "failed";
  const result = evidence(outcome, commands, mutationDetected);
  if (outcome !== "passed") {
    const reason = commands.at(-1)?.reason ?? "readiness_failed";
    throw new DelegationError(
      "context_readiness_failed",
      `Context readiness failed before worker invocation: ${reason}.`,
      { readiness: result, workerRequestCount: 0 }
    );
  }
  return result;
}

export async function persistReadinessEvidence(capsule, readiness) {
  const readinessPath = path.join(capsule.controlRoot, "readiness-evidence.json");
  await writeFile(readinessPath, `${JSON.stringify(readiness, null, 2)}\n`, { mode: 0o600 });
  await chmod(readinessPath, 0o600);
  return readinessPath;
}

export async function loadReadinessEvidence(capsule, options = {}) {
  try {
    const readiness = JSON.parse(await readFile(path.join(capsule.controlRoot, "readiness-evidence.json"), "utf8"));
    if (!readiness || typeof readiness !== "object" || typeof readiness.outcome !== "string") throw new Error("invalid evidence");
    return readiness;
  } catch {
    if (options.allowMissing === true) return evidence("not_configured", []);
    throw new DelegationError("readiness_evidence_missing", "Stored readiness evidence is missing or malformed.");
  }
}
