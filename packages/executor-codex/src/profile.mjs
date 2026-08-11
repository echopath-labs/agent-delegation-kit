import { createHash } from "node:crypto";
import { DelegationError } from "../../contracts/src/errors.mjs";
import { SensitiveUrlDecodeBudgetError, SensitiveUrlEncodingError, sensitiveUrlValues } from "../../core/src/redact.mjs";

const PROFILE_KEYS = new Set([
  "codexCommand",
  "codexProfile",
  "model",
  "reasoning",
  "external",
  "environmentAllowlist",
  "router",
  "provider"
]);
const ROUTER_KEYS = new Set(["healthUrl", "timeoutMs"]);
const PROVIDER_KEYS = new Set(["name", "baseUrl", "wireApi", "credentialEnv"]);
const REASONING_LEVELS = new Set(["minimal", "low", "medium", "high", "xhigh", "max"]);
const CREDENTIAL_NAME = /(api.?key|access.?token|auth.?token|password|secret|credential)/i;
const SAFE_ENVIRONMENT_NAMES = new Set([
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
  "http_proxy", "https_proxy", "all_proxy", "no_proxy"
]);
const PROFILE_NAME = /^[A-Za-z0-9._-]+$/;
const PROVIDER_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DIRECT_MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;

function requireObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DelegationError("invalid_worker_profiles", `${field} must be an object.`);
  }
  return value;
}

function optionalString(value, field) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("\0")) {
    throw new DelegationError("invalid_worker_profiles", `${field} must be a non-empty string.`);
  }
  return value;
}

function validateRouter(value, field) {
  if (value === undefined) return undefined;
  const router = requireObject(value, field);
  const unknown = Object.keys(router).filter((key) => !ROUTER_KEYS.has(key));
  if (unknown.length > 0) throw new DelegationError("invalid_worker_profiles", `${field} has unknown field(s): ${unknown.join(", ")}.`);
  const healthUrl = optionalString(router.healthUrl, `${field}.healthUrl`);
  let parsed;
  try {
    parsed = new URL(healthUrl);
  } catch {
    throw new DelegationError("invalid_worker_profiles", `${field}.healthUrl must be a valid URL.`);
  }
  if (!["http:", "https:"].includes(parsed.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) {
    throw new DelegationError("invalid_worker_profiles", `${field}.healthUrl must use an HTTP(S) loopback address.`);
  }
  const timeoutMs = router.timeoutMs ?? 5000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
    throw new DelegationError("invalid_worker_profiles", `${field}.timeoutMs is invalid.`);
  }
  return { healthUrl, timeoutMs };
}

function validateProvider(value, field) {
  if (value === undefined) return undefined;
  const provider = requireObject(value, field);
  const unknown = Object.keys(provider).filter((key) => !PROVIDER_KEYS.has(key));
  if (unknown.length > 0) throw new DelegationError("invalid_worker_profiles", `${field} has unknown field(s): ${unknown.join(", ")}.`);
  const name = optionalString(provider.name, `${field}.name`);
  if (!PROVIDER_NAME.test(name)) {
    throw new DelegationError("invalid_worker_profiles", `${field}.name contains unsupported characters.`);
  }
  const baseUrl = optionalString(provider.baseUrl, `${field}.baseUrl`);
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new DelegationError("invalid_worker_profiles", `${field}.baseUrl must be a valid URL.`);
  }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname);
  if ((parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new DelegationError("invalid_worker_profiles", `${field}.baseUrl must use HTTPS or loopback HTTP and must not contain credentials, query parameters, or fragments.`);
  }
  try {
    sensitiveUrlValues(parsed.toString());
  } catch (error) {
    if (error instanceof SensitiveUrlDecodeBudgetError) {
      throw new DelegationError("invalid_worker_profiles", `${field}.baseUrl exceeds the supported URL path decoding bound.`);
    }
    if (error instanceof SensitiveUrlEncodingError) {
      throw new DelegationError("invalid_worker_profiles", `${field}.baseUrl contains unsupported URL path encoding.`);
    }
    throw error;
  }
  const wireApi = optionalString(provider.wireApi, `${field}.wireApi`);
  if (wireApi !== "responses") {
    throw new DelegationError("invalid_worker_profiles", `${field}.wireApi must be responses.`);
  }
  const credentialEnv = optionalString(provider.credentialEnv, `${field}.credentialEnv`);
  if (!ENVIRONMENT_NAME.test(credentialEnv)) {
    throw new DelegationError("invalid_worker_profiles", `${field}.credentialEnv must be an environment-variable name.`);
  }
  return {
    name,
    baseUrl: parsed.toString().replace(/\/$/, ""),
    wireApi,
    credentialEnv
  };
}

