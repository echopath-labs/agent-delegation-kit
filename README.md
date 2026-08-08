# Agent Delegation Kit

Agent Delegation Kit is a portable, contract-first toolkit for delegating
bounded engineering work from a coordinating host to a delegated executor.

The supported adapters are Codex-to-Pi and Codex-to-Codex. The contracts are
agent-neutral so later host and executor adapters can preserve the same scope,
evidence, and acceptance semantics.

## Status

This repository is an early `0.1.0` implementation for controlled local use.
It is not intended for unattended execution.

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

Run a delegation envelope:

```bash
node ./bin/agent-delegation-kit.mjs run \
  --envelope ./examples/task-envelope.json
```

The target repository must be clean unless the envelope explicitly records and
acknowledges every pre-existing dirty path. The adapter invokes Pi without a
shell, derives changed paths independently from Git, checks the scope allowlist,
and records validation results.

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

Request a correction in the same delegated session:

```bash
node ./bin/agent-delegation-kit.mjs correct-codex \
  --task-root /absolute/private/task-state/adk-task-id-uuid \
  --profiles ./examples/codex-worker-profiles.json \
  --prompt /absolute/private/correction.txt
```

The stored task, profile fingerprint, capsule baseline, prior result identity,
and delegated thread must all match. A mismatch fails closed instead of
starting a replacement session.

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
the host environment. The adapter checks it before capsule creation and writes
a private deterministic task `config.toml` containing the variable name but not
its value. Initial execution and `codex exec resume` use that same configuration;
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
- `trusted-worktree` exposes the broader committed checkout and requires an
  explicit host acknowledgement.
- Validation commands are executed directly from argument arrays without a
  shell, but they still run with the current user's permissions.
- Direct provider credentials are present in the delegated process environment;
  use sanitized capsules and provider data-handling terms appropriate for the
  source context.

Use small tasks, clean repositories, explicit readable and writable path
allowlists, private task-state directories, and human review. See
`adapters/codex-codex/README.md` for profiles, routing, corrections, failure
recovery, terminal cleanup, and rollback.

## Removal

Remove or disable the installed package using the supported mechanism of your
Agent Plugins client. Before removal, explicitly reject or abandon live Codex
tasks and archive their review evidence; task state is intentionally retained
while review or correction is pending.

## License

MIT. See [LICENSE](LICENSE).
