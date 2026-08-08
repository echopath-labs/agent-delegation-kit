import { randomUUID } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DelegationError } from "../errors.mjs";
import { cleanupCapsule } from "./capsule.mjs";
import { readTaskState, transitionTaskState } from "./state.mjs";

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

export async function recordTerminalDecision(prepared, review, action, actor) {
  ensureActor(actor);
  const decision = TERMINAL_ACTIONS[action];
  if (!decision) throw new DelegationError("invalid_host_action", "Host action must be accept, reject, or abandon.");
  if (action === "accept" && review.packet.acceptance.eligible !== true) {
    throw new DelegationError("acceptance_ineligible", "Host acceptance is refused because required evidence is not eligible.");
  }
  const state = await transitionTaskState(prepared.statePath, decision.state);
  const packet = {
    ...review.packet,
    lifecycleState: state.lifecycleState,
    acceptance: { status: decision.status, eligible: review.packet.acceptance.eligible, decidedBy: actor }
  };
  return { ...review, packet, state };
}

export async function archiveAndCleanupTerminalTask(prepared, decidedReview, archiveRoot) {
  if (!path.isAbsolute(archiveRoot)) throw new DelegationError("invalid_archive_root", "Review archive root must be absolute.");
  const state = await readTaskState(prepared.statePath);
  if (!new Set(["accepted", "rejected", "abandoned", "failed"]).has(state.lifecycleState)) {
    throw new DelegationError("cleanup_refused", "Only a terminal task can be archived and cleaned.");
  }
  const relative = path.relative(prepared.capsule.taskRoot, archiveRoot);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new DelegationError("invalid_archive_root", "Review evidence must be archived outside the task directory.");
  }
  await mkdir(archiveRoot, { recursive: true, mode: 0o700 });
  const archivePath = path.join(archiveRoot, `review-${randomUUID()}`);
  await mkdir(archivePath, { mode: 0o700 });
  const packetPath = path.join(archivePath, "host-review-packet.json");
  const patchPath = path.join(archivePath, "candidate.patch");
  await writeFile(packetPath, `${JSON.stringify(decidedReview.packet, null, 2)}\n`, { mode: 0o600 });
  await writeFile(patchPath, decidedReview.candidatePatch ?? "", { mode: 0o600 });
  await chmod(packetPath, 0o600);
  await chmod(patchPath, 0o600);
  await cleanupCapsule(prepared.capsule, prepared.repository);
  return { archivePath, packetPath, patchPath };
}
