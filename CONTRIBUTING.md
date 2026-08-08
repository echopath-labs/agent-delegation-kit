# Contributing

Keep changes scoped to portable delegation contracts or an explicit host,
executor, or adapter boundary.

Before submitting a change:

1. Run `npm run check` with Node.js 20 or later.
2. Add or update tests for contract, Git-boundary, and error behavior.
3. Do not commit credentials, authentication files, personal absolute paths,
   private planning records, or raw executor logs.
4. Keep provider and model choices configurable.
5. Treat executor completion and host acceptance as separate concepts.

Public changes should be understandable without access to any private planning
workspace.
