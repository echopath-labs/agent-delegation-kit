import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { DelegationError } from "../../contracts/src/errors.mjs";
import { cleanupCapsule } from "../../executor-codex/src/capsule.mjs";
import { bindReviewIdentity, buildHostReviewPacket, verifyReviewIdentity } from "./review.mjs";
import { readTaskState, removeTaskIntegrityAnchor, transitionTaskStateMatching } from "../../executor-codex/src/state.mjs";

const TERMINAL_ACTIONS = {
  accept: { state: "accepted", status: "accepted" },
  reject: { state: "rejected", status: "rejected" },
  abandon: { state: "abandoned", status: "abandoned" }
};

function ensureActor(actor) {
  if (typeof actor !== "string" || actor.trim().length === 0) {
    throw new DelegationError("host_actor_required", "A host or human decision-maker identity is required.");
  }
}

function stateExpectations(prepared, identity) {
  return {
    taskId: prepared.envelope.taskId,
    lifecycleState: "awaiting_review",
    stateRevision: identity.stateRevision,
    correctionSequence: identity.correctionSequence,
    resultIdentity: identity.resultIdentity,
    privateControlFingerprint: identity.privateControlFingerprint
  };
}

function sameReviewBasis(supplied, rebuilt) {
  return supplied.candidatePatch === rebuilt.candidatePatch &&
    JSON.stringify(supplied.packet.executorSelfReport) === JSON.stringify(rebuilt.packet.executorSelfReport) &&
    JSON.stringify(supplied.packet.hostObserved) === JSON.stringify(rebuilt.packet.hostObserved) &&
    supplied.packet.acceptance.eligible === rebuilt.packet.acceptance.eligible;
}

export async function recordTerminalDecision(prepared, review, action, actor, options = {}) {
  ensureActor(actor);
  const decision = TERMINAL_ACTIONS[action];
  if (!decision) throw new DelegationError("invalid_host_action", "Host action must be accept, reject, or abandon.");
  verifyReviewIdentity(review);
  if (review.packet.taskId !== prepared.envelope.taskId) {
    throw new DelegationError("review_identity_mismatch", "Review task identity does not match the prepared delegation.");
  }
  const authoritativeReview = await buildHostReviewPacket(prepared, {
    workerResult: review.packet.executorSelfReport,
    usage: null,
    eventCount: 0,
    lifecycleError: null
  }, options);
  if (!sameReviewBasis(review, authoritativeReview)) {
    throw new DelegationError("stale_review", "Candidate or host evidence changed after review; rebuild the review before recording a terminal decision.");
  }
  if (action === "accept" && authoritativeReview.packet.acceptance.eligible !== true) {
    throw new DelegationError("acceptance_ineligible", "Host acceptance is refused because current host evidence is not eligible.");
  }
  const identity = verifyReviewIdentity(authoritativeReview);
  const state = await transitionTaskStateMatching(
    prepared.statePath,
    decision.state,
    stateExpectations(prepared, identity)
  );
  const packet = bindReviewIdentity({
    ...authoritativeReview.packet,
    lifecycleState: state.lifecycleState,
    acceptance: { status: decision.status, eligible: authoritativeReview.packet.acceptance.eligible, decidedBy: actor }
  }, authoritativeReview.candidatePatch, state);
  return { ...authoritativeReview, packet, state };
}

