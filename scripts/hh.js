#!/usr/bin/env node
/**
 * Runs one of the project scripts against the network named by SABHA_NETWORK
 * (default: localhost), or by --network on the command line. Exists so the same
 * `npm run deploy` works in PowerShell and bash, on any network, without a
 * script per network.
 *
 *   npm run deploy
 *   SABHA_NETWORK=besu npm run demo        (bash)
 *   npm run demo -- --network sepolia      (any shell)
 */
const { spawnSync } = require("child_process");
const { assertUsable, env } = require("../config/networks");

const TASKS = {
  deploy: "scripts/deploy.js",
  seed: "scripts/seed.js",
  demo: "scripts/demo.js",
};

const [task, ...rest] = process.argv.slice(2);
if (!TASKS[task]) {
  console.error(`Usage: node scripts/hh.js <${Object.keys(TASKS).join("|")}> [--network <name>]`);
  process.exit(2);
}

let network = env("SABHA_NETWORK", "localhost");
const flag = rest.indexOf("--network");
if (flag !== -1) {
  network = rest[flag + 1];
  if (!network) {
    console.error("--network needs a value.");
    process.exit(2);
  }
}

try {
  assertUsable(network);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const result = spawnSync("npx", ["hardhat", "run", TASKS[task], "--network", network], {
  stdio: "inherit",
  shell: true,
  env: process.env,
});
process.exit(result.status ?? 1);
