import assert from "node:assert/strict";
import test from "node:test";
import { runRealCodexSmoke } from "./smoke-helpers.mjs";

const enabled = process.env.ADK_ROUTER_CODEX_SMOKE === "1";

test("opt-in routed Codex delegated execution", { skip: !enabled }, async (context) => {
  assert.ok(process.env.ADK_ROUTER_HEALTH_URL, "ADK_ROUTER_HEALTH_URL is required.");
  assert.ok(process.env.ADK_ROUTER_CODEX_PROFILE, "ADK_ROUTER_CODEX_PROFILE is required.");
  assert.ok(process.env.ADK_ROUTER_CODEX_MODEL, "ADK_ROUTER_CODEX_MODEL is required.");
  const profile = {
    codexCommand: process.env.ADK_CODEX_COMMAND ?? "codex",
    codexProfile: process.env.ADK_ROUTER_CODEX_PROFILE,
    model: process.env.ADK_ROUTER_CODEX_MODEL,
    reasoning: process.env.ADK_ROUTER_CODEX_REASONING ?? "high",
    external: true,
    environmentAllowlist: ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"],
    router: { healthUrl: process.env.ADK_ROUTER_HEALTH_URL, timeoutMs: 5000 }
  };
  await runRealCodexSmoke(profile, (message) => context.diagnostic(message));
});
