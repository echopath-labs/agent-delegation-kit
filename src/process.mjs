import { spawn } from "node:child_process";

const MAX_CAPTURE_BYTES = 128 * 1024;

function appendLimited(current, chunk) {
  if (current.length >= MAX_CAPTURE_BYTES) return current;
  return (current + chunk.toString("utf8")).slice(0, MAX_CAPTURE_BYTES);
}

export function runProcess(command, args, options = {}) {
  const {
    cwd,
    env = process.env,
    timeoutMs = 30_000,
    input = undefined
  } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout = appendLimited(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendLimited(stderr, chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({ exitCode, signal, stdout, stderr, timedOut });
    });

    if (input === undefined) child.stdin.end();
    else child.stdin.end(input);
  });
}
