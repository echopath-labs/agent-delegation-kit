import assert from "node:assert/strict";
import { access, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  cleanupCapsule,
  collectCandidateEvidence,
  prepareCapsule,
  preflightCapsule,
  verifySourceUnchanged
} from "../src/codex/capsule.mjs";
import { resolveRepository } from "../src/git.mjs";
import { createGitRepository, makeEnvelope } from "./helpers.mjs";

const workerResultSchemaPath = fileURLToPath(new URL("../contracts/codex-worker-result.schema.json", import.meta.url));
const profile = { name: "worker", external: true };

async function setup(overrides = {}) {
  const root = await createGitRepository();
  const repository = await resolveRepository({ root, workingDirectory: "." });
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "adk-state-"));
  const envelope = makeEnvelope(root, {
    scope: { readablePaths: ["README.md"] },
    executionProfile: "worker",
    ...overrides
  });
  return { root, repository, stateRoot, envelope };
}

test("sanitized capsule copies only declared readable files and preserves source", async () => {
  const fixture = await setup();
  const capsule = await prepareCapsule({ ...fixture, profile, workerResultSchemaPath });
  assert.equal(capsule.mode, "sanitized");
  assert.equal(await readFile(path.join(capsule.capsuleRoot, "README.md"), "utf8"), "# Fixture\n");
  assert.equal(
    JSON.parse(await readFile(path.join(capsule.capsuleRoot, ".agent-delegation", "task-envelope.json"), "utf8")).taskId,
    fixture.envelope.taskId
  );
  await access(path.join(capsule.capsuleRoot, ".agent-delegation", "codex-worker-result.schema.json"));
  assert.equal((await verifySourceUnchanged(fixture.repository, capsule)).unchanged, true);
});

test("sanitized capsule baseline is reproducible for identical inputs", async () => {
  const fixture = await setup();
  const first = await prepareCapsule({ ...fixture, profile, workerResultSchemaPath });
  const second = await prepareCapsule({ ...fixture, profile, workerResultSchemaPath });
  assert.equal(first.baseline, second.baseline);
  assert.deepEqual(first.inputMetadata, second.inputMetadata);
});

test("all readable inputs are preflighted before state mutation", async () => {
  const fixture = await setup({ scope: { readablePaths: ["README.md", "missing.md"] } });
  await assert.rejects(
    preflightCapsule({ ...fixture, profile, workerResultSchemaPath }),
    (error) => error.code === "capsule_input_missing"
  );
  assert.deepEqual(await readdir(fixture.stateRoot), []);
});

test("symlink and private inputs are rejected", async () => {
  const symlinkFixture = await setup({ scope: { readablePaths: ["linked.md"] } });
  await symlink(path.join(symlinkFixture.root, "README.md"), path.join(symlinkFixture.root, "linked.md"));
  await assert.rejects(
    preflightCapsule({ ...symlinkFixture, profile, workerResultSchemaPath }),
    (error) => error.code === "unsafe_capsule_input"
  );

  const privateFixture = await setup({ scope: { readablePaths: [".env"] } });
  await writeFile(path.join(privateFixture.root, ".env"), "SECRET=value\n");
  await assert.rejects(
    preflightCapsule({ ...privateFixture, profile, workerResultSchemaPath }),
    (error) => error.code === "unsafe_capsule_input"
  );
});

test("trusted worktree requires explicit acknowledgement", async () => {
  const fixture = await setup({ execution: { exposureMode: "trusted-worktree", trustedWorktreeAcknowledged: false } });
  await assert.rejects(
    preflightCapsule({ ...fixture, profile, workerResultSchemaPath }),
    (error) => error.code === "trusted_worktree_not_acknowledged"
  );
});

test("trusted worktree records the source baseline and cleans only task state", async () => {
  const fixture = await setup({ execution: { exposureMode: "trusted-worktree", trustedWorktreeAcknowledged: true } });
  const capsule = await prepareCapsule({ ...fixture, profile, workerResultSchemaPath });
  assert.equal(capsule.mode, "trusted-worktree");
  assert.equal(capsule.baseline, capsule.sourceHead);
  assert.equal((await verifySourceUnchanged(fixture.repository, capsule)).unchanged, true);
  await cleanupCapsule(capsule, fixture.repository);
  await assert.rejects(access(capsule.taskRoot));
  await access(fixture.root);
});

test("candidate evidence derives changed paths, scope breaches, and a patch", async () => {
  const fixture = await setup();
  const capsule = await prepareCapsule({ ...fixture, profile, workerResultSchemaPath });
  await writeFile(path.join(capsule.capsuleRoot, "allowed.txt"), "candidate\n");
  await writeFile(path.join(capsule.capsuleRoot, "private.txt"), "breach\n");
  const evidence = await collectCandidateEvidence(capsule, fixture.envelope.scope);
  assert.deepEqual(evidence.changedPaths, ["allowed.txt", "private.txt"]);
  assert.deepEqual(evidence.scopeBreaches, ["private.txt"]);
  assert.match(evidence.candidatePatch, /candidate/);
  assert.match(evidence.candidatePatchSha256, /^sha256:/);
  assert.equal((await verifySourceUnchanged(fixture.repository, capsule)).unchanged, true);
});
