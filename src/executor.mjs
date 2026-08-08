import { conciseOutput } from "./redact.mjs";
import { runProcess } from "./process.mjs";

const EXECUTOR_STATUSES = new Set(["completed", "blocked", "failed"]);

function findPayload(value, depth = 0) {
  if (depth > 8 || value === null || value === undefined) return null;
  if (typeof value === "string") {
    try {
      return findPayload(JSON.parse(value), depth + 1);
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) {
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const found = findPayload(value[index], depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === "object") {
    if (EXECUTOR_STATUSES.has(value.status) && typeof value.summary === "string") return value;
    for (const key of ["result", "message", "content", "text", "data"]) {
      const found = findPayload(value[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function parseExecutorPayload(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    const found = findPayload(JSON.parse(trimmed));
    if (found) return found;
  } catch {
    // Pi JSON mode may emit one JSON object per line.
  }
  const lines = trimmed.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const found = findPayload(JSON.parse(lines[index]));
      if (found) return found;
    } catch {
      // Keep searching earlier event lines.
    }
  }
  return null;
}

function buildPrompt(envelope) {
  return [
    "You are the Delegated Executor. Execute only within the following envelope.",
    "Stop with status blocked if information or authority is missing.",
    "Do not commit, push, widen scope, or expose credentials.",
    "Your final response must contain a JSON object with status (completed|blocked|failed), summary, and optional residualRisks.",
    JSON.stringify(envelope, null, 2)
  ].join("\n\n");
}

function buildPiArgs(envelope) {
  const args = [
    "--print",
    "--mode", "json",
    "--no-session",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--no-context-files",
    "--approve",
    "--tools", "read,bash,edit,write,grep,find,ls"
  ];
  const profile = envelope.executionProfile ?? {};
  if (profile.provider) args.push("--provider", profile.provider);
  if (profile.model) args.push("--model", profile.model);
  if (profile.reasoning) args.push("--thinking", profile.reasoning);
  args.push(buildPrompt(envelope));
  return args;
}

export async function runExecutor(envelope, options) {
  const command = options.executorCommand ?? "pi";
  let processResult;
  try {
    processResult = await runProcess(command, buildPiArgs(envelope), {
      cwd: options.workingDirectory,
      env: { ...process.env, ...(options.executorEnv ?? {}) },
      timeoutMs: envelope.execution?.timeoutMs ?? 900_000
    });
  } catch (error) {
    return {
      reportedStatus: "failed",
      summary: conciseOutput(`Executor could not start: ${error.message}`),
      residualRisks: [],
      exitCode: null,
      signal: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      output: ""
    };
  }

  const combinedOutput = conciseOutput(`${processResult.stdout}\n${processResult.stderr}`);
  if (processResult.timedOut) {
    return { reportedStatus: "failed", summary: "Executor timed out.", residualRisks: [], ...processResult, output: combinedOutput };
  }
  if (processResult.exitCode !== 0 || processResult.signal) {
    return { reportedStatus: "failed", summary: combinedOutput || "Executor process failed.", residualRisks: [], ...processResult, output: combinedOutput };
  }

  const payload = parseExecutorPayload(processResult.stdout);
  if (!payload) {
    return { reportedStatus: "malformed", summary: "Executor output did not contain the required structured result.", residualRisks: [], ...processResult, output: combinedOutput };
  }
  return {
    reportedStatus: payload.status,
    summary: conciseOutput(payload.summary),
    residualRisks: Array.isArray(payload.residualRisks) ? payload.residualRisks.map((item) => conciseOutput(item)) : [],
    ...processResult,
    output: combinedOutput
  };
}
