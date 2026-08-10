import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function createGitRepository() {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-delegation-kit-test-"));
  await execFileAsync("git", ["init", "-b", "main"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "tests@example.invalid"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Agent Delegation Kit Tests"], { cwd: root });
  await writeFile(path.join(root, "README.md"), "# Fixture\n", "utf8");
  await execFileAsync("git", ["add", "README.md"], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "test: baseline"], { cwd: root });
  return root;
}

export async function createDirectory() {
  return mkdtemp(path.join(os.tmpdir(), "agent-delegation-kit-dir-"));
}

export async function makeMinimalPlugin(root, manifest) {
  await mkdir(path.join(root, ".agents", "plugins"), { recursive: true });
  await mkdir(path.join(root, "skills", "demo"), { recursive: true });
  await mkdir(path.join(root, "contracts"), { recursive: true });
  await writeFile(path.join(root, "plugin.json"), JSON.stringify(manifest, null, 2));
  await writeFile(path.join(root, ".agents", "plugins", "marketplace.json"), JSON.stringify({
    name: "fixture-marketplace",
    plugins: [{ name: manifest.name, source: { source: "local", path: "." } }]
  }, null, 2));
  await writeFile(path.join(root, "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: Demo skill.\n---\n");
  await writeFile(path.join(root, "contracts", "task-envelope.schema.json"), "{}\n");
  await writeFile(path.join(root, "contracts", "execution-result.schema.json"), "{}\n");
}

export function makeEnvelope(root, overrides = {}) {
  const envelope = {
    schemaVersion: "1.0.0",
    taskId: "test-task",
    objective: "Make one bounded fixture edit.",
    expectedOutcome: "The allowed file is updated.",
    repository: {
      root,
      workingDirectory: ".",
      dirtyTree: { allow: false, acknowledgedPaths: [] }
    },
    scope: {
      allowedPaths: ["allowed.txt", "README.md"],
      forbiddenPaths: ["private.txt", ".env", ".env.*"]
    },
    instructions: ["Stay inside the envelope."],
    constraints: ["Do not commit or push."],
    validation: [
      { id: "pass", argv: [process.execPath, "-e", "process.exit(0)"], timeoutMs: 10_000 }
    ],
    requiredEvidence: ["git_preflight", "changed_paths", "validation_results", "executor_report"],
    stopConditions: ["Stop if authority is missing."],
    resultFormat: { schemaVersion: "1.0.0" },
    execution: { timeoutMs: 10_000 }
  };
  return deepMerge(envelope, overrides);
}

function deepMerge(base, overrides) {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) return overrides ?? base;
  const output = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    output[key] = value && typeof value === "object" && !Array.isArray(value)
      ? deepMerge(base?.[key] ?? {}, value)
      : value;
  }
  return output;
}
