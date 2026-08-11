import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createGitRepository, makeEnvelope } from "./helpers.mjs";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrapper = path.join(packageRoot, "skills", "codex-delegated-execution", "scripts", "agent-delegation-kit.mjs");
const fakeCodex = path.join(packageRoot, "test", "fixtures", "fake-codex.mjs");

test("Skill-local wrapper exposes sanitized support metadata", async () => {
  const { stdout } = await execFileAsync(process.execPath, [wrapper, "support"], { cwd: os.tmpdir() });
  const support = JSON.parse(stdout);
  assert.equal(support.routes[0].id, "codex-codex");
  assert.equal(support.routes[0].status, "public-preview");
  assert.equal(support.routes[1].status, "experimental");
});

test("Skill-local wrapper completes fake Codex execution through pending review", async (context) => {
  const repository = await createGitRepository();
  const privateRoot = await mkdtemp(path.join(os.tmpdir(), "adk-cli-codex-"));
  const stateRoot = await mkdtemp(path.join(privateRoot, "state-"));
  const archiveRoot = await mkdtemp(path.join(privateRoot, "archive-"));
  const envelopePath = path.join(privateRoot, "envelope.json");
  const profilesPath = path.join(privateRoot, "profiles.json");
  await writeFile(envelopePath, JSON.stringify(makeEnvelope(repository, {
    executionProfile: "fake-worker",
    scope: {
      readablePaths: ["README.md"],
      allowedPaths: ["allowed.txt"],
      forbiddenPaths: [".env", ".env.*", "private/**"]
    }
  })));
  await writeFile(profilesPath, JSON.stringify({
    schemaVersion: "1.0.0",
    profiles: {
      "fake-worker": {
        codexCommand: fakeCodex,
        model: "fake-model",
        reasoning: "low",
        external: false,
        environmentAllowlist: []
      }
    }
  }));
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      wrapper,
      "run-codex",
      "--envelope", envelopePath,
      "--profiles", profilesPath,
      "--state-root", stateRoot,
      "--host-instance", "fake-host-instance"
    ], { cwd: os.tmpdir(), maxBuffer: 8 * 1024 * 1024 });
    const result = JSON.parse(stdout);
    assert.equal(result.reviewPacket.lifecycleState, "awaiting_review");
    assert.equal(result.reviewPacket.acceptance.status, "pending");
    assert.equal(result.reviewPacket.acceptance.eligible, true);
    assert.deepEqual(result.reviewPacket.hostObserved.changedPaths, ["allowed.txt"]);
    assert.match(await readFile(result.evidence.patchPath, "utf8"), /allowed\.txt/u);
    const decision = JSON.parse((await execFileAsync(process.execPath, [
      wrapper,
      "decide-codex",
      "--task-root", result.taskRoot,
      "--profiles", profilesPath,
      "--action", "accept",
      "--actor", "fake-host-instance",
      "--archive-root", archiveRoot
    ], { cwd: os.tmpdir(), maxBuffer: 8 * 1024 * 1024 })).stdout);
    assert.equal(decision.lifecycleState, "accepted");
    assert.equal(decision.acceptance.status, "accepted");
    assert.match(await readFile(decision.archive.patchPath, "utf8"), /allowed\.txt/u);
    await assert.rejects(access(result.taskRoot), (error) => error.code === "ENOENT");
  } finally {
    await rm(repository, { recursive: true, force: true });
    await rm(privateRoot, { recursive: true, force: true });
  }
  context.diagnostic("Skill-local wrapper used fake Codex without Pi or provider configuration.");
});
