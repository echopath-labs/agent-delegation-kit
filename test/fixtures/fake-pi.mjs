#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const scenario = process.env.FAKE_PI_SCENARIO ?? "success";
const write = (name, content) => writeFileSync(path.join(process.cwd(), name), content, "utf8");
const result = (status, summary, residualRisks = []) => {
  process.stdout.write(`${JSON.stringify({ status, summary, residualRisks })}\n`);
};

switch (scenario) {
  case "success":
    write("allowed.txt", "delegated edit\n");
    result("completed", "Bounded edit completed.");
    break;
  case "breach":
    write("allowed.txt", "delegated edit\n");
    write("private.txt", "out of scope\n");
    result("completed", "Executor reported completion.");
    break;
  case "blocked":
    result("blocked", "A host decision is required.", ["Authority is unresolved."]);
    break;
  case "failed":
    process.stderr.write(`${["OPENAI", "API", "KEY"].join("_")}=${["top", "secret"].join("-")} executor failure\n`);
    process.exitCode = 7;
    break;
  case "malformed":
    process.stdout.write("not structured output\n");
    break;
  case "hang":
    setInterval(() => {}, 1000);
    break;
  case "nochange":
    result("completed", "No file change was required.");
    break;
  case "branch-change":
    spawnSync("git", ["switch", "-c", "executor-created-branch"], { cwd: process.cwd() });
    result("completed", "Executor changed the branch.");
    break;
  default:
    result("failed", `Unknown fake scenario: ${scenario}.`);
}
