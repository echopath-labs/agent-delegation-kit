import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkRouterHealth } from "../src/codex/router.mjs";
import {
  authorizeCorrection,
  createTaskState,
  recordWorkerResult,
  transitionTaskState
} from "../src/codex/state.mjs";
import { resolveWorkerProfile } from "../src/codex/profile.mjs";
import { buildCodexExecInvocation, directProviderConfig, parseCodexEventStream, prepareTaskCodexHome, runCodexWorker } from "../src/codex/worker.mjs";
import { makeEnvelope } from "./helpers.mjs";

const profile = {
  name: "local-worker",
  codexCommand: "codex-custom",
  codexProfile: "router-worker",
  model: "worker-model",
  reasoning: "high",
  external: true,
  environmentAllowlist: ["HTTPS_PROXY"],
  fingerprint: "sha256:profile"
};

function directProfile() {
  return resolveWorkerProfile({
    schemaVersion: "1.0.0",
    profiles: {
      direct: {
        codexCommand: "codex-custom",
        model: "worker-model",
        reasoning: "high",
        external: true,
        environmentAllowlist: ["HTTPS_PROXY"],
        provider: {
          name: "compatible-provider",
          baseUrl: "https://provider.example/v1",
          wireApi: "responses",
          credentialEnv: "PROVIDER_API_KEY"
        }
      }
    }
  }, "direct");
}

async function fixture() {
  const taskRoot = await mkdtemp(path.join(os.tmpdir(), "adk-worker-"));
  const capsuleRoot = path.join(taskRoot, "capsule");
  const controlRoot = path.join(taskRoot, "control");
  const capsule = {
    taskId: "test-task",
    taskRoot,
    capsuleRoot,
    controlRoot,
    resultSchemaPath: path.join(controlRoot, "result.schema.json"),
    baseline: "baseline-1"
  };
  const envelope = makeEnvelope(taskRoot, { executionProfile: profile.name });
  return { taskRoot, capsule, envelope };
}

function completedResult() {
  return {
    schemaVersion: "1.0.0",
    taskId: "test-task",
    status: "completed",
    summary: "Implemented the bounded change.",
    changedFiles: ["allowed.txt"],
    validations: [{ id: "pass", status: "passed", summary: "Passed." }],
    residualRisks: [],
    blocking: null
  };
}

test("Codex worker starts without a shell and captures structured completion", async () => {
  const { capsule, envelope } = await fixture();
  let observed;
  const runProcess = async (command, args, options) => {
    observed = { command, args, options };
    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      stderr: "",
      stdout: [
        JSON.stringify({ type: "thread.started", thread_id: "worker-thread-1" }),
        JSON.stringify({ type: "turn.completed", usage: { input_tokens: 12, output_tokens: 4 } })
      ].join("\n")
    };
  };
  const result = await runCodexWorker({ envelope, profile, capsule }, {
    runProcess,
    codexHome: path.join(capsule.taskRoot, "codex-home"),
    environment: { PATH: "/usr/bin", HTTPS_PROXY: "http://proxy.invalid:8080", PRIVATE_TOKEN: "must-not-pass" },
    readResultFile: async () => JSON.stringify(completedResult())
  });
  assert.equal(observed.command, "codex-custom");
  assert.deepEqual(observed.args.slice(0, 2), ["exec", "--json"]);
  assert.ok(observed.args.includes("--output-schema"));
  assert.ok(observed.args.includes("workspace-write"));
  assert.equal(observed.options.env.HTTPS_PROXY, "http://proxy.invalid:8080");
  assert.equal(observed.options.env.PRIVATE_TOKEN, undefined);
  assert.equal(result.threadId, "worker-thread-1");
  assert.equal(result.workerResult.status, "completed");
  assert.deepEqual(result.usage, { input_tokens: 12, output_tokens: 4 });
});

test("direct provider home is private, deterministic, and does not inherit global auth", async () => {
  const { capsule } = await fixture();
  const selected = directProfile();
  const sourceCodexHome = await mkdtemp(path.join(os.tmpdir(), "adk-global-codex-"));
  await writeFile(path.join(sourceCodexHome, "config.toml"), 'model_provider = "unexpected-global"\n');
  await writeFile(path.join(sourceCodexHome, "auth.json"), '{"token":"global-secret"}\n');
  const codexHome = await prepareTaskCodexHome(capsule, selected, { sourceCodexHome });
  const configPath = path.join(codexHome, "config.toml");
  const config = await readFile(configPath, "utf8");
  assert.equal(config, directProviderConfig(selected));
  assert.match(config, /model_provider = "compatible-provider"/);
  assert.match(config, /env_key = "PROVIDER_API_KEY"/);
  assert.doesNotMatch(config, /global-secret|unexpected-global|credential-value/);
  assert.equal((await stat(configPath)).mode & 0o777, 0o600);
  await assert.rejects(lstat(path.join(codexHome, "auth.json")), (error) => error.code === "ENOENT");
});

