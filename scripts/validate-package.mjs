#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CANONICAL_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const MANIFEST_FIELDS = new Set([
  "$schema", "name", "version", "description", "author", "homepage",
  "repository", "license", "keywords", "extensions"
]);
const ALLOWED_TOP_LEVEL = new Set([
  ".agents", ".git", ".github", ".gitignore", ".npmignore", "CHANGELOG.md",
  "AGENTS.md", "CONTRIBUTING.md", "LICENSE", "README.md", "RELEASING.md", "SECURITY.md",
  "plugin.json", "package.json", "skills", "packages", "bin", "scripts",
  "test", "examples", "docs", "public-files.json", "support-matrix.json"
]);
const PRIVATE_NAMES = new Set(["openspec", "opendomain", ".pi", "auth.json", ".ds_store", "node_modules"]);
const SENSITIVE_EXTENSIONS = /\.(?:pem|key|p12|pfx|log|patch|diff|har)$/iu;
const ALLOWED_ACTIONS = new Set([
  "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
  "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020"
]);
const REVIEWED_WORKFLOW_SHA256 = "6ef860d3bf95bf059a1dcc5e9569cdc46fb277411ef7bef55447c9d3916d6533";
const REQUIRED_PREVIEW_FILES = [
  "AGENTS.md",
  "CHANGELOG.md",
  "RELEASING.md",
  "SECURITY.md",
  ".github/workflows/validate.yml"
];

async function pathExists(candidate) {
  try {
    await stat(candidate);
    return true;
  } catch {
    return false;
  }
}

async function walk(root, current = root, output = []) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (entry.name === ".git" || (current === root && entry.name === "node_modules")) continue;
    const absolute = path.join(current, entry.name);
    const relative = path.relative(root, absolute).replaceAll(path.sep, "/");
    output.push({ entry, absolute, relative });
    if (entry.isDirectory()) await walk(root, absolute, output);
  }
  return output;
}

function validateManifest(manifest, errors) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    errors.push("plugin.json must contain an object.");
    return;
  }
  if (manifest.$schema !== CANONICAL_SCHEMA) errors.push("plugin.json must target Agent Plugins 1.0.0.");
  if (typeof manifest.name !== "string" || !/^[a-z0-9](?!.*(?:--|\.\.))[a-z0-9.-]{0,62}[a-z0-9]$|^[a-z0-9]$/.test(manifest.name)) {
    errors.push("plugin.json name is invalid.");
  }
  const unknown = Object.keys(manifest).filter((key) => !MANIFEST_FIELDS.has(key));
  if (unknown.length > 0) errors.push(`plugin.json has unknown field(s): ${unknown.join(", ")}.`);
  if (manifest.author !== undefined) {
    if (!manifest.author || typeof manifest.author !== "object" || Array.isArray(manifest.author)) errors.push("plugin.json author must be an object.");
    else if (Object.keys(manifest.author).some((key) => !["name", "email", "url"].includes(key))) errors.push("plugin.json author has unknown fields.");
  }
}

