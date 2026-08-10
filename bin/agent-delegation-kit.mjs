#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { asDelegationError } from "../src/errors.mjs";
import { redact } from "../src/redact.mjs";
import { runDelegation } from "../src/run-delegation.mjs";
import {
  correctCodexDelegation,
  executeCodexDelegation,
  loadCodexDelegation,
  prepareCodexDelegation
} from "../src/codex/controller.mjs";
import { buildHostReviewPacket, persistPendingReview } from "../src/codex/review.mjs";

function usage() {
  return [
    "Usage:",
    "  agent-delegation-kit run --envelope <file> [--executor <pi-path>]",
    "  agent-delegation-kit run-codex --envelope <file> --profiles <file> --state-root <dir> --host-instance <id>",
    "  agent-delegation-kit correct-codex --task-root <dir> --profiles <file> --prompt <file>"
  ].join("\n");
}

function parseArgs(argv) {
  if (!["run", "run-codex", "correct-codex"].includes(argv[0])) throw new Error(usage());
  const command = argv[0];
  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === "--envelope" && value) options.envelope = value;
    else if (key === "--executor" && value) options.executor = value;
    else if (key === "--profiles" && value) options.profiles = value;
    else if (key === "--state-root" && value) options.stateRoot = value;
    else if (key === "--host-instance" && value) options.hostInstanceId = value;
    else if (key === "--task-root" && value) options.taskRoot = value;
    else if (key === "--prompt" && value) options.prompt = value;
    else throw new Error(`Unknown or incomplete argument: ${key}. ${usage()}`);
    index += 1;
  }
  if (command === "run" && !options.envelope) throw new Error(usage());
  if (command === "run-codex" && (!options.envelope || !options.profiles || !options.stateRoot || !options.hostInstanceId)) throw new Error(usage());
  if (command === "correct-codex" && (!options.taskRoot || !options.profiles || !options.prompt)) throw new Error(usage());
  return { command, ...options };
}

async function readJson(file) {
  return JSON.parse(await readFile(resolve(file), "utf8"));
}

async function runCodex(options) {
  const started = performance.now();
  const envelope = await readJson(options.envelope);
  const profileRegistry = await readJson(options.profiles);
  const prepared = await prepareCodexDelegation({
    envelope,
    profileRegistry,
    stateRoot: resolve(options.stateRoot),
    hostInstanceId: options.hostInstanceId
  });
  const execution = await executeCodexDelegation(prepared);
  const review = await buildHostReviewPacket(prepared, execution, { durationMs: Math.round(performance.now() - started) });
  const evidence = await persistPendingReview(prepared, review);
  return { taskRoot: prepared.capsule.taskRoot, statePath: prepared.statePath, evidence, reviewPacket: review.packet };
}

async function correctCodex(options) {
  const started = performance.now();
  const profileRegistry = await readJson(options.profiles);
  const prepared = await loadCodexDelegation(resolve(options.taskRoot), profileRegistry);
  const state = JSON.parse(await readFile(prepared.statePath, "utf8"));
  const prompt = await readFile(resolve(options.prompt), "utf8");
  const execution = await correctCodexDelegation(prepared, {
    taskId: state.taskId,
    profileFingerprint: state.profileFingerprint,
    capsuleBaseline: state.capsuleBaseline,
    contextManifestFingerprint: state.contextManifestFingerprint,
    priorResultIdentity: state.resultIdentity,
    prompt
  });
  const review = await buildHostReviewPacket(prepared, execution, { durationMs: Math.round(performance.now() - started) });
  const evidence = await persistPendingReview(prepared, review);
  return { taskRoot: prepared.capsule.taskRoot, statePath: prepared.statePath, evidence, reviewPacket: review.packet };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let result;
  if (options.command === "run") {
    const envelope = await readJson(options.envelope);
    result = await runDelegation(envelope, { executorCommand: options.executor });
  } else if (options.command === "run-codex") result = await runCodex(options);
  else result = await correctCodex(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (options.command === "run") process.exitCode = result.status === "completed" || result.status === "blocked" ? 0 : 1;
  else process.exitCode = result.reviewPacket.lifecycleState === "failed" ? 1 : 0;
}

main().catch((error) => {
  const safe = asDelegationError(error);
  process.stderr.write(`${JSON.stringify({
    schemaVersion: "1.0.0",
    status: "failed",
    error: { code: safe.code, message: redact(safe.message) }
  }, null, 2)}\n`);
  process.exitCode = 1;
});
