import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validatePackage } from "../scripts/validate-package.mjs";
import { validateArchitecture } from "../scripts/validate-architecture.mjs";
import { makeMinimalPlugin } from "./helpers.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const validManifest = {
  $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  name: "fixture-plugin"
};

test("current package layout is valid", async () => {
  assert.deepEqual(await validatePackage(packageRoot), []);
});

test("current monorepo ownership and support matrix are valid", async () => {
  assert.deepEqual(await validateArchitecture(packageRoot), []);
});

test("architecture validation rejects Codex-to-Pi coupling", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "adk-architecture-"));
  await cp(path.join(packageRoot, "packages"), path.join(root, "packages"), { recursive: true });
  await cp(path.join(packageRoot, "package.json"), path.join(root, "package.json"));
  await cp(path.join(packageRoot, "support-matrix.json"), path.join(root, "support-matrix.json"));
  const target = path.join(root, "packages", "executor-codex", "src", "forbidden.mjs");
  await writeFile(target, "import '../../executor-pi/src/executor.mjs';\n");
  const errors = await validateArchitecture(root);
  assert(errors.some((item) => item.includes("couples the Codex route")));
  await rm(root, { recursive: true });
});

test("architecture validation rejects unowned and computed imports", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "adk-architecture-"));
  await cp(path.join(packageRoot, "packages"), path.join(root, "packages"), { recursive: true });
  await cp(path.join(packageRoot, "package.json"), path.join(root, "package.json"));
  await cp(path.join(packageRoot, "support-matrix.json"), path.join(root, "support-matrix.json"));
  const sourceRoot = path.join(root, "packages", "executor-codex", "src");
  await writeFile(path.join(sourceRoot, "computed.mjs"), "const target='./worker.mjs'; import(target);\n");
  await writeFile(path.join(sourceRoot, "external.mjs"), "import 'third-party-package';\n");
  await writeFile(path.join(sourceRoot, "escaped.mjs"), "import '../../../outside.mjs';\n");
  const errors = await validateArchitecture(root);
  assert(errors.some((item) => item.includes("non-literal dynamic import")));
  assert(errors.some((item) => item.includes("undeclared external specifier")));
  assert(errors.some((item) => item.includes("outside the package ownership tree")));
  await rm(root, { recursive: true });
});

test("architecture validation rejects support status drift", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "adk-architecture-"));
  await cp(path.join(packageRoot, "packages"), path.join(root, "packages"), { recursive: true });
  await cp(path.join(packageRoot, "package.json"), path.join(root, "package.json"));
  const matrix = JSON.parse(await readFile(path.join(packageRoot, "support-matrix.json"), "utf8"));
  matrix.routes[1].status = "public-preview";
  await writeFile(path.join(root, "support-matrix.json"), JSON.stringify(matrix));
  const errors = await validateArchitecture(root);
  assert(errors.some((item) => item.includes("codex-pi has unexpected status")));
  await rm(root, { recursive: true });
});

test("architecture validation rejects prerequisite and live-smoke drift", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "adk-architecture-"));
  await cp(path.join(packageRoot, "packages"), path.join(root, "packages"), { recursive: true });
  await cp(path.join(packageRoot, "package.json"), path.join(root, "package.json"));
  const matrix = JSON.parse(await readFile(path.join(packageRoot, "support-matrix.json"), "utf8"));
  matrix.routes[0].prerequisites = ["Pi must be installed"];
  matrix.routes[0].liveSmoke = "npm run smoke:pi";
  await writeFile(path.join(root, "support-matrix.json"), JSON.stringify(matrix));
  const errors = await validateArchitecture(root);
  assert(errors.some((item) => item.includes("codex-codex has unexpected prerequisites")));
  assert(errors.some((item) => item.includes("codex-codex has unexpected liveSmoke")));
  await rm(root, { recursive: true });
});

test("architecture validation rejects retired contract schema identifiers", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "adk-architecture-"));
  await cp(path.join(packageRoot, "packages"), path.join(root, "packages"), { recursive: true });
  await cp(path.join(packageRoot, "package.json"), path.join(root, "package.json"));
  await cp(path.join(packageRoot, "support-matrix.json"), path.join(root, "support-matrix.json"));
  const schemaPath = path.join(root, "packages", "contracts", "schemas", "task-envelope.schema.json");
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  schema.$id = "https://github.com/echopath-labs/agent-delegation-kit/contracts/task-envelope.schema.json";
  await writeFile(schemaPath, JSON.stringify(schema));
  const errors = await validateArchitecture(root);
  assert(errors.some((item) => item.includes("task-envelope.schema.json has a non-canonical $id")));
  await rm(root, { recursive: true });
});

test("invalid manifest schema is rejected", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "adk-package-"));
  await makeMinimalPlugin(root, { ...validManifest, $schema: "https://example.invalid/schema.json" });
  const errors = await validatePackage(root);
  assert(errors.some((item) => item.includes("Agent Plugins 1.0.0")));
  await rm(root, { recursive: true });
});

test("missing immediate skill is rejected", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "adk-package-"));
  await makeMinimalPlugin(root, validManifest);
  await rm(path.join(root, "skills", "demo", "SKILL.md"));
  const errors = await validatePackage(root);
  assert(errors.some((item) => item.includes("SKILL.md is missing")));
  await rm(root, { recursive: true });
});

