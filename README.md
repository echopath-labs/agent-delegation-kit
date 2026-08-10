# Agent Delegation Kit

Agent Delegation Kit is a portable, contract-first toolkit for delegating
bounded engineering work from a coordinating host to a delegated executor.

The supported adapters are Codex-to-Pi and Codex-to-Codex. The contracts are
agent-neutral so later host and executor adapters can preserve the same scope,
evidence, and acceptance semantics.

## Status

This repository is an early `0.1.0` implementation for controlled local use.
It is not intended for unattended execution.

## Installation

Clone or download this repository, then add its validated local marketplace and
install the root Agent Plugin with Codex CLI 0.147.0 or later:

```bash
codex plugin marketplace add /absolute/path/to/agent-delegation-kit --json
codex plugin add agent-delegation-kit@agent-delegation-kit-local --json
codex plugin list --marketplace agent-delegation-kit-local --json
```

The marketplace catalog points to the same root `plugin.json`; it is not a
second plugin manifest. The package intentionally contains no
`.codex-plugin/plugin.json`. A future shared marketplace can distribute the
same root package without changing its contracts.

## Requirements

- Codex CLI 0.147.0 or later for portable Agent Plugins support.
- Node.js 20 or later.
- A compatible Pi installation for the Pi adapter, or Codex CLI 0.147.0 or
  later for the Codex executor.
- Git for repository preflight and postflight evidence.

Provider credentials remain in host-managed environment variables or user
configuration. Codex executor envelopes select only a named worker profile;
executable, profile, model, reasoning, proxy allowlist, optional direct
Responses provider, and optional loopback router health check remain in that
local registry. A direct profile stores only the credential environment-variable
name, never its value. Never put credentials in an envelope or committed
example.

## Package Layout

```text
plugin.json                     Agent Plugins 1.0 manifest
skills/                         Portable Agent Skills
contracts/                      Versioned task and result schemas
hosts/codex/                    Codex host boundary
executors/pi/                   Pi executor boundary
executors/codex/                Independent Codex executor boundary
adapters/codex-pi/              Pair-specific integration notes
adapters/codex-codex/           Codex-to-Codex controller notes
bin/                            Local command entry point
src/                            Dependency-free runtime
test/                           Fake-executor integration tests
examples/                       Contract examples
```

The package intentionally has no `.codex-plugin/plugin.json` and no MCP server.

## Quick Start

Validate the package and run tests:

```bash
npm run check
```

Verify local plugin discovery without changing the user's installed plugins:

```bash
ADK_CODEX_PLUGIN_SMOKE=1 npm run smoke:codex-plugin
```

The smoke creates a disposable `CODEX_HOME`, installs from the repository's
local marketplace, verifies the plugin identity and packaged Skill, and removes
the temporary home.

Run a delegation envelope:

```bash
node ./bin/agent-delegation-kit.mjs run \
  --envelope ./examples/task-envelope.json
```

The target repository must be clean unless the envelope explicitly records and
acknowledges every pre-existing dirty path. The adapter invokes Pi without a
shell, derives changed paths independently from Git, checks the scope allowlist,
and records validation results.

### Task envelopes and Pi profiles

All repository paths in an envelope are relative to the declared Git root.
`scope.allowedPaths` grants write authority; `scope.readablePaths` and optional
planned context control exposure separately. Validation commands are direct
argument arrays, not shell strings. A Pi task may omit `executionProfile` to use
Pi's configured default, or supply only non-secret selection metadata:

```json
{
  "executionProfile": {
    "provider": "configured-provider",
    "model": "configured-model",
    "reasoning": "low"
  }
}
```

Keep provider authentication in Pi's supported user configuration or
environment. Never put an API key, bearer token, proxy credential, or personal
authentication path in an envelope. Run the opt-in real-Pi smoke only after a
working Pi route is configured:

```bash
ADK_PI_SMOKE=1 \
ADK_PI_PROVIDER=configured-provider \
ADK_PI_MODEL=configured-model \
npm run smoke:pi
```

The smoke uses a disposable Git repository, allows one output file, runs a
host-controlled content validation, and retains only aggregate diagnostics.

Run a Codex-to-Codex delegation in one command:

```bash
node ./bin/agent-delegation-kit.mjs run-codex \
  --envelope ./examples/codex-task-envelope.json \
  --profiles ./examples/codex-worker-profiles.json \
  --state-root /absolute/private/task-state \
  --host-instance codex-desktop-session-id
```

The command prepares a sanitized temporary Git capsule, launches an independent
`codex exec`, records its thread identity, runs host-controlled postflight, and
writes a pending review packet plus candidate patch under the private task
directory. It never copies the candidate into the source repository.

The private task directory retains the canonical envelope for host reload and
review. The executor-visible capsule receives a separate valid projection whose
repository uses a stable virtual capsule root while commands run from the real
capsule working directory; preparation fails closed if another projected field
would expose the host source root.

