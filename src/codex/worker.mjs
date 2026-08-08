import { access, chmod, lstat, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DelegationError } from "../errors.mjs";
import { runProcess } from "../process.mjs";
import { conciseOutput } from "../redact.mjs";
import { failedWorkerResult, validateCodexWorkerResult } from "./result.mjs";
import { workerEnvironment } from "./profile.mjs";

const SAFE_BASE_ENVIRONMENT = ["PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "TMPDIR", "SHELL", "SSL_CERT_FILE", "SSL_CERT_DIR"];

function safeBaseEnvironment(source) {
  return Object.fromEntries(SAFE_BASE_ENVIRONMENT.flatMap((name) => source[name] === undefined ? [] : [[name, source[name]]]));
}

async function linkIfPresent(source, destination) {
  try {
    await access(destination);
    return true;
  } catch {
    // The task home is new or this optional link has not been created yet.
  }
  try {
    await access(source);
  } catch {
    return false;
  }
  await symlink(source, destination);
  return true;
}

function tomlString(value) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")}"`;
}

export function directProviderConfig(profile) {
  if (!profile.provider) return null;
  return [
    `model = ${tomlString(profile.model)}`,
    `model_provider = ${tomlString(profile.provider.name)}`,
    'sandbox_mode = "workspace-write"',
    "",
    `[model_providers.${profile.provider.name}]`,
    `name = ${tomlString(profile.provider.name)}`,
    `base_url = ${tomlString(profile.provider.baseUrl)}`,
    `env_key = ${tomlString(profile.provider.credentialEnv)}`,
    `wire_api = ${tomlString(profile.provider.wireApi)}`,
    ""
  ].join("\n");
}

async function materializeDirectConfig(destination, expected, requireExisting = false) {
  let info;
  try {
    info = await lstat(destination);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (!info) {
    if (requireExisting) {
      throw new DelegationError("provider_config_drift", "The task-scoped direct provider configuration is missing.");
    }
    await writeFile(destination, expected, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await chmod(destination, 0o600);
    return;
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new DelegationError("provider_config_drift", "The task-scoped direct provider configuration has an unsafe file type.");
  }
  const actual = await readFile(destination, "utf8");
  if (actual !== expected) {
    throw new DelegationError("provider_config_drift", "The task-scoped direct provider configuration no longer matches the selected profile.");
  }
  if ((info.mode & 0o777) !== 0o600) {
    throw new DelegationError("provider_config_drift", "The task-scoped direct provider configuration permissions have drifted.");
  }
}

export async function prepareTaskCodexHome(capsule, profile, options = {}) {
  const codexHome = path.join(capsule.taskRoot, "codex-home");
  await mkdir(codexHome, { recursive: true, mode: 0o700 });
  if (profile.provider) {
    await materializeDirectConfig(
      path.join(codexHome, "config.toml"),
      directProviderConfig(profile),
      options.requireDirectConfig === true
    );
    return codexHome;
  }
  const sourceHome = path.resolve(options.sourceCodexHome ?? process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"));
  await linkIfPresent(path.join(sourceHome, "auth.json"), path.join(codexHome, "auth.json"));
  await linkIfPresent(path.join(sourceHome, "config.toml"), path.join(codexHome, "config.toml"));
  if (profile.codexProfile) {
    await linkIfPresent(
      path.join(sourceHome, `${profile.codexProfile}.config.toml`),
      path.join(codexHome, `${profile.codexProfile}.config.toml`)
    );
  }
  return codexHome;
}

function promptFor(envelope, correction) {
  const authority = [
    `Task ID: ${envelope.taskId}`,
    `Objective: ${envelope.objective}`,
    `Expected outcome: ${envelope.expectedOutcome}`,
    `Allowed output paths: ${envelope.scope.allowedPaths.join(", ")}`,
    `Forbidden paths: ${envelope.scope.forbiddenPaths.join(", ") || "none"}`,
    `Instructions: ${envelope.instructions.join(" | ")}`,
    `Constraints: ${envelope.constraints.join(" | ") || "none"}`,
    `Stop conditions: ${envelope.stopConditions.join(" | ")}`,
    "You are the delegated executor, not the coordinating host. Do not accept, integrate, commit, push, tag, publish, or deploy this work.",
    "First inspect the declared capsule context, use available tools to perform the engineering task, and run useful checks. The structured JSON is the final report, not a substitute for doing the task.",
    "Do not report completed unless the expected outcome is actually present in the capsule. If required context or tool execution is unavailable, report blocked with non-empty blocking.code and blocking.message.",
    "Return only the structured result required by the supplied output schema. Execution completion remains pending host review.",
    "Use exactly these top-level result keys: schemaVersion, taskId, status, summary, changedFiles, validations, residualRisks, blocking.",
    "Do not add reason, message, acceptance, evidence, metadata, or any other top-level field. Put failure details only in blocking.",
    `schemaVersion must be the exact string \"1.0.0\" and taskId must be the exact string ${JSON.stringify(envelope.taskId)}.`,
    "When status is completed, blocking must be the JSON literal null, not a string or object.",
    `Completed-result shape: ${JSON.stringify({
      schemaVersion: "1.0.0",
      taskId: envelope.taskId,
      status: "completed",
      summary: "brief summary",
      changedFiles: ["relative/path"],
      validations: [{ id: "validation-id", status: "passed", summary: "brief summary" }],
      residualRisks: [],
      blocking: null
    })}`
  ];
  if (correction) authority.push(`Correction request ${correction.sequence}: ${correction.prompt}`);
  return `${authority.join("\n")}\n`;
}

function profileArgs(profile) {
  const args = [];
  if (profile.codexProfile) args.push("--profile", profile.codexProfile);
  if (profile.model) args.push("--model", profile.model);
  if (profile.reasoning) args.push("--config", `model_reasoning_effort=\"${profile.reasoning}\"`);
  return args;
}

