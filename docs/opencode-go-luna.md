# OpenCode Go / GPT-5.6 Luna

This guide configures Agent Delegation Kit so a coordinating Codex instance can
delegate bounded work to an independent `codex exec` process that keeps the
Codex harness while using OpenCode Go and GPT-5.6 Luna for inference.

```text
Codex Desktop or another Codex host
  -> Agent Delegation Kit
  -> independent codex exec
  -> OpenCode Go Responses API
  -> GPT-5.6 Luna
  -> host review and explicit acceptance
```

OpenCodex, OpenCode CLI, and Pi are not required for this route. OpenCode Go is
an optional provider integration, not a package dependency or fallback route.

## Compatibility status

This integration was last checked on 2026-08-10 with:

- Agent Delegation Kit `0.1.0` Public Preview candidate;
- Codex CLI 0.147.0;
- Node.js 20;
- OpenCode Go model ID `gpt-5.6-luna`;
- OpenCode Go Responses endpoint
  `https://opencode.ai/zen/go/v1/responses`.

The worker profile uses the API base `https://opencode.ai/zen/go/v1`; Codex
adds the `/responses` operation. Verify the current model and endpoint in the
[OpenCode Go documentation](https://opencode.ai/docs/go) before use because
provider-owned routes can change independently of this package.

This is compatibility evidence, not a provider availability or reliability
guarantee. Larger local dogfood tasks have encountered intermittent stream
disconnects even though bounded tasks completed successfully.

## Before sending source

The delegated provider receives the context selected for the sanitized task
capsule. Review its current data-handling terms before sending private source.
At the date above, the OpenCode Go documentation states that GPT-5.6 Luna input
is not used for model training and abuse-monitoring logs may be retained for up
to 30 days.

Never put an API key in:

- a task envelope;
- a worker profile;
- a committed shell script;
- a prompt, validation argument, or example;
- an Agent Delegation Kit review artifact.

Load the key into the coordinating host environment using your normal secret
manager or an interactive shell. The environment variable name used by this
guide is `OPENCODE_GO_API_KEY`; only the name appears in public configuration.

## 1. Install and validate the package

Clone the public repository and keep its absolute location available as the
package root:

```bash
ADK_ROOT=/absolute/path/to/agent-delegation-kit
cd "$ADK_ROOT"
npm run check
codex plugin marketplace add "$ADK_ROOT" --json
codex plugin add agent-delegation-kit@agent-delegation-kit-local --json
```

Codex CLI 0.147.0 or later, Node.js 20 or later, and Git are required. The
target project must be a Git repository and should be clean.

## 2. Prepare host-owned configuration

The copy-safe profile is
`examples/codex-worker-profiles.opencode-go-luna.json`. It contains only route
metadata and the credential environment-variable name:

```json
{
  "schemaVersion": "1.0.0",
  "profiles": {
    "opencode-go-luna": {
      "codexCommand": "codex",
      "model": "gpt-5.6-luna",
      "reasoning": "high",
      "external": true,
      "environmentAllowlist": [
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "NO_PROXY",
        "http_proxy",
        "https_proxy",
        "all_proxy",
        "no_proxy"
      ],
      "provider": {
        "name": "opencode-go",
        "baseUrl": "https://opencode.ai/zen/go/v1",
        "wireApi": "responses",
        "credentialEnv": "OPENCODE_GO_API_KEY"
      }
    }
  }
}
```

Copy `examples/codex-task-envelope.opencode-go-luna.json` to a private working
location and edit at least:

- `repository.root`;
- the objective and expected outcome;
- readable, discoverable when planned, allowed, and forbidden paths;
- host-controlled validation commands.

The envelope selects `opencode-go-luna` by name. It does not contain provider
credentials or a provider URL.

Create a private state directory outside the target repository:

```bash
mkdir -p /absolute/private/agent-delegation-state
chmod 700 /absolute/private/agent-delegation-state
```

The state directory holds the sanitized capsule, worker home, review packet,
and candidate patch. Do not place it in a public repository or synchronize it
to shared storage without a separate review.

## 3. Configure networking only when needed

Proxy configuration is machine-local and optional. If your environment needs a
proxy, set the appropriate standard variables in the host process, for example
an HTTPS proxy or an `ALL_PROXY` SOCKS endpoint. Do not add proxy addresses to
the public profile or task envelope.

The adapter passes only allowlisted proxy variables to the worker. It does not
discover a proxy, install one, or fall back to a router automatically.

## 4. Run the optional live smoke

The live smoke makes a real provider request and may consume account quota. It
uses a disposable Git repository and retains only bounded aggregate evidence.
Run it only after `OPENCODE_GO_API_KEY` is available in the host environment:

```bash
cd "$ADK_ROOT"
ADK_DIRECT_CODEX_SMOKE=1 \
ADK_DIRECT_PROVIDER_NAME=opencode-go \
ADK_DIRECT_PROVIDER_BASE_URL=https://opencode.ai/zen/go/v1 \
ADK_DIRECT_PROVIDER_MODEL=gpt-5.6-luna \
ADK_DIRECT_PROVIDER_CREDENTIAL_ENV=OPENCODE_GO_API_KEY \
npm run smoke:codex-direct
```

Smoke success proves only that one bounded request completed on the current
machine and route. It does not accept source changes or establish general
provider reliability.

## 5. Delegate a bounded task

From the cloned package repository, run:

```bash
node ./bin/agent-delegation-kit.mjs run-codex \
  --envelope /absolute/private/opencode-go-luna-envelope.json \
  --profiles ./examples/codex-worker-profiles.opencode-go-luna.json \
  --state-root /absolute/private/agent-delegation-state \
  --host-instance codex-desktop-local
```

`--host-instance` is a host-owned attribution label. It must distinguish the
coordinating instance from the delegated Codex session; it is not a credential.

The command prepares a sanitized capsule, runs an independent `codex exec`,
collects host-observed evidence and validations, and prints bounded JSON that
includes:

- the private task root;
- the task state path;
- the pending review-packet path;
- the candidate-patch path;
- the review packet and acceptance eligibility.

The source repository is not patched automatically.

## 6. Use it from Codex Desktop

After installing the plugin, ask Codex Desktop to use the packaged Skill and
provide the host-owned paths it needs. A suitable request is:

```text
Use $codex-delegated-execution to coordinate this task. Delegate execution to
the opencode-go-luna Codex worker profile. Keep the target source unchanged
until I review the candidate patch. Use the private envelope, profile registry,
and state-root paths I provide. Stop on missing context, scope breach, failed
validation, route failure, or incomplete evidence. Do not accept, commit, push,
tag, publish, or deploy.
```

Codex remains responsible for task framing, context selection, risk judgment,
diff inspection, validation review, and the final recommendation. The
independent worker only executes inside the envelope authority.

## 7. Review, correct, and accept deliberately

`completed` means the worker turn and host evidence collection completed. It
does not mean the candidate is accepted.

Before acceptance:

1. inspect every changed path and the complete candidate patch;
2. confirm all changes are inside `scope.allowedPaths`;
3. review host-run validation evidence and residual risks;
4. confirm the worker received no more context than intended;
5. make an explicit human or coordinating-host decision.

An in-scope correction can resume the exact delegated thread:

```bash
node ./bin/agent-delegation-kit.mjs correct-codex \
  --task-root /absolute/private/agent-delegation-state/adk-task-id \
  --profiles ./examples/codex-worker-profiles.opencode-go-luna.json \
  --prompt /absolute/private/correction.txt
```

Changed authority or selected context requires a new task. The Public Preview
CLI intentionally stops at pending review; applying an accepted patch remains a
separate host or human action. See `examples/README.md` for the library-level
terminal decision and cleanup flow.

## Troubleshooting

### Credential unavailable

Confirm the coordinating host process can read `OPENCODE_GO_API_KEY`. Do not add
the value to the profile or envelope. The adapter fails before worker launch
when the named variable is missing.

### HTTP 401 or 403

Confirm the account, subscription, endpoint, and current OpenCode Go access.
Then check regional or network policy. Configure a personal proxy only when
your environment requires it; a proxy is not part of Agent Delegation Kit.

### Model or operation not found

Recheck the current OpenCode Go model list and verify that GPT-5.6 Luna still
uses the Responses endpoint. `baseUrl` must end at `/v1`, not `/responses`.

### Stream disconnected

Retry only after distinguishing transient provider transport from an oversized
task. Prefer smaller independently reviewable objectives and planned context.
Do not increase retries blindly because that can multiply latency and usage.

### Context is insufficient

The worker should stop and report the gap. Expand readable or discoverable
authority only by creating a new task envelope; do not silently widen a live
session.

### Direct route unavailable

The adapter fails closed. It does not switch to OpenCodex, Pi, OpenCode CLI, a
native Codex provider, or another model automatically.
