# Task Envelope

Use `contracts/task-envelope.schema.json` as the authoritative transport shape.

A complete envelope names the objective, expected outcome, target Git root,
working directory, dirty-tree policy, allowed and forbidden paths, repository
instructions, constraints, validation commands, required evidence, stop
conditions, and result version.

Execution profiles are optional adapter configuration. Do not include provider
credentials, API keys, access tokens, passwords, or secret environment values.
