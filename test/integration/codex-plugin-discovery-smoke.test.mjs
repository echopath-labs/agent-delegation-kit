import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { MINIMUM_CODEX_VERSION, parseCodexVersion } from "../../packages/executor-codex/src/compatibility.mjs";

const execFileAsync = promisify(execFile);
const enabled = process.env.ADK_CODEX_PLUGIN_SMOKE === "1";
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function containsPluginIdentity(value) {
  if (value === "agent-delegation-kit" || (typeof value === "string" && value.startsWith("agent-delegation-kit@"))) return true;
  if (Array.isArray(value)) return value.some(containsPluginIdentity);
  if (value && typeof value === "object") return Object.values(value).some(containsPluginIdentity);
  return false;
}

function meetsMinimumVersion(actual, minimum) {
  const left = actual.split(".").map(Number);
  const right = minimum.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return true;
}

async function findNamedFiles(root, expectedName, output = []) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return output;
  }
  for (const entry of entries) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) await findNamedFiles(absolute, expectedName, output);
    else if (entry.isFile() && entry.name === expectedName) output.push(absolute);
  }
  return output;
}

async function runCodex(command, args, environment) {
  const result = await execFileAsync(command, args, {
    cwd: packageRoot,
    env: environment,
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 2 * 1024 * 1024
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

test("opt-in supported Codex discovers the portable plugin and packaged skill", { skip: !enabled }, async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "adk-codex-plugin-smoke-"));
  const codexHome = path.join(temporaryRoot, "codex-home");
  const command = process.env.ADK_CODEX_COMMAND ?? "codex";
  const environment = { ...process.env, CODEX_HOME: codexHome };
  try {
    await mkdir(codexHome, { recursive: true, mode: 0o700 });

    const versionResult = await runCodex(command, ["--version"], environment);
    const version = parseCodexVersion(`${versionResult.stdout}\n${versionResult.stderr}`);
    assert.ok(version, "Codex version must be parseable.");
    assert.ok(meetsMinimumVersion(version, MINIMUM_CODEX_VERSION), `Codex ${MINIMUM_CODEX_VERSION} or later is required.`);

    await runCodex(command, ["plugin", "marketplace", "add", packageRoot, "--json"], environment);
    const available = JSON.parse((await runCodex(command, ["plugin", "list", "--marketplace", "agent-delegation-kit-local", "--available", "--json"], environment)).stdout);
    assert.equal(containsPluginIdentity(available), true, "Codex did not list the portable plugin from the isolated marketplace.");

    const installed = JSON.parse((await runCodex(command, ["plugin", "add", "agent-delegation-kit@agent-delegation-kit-local", "--json"], environment)).stdout);
    assert.equal(containsPluginIdentity(installed), true, "Codex did not report installing the portable plugin.");
    const listed = JSON.parse((await runCodex(command, ["plugin", "list", "--marketplace", "agent-delegation-kit-local", "--json"], environment)).stdout);
    assert.equal(containsPluginIdentity(listed), true, "Codex did not list the installed portable plugin.");

    const manifests = await findNamedFiles(codexHome, "plugin.json");
    const matchingManifest = (await Promise.all(manifests.map(async (file) => {
      try {
        return JSON.parse(await readFile(file, "utf8")).name === "agent-delegation-kit" ? file : null;
      } catch {
        return null;
      }
    }))).find(Boolean);
    assert.ok(matchingManifest, "Installed plugin cache does not contain the expected root plugin.json.");
    const skills = await findNamedFiles(path.dirname(matchingManifest), "SKILL.md");
    const skill = skills.find((file) => file.endsWith(path.join("skills", "codex-delegated-execution", "SKILL.md")));
    assert.ok(skill, "Installed plugin cache does not contain the expected delegated-execution skill.");
    const wrapper = path.join(path.dirname(skill), "scripts", "agent-delegation-kit.mjs");
    const wrapperSupport = JSON.parse((await runCodex(process.execPath, [wrapper, "support"], environment)).stdout);
    assert.equal(wrapperSupport.routes[0].id, "codex-codex", "Installed Skill-local wrapper did not resolve the packaged CLI.");
    assert.equal(wrapperSupport.routes[0].status, "public-preview");
    const wrapperDoctor = JSON.parse((await runCodex(process.execPath, [wrapper, "doctor"], environment)).stdout);
    assert.equal(wrapperDoctor.state, "ready", "Installed Skill-local doctor did not verify the isolated plugin.");
    assert.equal(wrapperDoctor.executor.command, "codex exec");
    assert.equal(wrapperDoctor.executor.additionalInstallationRequired, false);
    context.diagnostic(JSON.stringify({
      codexVersion: version,
      marketplace: "agent-delegation-kit-local",
      plugin: "agent-delegation-kit",
      expectedSkill: "codex-delegated-execution",
      isolatedHome: true
    }));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
