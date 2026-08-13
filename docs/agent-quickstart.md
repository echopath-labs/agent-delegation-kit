# Agent-first quick start

[English](agent-quickstart.md) | [简体中文](agent-quickstart.zh-CN.md)

This is the recommended way to use RelayPact. The coordinating
Agent prepares the bounded task and private artifacts; the human approves
material authority and retains final control.

The plugin supplies delegation controls, isolation, evidence, and acceptance.
Execution comes from an independent `codex exec` process in the user's existing
Codex CLI; no second Codex installation or separate executor package is needed.

For exact commands and JSON fields, use the
[manual configuration reference](manual-configuration.md).

## What the human provides

You normally provide only:

- the target Git repository;
- the engineering goal;
- any non-negotiable paths, tests, risk limits, or stop conditions;
- approval for material scope and route choices;
- confirmation that a required host-managed credential is available;
- a separate final decision about acceptance and any later patch application.

Do not paste provider credentials into the prompt. Do not ask the executor to
find secrets or broaden its own authority.

## Install with a coordinating Agent

Give Codex this prompt before the plugin is installed:

```text
Clone the versioned `v0.1.1` release tag from
https://github.com/echopath-labs/relaypact into a local tools
directory outside my target repository. Treat that tag as a version selector
from the trusted official repository. It is not an independent cryptographic guarantee.
Require the clone to exit successfully and verify that HEAD exactly equals the
commit produced by peeling the annotated v0.1.1 tag. A shallow clone may print
a warning while peeling an annotated tag; warning text alone is not the success
or failure signal.
If I provide a separately trusted full commit SHA, require an exact
match before installation. Read its README and nearest AGENTS.md.
Verify Codex CLI 0.147.0 or later and `codex exec`, install its root Agent
Plugin through the included local marketplace, then run the installed Skill's
`support` and `doctor` commands. Report the CLI version, `codex exec`, plugin
and Skill discovery, Codex-to-Codex readiness, and any remaining setup. Keep
all temporary state outside my target repository. Do not read credentials,
contact a provider, start an executor, commit, push, tag, publish, or deploy.
```

The Agent should run the equivalent of:

```bash
set -e
git clone --branch v0.1.1 --depth 1 \
  https://github.com/echopath-labs/relaypact.git
checkout_commit="$(git -C relaypact rev-parse HEAD)"
release_commit="$(git -C relaypact rev-parse 'v0.1.1^{}')"
test "$checkout_commit" = "$release_commit"
codex plugin marketplace add /absolute/path/to/relaypact --json
codex plugin add relaypact@relaypact-local --json
codex plugin list --marketplace relaypact-local --json
```

Start a new Codex task after installation so the packaged Skill is present in
the task's skill catalog.

## Delegate from intent

Use this prompt in the new task:

```text
Use $relaypact to delegate a bounded engineering task.

Target repository: <absolute path>
Goal: <specific desired outcome>
Important constraints: <paths, tests, risk limits, or none>

Inspect support and the nearest repository instructions first. Before starting
the executor, show me:
1. the coordinating-host and executor identities;
2. the proposed readable, writable, and forbidden paths;
3. the validation commands and timeouts;
4. the selected Codex worker profile and whether it is native, direct-provider,
   or optional-router based;
5. the private envelope/profile/state/archive locations outside the repository;
6. every question that requires human authority.

Prepare credential-free envelope and profile metadata for me. Never store a
secret or personal proxy value in either file. Do not silently expand context,
switch execution harnesses, or fall back to another model/provider. After the
worker finishes, independently review the observed diff, scope evidence,
validations, and residual risks. Do not accept, apply, commit, push, tag,
publish, or deploy without separate authorization.
```

## Expected Agent checkpoints

### 1. Support and repository preflight

The Agent resolves the installed Skill-local wrapper and runs `support` plus
`doctor` without loading Pi, a provider, or a worker. It reports static support
separately from local readiness, finds the target Git root, reads the nearest
`AGENTS.md` or equivalent instructions, and refuses an unacknowledged dirty
tree.

### 2. Scope and context proposal

The Agent separates:

