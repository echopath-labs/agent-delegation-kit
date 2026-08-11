import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkCodexCompatibility, parseCodexVersion } from "../packages/executor-codex/src/compatibility.mjs";
import { resolveWorkerProfile, validateWorkerProfiles, workerEnvironment } from "../packages/executor-codex/src/profile.mjs";
import { validateTaskEnvelope } from "../packages/contracts/src/envelope.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const registry = {
  schemaVersion: "1.0.0",
  profiles: {
    worker: {
      codexCommand: "codex",
      codexProfile: "worker",
      model: "provider/model",
      reasoning: "high",
      external: true,
      environmentAllowlist: ["HTTPS_PROXY", "NO_PROXY"],
      router: { healthUrl: "http://127.0.0.1:10100/healthz", timeoutMs: 1000 }
    }
  }
};

test("worker profiles resolve by name with a non-secret fingerprint", () => {
  const profile = resolveWorkerProfile(registry, "worker");
  assert.equal(profile.model, "provider/model");
  assert.match(profile.fingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(workerEnvironment(profile, { HTTPS_PROXY: "http://proxy", NO_PROXY: "localhost", SECRET: "no" }), {
    HTTPS_PROXY: "http://proxy",
    NO_PROXY: "localhost"
  });
});

test("profile values cannot carry arbitrary environment or credential fields", () => {
  assert.throws(() => validateWorkerProfiles({
    schemaVersion: "1.0.0",
    profiles: { worker: { environmentAllowlist: ["OPENAI_API_KEY"] } }
  }), (error) => error.code === "invalid_worker_profiles");
  assert.throws(() => validateWorkerProfiles({
    schemaVersion: "1.0.0",
    profiles: { worker: { apiKey: "secret" } }
  }), (error) => error.code === "invalid_worker_profiles");
});

test("direct Responses profiles bind provider identity without credential values", () => {
  const directRegistry = {
    schemaVersion: "1.0.0",
    profiles: {
      direct: {
        model: "worker-model",
        reasoning: "high",
        external: true,
        environmentAllowlist: ["HTTPS_PROXY"],
        provider: {
          name: "compatible-provider",
          baseUrl: "https://provider.example/v1/",
          wireApi: "responses",
          credentialEnv: "PROVIDER_API_KEY"
        }
      }
    }
  };
  const profile = resolveWorkerProfile(directRegistry, "direct");
  assert.deepEqual(profile.provider, {
    name: "compatible-provider",
    baseUrl: "https://provider.example/v1",
    wireApi: "responses",
    credentialEnv: "PROVIDER_API_KEY"
  });
  assert.match(profile.fingerprint, /^sha256:[a-f0-9]{64}$/);
  const environment = workerEnvironment(profile, {
    PROVIDER_API_KEY: "credential-value",
    HTTPS_PROXY: "http://proxy.invalid",
    UNRELATED_SECRET: "must-not-pass"
  });
  assert.deepEqual(environment, {
    HTTPS_PROXY: "http://proxy.invalid",
    PROVIDER_API_KEY: "credential-value"
  });
  assert.doesNotMatch(JSON.stringify(profile), /credential-value/);
});

test("OpenCode Go Luna examples form a valid credential-free direct route", async () => {
  const profilePath = path.join(packageRoot, "examples", "codex-worker-profiles.opencode-go-luna.json");
  const envelopePath = path.join(packageRoot, "examples", "codex-task-envelope.opencode-go-luna.json");
  const profileRegistry = JSON.parse(await readFile(profilePath, "utf8"));
  const envelope = JSON.parse(await readFile(envelopePath, "utf8"));

  const profile = resolveWorkerProfile(profileRegistry, "opencode-go-luna");
  assert.equal(profile.model, "gpt-5.6-luna");
  assert.equal(profile.external, true);
  assert.deepEqual(profile.provider, {
    name: "opencode-go",
    baseUrl: "https://opencode.ai/zen/go/v1",
    wireApi: "responses",
    credentialEnv: "OPENCODE_GO_API_KEY"
  });

  assert.doesNotThrow(() => validateTaskEnvelope(envelope));
  assert.equal(envelope.executionProfile, "opencode-go-luna");
  assert.doesNotMatch(JSON.stringify(envelope), /OPENCODE_GO_API_KEY|opencode\.ai\/zen/);
});

for (const [name, profile] of [
  ["unsupported wire API", { model: "worker-model", external: true, provider: { name: "provider", baseUrl: "https://provider.example/v1", wireApi: "chat", credentialEnv: "PROVIDER_API_KEY" } }],
  ["non-loopback HTTP", { model: "worker-model", external: true, provider: { name: "provider", baseUrl: "http://provider.example/v1", wireApi: "responses", credentialEnv: "PROVIDER_API_KEY" } }],
  ["URL credentials", { model: "worker-model", external: true, provider: { name: "provider", baseUrl: "https://user:password@provider.example/v1", wireApi: "responses", credentialEnv: "PROVIDER_API_KEY" } }],
  ["credential value field", { model: "worker-model", external: true, provider: { name: "provider", baseUrl: "https://provider.example/v1", wireApi: "responses", credentialEnv: "PROVIDER_API_KEY", apiKey: "secret" } }],
  ["over-budget URL encoding", { model: "worker-model", external: true, provider: { name: "provider", baseUrl: "https://provider.example/v1/carrier%25252Fopaque-value", wireApi: "responses", credentialEnv: "PROVIDER_API_KEY" } }],
  ["malformed URL encoding", { model: "worker-model", external: true, provider: { name: "provider", baseUrl: "https://provider.example/bad%ZZ/carrier%252Fopaque-value", wireApi: "responses", credentialEnv: "PROVIDER_API_KEY" } }],
  ["missing model", { external: true, provider: { name: "provider", baseUrl: "https://provider.example/v1", wireApi: "responses", credentialEnv: "PROVIDER_API_KEY" } }],
  ["non-external route", { model: "worker-model", external: false, provider: { name: "provider", baseUrl: "https://provider.example/v1", wireApi: "responses", credentialEnv: "PROVIDER_API_KEY" } }],
  ["named Codex profile conflict", { codexProfile: "other", model: "worker-model", external: true, provider: { name: "provider", baseUrl: "https://provider.example/v1", wireApi: "responses", credentialEnv: "PROVIDER_API_KEY" } }],
  ["router conflict", { model: "worker-model", external: true, router: { healthUrl: "http://127.0.0.1:10100/health" }, provider: { name: "provider", baseUrl: "https://provider.example/v1", wireApi: "responses", credentialEnv: "PROVIDER_API_KEY" } }]
]) {
  test(`direct profile rejects ${name}`, () => {
    assert.throws(() => validateWorkerProfiles({ schemaVersion: "1.0.0", profiles: { direct: profile } }), (error) => {
      assert.equal(error.code, "invalid_worker_profiles");
      assert.doesNotMatch(error.message, /secret|password@/);
      return true;
    });
  });
}

test("direct profile requires a non-empty credential in the selected environment", () => {
  const profile = resolveWorkerProfile({
    schemaVersion: "1.0.0",
    profiles: { direct: { model: "worker-model", external: true, provider: { name: "provider", baseUrl: "http://127.0.0.1:18080/v1", wireApi: "responses", credentialEnv: "PROVIDER_API_KEY" } } }
  }, "direct");
  assert.throws(() => workerEnvironment(profile, {}), (error) => error.code === "provider_credential_unavailable" && /PROVIDER_API_KEY/.test(error.message));
  assert.throws(() => workerEnvironment(profile, { PROVIDER_API_KEY: "  " }), (error) => error.code === "provider_credential_unavailable");
});

test("router health checks are limited to loopback HTTP endpoints", () => {
  assert.throws(() => validateWorkerProfiles({
    schemaVersion: "1.0.0",
    profiles: { worker: { router: { healthUrl: "https://example.invalid/health" } } }
  }), (error) => error.code === "invalid_worker_profiles");
});

test("Codex version parsing accepts the supported CLI format", () => {
  assert.equal(parseCodexVersion("codex-cli 0.147.0"), "0.147.0");
  assert.equal(parseCodexVersion("unknown"), null);
});

test("Codex compatibility checks version and required exec features", async () => {
  const observed = [];
  const runProcess = async (_command, args, options) => {
    observed.push(options.env);
    if (args[0] === "--version") return { exitCode: 0, stdout: "codex-cli 0.147.0", stderr: "" };
    if (args[1] === "resume") return { exitCode: 0, stdout: "Resume a previous session --json", stderr: "" };
    return { exitCode: 0, stdout: "--json --output-schema --profile --sandbox", stderr: "" };
  };
  const result = await checkCodexCompatibility({ codexCommand: "codex" }, {
    runProcess,
    environment: { PATH: "/usr/bin", HOME: "/temporary/home", PROVIDER_API_KEY: "must-not-pass" }
  });
  assert.equal(result.version, "0.147.0");
  assert.equal(observed.length, 3);
  for (const environment of observed) {
    assert.deepEqual(environment, { PATH: "/usr/bin", HOME: "/temporary/home" });
  }
});

test("unsupported Codex versions fail before execution", async () => {
  const runProcess = async () => ({ exitCode: 0, stdout: "codex-cli 0.146.0", stderr: "" });
  await assert.rejects(
    checkCodexCompatibility({ codexCommand: "codex" }, { runProcess }),
    (error) => error.code === "codex_unsupported"
  );
});
