# RelayPact

[English](README.md) | [简体中文](README.zh-CN.md)

RelayPact lets one Codex Agent Instance delegate bounded engineering work to an
independent Codex executor while the coordinating Codex retains scope, evidence
review, risk judgment, and final acceptance.

The first and only active Public Preview route is **Codex → Codex**. RelayPact
provides the workflow, isolation, evidence, and acceptance controls; execution
comes from an independent `codex exec` process in the user's existing Codex
CLI. No second Codex installation or executor package is required.

**No additional executor installation is required.**

## Release status

- Public source version: **0.1.2 source candidate** (`v0.1.2` is not released).
- Latest published release: **v0.1.1**.
- Support: `codex-codex` is `public-preview`; `codex-pi` remains
  `experimental` and inactive.

[`support-matrix.json`](support-matrix.json) is authoritative. Pi, OpenCode CLI,
OpenCodex, a third-party provider, and any particular model are not prerequisites
or fallbacks for the Codex-to-Codex path.

This preview is human-reviewed and is not intended for unattended or
production-critical use. Validated prerequisites are Node.js 20 or later, Git,
and Codex CLI 0.147.0 or later with both `codex --version` and
`codex exec --help` available. macOS is locally validated; Ubuntu is claimed
for a release only after its exact candidate passes public CI. Windows support
is not yet claimed.

## Five-minute start with the 0.1.2 source candidate

Use this development-only path to review the unreleased hotfix candidate. A
`main` checkout is mutable and is not a reproducible release installation.

Give a coordinating Codex instance this prompt:

```text
Clone https://github.com/echopath-labs/relaypact from branch main into a local
tools directory outside my target repository. Treat it as an unreleased 0.1.2
source candidate, not a versioned release. Record the exact checkout commit and
verify that package.json and plugin.json both report 0.1.2.
Read README.md and the nearest AGENTS.md. Verify Node.js 20 or later, Git,
Codex CLI 0.147.0 or later, and `codex exec --help`. Install the root Agent
Plugin through its local marketplace, start no worker, then run the installed
Skill-local `support` and `doctor` commands. Report the exact checkout commit,
versions, Plugin and Skill discovery, Codex-to-Codex readiness, and remaining
setup. Do not read credentials or configure, invoke, accept, apply, commit,
push, tag, publish, release, or deploy anything.
```

The equivalent source commands are:

```bash
git clone --branch main --depth 1 \
  https://github.com/echopath-labs/relaypact.git relaypact-0.1.2-source
cd relaypact-0.1.2-source
git rev-parse HEAD
node -e 'const p=require("./package.json"),q=require("./plugin.json"); if(p.version!=="0.1.2"||q.version!==p.version) process.exit(1)'
codex plugin marketplace add "$PWD" --json
codex plugin add relaypact@relaypact-local --json
codex plugin list --marketplace relaypact-local --json
```

Start a new Codex task after installation, then follow the
[5-minute getting started guide](docs/agent-quickstart.md). It includes a real,
bounded first delegation that invokes `$relaypact` and creates one reviewable
documentation file.

## Install the latest published release

The latest published release is `v0.1.1`:

The previous `v0.1.0` release remains available for exact historical installs.

```bash
git clone --branch v0.1.1 --depth 1 \
  https://github.com/echopath-labs/relaypact.git relaypact-v0.1.1
checkout_commit="$(git -C relaypact-v0.1.1 rev-parse HEAD)"
release_commit="$(git -C relaypact-v0.1.1 rev-parse 'v0.1.1^{}')"
test "$checkout_commit" = "$release_commit"
cd relaypact-v0.1.1
codex plugin marketplace add "$PWD" --json
codex plugin add relaypact@relaypact-local --json
codex plugin list --marketplace relaypact-local --json
```

An official repository tag is a version selector, **not an independent
cryptographic guarantee**. Compare a full commit SHA only when it came through
a separate trusted channel.

`v0.1.2` is not released and no v0.1.2 tag installation is claimed. Keep the
source candidate distinct from the released installation and record its exact
commit.

```bash
git clone --branch main --depth 1 \
  https://github.com/echopath-labs/relaypact.git relaypact-current-source
git -C relaypact-current-source rev-parse HEAD
```

## The lifecycle in one minute

`completed` != `accept` != `apply`:

1. `completed` is the executor's result plus candidate evidence. It remains
   pending independent host review.
2. `accept` is an explicit host or human terminal decision after reviewing the
   actual patch, scope, validation, credential safety, and residual risk. The
   patch is still unapplied.
3. `apply` is a later, separately authorized source mutation after the accepted
   archive and current source base are rechecked.

Commit, push, tag, GitHub Release, package publication, and deployment are
further separate actions. RelayPact never infers one authority from another.

## Safety and observability

- Credentials stay in host-managed configuration or environment grants, never
  in task envelopes, examples, or public documentation.
- The executor receives only declared context and write authority. A read-only
  path is readable, omitted from writable paths, and not forbidden.
- Route or context failure is fail-closed; RelayPact never silently falls back
  to Pi, another harness, provider, or model.
- Host review keeps `relaypactPromptBytes`, `relaypactResultSchemaBytes`, and
  `relaypactDeclaredInputBytes` separate from selected context bytes and
  provider-reported tokens. They are not token, quota, cost, or hidden-harness
  estimates.
- An independent executor makes a separate model request and may consume
  additional quota or cost.
- This is not an operating-system security sandbox. Read
  [SECURITY.md](SECURITY.md) before using untrusted code or credentials.

## Install lifecycle and documentation

- [5-minute getting started](docs/agent-quickstart.md)
- [5 分钟开始使用](docs/agent-quickstart.zh-CN.md)
- [Install, version verification, upgrade, uninstall, troubleshooting, and CLI reference](docs/manual-configuration.md)
- [Codex-to-Codex adapter reference](packages/adapter-codex-codex/README.md)
- [Examples](examples/README.md)
- [Release checklist](RELEASING.md)
- [Contribution guide](CONTRIBUTING.md)
- [NOTICE](NOTICE) and [Apache License 2.0](LICENSE) (`Apache-2.0`)

## Development validation

```bash
npm run check:codex-codex
npm run check
```

The default suite is deterministic and offline. Real Codex, Pi, router, and
provider smokes are opt-in and may consume local resources or account quota.
