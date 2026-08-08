import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  correctCodexDelegation,
  executeCodexDelegation,
  loadCodexDelegation,
  prepareCodexDelegation
} from "../src/codex/controller.mjs";
import { createGitRepository, makeEnvelope } from "./helpers.mjs";

const profileRegistry = {
  schemaVersion: "1.0.0",
  profiles: {
    worker: {
      codexCommand: "codex",
      model: "worker-model",
      reasoning: "high",
      external: true
    }
  }
};

const compatibilityProcess = async (_command, args) => {
  if (args[0] === "--version") return { exitCode: 0, stdout: "codex-cli 0.147.0", stderr: "" };
  if (args[0] === "exec" && args[1] === "resume") return { exitCode: 0, stdout: "Resume usage --json --output-schema", stderr: "" };
  return { exitCode: 0, stdout: "--json --output-schema --profile --sandbox", stderr: "" };
};

function workerProcess(threadId = "delegated-thread-1") {
  return async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    stderr: "",
    stdout: [
      JSON.stringify({ type: "thread.started", thread_id: threadId }),
      JSON.stringify({ type: "turn.completed", usage: {} })
    ].join("\n")
  });
}

function result(summary = "Done") {
  return {
    schemaVersion: "1.0.0",
    taskId: "test-task",
    status: "completed",
    summary,
    changedFiles: ["allowed.txt"],
    validations: [],
    residualRisks: [],
    blocking: null
  };
}

async function preparedFixture() {
  const root = await createGitRepository();
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "adk-controller-state-"));
  const envelope = makeEnvelope(root, {
    executionProfile: "worker",
    scope: { readablePaths: ["README.md"] }
  });
  return prepareCodexDelegation({ envelope, profileRegistry, stateRoot, hostInstanceId: "desktop-host-1" }, { compatibilityProcess });
}

test("controller preflights profile, compatibility, repository, and capsule before execution", async () => {
  const prepared = await preparedFixture();
  assert.equal(prepared.compatibility.version, "0.147.0");
  assert.equal(prepared.router.checked, false);
  assert.equal(prepared.profile.name, "worker");
  assert.equal(prepared.capsule.mode, "sanitized");
});

test("controller executes and resumes correction in the same delegated session", async () => {
  const prepared = await preparedFixture();
  const first = await executeCodexDelegation(prepared, {
    codexHome: path.join(prepared.capsule.taskRoot, "codex-home"),
    runProcess: workerProcess(),
    readResultFile: async () => JSON.stringify(result("First result"))
  });
  assert.equal(first.state.lifecycleState, "awaiting_review");
  assert.equal(first.state.executorThreadId, "delegated-thread-1");

  const reloaded = await loadCodexDelegation(prepared.capsule.taskRoot, profileRegistry);
  const corrected = await correctCodexDelegation(reloaded, {
    taskId: prepared.envelope.taskId,
    profileFingerprint: prepared.profile.fingerprint,
    capsuleBaseline: prepared.capsule.baseline,
    priorResultIdentity: first.state.resultIdentity,
    prompt: "Fix the identified defect."
  }, {
    compatibilityProcess,
    codexHome: path.join(prepared.capsule.taskRoot, "codex-home"),
    runProcess: workerProcess(),
    readResultFile: async () => JSON.stringify(result("Corrected result"))
  });
  assert.equal(corrected.state.lifecycleState, "awaiting_review");
  assert.equal(corrected.state.executorThreadId, "delegated-thread-1");
  assert.equal(corrected.state.correctionSequence, 1);
});

test("controller fails when delegated identity cannot be separated from the host", async () => {
  const prepared = await preparedFixture();
  const execution = await executeCodexDelegation(prepared, {
    codexHome: path.join(prepared.capsule.taskRoot, "codex-home"),
    runProcess: workerProcess("desktop-host-1"),
    readResultFile: async () => JSON.stringify(result())
  });
  assert.equal(execution.state.lifecycleState, "failed");
  assert.equal(execution.lifecycleError.code, "executor_identity_unavailable");
});

test("controller refuses an unavailable named profile before capsule creation", async () => {
  const root = await createGitRepository();
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "adk-controller-missing-profile-"));
  const envelope = makeEnvelope(root, { executionProfile: "missing", scope: { readablePaths: ["README.md"] } });
  await assert.rejects(
    prepareCodexDelegation({ envelope, profileRegistry, stateRoot, hostInstanceId: "desktop-host-1" }, { compatibilityProcess }),
    (error) => error.code === "worker_profile_not_found"
  );
  assert.deepEqual(await readdir(stateRoot), []);
});

test("controller fails closed on router health without creating a capsule or fallback route", async () => {
  const root = await createGitRepository();
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "adk-controller-router-"));
  const routedRegistry = {
    schemaVersion: "1.0.0",
    profiles: {
      routed: {
        model: "router-only-model",
        external: true,
        router: { healthUrl: "http://127.0.0.1:10100/health", timeoutMs: 500 }
      }
    }
  };
  const envelope = makeEnvelope(root, { executionProfile: "routed", scope: { readablePaths: ["README.md"] } });
  await assert.rejects(
    prepareCodexDelegation({ envelope, profileRegistry: routedRegistry, stateRoot, hostInstanceId: "desktop-host-1" }, {
      compatibilityProcess,
      fetch: async () => ({ ok: false, status: 503 })
    }),
    (error) => error.code === "router_unavailable" && /routed/.test(error.message)
  );
  assert.deepEqual(await readdir(stateRoot), []);
});

test("controller rejects a missing direct provider credential before capsule mutation", async () => {
  const root = await createGitRepository();
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "adk-controller-direct-missing-"));
  const directRegistry = {
    schemaVersion: "1.0.0",
    profiles: {
      direct: {
        model: "worker-model",
        external: true,
        provider: {
          name: "compatible-provider",
          baseUrl: "https://provider.example/v1",
          wireApi: "responses",
          credentialEnv: "PROVIDER_API_KEY"
        }
      }
    }
  };
  const envelope = makeEnvelope(root, { executionProfile: "direct", scope: { readablePaths: ["README.md"] } });
  await assert.rejects(
    prepareCodexDelegation({ envelope, profileRegistry: directRegistry, stateRoot, hostInstanceId: "desktop-host-1" }, {
      compatibilityProcess,
      environment: { PROVIDER_API_KEY: "" }
    }),
    (error) => error.code === "provider_credential_unavailable" && /PROVIDER_API_KEY/.test(error.message)
  );
  assert.deepEqual(await readdir(stateRoot), []);
});

test("controller prepares a direct provider only from host environment configuration", async () => {
  const root = await createGitRepository();
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "adk-controller-direct-"));
  const directRegistry = {
    schemaVersion: "1.0.0",
    profiles: {
      direct: {
        model: "worker-model",
        external: true,
        provider: {
          name: "compatible-provider",
          baseUrl: "https://provider.example/v1",
          wireApi: "responses",
          credentialEnv: "PROVIDER_API_KEY"
        }
      }
    }
  };
  const envelope = makeEnvelope(root, { executionProfile: "direct", scope: { readablePaths: ["README.md"] } });
  const prepared = await prepareCodexDelegation({ envelope, profileRegistry: directRegistry, stateRoot, hostInstanceId: "desktop-host-1" }, {
    compatibilityProcess,
    environment: { PROVIDER_API_KEY: "credential-value" }
  });
  assert.deepEqual(prepared.providerCredential, { checked: true, credentialEnv: "PROVIDER_API_KEY" });
  assert.equal(prepared.profile.provider.name, "compatible-provider");
  assert.doesNotMatch(JSON.stringify(prepared), /credential-value/);
});
