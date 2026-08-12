# Manual configuration and CLI reference

This reference is for automation authors, debugging, and users who intentionally
opt out of the recommended [Agent-first workflow](agent-quickstart.md).

The same scope, credential, evidence, and acceptance rules apply. Manual control
does not authorize broader access or automatic patch application.

## Prerequisites

- Node.js 20 or later
- Git
- Codex CLI 0.147.0 or later
- a clean target Git repository, unless every pre-existing dirty path is
  explicitly acknowledged in the envelope
- pre-existing real private state and archive directories outside the target
  repository

Pi is required only for the explicitly selected experimental `codex-pi` route.

Agent Delegation Kit supplies the delegation workflow, scope controls,
execution isolation, evidence, and acceptance lifecycle. The delegated executor
is `codex exec` from the same Codex CLI installation. A second Codex installation
or separate executor package is not required, but Codex Desktop alone does not
guarantee that `codex` is callable from the shell.

Verify the base commands before installation:

```bash
node --version
git --version
codex --version
codex exec --help
```

## Install the root plugin

```bash
git clone --branch v0.1.0 --depth 1 \
  https://github.com/echopath-labs/agent-delegation-kit.git
cd agent-delegation-kit
codex plugin marketplace add "$PWD" --json
codex plugin add agent-delegation-kit@agent-delegation-kit-local --json
codex plugin list --marketplace agent-delegation-kit-local --json
```

The repository contains one Agent Plugins 1.0 root `plugin.json`. It has no
`.codex-plugin/plugin.json` and no MCP server.

## Inspect support

From a source clone:

```bash
node ./bin/agent-delegation-kit.mjs support
node ./bin/agent-delegation-kit.mjs doctor
```

From an installed Skill, resolve
`skills/codex-delegated-execution/scripts/agent-delegation-kit.mjs` relative to
the installed Skill directory. Do not assume the current directory is the
plugin checkout.

The support matrix identifies `codex-codex` as `public-preview` and `codex-pi`
as `experimental`. `support` reports that static contract. `doctor` separately
checks the current Node.js, Git, Codex CLI, `codex exec`, packaged Skill,
marketplace, and plugin visibility without reading authentication, contacting a
provider, or starting a worker:

- `ready`: required runtime and installed-plugin checks passed;
- `needs_setup`: runtime works, but marketplace or plugin visibility needs setup;
- `blocked`: a required runtime, packaged Skill, or `codex exec` check failed.

Doctor cannot prove live model/provider availability. That is evaluated only
when the user selects and invokes a route.

## Prepare private roots

```bash
mkdir -p /absolute/private/agent-delegation-state
mkdir -p /absolute/private/agent-delegation-archive
chmod 700 /absolute/private/agent-delegation-state
chmod 700 /absolute/private/agent-delegation-archive
```

Do not place these directories inside the target repository or shared public
storage. They contain the sanitized capsule, task-scoped Codex home, pending
review packet, candidate patch, lifecycle state, and terminal archive.

## Prepare a task envelope

Start from [`examples/codex-task-envelope.json`](../examples/codex-task-envelope.json).
Important fields are:

- `taskId`: unique stable identity;
- `objective` and `expectedOutcome`: bounded desired behavior;
- `repository.root`: absolute target repository path;
- `scope.readablePaths`: executor context authority;
- `scope.allowedPaths`: executor write authority;
- `scope.forbiddenPaths`: explicit exclusions;
- `validation`: host-owned argument arrays and timeouts;
- `executionProfile`: name from the private profile registry;
- `execution.timeoutMs` and `execution.exposureMode`.

Never put a credential, authentication path, personal proxy value, or raw
private log in an envelope. Context planning details are in the packaged
Skill's [`context-planning.md`](../skills/codex-delegated-execution/references/context-planning.md).

## Prepare a worker profile registry

Start from [`examples/codex-worker-profiles.json`](../examples/codex-worker-profiles.json).
The registry is host-owned and private.

### Native Codex profile

A native profile names a selected Codex profile, model, reasoning level, and
empty or explicit environment allowlist. The adapter projects only the selected
safe configuration and authentication fields into a task-scoped Codex home.
The selected profile must already have usable host-managed Codex authentication.
The adapter does not ask for a token in the envelope and does not copy the
complete global configuration.

### Direct Responses provider

A direct profile declares:

- `provider.name`;
- an HTTPS or loopback HTTP `provider.baseUrl` ending at `/v1`;
- `provider.wireApi: "responses"`;
- `provider.credentialEnv`, containing only an environment-variable name;
- an explicit model and optional standard proxy-variable allowlist.