test("direct provider worker injects only the selected credential and approved environment", async () => {
  const { capsule, envelope } = await fixture();
  const selected = directProfile();
  let observed;
  const execution = await runCodexWorker({ envelope, profile: selected, capsule }, {
    environment: {
      PATH: "/usr/bin",
      PROVIDER_API_KEY: "credential-value",
      HTTPS_PROXY: "http://proxy.invalid",
      UNRELATED_SECRET: "must-not-pass"
    },
    runProcess: async (_command, _args, options) => {
      observed = options;
      return {
        exitCode: 0,
        signal: null,
        timedOut: false,
        stderr: "",
        stdout: `${JSON.stringify({ type: "thread.started", thread_id: "direct-thread-1" })}\n${JSON.stringify({ type: "turn.completed", usage: {} })}\n`
      };
    },
    readResultFile: async () => JSON.stringify(completedResult())
  });
  assert.equal(execution.workerResult.status, "completed");
  assert.equal(observed.env.PROVIDER_API_KEY, "credential-value");
  assert.equal(observed.env.HTTPS_PROXY, "http://proxy.invalid");
  assert.equal(observed.env.UNRELATED_SECRET, undefined);
  assert.doesNotMatch(JSON.stringify(execution), /credential-value/);
});

test("direct provider correction refuses task configuration drift without invoking Codex", async () => {
  const { capsule, envelope } = await fixture();
  const selected = directProfile();
  const codexHome = await prepareTaskCodexHome(capsule, selected);
  await writeFile(path.join(codexHome, "config.toml"), 'model_provider = "fallback"\n', { mode: 0o600 });
  let invoked = false;
  const execution = await runCodexWorker({
    envelope,
    profile: selected,
    capsule,
    correction: { threadId: "direct-thread-1", sequence: 1, prompt: "Correct the task." }
  }, {
    environment: { PROVIDER_API_KEY: "credential-value" },
    runProcess: async () => {
      invoked = true;
      throw new Error("must not run");
    }
  });
  assert.equal(invoked, false);
  assert.equal(execution.threadId, "direct-thread-1");
  assert.equal(execution.workerResult.blocking.code, "provider_config_drift");
  assert.match(await readFile(path.join(codexHome, "config.toml"), "utf8"), /fallback/);
});

for (const scenario of ["missing", "symlink"]) {
  test(`direct provider correction refuses a ${scenario} task configuration`, async () => {
    const { capsule, envelope } = await fixture();
    const selected = directProfile();
    const codexHome = await prepareTaskCodexHome(capsule, selected);
    const configPath = path.join(codexHome, "config.toml");
    await rm(configPath);
    if (scenario === "symlink") {
      const replacement = path.join(capsule.taskRoot, "replacement.toml");
      await writeFile(replacement, directProviderConfig(selected), { mode: 0o600 });
      await symlink(replacement, configPath);
    }
    let invoked = false;
    const execution = await runCodexWorker({
      envelope,
      profile: selected,
      capsule,
      correction: { threadId: "direct-thread-1", sequence: 1, prompt: "Correct the task." }
    }, {
      environment: { PROVIDER_API_KEY: "credential-value" },
      runProcess: async () => {
        invoked = true;
        throw new Error("must not run");
      }
    });
    assert.equal(invoked, false);
    assert.equal(execution.workerResult.blocking.code, "provider_config_drift");
  });
}

test("correction invocation resumes the exact delegated thread", async () => {
  const { capsule, envelope } = await fixture();
  const invocation = buildCodexExecInvocation({
    envelope,
    profile,
    capsule,
    resultPath: path.join(capsule.controlRoot, "correction.json"),
    correction: { threadId: "worker-thread-1", sequence: 1, prompt: "Fix the failing test." }
  });
  assert.deepEqual(invocation.args.slice(0, 3), ["exec", "resume", "--json"]);
  assert.ok(invocation.args.includes("worker-thread-1"));
  assert.equal(invocation.args.includes("--profile"), false);
  assert.match(invocation.input, /Correction request 1/);
});

