# Codex Delegated Executor

Codex can act as a Delegated Executor when it runs as a distinguishable Agent
Instance with its own task identity, session attribution, bounded authority, and
result provenance.

The first transport is an independent non-interactive `codex exec` process. A
host-approved named worker profile selects the executable, model alias,
reasoning effort, and one explicit route: native Codex configuration, a direct
Responses-compatible provider, or an optional loopback router. Provider
credential values and user-specific paths never belong in a delegation envelope
or public example.

Executor completion remains pending Coordinating Host review. This boundary
does not authorize applying work to the source workspace, acceptance, commits,
pushes, tags, releases, or deployments.

The executor writes only inside a sanitized capsule by default. It must return
`contracts/codex-worker-result.schema.json`, and its changed-file and validation
claims remain separate from host-observed Git and command evidence. Corrections
use `codex exec resume` with the original thread; they never select `--last`.

A direct-provider worker receives a generated task-scoped Codex base
configuration rather than the user's global `config.toml` or `auth.json`. The
configuration binds the provider, base URL, `responses` wire API, credential
environment-variable name, model, and workspace-write sandbox. Its bytes and
the exact disposable capsule project trust are materialized before first use.
Its bytes and permissions are verified again before correction resume; drift stops execution
instead of selecting another route.
