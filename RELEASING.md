# Public Preview Release Checklist

This checklist prepares a human-authorized `0.1.x` GitHub Public Preview. It
does not authorize a commit, remote change, push, tag, GitHub release, npm
publish, or deployment.

## Candidate Validation

From a clean candidate repository with Node.js 20 or later and Git:

```bash
npm run check
ADK_CODEX_PLUGIN_SMOKE=1 npm run smoke:codex-plugin
npm pack --dry-run --json
```

`public-files.json` is the exact reviewed public-tree manifest. Any added,
removed, or renamed public file requires an intentional manifest update. The
sole GitHub workflow must also match the reviewed byte digest enforced by the
package validator; changing that digest is a separate security-review event.

The private development workspace additionally runs its exact public allowlist,
sensitive-content, retained-history, clean-clone, OpenSpec, OpenDomain, and
source-backed security-review gates. Raw private scan or dogfood evidence must
not be copied into this repository.

The release candidate must have a post-remediation scan against the exact tree,
no unresolved high-severity finding, no undispositioned medium-severity finding,
and passing adversarial regressions for environment isolation, Git-control
tampering, ignored-file evidence, output truncation, hard timeouts, result
redaction, context budgets and queue pressure, profile projection, concurrent
state changes, archive symlinks, and correction-state validation. Third-party
CI actions must remain pinned to reviewed full commit identifiers.

The candidate `LICENSE` must contain the reviewed Apache License 2.0 text,
`NOTICE` must retain the EchoPath Labs attribution, and `package.json`,
`plugin.json`, both README language entries, and contribution guidance must use
the exact SPDX identifier `Apache-2.0`. License drift is a release blocker.

## Manual GitHub Gates

Before the first public preview:

- establish `main` as the default branch and preserve the reviewed candidate
  history;
- configure the `echopath-labs/agent-delegation-kit` remote without embedding
  credentials in its URL;
- enable GitHub private vulnerability reporting and verify the link in
  [SECURITY.md](SECURITY.md);
- require the `Validate` workflow on protected release changes;
- verify the first remote Ubuntu workflow succeeds;
- inspect the final GitHub diff and release archive;
- obtain an explicit human Go decision before pushing a version tag or creating
  a release.

## Release Positioning

Describe `0.1.x` as a human-reviewed Codex-to-Codex Public Preview for
experienced Codex, Node.js, and Git users. Describe Codex-to-Pi separately as
experimental and optional. Do not claim unattended, production-ready, complete
cross-platform, provider-neutral live reliability, or operating-system sandbox
guarantees beyond the documented contracts.

Keep `package.json` private for the GitHub preview. npm publication requires a
separate design, package-metadata review, provenance plan, and human approval.

## Rollback

Before publication, revert the candidate on its feature branch. After
publication, preserve the public history and either withdraw the preview
release or publish a corrected version. Never rewrite a released tag silently.
