# Task Envelope

Use `packages/contracts/schemas/task-envelope.schema.json` as the authoritative transport shape.

A complete envelope names the objective, expected outcome, target Git root,
working directory, dirty-tree policy, readable, allowed, and forbidden paths, repository
instructions, constraints, validation commands, required evidence, stop
conditions, and result version.

Use exact `scope.readablePaths` when the coordinating host already knows the
complete context. For bounded dependency discovery, add `scope.discoverablePaths`
and `contextPlanning` according to `context-planning.md`. Discovery authority
does not grant output authority, and readiness is not acceptance validation.

Express a read-only file by placing it in `scope.readablePaths`, omitting it
from writable `scope.allowedPaths`, and ensuring it does not match
`scope.forbiddenPaths`. Readable and forbidden authority are contradictory and
must be resolved before worker launch.

Execution profiles are optional adapter configuration. Do not include provider
credentials, API keys, access tokens, passwords, or secret environment values.