async function validatePreviewFiles(root, errors) {
  for (const relative of REQUIRED_PREVIEW_FILES) {
    if (!(await pathExists(path.join(root, ...relative.split("/"))))) {
      errors.push(`${relative} is required for public preview.`);
    }
  }

  const workflowPath = path.join(root, ".github", "workflows", "validate.yml");
  const workflowRoot = path.dirname(workflowPath);
  if (await pathExists(workflowRoot)) {
    const workflows = (await readdir(workflowRoot)).sort();
    if (workflows.length !== 1 || workflows[0] !== "validate.yml") {
      errors.push("Public preview must contain only .github/workflows/validate.yml.");
    }
  }
  if (!(await pathExists(workflowPath))) return;
  const workflow = await readFile(workflowPath, "utf8");
  const workflowSha256 = createHash("sha256").update(workflow).digest("hex");
  if (workflowSha256 !== REVIEWED_WORKFLOW_SHA256) {
    errors.push("CI workflow bytes must exactly match the reviewed public-preview workflow.");
  }
  const requiredPatterns = [
    [/^permissions:\s*\n\s+contents:\s*read\s*$/m, "CI must grant only read access to repository contents."],
    [/uses:\s*actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1\b/, "CI must pin the reviewed checkout v7 commit."],
    [/uses:\s*actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020\b/, "CI must pin the reviewed setup-node v7 commit."],
    [/node-version:\s*20\.20\.2\b/, "CI must use the verified Node.js 20 baseline."],
    [/package-manager-cache:\s*false\b/, "CI must disable unused automatic package-manager caching."],
    [/run:\s*npm run check\b/, "CI must run the deterministic package checks."],
    [/run:\s*npm pack --dry-run --json\b/, "CI must inspect the package dry-run."],
  ];
  for (const [pattern, message] of requiredPatterns) {
    if (!pattern.test(workflow)) errors.push(message);
  }
  if (/\bpull_request_target\s*:/u.test(workflow)) {
    errors.push("CI must not run public-preview validation with pull_request_target.");
  }
  if (/\bsecrets\s*\./u.test(workflow)) {
    errors.push("CI validation must not require repository secrets.");
  }
  const actionReferences = [...workflow.matchAll(/\buses:\s*([^\s#]+)/gu)].map((match) => match[1]);
  for (const reference of actionReferences) {
    if (!ALLOWED_ACTIONS.has(reference)) errors.push(`CI action is not on the reviewed exact allowlist: ${reference}.`);
  }
  if (/\bwrite-all\b|^\s*[A-Za-z_-]+:\s*write\s*$/mu.test(workflow)) {
    errors.push("CI validation must not grant write permissions.");
  }
}

export async function validatePackage(root) {
  const errors = [];
  const resolvedRoot = await realpath(root);
  let manifest;
  let publicFiles;
  try {
    manifest = JSON.parse(await readFile(path.join(resolvedRoot, "plugin.json"), "utf8"));
  } catch (error) {
    errors.push(`plugin.json is missing or invalid JSON: ${error.message}`);
  }
  if (manifest) validateManifest(manifest, errors);
  try {
    const publicManifest = JSON.parse(await readFile(path.join(resolvedRoot, "public-files.json"), "utf8"));
    publicFiles = publicManifest?.files;
    if (
      publicManifest?.schemaVersion !== "1.0.0" ||
      !Array.isArray(publicFiles) ||
      publicFiles.some((item) => typeof item !== "string" || item.length === 0 || item.startsWith("/") || item.includes("\\") || item.split("/").includes("..")) ||
      JSON.stringify(publicFiles) !== JSON.stringify([...new Set(publicFiles)].sort())
    ) {
      throw new Error("manifest must contain one sorted unique normalized file list");
    }
  } catch (error) {
    errors.push(`public-files.json is missing or invalid: ${error.message}`);
  }
  await validatePreviewFiles(resolvedRoot, errors);

  try {
    const marketplace = JSON.parse(await readFile(path.join(resolvedRoot, ".agents", "plugins", "marketplace.json"), "utf8"));
    const entry = Array.isArray(marketplace.plugins)
      ? marketplace.plugins.find((item) => item?.name === manifest?.name)
      : null;
    if (typeof marketplace.name !== "string" || marketplace.name.length === 0) {
      errors.push("Local marketplace name is missing or invalid.");
    }
    if (!entry || entry.source?.source !== "local" || entry.source?.path !== ".") {
      errors.push("Local marketplace must expose the root plugin by its manifest name.");
    }
  } catch (error) {
    errors.push(`.agents/plugins/marketplace.json is missing or invalid JSON: ${error.message}`);
  }

  const entries = await walk(resolvedRoot);
  if (publicFiles) {
    const actualFiles = entries
      .filter((item) => item.entry.isFile())
      .map((item) => item.relative)
      .sort();
    if (JSON.stringify(actualFiles) !== JSON.stringify(publicFiles)) {
      const expected = new Set(publicFiles);
      const actual = new Set(actualFiles);
      const extra = actualFiles.filter((item) => !expected.has(item));
      const missing = publicFiles.filter((item) => !actual.has(item));
      errors.push(`Public file manifest mismatch; extra: ${extra.join(", ") || "none"}; missing: ${missing.join(", ") || "none"}.`);
    }
  }
  const manifests = entries.filter((item) => item.entry.isFile() && item.entry.name === "plugin.json");
  if (manifests.length !== 1 || manifests[0]?.relative !== "plugin.json") {
    errors.push("The package must contain exactly one plugin.json at its root.");
  }
  if (await pathExists(path.join(resolvedRoot, ".codex-plugin", "plugin.json"))) {
    errors.push(".codex-plugin/plugin.json is not allowed.");
  }

  const topLevel = await readdir(resolvedRoot);
  const unexpected = topLevel.filter((name) => !ALLOWED_TOP_LEVEL.has(name));
  if (unexpected.length > 0) errors.push(`Unexpected top-level path(s): ${unexpected.join(", ")}.`);

  const skillsRoot = path.join(resolvedRoot, "skills");
  if (!(await pathExists(skillsRoot))) errors.push("skills/ is missing.");
  else {
    const skills = (await readdir(skillsRoot, { withFileTypes: true })).filter((item) => item.isDirectory());
    if (skills.length === 0) errors.push("skills/ must contain at least one immediate skill directory.");
    for (const skill of skills) {
      const skillFile = path.join(skillsRoot, skill.name, "SKILL.md");
      if (!(await pathExists(skillFile))) errors.push(`skills/${skill.name}/SKILL.md is missing.`);
      if (skill.name === "codex-delegated-execution") {
        const wrapper = path.join(skillsRoot, skill.name, "scripts", "agent-delegation-kit.mjs");
        if (!(await pathExists(wrapper))) errors.push("The Codex delegation Skill-local wrapper is missing.");
        else if (((await stat(wrapper)).mode & 0o111) === 0) errors.push("The Codex delegation Skill-local wrapper must be executable.");
      }
    }
  }

  for (const item of entries) {
    if (item.entry.isSymbolicLink()) {
      errors.push(`Symbolic links are not allowed in the public package: ${item.relative}.`);
    }
    if (item.relative.split("/").some((part) => PRIVATE_NAMES.has(part.toLowerCase()))) {
      errors.push(`Private or generated path is not allowed: ${item.relative}.`);
    }
    if (item.entry.isFile() && SENSITIVE_EXTENSIONS.test(item.relative)) {
      errors.push(`Sensitive artifact type is not allowed: ${item.relative}.`);
    }
    if (item.entry.isFile() && /(^|\/)\.env(?:\.|$)/.test(item.relative)) {
      errors.push(`Environment file is not allowed: ${item.relative}.`);
    }
    if (item.entry.isFile() && /\.(?:md|json|mjs|js|txt|ya?ml)$/i.test(item.relative)) {
      const text = await readFile(item.absolute, "utf8");
      if (/\/Users\/[A-Za-z0-9._-]+\//.test(text) || /[A-Za-z]:\\Users\\[^\\]+\\/.test(text)) {
        errors.push(`User-specific absolute path found in ${item.relative}.`);
      }
    }
  }

  for (const contract of [
    "adapter-support-matrix.schema.json",
    "task-envelope.schema.json",
    "context-manifest.schema.json",
    "execution-result.schema.json",
    "codex-worker-result.schema.json",
    "host-review-packet.schema.json"
  ]) {
    try {
      JSON.parse(await readFile(path.join(resolvedRoot, "packages", "contracts", "schemas", contract), "utf8"));
    } catch (error) {
      errors.push(`packages/contracts/schemas/${contract} is missing or invalid JSON: ${error.message}`);
    }
  }

  return errors;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const errors = await validatePackage(root);
  if (errors.length > 0) {
    process.stderr.write(`${errors.map((item) => `- ${item}`).join("\n")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("Package validation passed.\n");
  }
}
