# Scope Breach

A scope breach is an observed action or effect outside the authority granted by
the envelope. Out-of-allowlist changed paths are the first enforced form.

When a breach is detected:

1. Mark the Execution Result `rejected`.
2. List every detected breach.
3. Do not silently widen the allowlist after execution.
4. Do not delete or revert user work automatically.
5. Return control to the host for diff review and recovery instructions.