test("invalid local marketplace metadata is rejected", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "adk-package-"));
  await makeMinimalPlugin(root, validManifest);
  await writeFile(path.join(root, ".agents", "plugins", "marketplace.json"), JSON.stringify({
    name: "fixture-marketplace",
    plugins: [{ name: "different-plugin", source: { source: "local", path: "./nested" } }]
  }));
  const errors = await validatePackage(root);
  assert(errors.some((item) => item.includes("must expose the root plugin")));
  await rm(root, { recursive: true });
});

test("unexpected private workspace files are rejected", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "adk-package-"));
  await makeMinimalPlugin(root, validManifest);
  await mkdir(path.join(root, "openspec"));
  await writeFile(path.join(root, "openspec", "private.md"), "private\n");
  const errors = await validatePackage(root);
  assert(errors.some((item) => item.includes("Unexpected top-level")));
  assert(errors.some((item) => item.includes("Private or generated path")));
  await rm(root, { recursive: true });
});

test("public preview policy and credential-free CI are required", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "adk-package-"));
  await makeMinimalPlugin(root, validManifest);
  await rm(path.join(root, "SECURITY.md"));
  await writeFile(path.join(root, ".github", "workflows", "validate.yml"), [
    "name: Unsafe",
    "on:",
    "  pull_request_target:",
    "jobs:",
    "  test:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: echo ${{ secrets.DEPLOY_TOKEN }}",
    ""
  ].join("\n"));

  const errors = await validatePackage(root);

  assert(errors.some((item) => item.includes("SECURITY.md is required")));
  assert(errors.some((item) => item.includes("pull_request_target")));
  assert(errors.some((item) => item.includes("must not require repository secrets")));
  await rm(root, { recursive: true });
});

test("public preview CI rejects mutable action tags", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "adk-package-"));
  await makeMinimalPlugin(root, validManifest);
  const workflowPath = path.join(root, ".github", "workflows", "validate.yml");
  const workflow = (await readFile(workflowPath, "utf8"))
    .replace("actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1", "actions/checkout@v7")
    .replace("actions/setup-node@820762786026740c76f36085b0efc47a31fe5020", "actions/setup-node@v7");
  await writeFile(workflowPath, workflow);
  const errors = await validatePackage(root);
  assert(errors.some((item) => item.includes("pin the reviewed checkout")));
  assert(errors.some((item) => item.includes("pin the reviewed setup-node")));
  await rm(root, { recursive: true });
});

test("public preview rejects symlinks and additional workflows", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "adk-package-"));
  await makeMinimalPlugin(root, validManifest);
  await writeFile(path.join(root, "README-target.md"), "target\n");
  await symlink("README-target.md", path.join(root, "skills", "demo", "linked.md"));
  await writeFile(path.join(root, ".github", "workflows", "extra.yml"), "jobs: {}\n");
  const errors = await validatePackage(root);
  assert(errors.some((item) => item.includes("Symbolic links are not allowed")));
  assert(errors.some((item) => item.includes("only .github/workflows/validate.yml")));
  await rm(root, { recursive: true });
});

test("public preview rejects unmanifested files under nested node_modules", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "adk-package-"));
  await makeMinimalPlugin(root, validManifest);
  await mkdir(path.join(root, "skills", "node_modules"));
  await writeFile(path.join(root, "skills", "node_modules", "SKILL.md"), "unreviewed instructions\n");
  const errors = await validatePackage(root);
  assert(errors.some((item) => item.includes("Public file manifest mismatch")));
  await rm(root, { recursive: true });
});

test("public preview rejects manifest-listed files under nested node_modules", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "adk-package-"));
  await makeMinimalPlugin(root, validManifest);
  const relative = "skills/node_modules/SKILL.md";
  await mkdir(path.join(root, "skills", "node_modules"));
  await writeFile(path.join(root, ...relative.split("/")), "unreviewed instructions\n");
  const manifestPath = path.join(root, "public-files.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.files.push(relative);
  manifest.files.sort();
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  const errors = await validatePackage(root);
  assert(errors.some((item) => item.includes("Private or generated path")));
  await rm(root, { recursive: true });
});

test("public preview rejects unreviewed workflow actions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "adk-package-"));
  await makeMinimalPlugin(root, validManifest);
  const workflowPath = path.join(root, ".github", "workflows", "validate.yml");
  await writeFile(workflowPath, `${await readFile(workflowPath, "utf8")}      - uses: vendor/unreviewed@0123456789012345678901234567890123456789\n`);
  const errors = await validatePackage(root);
  assert(errors.some((item) => item.includes("not on the reviewed exact allowlist")));
  await rm(root, { recursive: true });
});

test("public preview rejects alternate YAML spellings even when safe fragments remain", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "adk-package-"));
  await makeMinimalPlugin(root, validManifest);
  const workflowPath = path.join(root, ".github", "workflows", "validate.yml");
  const workflow = await readFile(workflowPath, "utf8");
  await writeFile(workflowPath, `${workflow}\n# permissions:\n#   contents: read\njobs:\n  bypass:\n    permissions: { "contents": write }\n    steps:\n      - "uses": vendor/action@main\n`);
  const errors = await validatePackage(root);
  assert(errors.some((item) => item.includes("exactly match the reviewed")));
  assert(errors.some((item) => item.includes("Public file manifest mismatch")) === false);
  await rm(root, { recursive: true });
});
