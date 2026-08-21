# Public Preview Release Checklist

This checklist prepares a human-authorized `0.1.x` GitHub Public Preview. It
does not authorize a commit, remote change, push, tag, GitHub release, npm
publish, or deployment.

## Candidate Validation

From a clean candidate repository with Node.js 20 or later and Git:

```bash
npm run check
RELAYPACT_CODEX_PLUGIN_SMOKE=1 npm run smoke:codex-plugin
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

## 0.1.2 release-time documentation closeout

The checked-in source state is intentionally `candidate`: package and Plugin
metadata report `0.1.2`, while public onboarding says that `v0.1.2` is not
yet released and keeps `v0.1.1` as the latest published installation. Never
merge released-state documentation to `main` while the tag or GitHub Release
is absent.

This closeout is a later, separately authorized release operation:

1. Start a clean release branch from the then-current live `main`. Record the
   exact commit and confirm the remote owner is `echopath-labs/relaypact`.
2. Confirm the authenticated GitHub identity is exactly `chasechou007`.
   Identity configuration changes are out of scope; stop on mismatch.
3. Obtain the human-supplied release date and explicit approval for commit,
   tag, push, GitHub Release, and main integration. Do not infer a date from
   package metadata, commit time, CI, or this checklist.
4. In one scoped release-state commit:
   - change `PROJECT_RELEASE_STATE` in `scripts/validate-package.mjs` from
     `candidate` to `released`;
   - update `README.md`, `README.zh-CN.md`,
     `docs/agent-quickstart.md`, `docs/agent-quickstart.zh-CN.md`, and
     `docs/manual-configuration.md` so `v0.1.2` is the latest published
     install and every tag checkout verifies `HEAD` against the peeled
     `v0.1.2^{}` commit;
   - change the changelog heading to
     `## [0.1.2] - <human-supplied YYYY-MM-DD> - Public Preview` and restore
     the `v0.1.1...v0.1.2` comparison link;
   - update focused validation fixtures only as required by the released-state
     branch of the package validator.
5. Run the full candidate validation, exact public allowlist, privacy/history
   and security scans, no-object-sharing clean-clone validation, and Plugin
   discovery. Confirm the release-state commit is clean and approved.
6. Under the separate remote authorization, create the annotated `v0.1.2` tag
   at that exact release-state commit, push only the approved tag, and create
   the GitHub Release. Verify the remote tag peels to the approved commit and
   the GitHub Release is visible before changing live `main`.
7. Only after both remote objects exist, integrate that same release-state
   commit to `main` through the separately approved path. Re-fetch and verify
   live `main`, tag identity, Release visibility, bilingual links, and install
   commands.

If authorization, identity, human-supplied date, commit identity, remote tag,
Release visibility, CI, or validation is absent or mismatched, stop. Before any
remote operation, discard the release branch to return to candidate state.
After a tag or Release is public, never rewrite the tag; leave `main` in its
last truthful state, withdraw the Release if explicitly authorized, and publish
a corrected version.

## Manual GitHub Gates

Before the first public preview:

- establish `main` as the default branch and preserve the reviewed candidate
  history;
- configure the `echopath-labs/relaypact` remote without embedding
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