function normalizeProfile(name, value) {
  if (CREDENTIAL_NAME.test(name)) throw new DelegationError("invalid_worker_profiles", `Credential-like profile name is not allowed: ${name}.`);
  const profile = requireObject(value, `profiles.${name}`);
  const unknown = Object.keys(profile).filter((key) => !PROFILE_KEYS.has(key));
  if (unknown.length > 0) throw new DelegationError("invalid_worker_profiles", `profiles.${name} has unknown field(s): ${unknown.join(", ")}.`);

  const codexCommand = optionalString(profile.codexCommand ?? "codex", `profiles.${name}.codexCommand`);
  const codexProfile = optionalString(profile.codexProfile, `profiles.${name}.codexProfile`);
  if (codexProfile !== undefined && !PROFILE_NAME.test(codexProfile)) {
    throw new DelegationError("invalid_worker_profiles", `profiles.${name}.codexProfile contains unsupported characters.`);
  }
  const model = optionalString(profile.model, `profiles.${name}.model`);
  const reasoning = profile.reasoning;
  if (reasoning !== undefined && !REASONING_LEVELS.has(reasoning)) {
    throw new DelegationError("invalid_worker_profiles", `profiles.${name}.reasoning is invalid.`);
  }
  if (profile.external !== undefined && typeof profile.external !== "boolean") {
    throw new DelegationError("invalid_worker_profiles", `profiles.${name}.external must be boolean.`);
  }
  const environmentAllowlist = profile.environmentAllowlist ?? [];
  if (!Array.isArray(environmentAllowlist) || environmentAllowlist.some((item) => !SAFE_ENVIRONMENT_NAMES.has(item))) {
    throw new DelegationError("invalid_worker_profiles", `profiles.${name}.environmentAllowlist contains an unsupported name.`);
  }
  if (new Set(environmentAllowlist).size !== environmentAllowlist.length) {
    throw new DelegationError("invalid_worker_profiles", `profiles.${name}.environmentAllowlist must not contain duplicates.`);
  }
  const router = validateRouter(profile.router, `profiles.${name}.router`);
  const provider = validateProvider(profile.provider, `profiles.${name}.provider`);
  if (provider) {
    if (codexProfile !== undefined || router !== undefined) {
      throw new DelegationError("invalid_worker_profiles", `profiles.${name}.provider cannot be combined with codexProfile or router.`);
    }
    if (model === undefined || !DIRECT_MODEL_NAME.test(model)) {
      throw new DelegationError("invalid_worker_profiles", `profiles.${name}.provider requires a safe explicit model.`);
    }
    if (profile.external !== true) {
      throw new DelegationError("invalid_worker_profiles", `profiles.${name}.provider requires external to be true.`);
    }
  }

  return {
    name,
    codexCommand,
    codexProfile,
    model,
    reasoning,
    external: profile.external ?? false,
    environmentAllowlist: [...environmentAllowlist],
    router,
    provider
  };
}

export function validateWorkerProfiles(input) {
  const registry = requireObject(input, "worker profile registry");
  const unknown = Object.keys(registry).filter((key) => !["schemaVersion", "profiles"].includes(key));
  if (unknown.length > 0) throw new DelegationError("invalid_worker_profiles", `Unknown registry field(s): ${unknown.join(", ")}.`);
  if (registry.schemaVersion !== "1.0.0") throw new DelegationError("invalid_worker_profiles", "Worker profile schemaVersion must be 1.0.0.");
  const profiles = requireObject(registry.profiles, "profiles");
  if (Object.keys(profiles).length === 0) throw new DelegationError("invalid_worker_profiles", "At least one worker profile is required.");
  return {
    schemaVersion: "1.0.0",
    profiles: Object.fromEntries(Object.entries(profiles).map(([name, value]) => [name, normalizeProfile(name, value)]))
  };
}

export function resolveWorkerProfile(registryInput, name) {
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new DelegationError("worker_profile_required", "A named worker profile is required.");
  }
  const registry = validateWorkerProfiles(registryInput);
  const profile = registry.profiles[name];
  if (!profile) throw new DelegationError("worker_profile_not_found", `Worker profile is not configured: ${name}.`);
  const fingerprintInput = JSON.stringify(profile);
  return {
    ...profile,
    fingerprint: `sha256:${createHash("sha256").update(fingerprintInput).digest("hex")}`
  };
}

export function workerEnvironment(profile, source = process.env) {
  const environment = Object.fromEntries(profile.environmentAllowlist.flatMap((name) => source[name] === undefined ? [] : [[name, source[name]]]));
  if (profile.provider) {
    requireProviderCredential(profile, source);
    environment[profile.provider.credentialEnv] = source[profile.provider.credentialEnv];
  }
  return environment;
}

export function requireProviderCredential(profile, source = process.env) {
  if (!profile.provider) return { checked: false };
  const name = profile.provider.credentialEnv;
  const value = source[name];
  if (typeof value !== "string" || value.trim().length < 8) {
    throw new DelegationError("provider_credential_unavailable", `Direct provider credential environment variable is unavailable: ${name}.`);
  }
  return { checked: true, credentialEnv: name };
}