The actual credential remains in the named host environment variable. Provider
URLs with userinfo, query parameters, fragments, unsupported encoding, or an
excessive decode chain are refused before worker launch.

The copy-safe OpenCode Go / GPT-5.6 Luna example is in
[`examples/codex-worker-profiles.opencode-go-luna.json`](../examples/codex-worker-profiles.opencode-go-luna.json).
Read [the provider guide](opencode-go-luna.md) before using it.

### Optional loopback router

A router profile names a selected Codex profile plus a loopback health URL. The
router is optional local infrastructure. Route failure does not fall back to a
direct provider, Pi, OpenCode CLI, or another harness.

## Start a Codex-to-Codex task

```bash
node ./bin/agent-delegation-kit.mjs run-codex \
  --envelope /absolute/private/task-envelope.json \
  --profiles /absolute/private/worker-profiles.json \
  --state-root /absolute/private/agent-delegation-state \
  --host-instance coordinating-host-id
```

The command prepares a sanitized Git capsule, launches an independent
`codex exec`, records the delegated thread identity, performs host postflight
and validation, then writes a pending review packet and candidate patch under
the returned task root.

It does not modify the source repository.

## Review the pending result

Inspect, at minimum:

- `executorSelfReport.status`, changed files, validations, blocking detail, and
  residual risks;
- `hostObserved.changedPaths`, scope breaches, candidate patch identity,
  private-control status, and credential-evidence safety;
- host validation status and bounded output;
- acceptance eligibility and unresolved risks;
- the actual candidate patch stored beside the review packet.

Do not infer acceptance from `executorSelfReport.status: "completed"`.

## Request a same-session correction

Prepare a private text file containing only the correction and run:

```bash
node ./bin/agent-delegation-kit.mjs correct-codex \
  --task-root /absolute/private/agent-delegation-state/adk-task-id-uuid \
  --profiles /absolute/private/worker-profiles.json \
  --prompt /absolute/private/correction.txt
```

Correction is permitted only when the task identity, capsule baseline, context
manifest, profile, prior result, and original authority still match. Expanded
context or scope requires a new task.

## Record a terminal decision

```bash
node ./bin/agent-delegation-kit.mjs decide-codex \
  --task-root /absolute/private/agent-delegation-state/adk-task-id-uuid \
  --profiles /absolute/private/worker-profiles.json \
  --action accept \
  --actor reviewing-host-id \
  --archive-root /absolute/private/agent-delegation-archive
```

Use `reject` or `abandon` when appropriate. The command rebuilds authoritative
review evidence, refuses stale or ineligible acceptance, records the terminal
state, archives the packet and patch, and removes only task-local state.

Acceptance still does not apply the patch. Applying a reviewed patch and any
later Git or release action require separate authority.

## Apply an accepted candidate separately

After `accept`, use the archive returned by `decide-codex`. Before applying
anything, confirm that the archived patch and review identities are the accepted
ones, inspect every changed path, and ensure the source repository still matches
the expected base. A suitable Agent prompt is:

```text
This delegation was accepted. Re-read the archived candidate patch and verify
that its evidence identity matches the accepted record. Explain every file that
would be applied and confirm the source base has not drifted. Wait for my
separate approval before applying anything. Do not commit or push.
```

Patch application, commit, push, and release remain distinct authorizations.
Never apply an unreviewed or stale archive automatically.

## Upgrade a release installation

The `v0.1.0` instructions use a local marketplace backed by a versioned release
tag checkout. A tag from the trusted official repository is a version selector,
not an independent cryptographic guarantee. If your organization distributes a
full commit SHA through a separate trusted channel, compare it exactly with
`git rev-parse HEAD` and stop before installation on any mismatch. For a later
release, clone that new tag into a separate tools directory, remove and re-add
the plugin against the new marketplace checkout, then start a new Codex task
and run `support` plus `doctor` again. The Codex `marketplace upgrade` command
refreshes Git-backed marketplaces; it does not change a local tag checkout
automatically.

Do not overwrite an installation while an active task depends on its Skill
files. Existing private task archives are versioned evidence and do not need to
be rewritten for a plugin upgrade.

## Uninstall

Remove the installed plugin first, then remove the local marketplace:

```bash
codex plugin remove agent-delegation-kit@agent-delegation-kit-local --json
codex plugin marketplace remove agent-delegation-kit-local --json
```

