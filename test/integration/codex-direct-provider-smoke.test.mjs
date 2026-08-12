import assert from "node:assert/strict";
import test from "node:test";
import { runRealCodexSmoke } from "./smoke-helpers.mjs";

const enabled = process.env.RELAYPACT_DIRECT_CODEX_SMOKE === "1";

test("opt-in direct Responses-provider Codex delegated execution", { skip: !enabled }, async (context) => {
  assert.ok(process.env.RELAYPACT_DIRECT_PROVIDER_NAME, "RELAYPACT_DIRECT_PROVIDER_NAME is required.");
  assert.ok(process.env.RELAYPACT_DIRECT_PROVIDER_BASE_URL, "RELAYPACT_DIRECT_PROVIDER_BASE_URL is required.");
  assert.ok(process.env.RELAYPACT_DIRECT_PROVIDER_MODEL, "RELAYPACT_DIRECT_PROVIDER_MODEL is required.");
  assert.ok(process.env.RELAYPACT_DIRECT_PROVIDER_CREDENTIAL_ENV, "RELAYPACT_DIRECT_PROVIDER_CREDENTIAL_ENV is required.");
  const credentialEnv = process.env.RELAYPACT_DIRECT_PROVIDER_CREDENTIAL_ENV;
  assert.ok(process.env[credentialEnv], `The credential environment variable named by RELAYPACT_DIRECT_PROVIDER_CREDENTIAL_ENV is required: ${credentialEnv}.`);
  const profile = {
    codexCommand: process.env.RELAYPACT_CODEX_COMMAND ?? "codex",
    model: process.env.RELAYPACT_DIRECT_PROVIDER_MODEL,
    reasoning: process.env.RELAYPACT_DIRECT_PROVIDER_REASONING ?? "high",
    external: true,
    environmentAllowlist: ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"],
    provider: {
      name: process.env.RELAYPACT_DIRECT_PROVIDER_NAME,
      baseUrl: process.env.RELAYPACT_DIRECT_PROVIDER_BASE_URL,
      wireApi: "responses",
      credentialEnv
    }
  };
  const scenario = {};
  if (process.env.RELAYPACT_SMOKE_TASK_ID) scenario.taskId = process.env.RELAYPACT_SMOKE_TASK_ID;
  if (process.env.RELAYPACT_SMOKE_OUTPUT_FILE) scenario.outputFile = process.env.RELAYPACT_SMOKE_OUTPUT_FILE;
  if (process.env.RELAYPACT_SMOKE_OUTPUT_CONTENT) scenario.outputContent = process.env.RELAYPACT_SMOKE_OUTPUT_CONTENT;
  if (process.env.RELAYPACT_SMOKE_OBJECTIVE) scenario.objective = process.env.RELAYPACT_SMOKE_OBJECTIVE;
  await runRealCodexSmoke(profile, (message) => context.diagnostic(message), scenario);
});