- `readablePaths`: context the executor may inspect;
- `allowedPaths`: files the executor may change;
- `forbiddenPaths`: explicit exclusions;
- host validation: direct argument arrays run independently after execution.

For a read-only file, include it in `readablePaths`, omit it from
`allowedPaths`, and do not also match it with `forbiddenPaths`. Readable
authority is not writable authority. A context change after execution
starts requires a new task identity, not a silent expansion of a correction.

### 3. Route selection

The first public-preview route always preserves the Codex harness.

- **Native Codex profile:** uses a selected, minimal Codex configuration
  projection and host-managed Codex authentication already available to the
  selected CLI profile.
- **Direct Responses provider:** uses a compatible `/v1` Responses endpoint and
  a named credential environment variable.
- **Optional loopback router:** uses an explicitly configured local route and
  health check.

Pi, OpenCode CLI, OpenCodex, another provider, or another model is never an
automatic fallback. The optional tested OpenCode Go / GPT-5.6 Luna profile is
documented in [its provider guide](opencode-go-luna.md).

### 4. Private artifact preparation

The Agent creates envelope, profile, task state, and review archive paths under
a host-approved private directory outside the target repository. Profiles name
credential environment variables but never contain credential values. State
and archive roots must be pre-existing real directories and should use mode
`0700` where supported.

### 5. Execution and review

The executor runs in a sanitized task capsule. Its structured completion report
is only self-report. The coordinating host separately checks:

- actual changed paths and candidate patch;
- source and capsule baseline consistency;
- ignored, index-hidden, Git-control, and filesystem evidence;
- scope breaches;
- host-controlled validation results;
- credential-evidence safety;
- residual risks and lifecycle identity.

The Agent should summarize this evidence before presenting a decision.

Review metrics keep `relaypactPromptBytes`,
`relaypactResultSchemaBytes`, `relaypactDeclaredInputBytes`, selected context
bytes, and provider-reported tokens separate. RelayPact byte counts cover only
the exact prompt and generated result schema it supplies; they are not token,
quota, cost, hidden-harness, or overhead estimates.

### 6. Terminal decision

- `accept`: evidence is currently eligible and the host approves the candidate;
- `reject`: the candidate is not acceptable;
- `abandon`: the task is being closed without accepting its result.

Every decision rebuilds authoritative evidence and archives it privately. Even
`accept` does not apply the patch to the source repository. Patch application,
commit, push, tag, Release, publication, and deployment remain separate actions.

After acceptance, use a separate prompt such as:

```text
This delegation was accepted. Re-read the archived candidate patch and verify
that its evidence identity matches the accepted record. Explain exactly which
files would be applied, then wait for my separate approval. Do not apply the
patch, commit, or push yet.
```

An independent executor makes its own model request and may consume additional
quota or cost. Private archives can contain source patches and review evidence;
the user owns their retention and deletion policy.

## Correction or new task?

Use a same-session correction only when the requested fix stays inside the
original scope, context identity, route, and risk boundary. Create a new task
when readable authority, writable paths, provider route, harness, or material
requirements change.

## Failure handling

| Failure | Agent response |
| --- | --- |
| Credential unavailable | Stop before worker launch; ask only whether the named host credential can be made available. |
| Provider or model incompatible | Fail closed; reverify provider-owned documentation and create a new approved route if needed. |
| Stream disconnected | Distinguish transport health from task size; do not increase retries blindly or change harnesses. |
| Context gap | Report the missing repository-relative context; create a new bounded task if authority is approved. |
| Scope breach | Mark evidence ineligible and preserve recovery evidence. |
| Validation failure | Do not accept; correct inside the same authority or start a new task. |
| Stale review | Rebuild evidence; never force a terminal decision against stale state. |

See [SECURITY.md](../SECURITY.md) for the threat boundary and
[manual configuration](manual-configuration.md) for exact recovery commands.

## What this workflow does not automate

RelayPact does not decide product requirements, supply credentials,
approve broader authority, apply patches, commit, push, tag, publish, release,
or deploy. Those remain explicit host or human actions.

The software is licensed under the
[Apache License 2.0](../LICENSE) (`Apache-2.0`).
