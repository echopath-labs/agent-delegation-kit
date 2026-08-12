# Agent Delegation Kit

[English](README.md) | [简体中文](README.zh-CN.md)

Agent Delegation Kit lets a coordinating Agent delegate bounded engineering
work to an independent executor without delegating scope control, evidence
review, risk judgment, or final acceptance.

The first public-preview route is **Codex → Codex**. Codex coordinates and
reviews an independent Codex Agent Instance while preserving the Codex harness
across compatible model and provider routes.

Agent Delegation Kit provides the delegation workflow, scope controls,
execution isolation, evidence collection, and acceptance lifecycle. The actual
executor is an independent `codex exec` process supplied by the Codex CLI
already installed on the user's machine. No second Codex installation or
separate executor package is required. Codex Desktop alone does not prove that
the compatible CLI is callable from the shell, so installation verifies both
`codex --version` and `codex exec --help`.

No additional executor installation is required.

## Why

Multi-Agent development usually fails at the handoff: context is incomplete,
write authority is vague, executor success is mistaken for acceptance, or the
result cannot be reviewed independently. Agent Delegation Kit structures that
handoff with:

- a task envelope with explicit readable, writable, and forbidden paths;
- a sanitized task capsule and distinguishable executor identity;
- host-observed Git, filesystem, validation, and scope evidence;
- credential-aware result and patch handling;
- explicit host or human acceptance after execution.

Executor completion is never final acceptance.

## Status

Version **0.1.0** is a controlled, human-reviewed Public Preview candidate. It
is not intended for unattended or production-critical execution.

| Adapter | Execution harness | Status | Root Skill |
| --- | --- | --- | --- |
| `codex-codex` | Codex | `public-preview` | active |
| `codex-pi` | Pi | `experimental` | inactive |

[`support-matrix.json`](support-matrix.json) is authoritative. Pi, OpenCode CLI,
OpenCodex, a third-party provider, and a particular model are not prerequisites
for the default Codex-to-Codex route.

Validated release environments currently include:

- Node.js 20 or later;
- Git;
- Codex CLI 0.147.0 or later;
- macOS local validation; Ubuntu validation is confirmed for each release only
  after the exact release candidate passes the public GitHub Actions workflow.

Windows support is not yet claimed.

## Agent-first quick start

The recommended workflow is to let Codex install and use the plugin, then let
the installed Skill prepare private configuration. You provide the goal and
approve material authority; you do not need to hand-write task JSON.

### 1. Ask Codex to install and verify the plugin

Give a coordinating Codex instance this prompt:

```text
After v0.1.0 is published, clone its versioned release tag from
https://github.com/echopath-labs/agent-delegation-kit into a local tools
directory outside my target repository. Treat that tag as a version selector
from the trusted official repository. It is not an independent cryptographic guarantee.
If I provide a separately trusted full commit SHA, require an exact
match before installation. Verify Codex CLI 0.147.0 or later and
`codex exec`, install the root Agent Plugin through the repository's local
marketplace, and run the installed Skill-local `support` and `doctor` commands.
Report the Codex CLI version, `codex exec` availability, plugin and Skill
discovery, Codex-to-Codex readiness, and any remaining setup. Do not read or
copy credentials, configure a provider, start an executor, or commit or publish
anything.
```

After installation, start a new Codex task so the installed Skill is available.

### 2. Ask the installed Skill to delegate

```text
Use $codex-delegated-execution to delegate this bounded engineering task.

Target repository: <absolute path>
Goal: <what should change>

First inspect support and the repository's nearest agent instructions. Propose
the readable paths, writable paths, forbidden paths, validation commands,
worker route, and private state/archive locations before starting execution.
Create any envelope or profile metadata only in a private directory outside the
target repository. Never write credentials into those files. Stop for my
decision if authority, route, validation, or final acceptance is ambiguous.
Do not apply, commit, push, tag, publish, or deploy a candidate without separate
authorization.
```

The Agent should then:

1. inspect route support and repository instructions;
2. propose a narrow task and validation boundary;
3. prepare credential-free private artifacts;
4. start an independent Codex executor only after material choices are clear;
5. review the observed diff, scope, validations, and residual risks;
6. present an explicit `accept`, `reject`, or `abandon` decision without
   automatically applying the patch.

See the complete [Agent-first tutorial](docs/agent-quickstart.md). A
[manual configuration reference](docs/manual-configuration.md) remains
available for debugging and automation authors.

## Installation commands

If an Agent needs the exact underlying commands, they are:

```bash
git clone --branch v0.1.0 --depth 1 \
  https://github.com/echopath-labs/agent-delegation-kit.git
codex plugin marketplace add /absolute/path/to/agent-delegation-kit --json
codex plugin add agent-delegation-kit@agent-delegation-kit-local --json
codex plugin list --marketplace agent-delegation-kit-local --json
```

After installation, the Skill-local `support` command reports the static route
contract and `doctor` checks local runtime and plugin readiness without reading
authentication, contacting a provider, or starting a worker. Independent
`codex exec` calls use model capacity separately from the coordinating Agent
and may consume additional quota or cost.

The package uses the Agent Plugins 1.0 root `plugin.json`. It intentionally has
no `.codex-plugin/plugin.json` and no MCP server.

## Routes, harnesses, and providers

An execution harness owns the Agent loop, tools, context, permissions, and
result behavior. A model, provider, proxy, router, or protocol bridge is a
separate route choice.

- An independent `codex exec` worker remains the Codex harness when it uses a
  compatible external provider.
- An OpenCode CLI worker would use the OpenCode harness even if it selected the
  same model.
- Route failure is fail-closed; the toolkit never silently substitutes Pi,
  OpenCode, another provider, or another model.

The optional tested OpenCode Go / GPT-5.6 Luna route preserves the Codex
harness and does not require OpenCodex. It is compatibility evidence, not an
availability guarantee. See
[OpenCode Go / GPT-5.6 Luna](docs/opencode-go-luna.md).

## Safety boundary

- Credentials stay in host-managed environment variables or user
  configuration and never belong in task envelopes or committed examples.
- The executor receives only task-scoped context and explicit grants.
- Host validation and observed repository evidence determine eligibility.
- Accepted evidence is archived privately; the toolkit does not copy the
  candidate into the source repository.
- Commit, push, tag, Release, package publication, and deployment always remain
  separate actions.
- This preview is not an operating-system security sandbox. Read
  [SECURITY.md](SECURITY.md) before using it with untrusted code or credentials.

## Documentation

- [Agent-first tutorial](docs/agent-quickstart.md)
- [Agent-first tutorial — 简体中文](docs/agent-quickstart.zh-CN.md)
- [Manual configuration and CLI reference](docs/manual-configuration.md)
- [End-to-end examples](examples/README.md)
- [Codex-to-Codex adapter reference](packages/adapter-codex-codex/README.md)
- [OpenCode Go / Luna provider route](docs/opencode-go-luna.md)
- [Security policy and threat boundary](SECURITY.md)
- [Contribution guide](CONTRIBUTING.md)
- [Release checklist](RELEASING.md)

## Development

Run all offline deterministic validation:

```bash
npm run check
```

Validate only the first public-preview route:

```bash
npm run check:codex-codex
```

Real Codex, Pi, router, and provider smokes are opt-in and may consume local
resources or account quota. They are never part of the deterministic default
test suite.

## License

Agent Delegation Kit is licensed under the
[Apache License 2.0](LICENSE) (`Apache-2.0`). See [NOTICE](NOTICE) for attribution.
