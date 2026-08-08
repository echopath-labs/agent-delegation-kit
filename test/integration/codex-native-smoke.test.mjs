import test from "node:test";
import { runRealCodexSmoke } from "./smoke-helpers.mjs";

const enabled = process.env.ADK_NATIVE_CODEX_SMOKE === "1";

test("opt-in native Codex delegated execution", { skip: !enabled }, async (context) => {
  const profile = {
    codexCommand: process.env.ADK_CODEX_COMMAND ?? "codex",
    external: false,
    environmentAllowlist: []
  };
  if (process.env.ADK_NATIVE_CODEX_PROFILE) profile.codexProfile = process.env.ADK_NATIVE_CODEX_PROFILE;
  if (process.env.ADK_NATIVE_CODEX_MODEL) profile.model = process.env.ADK_NATIVE_CODEX_MODEL;
  if (process.env.ADK_NATIVE_CODEX_REASONING) profile.reasoning = process.env.ADK_NATIVE_CODEX_REASONING;
  const scenario = {};
  if (process.env.ADK_SMOKE_TASK_ID) scenario.taskId = process.env.ADK_SMOKE_TASK_ID;
  if (process.env.ADK_SMOKE_OUTPUT_FILE) scenario.outputFile = process.env.ADK_SMOKE_OUTPUT_FILE;
  if (process.env.ADK_SMOKE_OUTPUT_CONTENT) scenario.outputContent = process.env.ADK_SMOKE_OUTPUT_CONTENT;
  if (process.env.ADK_SMOKE_OBJECTIVE) scenario.objective = process.env.ADK_SMOKE_OBJECTIVE;
  await runRealCodexSmoke(profile, (message) => context.diagnostic(message), scenario);
});
