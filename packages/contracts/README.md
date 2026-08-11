# Neutral Contracts

This package owns the Agent-neutral delegation envelope, path policy, shared
error contract, and versioned public JSON schemas. It must not import a host,
executor, adapter, provider, model, bridge, or CLI package.

The contracts define bounded authority and evidence shapes. They do not select
an execution harness or grant acceptance authority to an executor.
