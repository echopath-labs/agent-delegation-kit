# Executor Result

The executor may report `completed`, `blocked`, or `failed`. The adapter may
normalize malformed or interrupted execution as `failed`, and may set the final
Execution Result to `rejected` when independent postflight checks find a contract
violation.

Review executor self-report separately from Git and validation evidence. A
`completed` result remains pending host or human acceptance.
