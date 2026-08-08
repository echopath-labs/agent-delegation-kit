#!/usr/bin/env node
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CANONICAL_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const MANIFEST_FIELDS = new Set([
  "$schema", "name", "version", "description", "author", "homepage",
  "repository", "license", "keywords", "extensions"
]);
const ALLOWED_TOP_LEVEL = new Set([
  ".git", ".gitignore", "LICENSE", "README.md", "CONTRIBUTING.md",
  "plugin.json", "package.json", "skills", "contracts", "hosts", "executors",
  "adapters", "bin", "src", "scripts", "test", "examples"
]);
const PRIVATE_NAMES = new Set(["openspec", "opendomain", ".pi", "auth.json", ".DS_Store"]);

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
    if (entry.name === ".git" || entry.name === "node_modules") continue;
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

export async function validatePackage(root) {
  const errors = [];
  const resolvedRoot = await realpath(root);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(resolvedRoot, "plugin.json"), "utf8"));
  } catch (error) {
    errors.push(`plugin.json is missing or invalid JSON: ${error.message}`);
  }
  if (manifest) validateManifest(manifest, errors);

  const entries = await walk(resolvedRoot);
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
    }
  }

  for (const item of entries) {
    if (item.relative.split("/").some((part) => PRIVATE_NAMES.has(part))) {
      errors.push(`Private or generated path is not allowed: ${item.relative}.`);
    }
    if (item.entry.isFile() && /(^|\/)\.env(?:\.|$)/.test(item.relative)) {
      errors.push(`Environment file is not allowed: ${item.relative}.`);
    }
    if (item.entry.isFile() && /\.(?:md|json|mjs|js|txt)$/.test(item.relative)) {
      const text = await readFile(item.absolute, "utf8");
      if (/\/Users\/[A-Za-z0-9._-]+\//.test(text) || /[A-Za-z]:\\Users\\[^\\]+\\/.test(text)) {
        errors.push(`User-specific absolute path found in ${item.relative}.`);
      }
    }
  }

  for (const contract of [
    "task-envelope.schema.json",
    "execution-result.schema.json",
    "codex-worker-result.schema.json",
    "host-review-packet.schema.json"
  ]) {
    try {
      JSON.parse(await readFile(path.join(resolvedRoot, "contracts", contract), "utf8"));
    } catch (error) {
      errors.push(`contracts/${contract} is missing or invalid JSON: ${error.message}`);
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