### Explicit and planned context

Explicit mode keeps the original exact-list behavior: omit `contextPlanning`
and only literal `scope.readablePaths` are copied. Planned mode keeps selection
inside a separate maximum authority boundary:

- `scope.readablePaths` remain exact explicit inclusions;
- `scope.discoverablePaths` authorizes, but does not automatically expose,
  additional files;
- `contextPlanning.seeds` start a dependency closure;
- named analyzers and explicit file, byte, and depth budgets bound selection;
- optional readiness commands check structural usability before any worker
  request.

Planned selection changes read exposure only; it never expands `scope.allowedPaths` or writable authority.

The first dependency-free analyzer supports conservative Node.js ESM imports,
re-exports, and literal dynamic imports in `.js` and `.mjs`. It never evaluates
repository modules. Missing, ambiguous, unauthorized, private, symlinked, or
over-budget dependencies fail closed; there is no automatic whole-repository or
`trusted-worktree` fallback.

A planned capsule carries a credential-free context manifest with deterministic
file integrity metadata, inclusion provenance, aggregate totals, readiness-plan
fingerprints, and a canonical identity. That identity is bound to private task
state, executor-visible controls, the capsule baseline, and correction resume.
Authorizing more context therefore creates a new task instead of silently
changing an existing delegated session. See
`examples/codex-task-envelope.planned.json` for a complete envelope.

Request a correction in the same delegated session:

```bash
node ./bin/agent-delegation-kit.mjs correct-codex \
  --task-root /absolute/private/task-state/adk-task-id-uuid \
  --profiles ./examples/codex-worker-profiles.json \
  --prompt /absolute/private/correction.txt
```

The stored task, profile fingerprint, capsule baseline, context-manifest
identity when planned, prior result identity, and delegated thread must all
match. A mismatch fails closed instead of starting a replacement session.

### Direct Responses providers

When a provider exposes a Codex-compatible Responses API, a host-owned profile
can connect `codex exec` directly without OpenCodex or another protocol bridge:

```json
{
  "model": "compatible-model-id",
  "external": true,
  "provider": {
    "name": "compatible-provider",
    "baseUrl": "https://provider.example/v1",
    "wireApi": "responses",
    "credentialEnv": "COMPATIBLE_PROVIDER_API_KEY"
  }
}
```

`baseUrl` is the OpenAI-compatible API base (for example, ending in `/v1`), not
the full `/responses` operation URL. Set the named credential variable only in
the host environment. Context planning and readiness finish without that
credential; only then does the adapter require it before worker invocation. A
private deterministic task `config.toml` contains the variable name but not its
value. Initial execution and `codex exec resume` use that same configuration;
identity drift fails closed. Providers that require protocol conversion must be
configured explicitly through the optional router route.

## Acceptance Boundary

An executor result of `completed` is not final acceptance. Codex or the human
reviewer must inspect the actual diff, scope evidence, validation results, and
residual risks before issuing an acceptance decision.

## Safety Limits

- Agent tool selection is not an operating-system filesystem sandbox.
- Sanitized mode minimizes copied context but does not claim operating-system
  containment. Postflight scope checks detect violations after they occur.
- Host validation is followed by a second capsule and source-integrity check;
  acceptance eligibility uses that final evidence rather than the earlier
  executor-only snapshot.
- `trusted-worktree` exposes the broader committed checkout and requires an
  explicit host acknowledgement.
- Validation commands are executed directly from argument arrays without a
  shell, but they still run with the current user's permissions.
- Readiness commands also run with the current user's permissions. They receive
  a minimized environment and disposable home, are output-bounded and
  mutation-checked, but are host-declared trusted commands rather than an OS
  sandbox.
- Direct provider credentials are present in the delegated process environment;
  use sanitized capsules and provider data-handling terms appropriate for the
  source context.

Use small tasks, clean repositories, explicit readable and writable path
allowlists, private task-state directories, and human review. See
`adapters/codex-codex/README.md` for profiles, routing, corrections, failure
recovery, terminal cleanup, and rollback.

See [`examples/README.md`](examples/README.md) for end-to-end Pi and Codex
flows covering completion, blocking, validation failure, correction, review,
terminal acceptance, and cleanup.

## Removal

Before removal, explicitly reject or abandon live Codex tasks and archive their
review evidence; task state is intentionally retained while review or
correction is pending. Then remove the installed plugin and optional local
marketplace:

```bash
codex plugin remove agent-delegation-kit@agent-delegation-kit-local --json
codex plugin marketplace remove agent-delegation-kit-local
```

Removing the plugin does not revert source changes already accepted and applied
by a host. Git rollback remains a separate human-controlled repository action.

## License

MIT. See [LICENSE](LICENSE).