test("event parsing rejects non-JSON output and worker failures remain structured", async () => {
  assert.throws(() => parseCodexEventStream("not-json\n"), (error) => error.code === "malformed_codex_event");
  const { capsule, envelope } = await fixture();
  const result = await runCodexWorker({ envelope, profile, capsule }, {
    codexHome: path.join(capsule.taskRoot, "codex-home"),
    runProcess: async () => ({ exitCode: 1, signal: null, timedOut: false, stdout: "", stderr: "provider details" })
  });
  assert.equal(result.workerResult.status, "failed");
  assert.equal(result.workerResult.blocking.code, "executor_identity_unavailable");
  assert.doesNotMatch(JSON.stringify(result), /provider details/);
});

for (const scenario of [
  { name: "timeout", process: { exitCode: null, signal: "SIGTERM", timedOut: true }, code: "codex_timeout" },
  { name: "interruption", process: { exitCode: null, signal: "SIGINT", timedOut: false }, code: "codex_interrupted" },
  { name: "non-zero exit", process: { exitCode: 7, signal: null, timedOut: false }, code: "codex_process_failed" }
]) {
  test(`Codex ${scenario.name} is normalized without raw process output`, async () => {
    const { capsule, envelope } = await fixture();
    const result = await runCodexWorker({ envelope, profile, capsule }, {
      codexHome: path.join(capsule.taskRoot, "codex-home"),
      runProcess: async () => ({
        ...scenario.process,
        stderr: "API_KEY=must-not-leak",
        stdout: `${JSON.stringify({ type: "thread.started", thread_id: "worker-thread-1" })}\n`
      })
    });
    assert.equal(result.workerResult.blocking.code, scenario.code);
    assert.doesNotMatch(JSON.stringify(result), /must-not-leak/);
  });
}

test("malformed structured output cannot be inferred as completion", async () => {
  const { capsule, envelope } = await fixture();
  const result = await runCodexWorker({ envelope, profile, capsule }, {
    codexHome: path.join(capsule.taskRoot, "codex-home"),
    runProcess: async () => ({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stderr: "",
      stdout: `${JSON.stringify({ type: "thread.started", thread_id: "worker-thread-1" })}\n${JSON.stringify({ type: "turn.completed" })}\n`
    }),
    readResultFile: async () => "{not valid json"
  });
  assert.equal(result.workerResult.status, "failed");
  assert.equal(result.workerResult.blocking.code, "malformed_worker_result");
});

test("router health fails closed and does not select a fallback", async () => {
  const routedProfile = { ...profile, router: { healthUrl: "http://127.0.0.1:10100/health", timeoutMs: 500 } };
  await assert.rejects(
    checkRouterHealth(routedProfile, { fetch: async () => ({ ok: false, status: 503 }) }),
    (error) => error.code === "router_unavailable" && /local-worker/.test(error.message)
  );
  assert.deepEqual(await checkRouterHealth(profile), { checked: false, healthy: true });
});

test("task lifecycle persists identity and authorizes only matching correction", async () => {
  const { capsule } = await fixture();
  const created = await createTaskState({ capsule, profile, hostInstanceId: "desktop-host-1" });
  await transitionTaskState(created.statePath, "running");
  const reviewed = await recordWorkerResult(created.statePath, { threadId: "worker-thread-1", result: completedResult() });
  assert.equal(reviewed.lifecycleState, "awaiting_review");
  const correction = await authorizeCorrection(created.statePath, {
    taskId: capsule.taskId,
    profileFingerprint: profile.fingerprint,
    capsuleBaseline: capsule.baseline,
    priorResultIdentity: reviewed.resultIdentity
  });
  assert.equal(correction.lifecycleState, "correction_requested");
  assert.equal(correction.correctionSequence, 1);
});

test("correction resume refuses every mismatched identity dimension", async () => {
  const { capsule } = await fixture();
  const created = await createTaskState({ capsule, profile, hostInstanceId: "desktop-host-1" });
  await transitionTaskState(created.statePath, "running");
  const reviewed = await recordWorkerResult(created.statePath, { threadId: "worker-thread-1", result: completedResult() });
  const identity = {
    taskId: capsule.taskId,
    profileFingerprint: profile.fingerprint,
    capsuleBaseline: capsule.baseline,
    priorResultIdentity: reviewed.resultIdentity
  };
  for (const field of Object.keys(identity)) {
    await assert.rejects(
      authorizeCorrection(created.statePath, { ...identity, [field]: `different-${field}` }),
      (error) => error.code === "resume_identity_mismatch" && error.message.includes(field === "priorResultIdentity" ? "resultIdentity" : field)
    );
  }
});
