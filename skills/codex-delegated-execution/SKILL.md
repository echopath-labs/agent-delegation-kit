---
name: codex-delegated-execution
description: Use when Codex should delegate a bounded engineering task to Pi or an independent Codex executor while retaining scope control, evidence review, risk judgment, and final acceptance responsibility.
---

# Codex Delegated Execution

Delegate implementation without delegating ownership or acceptance.

1. Confirm the target Git root and read the nearest repository instructions.
2. Construct a complete task envelope using
   `references/task-envelope.md`. Do not include credentials.
3. Choose exact explicit context or bounded planned context using
   `references/context-planning.md`. Keep readable and writable authority
   separate and declare readiness and validation as distinct argument arrays.
4. Refuse a dirty repository by default. Use an override only when every
   pre-existing path is recorded and the user accepts the review burden.
5. Select the Pi adapter or a host-approved named Codex worker profile. For an
   external Codex route, default to a sanitized capsule.
6. Invoke the adapter and retain its structured result, delegated instance
   identity, and context-manifest identity when planning is enabled.
7. Treat any scope breach, failed validation, malformed output, or missing
   evidence as ineligible for acceptance.
8. Inspect the actual Git diff and evidence independently.
9. Issue an acceptance decision only within user-granted authority.

Executor completion is never final acceptance. A context change requires a new
task identity, not silent correction-session expansion. See the on-demand
references for context planning, result interpretation, scope breaches, and
correction requests.