export async function archiveAndCleanupTerminalTask(prepared, decidedReview, archiveRoot) {
  if (!path.isAbsolute(archiveRoot)) throw new DelegationError("invalid_archive_root", "Review archive root must be absolute.");
  const state = await readTaskState(prepared.statePath);
  if (
    prepared.capsule.taskId !== state.taskId ||
    prepared.envelope.taskId !== state.taskId ||
    path.resolve(prepared.statePath) !== path.join(path.resolve(prepared.capsule.taskRoot), "state.json")
  ) {
    throw new DelegationError("cleanup_refused", "Prepared state and capsule do not identify the same task.");
  }
  if (!new Set(["accepted", "rejected", "abandoned", "failed"]).has(state.lifecycleState)) {
    throw new DelegationError("cleanup_refused", "Only a terminal task can be archived and cleaned.");
  }
  const reviewIdentity = verifyReviewIdentity(decidedReview);
  const expectedAcceptance = {
    accepted: "accepted",
    rejected: "rejected",
    abandoned: "abandoned",
    failed: "pending"
  }[state.lifecycleState];
  if (
    decidedReview.packet.lifecycleState !== state.lifecycleState ||
    decidedReview.packet.acceptance.status !== expectedAcceptance ||
    (state.lifecycleState !== "failed" && !decidedReview.packet.acceptance.decidedBy) ||
    state.stateRevision !== reviewIdentity.stateRevision ||
    state.correctionSequence !== reviewIdentity.correctionSequence ||
    state.resultIdentity !== reviewIdentity.resultIdentity ||
    state.privateControlFingerprint !== reviewIdentity.privateControlFingerprint
  ) {
    throw new DelegationError("stale_review", "Terminal review no longer matches current task state.");
  }
  let archiveInfo;
  let resolvedArchiveRoot;
  let resolvedTaskRoot;
  try {
    archiveInfo = await lstat(archiveRoot);
    resolvedArchiveRoot = await realpath(archiveRoot);
    resolvedTaskRoot = await realpath(prepared.capsule.taskRoot);
  } catch {
    throw new DelegationError("invalid_archive_root", "Review archive root must be a pre-existing real directory.");
  }
  if (!archiveInfo.isDirectory() || archiveInfo.isSymbolicLink()) {
    throw new DelegationError("invalid_archive_root", "Review archive root must be a pre-existing real directory, not a symlink.");
  }
  const relative = path.relative(resolvedTaskRoot, resolvedArchiveRoot);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new DelegationError("invalid_archive_root", "Review evidence must be archived outside the task directory.");
  }
  const archivePath = path.join(resolvedArchiveRoot, `review-${randomUUID()}`);
  await mkdir(archivePath, { mode: 0o700 });
  const resolvedArchivePath = await realpath(archivePath);
  const childRelative = path.relative(resolvedArchiveRoot, resolvedArchivePath);
  if (childRelative.startsWith("..") || path.isAbsolute(childRelative)) {
    throw new DelegationError("invalid_archive_root", "Review archive path escaped the selected archive root.");
  }
  const packetPath = path.join(archivePath, "host-review-packet.json");
  const patchPath = path.join(archivePath, "candidate.patch");
  const packetContent = `${JSON.stringify(decidedReview.packet, null, 2)}\n`;
  const patchContent = decidedReview.candidatePatch ?? "";
  await writeFile(packetPath, packetContent, { flag: "wx", mode: 0o600 });
  await writeFile(patchPath, patchContent, { flag: "wx", mode: 0o600 });
  await chmod(packetPath, 0o600);
  await chmod(patchPath, 0o600);
  const [archiveAfter, packetAfter, patchAfter, resolvedAfter, persistedPacket, persistedPatch] = await Promise.all([
    lstat(archivePath),
    lstat(packetPath),
    lstat(patchPath),
    realpath(archivePath),
    readFile(packetPath, "utf8"),
    readFile(patchPath, "utf8")
  ]);
  if (
    !archiveAfter.isDirectory() || archiveAfter.isSymbolicLink() || resolvedAfter !== resolvedArchivePath ||
    !packetAfter.isFile() || packetAfter.isSymbolicLink() ||
    !patchAfter.isFile() || patchAfter.isSymbolicLink() ||
    persistedPacket !== packetContent || persistedPatch !== patchContent
  ) {
    throw new DelegationError("archive_verification_failed", "Archived review evidence changed before task cleanup.");
  }
  await cleanupCapsule(prepared.capsule, prepared.repository);
  await removeTaskIntegrityAnchor(prepared.statePath);
  return { archivePath, packetPath, patchPath };
}
