import { DelegationError } from "../errors.mjs";
import { runProcess } from "../process.mjs";

export const MINIMUM_CODEX_VERSION = "0.147.0";
const SAFE_COMPATIBILITY_ENVIRONMENT = ["PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "TMPDIR", "SHELL", "SSL_CERT_FILE", "SSL_CERT_DIR"];

export function parseCodexVersion(text) {
  const match = String(text).match(/\b(?:codex-cli|codex)\s+(\d+)\.(\d+)\.(\d+)\b/i);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}

function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function compatibilityEnvironment(source) {
  return Object.fromEntries(SAFE_COMPATIBILITY_ENVIRONMENT.flatMap((name) => source[name] === undefined ? [] : [[name, source[name]]]));
}

async function checkedRun(run, command, args, environment) {
  try {
    return await run(command, args, { timeoutMs: 15_000, env: environment });
  } catch (error) {
    throw new DelegationError("codex_unavailable", `Codex could not start: ${error.message}`);
  }
}

export async function checkCodexCompatibility(profile, options = {}) {
  const run = options.runProcess ?? runProcess;
  const environment = compatibilityEnvironment(options.environment ?? process.env);
  const versionResult = await checkedRun(run, profile.codexCommand, ["--version"], environment);
  const version = parseCodexVersion(`${versionResult.stdout}\n${versionResult.stderr}`);
  if (versionResult.exitCode !== 0 || !version) {
    throw new DelegationError("codex_version_unavailable", "Could not determine the installed Codex CLI version.");
  }
  if (compareVersions(version, MINIMUM_CODEX_VERSION) < 0) {
    throw new DelegationError("codex_unsupported", `Codex CLI ${MINIMUM_CODEX_VERSION} or later is required; found ${version}.`);
  }

  const execHelp = await checkedRun(run, profile.codexCommand, ["exec", "--help"], environment);
  const resumeHelp = await checkedRun(run, profile.codexCommand, ["exec", "resume", "--help"], environment);
  const execText = `${execHelp.stdout}\n${execHelp.stderr}`;
  const resumeText = `${resumeHelp.stdout}\n${resumeHelp.stderr}`;
  const missing = [];
  for (const flag of ["--json", "--output-schema", "--profile", "--sandbox"]) {
    if (!execText.includes(flag)) missing.push(flag);
  }
  if (!/resume/i.test(resumeText) || !resumeText.includes("--json")) missing.push("exec resume --json");
  if (execHelp.exitCode !== 0 || resumeHelp.exitCode !== 0 || missing.length > 0) {
    throw new DelegationError("codex_features_missing", `Installed Codex CLI lacks required feature(s): ${missing.join(", ") || "exec/resume"}.`);
  }

  return {
    command: profile.codexCommand,
    version,
    minimumVersion: MINIMUM_CODEX_VERSION,
    features: ["exec", "resume", "json", "output-schema", "profile", "sandbox"]
  };
}