Start a new Codex task and confirm that `$codex-delegated-execution` is no
longer available. Deleting the cloned tools directory is a separate filesystem
action.

Uninstall does not delete private envelopes, profiles, state, or archives.
Review active tasks first. Archives can contain source patches and review
evidence; retain or delete them only under the user's own retention policy.
These private archives remain user-owned data.

## First-run troubleshooting

| Symptom | Check and recovery |
| --- | --- |
| `codex` not found | Ensure a supported Codex CLI is installed and callable on `PATH`; Codex Desktop presence alone is insufficient. |
| Codex version below 0.147.0 | Upgrade Codex CLI, open a new shell/task, and rerun `doctor`. |
| `codex exec` unavailable | Repair or upgrade the Codex CLI installation; no separate executor package exists. |
| `doctor` returns `needs_setup` | Add the release checkout as `agent-delegation-kit-local`, install the plugin, start a new task, and rerun doctor from the installed Skill. |
| Plugin installed but Skill absent | Start a new Codex task and verify `codex plugin list --marketplace agent-delegation-kit-local --json`. |
| Native authentication unavailable | Repair the selected host Codex profile; never paste credentials into envelope/profile files. |
| Dirty target repository | Record and explicitly acknowledge every pre-existing path, or restore a clean tree before delegation. |
| No approved worker profile | Let the coordinating Agent prepare credential-free metadata and stop for route/auth availability decisions. |
| State/archive rejected | Use pre-existing real, non-symlink directories outside the target repository; use restrictive permissions where supported. |
| Provider or stream failure | Fail closed; inspect the provider-specific guide and do not silently change provider, model, router, or harness. |
| Correction needs new context or authority | Create a new task; correction is only for defects inside the original identity and boundary. |

## Usage and private storage

The coordinating Agent and independent executor make separate model requests.
An executor run or correction can therefore consume additional tokens, quota,
time, or cost according to the selected route. Doctor and support do not make a
provider request.

Private task state can contain a sanitized source capsule, task-scoped Codex
home, candidate patch, and review evidence. Terminal decisions archive evidence
and clean task-local state, but archive retention is not automatic. Do not place
these directories in a public repository or publicly synchronized folder.

## Glossary

- **Plugin:** the installable Agent Plugins 1.0 package containing the Skill,
  wrapper, contracts, adapters, tests, and documentation.
- **Coordinating Host:** the Codex instance that frames authority, reviews
  evidence, judges risk, and owns acceptance.
- **Executor:** the distinguishable independent `codex exec` Agent Instance that
  performs the bounded task.
- **Harness:** the Agent loop, tools, context, permissions, and result behavior;
  the public-preview worker keeps the Codex harness.
- **Route:** the selected connection to a model/provider, such as native Codex,
  a direct Responses endpoint, or an explicit loopback router.
- **Profile:** host-owned, non-secret metadata selecting the worker command,
  model alias, reasoning effort, environment names, and one route.

## Experimental Codex-to-Pi command

Pi remains an explicit experimental route and is not loaded by `run-codex`:

```bash
node ./bin/agent-delegation-kit.mjs run-pi \
  --envelope /absolute/private/pi-task-envelope.json
```

Read [`packages/adapter-codex-pi/README.md`](../packages/adapter-codex-pi/README.md)
before selecting it. Pi configuration must not become an implicit dependency or
fallback for Codex-to-Codex.

## Validation

Offline deterministic checks:

```bash
npm run check
npm run check:codex-codex
npm pack --dry-run
```

Plugin discovery uses an isolated home and no ambient credential:

```bash
ADK_CODEX_PLUGIN_SMOKE=1 npm run smoke:codex-plugin
```

Live Codex, direct-provider, router, and Pi smokes are opt-in. They may consume
quota and must run only with explicitly prepared local configuration.

## Recovery principles

- Missing credential: fix host configuration; do not put the value in JSON.
- Provider incompatibility: create a newly approved profile; do not fall back.
- Context gap: create a new task with approved context.
- Scope breach or source drift: refuse acceptance and preserve evidence.
- Validation failure: correct within existing authority or create a new task.
- Stale state: reload and rebuild authoritative review; never edit lifecycle
  files manually.

See [SECURITY.md](../SECURITY.md),
[`examples/README.md`](../examples/README.md), and the
[`codex-codex` adapter reference](../packages/adapter-codex-codex/README.md) for
the full threat, lifecycle, and library boundaries.

Agent Delegation Kit is licensed under the
[Apache License 2.0](../LICENSE) (`Apache-2.0`).