export function buildCodexExecInvocation({ envelope, profile, capsule, resultPath, correction }) {
  const common = [
    "--json",
    "--output-schema", capsule.resultSchemaPath,
    "--output-last-message", resultPath,
    ...profileArgs(profile)
  ];
  const args = correction
    ? ["exec", "resume", ...common.filter((item, index) => item !== "--profile" && common[index - 1] !== "--profile"), correction.threadId, "-"]
    : ["exec", ...common, "--sandbox", "workspace-write", "--cd", capsule.capsuleRoot, "-"];
  return { command: profile.codexCommand, args, input: promptFor(envelope, correction) };
}

export function parseCodexEventStream(stdout) {
  let threadId = null;
  let terminalState = null;
  let usage = null;
  let failure = null;
  let eventCount = 0;
  for (const line of stdout.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw new DelegationError("malformed_codex_event", "Codex emitted a non-JSON event line.");
    }
    eventCount += 1;
    if (event.type === "thread.started" && typeof event.thread_id === "string") threadId = event.thread_id;
    if (event.type === "turn.completed") {
      terminalState = "completed";
      usage = event.usage && typeof event.usage === "object" ? event.usage : null;
    }
    if (event.type === "turn.failed") {
      terminalState = "failed";
      failure = {
        code: typeof event.error?.code === "string" ? event.error.code : "codex_turn_failed",
        message: conciseOutput(event.error?.message ?? "The delegated Codex turn failed.", 1000)
      };
    }
  }
  return { threadId, terminalState, usage, eventCount, failure };
}

export async function runCodexWorker({ envelope, profile, capsule, correction = null }, options = {}) {
  const runner = options.runProcess ?? runProcess;
  let codexHome;
  try {
    codexHome = profile.provider
      ? await prepareTaskCodexHome(capsule, profile, { ...options, requireDirectConfig: correction !== null })
      : options.codexHome ?? await prepareTaskCodexHome(capsule, profile, options);
  } catch (error) {
    const code = error instanceof DelegationError ? error.code : "codex_home_unavailable";
    const message = error instanceof DelegationError ? error.message : "The task-scoped Codex home could not be prepared.";
    return { threadId: correction?.threadId ?? null, terminalState: "failed", usage: null, eventCount: 0, workerResult: failedWorkerResult(envelope.taskId, code, message) };
  }
  const sequence = correction?.sequence ?? 0;
  const resultPath = path.join(capsule.controlRoot, `worker-result-${sequence}.json`);
  const invocation = buildCodexExecInvocation({ envelope, profile, capsule, resultPath, correction });
  const environmentSource = options.environment ?? process.env;
  let env;
  try {
    env = {
      ...safeBaseEnvironment(environmentSource),
      ...workerEnvironment(profile, environmentSource),
      CODEX_HOME: codexHome
    };
  } catch (error) {
    const code = error instanceof DelegationError ? error.code : "worker_environment_unavailable";
    const message = error instanceof DelegationError ? error.message : "The delegated worker environment could not be prepared.";
    return { threadId: correction?.threadId ?? null, terminalState: "failed", usage: null, eventCount: 0, workerResult: failedWorkerResult(envelope.taskId, code, message) };
  }
  let processResult;
  try {
    processResult = await runner(invocation.command, invocation.args, {
      cwd: capsule.capsuleRoot,
      env,
      timeoutMs: envelope.execution?.timeoutMs ?? 30 * 60_000,
      input: invocation.input
    });
  } catch {
    return { threadId: correction?.threadId ?? null, terminalState: "failed", usage: null, eventCount: 0, workerResult: failedWorkerResult(envelope.taskId, "codex_start_failed", "The configured Codex executable could not be started.") };
  }

  let events;
  try {
    events = parseCodexEventStream(processResult.stdout);
  } catch (error) {
    return { threadId: correction?.threadId ?? null, terminalState: "failed", usage: null, eventCount: 0, workerResult: failedWorkerResult(envelope.taskId, error.code, error.message) };
  }
  const threadId = events.threadId ?? correction?.threadId ?? null;
  if (!threadId) return { ...events, workerResult: failedWorkerResult(envelope.taskId, "executor_identity_unavailable", "Codex did not emit a delegated thread identity.") };
  if (correction && events.threadId && events.threadId !== correction.threadId) {
    return { ...events, threadId: events.threadId, workerResult: failedWorkerResult(envelope.taskId, "executor_identity_mismatch", "Codex resumed a different delegated thread.") };
  }
  if (processResult.timedOut) return { ...events, threadId, workerResult: failedWorkerResult(envelope.taskId, "codex_timeout", "The delegated Codex turn timed out.") };
  if (processResult.signal) return { ...events, threadId, workerResult: failedWorkerResult(envelope.taskId, "codex_interrupted", "The delegated Codex turn was interrupted.") };
  if (processResult.exitCode !== 0 || events.terminalState !== "completed") {
    return {
      ...events,
      threadId,
      workerResult: failedWorkerResult(
        envelope.taskId,
        events.failure?.code ?? "codex_process_failed",
        events.failure?.message || "The delegated Codex turn did not complete successfully."
      )
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(await (options.readResultFile ?? readFile)(resultPath, "utf8"));
    parsed = validateCodexWorkerResult(parsed, envelope.taskId);
  } catch (error) {
    const code = error instanceof DelegationError ? error.code : "malformed_worker_result";
    const message = error instanceof DelegationError ? error.message : "Codex produced malformed structured output.";
    return { ...events, threadId, workerResult: failedWorkerResult(envelope.taskId, code, message) };
  }
  return { ...events, threadId, workerResult: parsed, resultPath };
}
