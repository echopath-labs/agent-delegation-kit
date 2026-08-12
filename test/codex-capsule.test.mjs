import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, realpath, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  cleanupCapsule,
  collectCandidateEvidence,
  prepareCapsule,
  preflightCapsule,
  verifyContextManifestIdentity,
  verifySourceUnchanged
} from "../packages/executor-codex/src/capsule.mjs";
import { validateTaskEnvelope } from "../packages/contracts/src/envelope.mjs";
import { resolveRepository } from "../packages/core/src/git.mjs";
import { createDirectory, createGitRepository, makeEnvelope } from "./helpers.mjs";

const workerResultSchemaPath = fileURLToPath(new URL("../packages/contracts/schemas/codex-worker-result.schema.json", import.meta.url));
const execFileAsync = promisify(execFile);
const profile = { name: "worker", external: true };

async function setup(overrides = {}) {
  const root = await createGitRepository();
  const repository = await resolveRepository({ root, workingDirectory: "." });
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "relaypact-state-"));
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
  const executorEnvelope = JSON.parse(await readFile(
    path.join(capsule.capsuleRoot, ".relaypact", "task-envelope.json"),
    "utf8"
  ));
  const canonicalEnvelope = JSON.parse(await readFile(capsule.envelopePath, "utf8"));
  assert.equal(executorEnvelope.taskId, fixture.envelope.taskId);
  assert.equal(
    path.isAbsolute(executorEnvelope.repository.root) || path.win32.isAbsolute(executorEnvelope.repository.root),
    true
  );
  assert.notEqual(executorEnvelope.repository.root, capsule.capsuleRoot);
  assert.equal(executorEnvelope.repository.workingDirectory, ".");
  assert.deepEqual(executorEnvelope.repository.dirtyTree, { allow: false, acknowledgedPaths: [] });
  assert.equal(JSON.stringify(executorEnvelope).includes(fixture.root), false);
  assert.equal(canonicalEnvelope.repository.root, fixture.root);
  assert.equal(validateTaskEnvelope(executorEnvelope), executorEnvelope);
  await access(path.join(capsule.capsuleRoot, ".relaypact", "codex-worker-result.schema.json"));
  assert.equal((await verifySourceUnchanged(fixture.repository, capsule)).unchanged, true);
});

test("sanitized capsule refuses source roots retained in free-form executor controls", async () => {
  const fixture = await setup();
  fixture.envelope.instructions = [`Inspect source at ${fixture.root}.`];
  await assert.rejects(
    prepareCapsule({ ...fixture, profile, workerResultSchemaPath }),
    (error) => error.code === "unsafe_executor_envelope"
  );
  assert.deepEqual(await readdir(fixture.stateRoot), []);
});

test("sanitized capsule baseline is reproducible for identical inputs", async () => {
  const fixture = await setup();
  const first = await prepareCapsule({ ...fixture, profile, workerResultSchemaPath });
  const second = await prepareCapsule({ ...fixture, profile, workerResultSchemaPath });
  assert.equal(first.baseline, second.baseline);
  assert.deepEqual(first.inputMetadata, second.inputMetadata);
});

test("planned capsule copies the deterministic closure and persists one manifest identity", async () => {
  const fixture = await setup({
    scope: {
      allowedPaths: ["src/**/*.mjs"],
      forbiddenPaths: [".env", ".env.*", "private/**"],
      readablePaths: ["README.md"],
      discoverablePaths: ["src/**/*.mjs"]
    },
    contextPlanning: {
      strategy: "dependency-closure",
      seeds: ["src/entry.mjs"],
      analyzers: ["node-esm"],
      budget: { maxFiles: 10, maxBytes: 10_000, maxDepth: 5 },
      readiness: []
    }
  });
  await mkdir(path.join(fixture.root, "src"));
  await writeFile(path.join(fixture.root, "src", "entry.mjs"), "import './dependency.mjs';\n");
  await writeFile(path.join(fixture.root, "src", "dependency.mjs"), "export const value = true;\n");

  const capsule = await prepareCapsule({ ...fixture, profile, workerResultSchemaPath });
  assert.deepEqual(capsule.inputMetadata.map((item) => item.path), [
    "README.md",
    "src/dependency.mjs",
    "src/entry.mjs"
  ]);
  const privateManifest = JSON.parse(await readFile(capsule.contextManifestPath, "utf8"));
  const visibleManifest = JSON.parse(await readFile(
    path.join(capsule.capsuleRoot, ".relaypact", "context-manifest.json"),
    "utf8"
  ));
  assert.equal(privateManifest.fingerprint, capsule.contextManifestFingerprint);
  assert.deepEqual(visibleManifest, privateManifest);
  assert.deepEqual(await verifyContextManifestIdentity(capsule), {
    verified: true,
    fingerprint: capsule.contextManifestFingerprint
  });
});

