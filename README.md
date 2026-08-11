# Agent Delegation Kit

Agent Delegation Kit is a portable, contract-first toolkit for delegating
bounded engineering work from a coordinating host to a delegated executor.

The supported adapters are Codex-to-Pi and Codex-to-Codex. The contracts are
agent-neutral so later host and executor adapters can preserve the same scope,
evidence, and acceptance semantics.

## Status

This repository is an early `0.1.0` Public Preview candidate for controlled,
human-reviewed local use. It is not intended for unattended or
production-critical execution. See [CHANGELOG.md](CHANGELOG.md) for preview
scope, [SECURITY.md](SECURITY.md) for private vulnerability reporting, and
[RELEASING.md](RELEASING.md) for the human-gated release checklist.

Local package and plugin-discovery validation has been completed on macOS with
Node.js 20 and Codex CLI 0.147.0. The repository configures Ubuntu validation in
GitHub Actions, but that becomes release evidence only after the workflow runs
successfully on the public remote. Windows behavior is not yet validated or
claimed as supported.

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

Child processes do not inherit the complete coordinating-host environment. Pi
receives a disposable home and temporary directory, its dedicated
`PI_CODING_AGENT_DIR`, and only explicit host grants. Postflight validation
receives a disposable home and a small tool-discovery environment with no
ambient credential or proxy variables.

## Package Layout

