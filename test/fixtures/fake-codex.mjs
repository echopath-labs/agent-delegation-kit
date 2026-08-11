#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
if (args[0] === "--version") {
  process.stdout.write("codex-cli 0.147.0\n");
} else if (args[0] === "exec" && args.includes("--help")) {
  process.stdout.write(args[1] === "resume"
    ? "Resume a previous session --json --output-schema\n"
    : "--json --output-schema --profile --sandbox\n");
} else if (args[0] === "exec") {
  let prompt = "";
  for await (const chunk of process.stdin) prompt += chunk;
  const taskId = prompt.match(/^Task ID: (.+)$/mu)?.[1] ?? "unknown-task";
  const resultIndex = args.indexOf("--output-last-message");
  const resultPath = resultIndex >= 0 ? args[resultIndex + 1] : null;
  if (!resultPath) throw new Error("Fake Codex requires --output-last-message.");
  writeFileSync(path.join(process.cwd(), "allowed.txt"), "delegated fake Codex edit\n", "utf8");
  writeFileSync(resultPath, `${JSON.stringify({
    schemaVersion: "1.0.0",
    taskId,
    status: "completed",
    summary: "Fake Codex completed the bounded task.",
    changedFiles: ["allowed.txt"],
    validations: [],
    residualRisks: [],
    blocking: null
  })}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ type: "thread.started", thread_id: "fake-codex-thread-1" })}\n`);
  process.stdout.write(`${JSON.stringify({ type: "turn.completed", usage: {} })}\n`);
} else {
  process.stderr.write("Unsupported fake Codex invocation.\n");
  process.exitCode = 2;
}
