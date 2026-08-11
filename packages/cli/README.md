# CLI Composition

This package owns argument parsing, support discovery, and lazy adapter loading.
`run-codex`, `correct-codex`, and `decide-codex` load the public-preview
Codex-to-Codex route. The terminal decision archives evidence but never applies
the candidate patch to the source repository.
`run-pi` loads the experimental Codex-to-Pi route explicitly. `support` reads
sanitized metadata without loading an executor.

The CLI never falls back from one execution harness to another.
