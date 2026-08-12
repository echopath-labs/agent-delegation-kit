#!/usr/bin/env node
import { runCli } from "../packages/cli/src/main.mjs";

await runCli(process.argv.slice(2));