test("source verification detects byte changes hidden behind the same dirty path set", async () => {
  const fixture = await setup();
  await writeFile(path.join(fixture.root, "README.md"), "# One\n");
  const capsule = await prepareCapsule({ ...fixture, profile, workerResultSchemaPath });
  assert.deepEqual(capsule.sourceStatus, ["README.md"]);
  await writeFile(path.join(fixture.root, "README.md"), "# Two\n");
  const verification = await verifySourceUnchanged(fixture.repository, capsule);
  assert.deepEqual(verification.statusPaths, ["README.md"]);
  assert.equal(verification.unchanged, false);
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

  const mixedCasePrivateFixture = await setup({ scope: { readablePaths: [".CoDeX/private.txt"] } });
  await mkdir(path.join(mixedCasePrivateFixture.root, ".CoDeX"));
  await writeFile(path.join(mixedCasePrivateFixture.root, ".CoDeX", "private.txt"), "private\n");
  await assert.rejects(
    preflightCapsule({ ...mixedCasePrivateFixture, profile, workerResultSchemaPath }),
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

test("candidate patch uses a clean host index and reports authoritative index drift", async () => {
  const fixture = await setup();
  const capsule = await prepareCapsule({ ...fixture, profile, workerResultSchemaPath });
  await writeFile(path.join(capsule.capsuleRoot, "README.md"), "changed despite index flag\n");
  await execFileAsync("git", [
    `--git-dir=${capsule.gitControl.gitDir}`,
    `--work-tree=${capsule.gitControl.workTree}`,
    "update-index",
    "--skip-worktree",
    "README.md"
  ], { cwd: capsule.capsuleRoot });
  const evidence = await collectCandidateEvidence(capsule, fixture.envelope.scope);
  assert.ok(evidence.scopeBreaches.includes("task:private control changed"));
  assert.match(evidence.candidatePatch, /changed despite index flag/);
  assert.doesNotMatch(evidence.scopeBreaches.join("\n"), /candidate patch incomplete/);
});

test("candidate evidence omits a patch containing an exact granted credential", async () => {
  const root = await createGitRepository();
  const envelope = makeEnvelope(root, { scope: { allowedPaths: ["allowed.txt"], readablePaths: ["README.md"] } });
  const repository = await resolveRepository({ root, workingDirectory: "." });
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "relaypact-capsule-state-"));
  const capsule = await prepareCapsule({ envelope, repository, profile, stateRoot, workerResultSchemaPath });
  const secret = "exact-provider-credential-for-evidence";
  await writeFile(path.join(capsule.capsuleRoot, "allowed.txt"), `leaked ${secret}\n`);
  const evidence = await collectCandidateEvidence(capsule, envelope.scope, { sensitiveValues: [secret] });
  assert.equal(evidence.credentialEvidenceSafe, false);
  assert.equal(evidence.candidatePatch, "");
  assert.equal(evidence.candidatePatchSha256, null);
  assert.ok(evidence.scopeBreaches.includes("evidence:credential value detected"));
});

test("capsule private Git metadata drift is part of immutable control evidence", async () => {
  const root = await createGitRepository();
  const envelope = makeEnvelope(root, { scope: { readablePaths: ["README.md"] } });
  const capsule = await prepareCapsule({
    envelope,
    repository: { gitRoot: await realpath(root) },
    profile,
    stateRoot: await createDirectory(),
    workerResultSchemaPath
  });
  await mkdir(path.join(capsule.gitControl.gitDir, "info"), { recursive: true });
  await writeFile(path.join(capsule.gitControl.gitDir, "info", "attributes"), "*.txt -diff\n");
  const evidence = await collectCandidateEvidence(capsule, envelope.scope);
  assert.equal(evidence.privateControlChanged, true);
  assert.ok(evidence.scopeBreaches.includes("task:private control changed"));
});