```text
plugin.json                     Agent Plugins 1.0 manifest
skills/                         Portable Agent Skills
contracts/                      Versioned task and result schemas
docs/                           Tested optional integration guides
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

The adapter does not expose the original Pi configuration directory to the
worker. It creates a disposable task projection containing only the selected
provider's authentication entry, selected custom-model provider, and safe
provider/model/thinking defaults. Credential environment references must be
explicit executor grants. The preview supports only a selected `api_key` auth
entry with a literal key or one exact environment reference; command-resolved,
OAuth, provider-specific environment, interpolation/escape, and unknown auth
shapes are refused before Pi starts. Explicit grants are snapshotted once, and
provider base URLs with userinfo, query parameters, or fragments are refused.
The resolved provider and model are also bound on the Pi command line while
project-local Pi resources are disabled, so repository settings cannot replace
the host-selected route. Every nonempty projected authentication or explicit
grant value, including short values, is used for lifecycle binding, output,
validation, changed-path, and changed-file scanning. The normalized provider
endpoint, hostname, nontrivial path components, and original
authority/hostname/path spellings join that inventory; percent-encoded path
components are decoded and split through a bounded depth, and a path that is
still decodable after that budget or contains malformed percent encoding is
refused before worker launch. Matching paths are omitted from
retained evidence and projection drift makes the result ineligible. Validation
receives only its explicit grants, but its retained output is redacted with the
full executor-plus-validation sensitive-value union.

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

The capsule's authoritative Git directory and index remain in the private task
control root. The executor-visible `.git` pointer is treated as untrusted;
postflight uses the private control path explicitly and rejects pointer drift or
incomplete command output. Host-owned filesystem snapshots cover ignored and
index-hidden paths in both the capsule and source repository. Source Git-control
snapshots include pre-existing objects, packs, hooks, refs, configuration,
indexes, linked-worktree common directories, and configured recursive alternate
object stores under aggregate bounds. Sanitized capsule controls separately
cover behavior-bearing Git configuration, index, refs, attributes, hooks,
alternate metadata, and packs while allowing host-created content-addressed
loose objects. The Codex path checks these controls before and after host
validation, so Git status is not the sole acceptance input.

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

Path authority uses canonical repository-relative spellings. Internal dot
segments, duplicate separators, traversal, and forbidden-path case aliases fail
before filesystem access. The preview caps planned context at 10,000 files and
64 MiB, caps each copied file at 16 MiB, checks size before reading, and verifies
the copied bytes against the preflight digest.

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

### Tested OpenCode Go / GPT-5.6 Luna route

The direct provider adapter has completed bounded local dogfood through
OpenCode Go and GPT-5.6 Luna without OpenCodex. This remains an optional tested
integration rather than a core dependency or reliability guarantee. The
copy-safe profile, task envelope, optional live smoke, Codex Desktop prompt,
review flow, provider data-handling warning, proxy boundary, and troubleshooting
steps are documented in
[docs/opencode-go-luna.md](docs/opencode-go-luna.md).

Native Codex workers do not inherit the coordinating host's complete
`config.toml`. The adapter generates a minimal native profile or, for a custom
named/router route, reads a credential-free selected snapshot named
`$CODEX_HOME/<codexProfile>.config.toml`. Only profile and model-provider tables
referenced by the selected route are accepted; snapshots cannot widen sandbox
or approval policy, and provider URLs cannot embed credentials. Supported Codex
authentication fields are copied into the private task home with mode `0600`;
unrelated global MCP servers, tools, tables, and authentication fields are not
projected. The projection is refreshed from the current host-owned auth file
before initial execution and each correction, so task-local drift is not reused.
Each worker and validation grant set is separately HMAC-bound to host-private
lifecycle state. A changed or unavailable set requires a new task and makes raw
candidate evidence unavailable rather than trying to reconstruct an old
credential. Exact injected credential and explicitly granted proxy values are
removed from worker result narratives and failure events before those results
are retained.

## Acceptance Boundary

An executor result of `completed` is not final acceptance. Codex or the human
reviewer must inspect the actual diff, scope evidence, validation results, and
residual risks before issuing an acceptance decision.

Acceptance rebuilds the review from the current worker-result identity,
candidate/source/Git evidence, and a fresh host-validation run. It never trusts
the persisted `eligible` bit by itself. The terminal action and actor receive a
new identity bound to the resulting lifecycle revision.

## Safety Limits

- Agent tool selection is not an operating-system filesystem sandbox.
- Sanitized mode minimizes copied context but does not claim operating-system
  containment. Postflight scope checks detect violations after they occur.
- Host validation is followed by a second capsule and source-integrity check;
  acceptance eligibility uses that final evidence rather than the earlier
  executor-only snapshot. Ignored files and selected private task controls are
  included in that integrity check.
- `trusted-worktree` exposes the broader committed checkout and requires an
  explicit host acknowledgement.
- Validation commands are executed directly from argument arrays without a
  shell. They still run with the current user's operating-system permissions,
  but receive a minimized environment and disposable home rather than ambient
  host credentials.
- Readiness commands also run with the current user's permissions. They receive
  a minimized environment and disposable home, are output-bounded and
  mutation-checked, but are host-declared trusted commands rather than an OS
  sandbox.
- Direct provider credentials are present in the delegated process environment;
  use sanitized capsules and provider data-handling terms appropriate for the
  source context. Result redaction is defense in depth, not a substitute for
  reviewing candidate files and patches that executor-controlled code can
  produce.
- Before a candidate patch is retained, changed regular files and patch bytes
  are checked against every exact provider, native-authentication, proxy, and
  host-validation value currently granted to the task. Host-keyed worker and
  validation grant fingerprints must still match their first task-lifecycle
  values. A detected value, changed grant set, or unscannable evidence makes the
  task ineligible and replaces the raw patch evidence with a leak marker.
- Codex rechecks worker grant identity immediately after process exit and before
  parsing events or structured output. Auth drift discards untrusted raw result
  evidence and returns only a host-authored failure.
- Pi receives a task-scoped minimal configuration projection rather than the
  host's configuration directory. Projected auth leaves redact narratives and
  are scanned in changed source files before eligibility.
- Process deadlines escalate from graceful to forced termination on the
  supported platform. Output remains bounded, and truncated Git, executor, or
  validation evidence fails closed instead of being treated as complete.
- Process-group cleanup is best-effort containment, not an OS sandbox. A
  delegated program that deliberately daemonizes into another session or
  process group can outlive the tracked executor. Do not delegate tasks that
  start background services; inspect and stop unexpected descendants before
  acceptance.
- Task lifecycle mutations are serialized with a private lock. A stale lock
  after a host crash fails closed and requires abandoning or manually recovering
  that private task; concurrent acceptance or correction is never merged.
- Lifecycle revisions carry an HMAC rooted in a host-private integrity key next
  to, but outside, the individual task directory. Updates verify the prior
  revision before rename; terminal cleanup removes the per-task key after
  archive and capsule cleanup succeed.
- A pending review is bound to the lifecycle revision, correction sequence,
  result identity, private controls, final candidate patch, and observed paths.
  Acceptance recollects evidence and fails closed if either the task or review
  changed after review. Archive contents are reread and verified before task
  cleanup.
- Git pointer reads use bounded non-following handles, and alternate-object
  traversal has global edge, pointer-byte, store, file, directory, and byte
  budgets. Pending evidence directories are resolved and inode-checked inside
  task state before review bytes are written.

Use small tasks, clean repositories, explicit readable and writable path
allowlists, pre-existing real (non-symlink) private task-state directories, and
human review. Review archives likewise require a pre-existing real directory
outside the task root. See
`adapters/codex-codex/README.md` for profiles, routing, corrections, failure
recovery, terminal cleanup, and rollback.

External provider routes remain user-configured preview integrations. Local
dogfood has completed bounded tasks through a direct Responses provider, while
larger requests have also shown intermittent stream disconnections. Prefer
small, independently reviewable objectives and never infer general provider
reliability from one successful route.

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
