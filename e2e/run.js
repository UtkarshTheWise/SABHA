/**
 * Runs the browser tests from nothing: starts a throwaway local node, deploys the
 * contracts, fills the chain with ballots in every state, builds the page against
 * it, serves the build, runs e2e/ui.test.js and tears everything down.
 *
 *   npm run e2e
 *
 * Needs Chrome or Edge installed (E2E_CHANNEL=chrome|msedge, or E2E_BROWSER=<path>).
 * Uses ports 8545 (node) and 5199 (page); E2E_PORT changes the page's.
 */
const { spawn, spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const FRONTEND = path.join(ROOT, "frontend");
const RPC = "http://127.0.0.1:8545";
const PORT = process.env.E2E_PORT || "5199";
const PAGE = `http://127.0.0.1:${PORT}/`;

const children = [];

function stop(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill("SIGTERM");
}

function start(label, args, options = {}) {
  const child = spawn(process.execPath, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], ...options });
  const tail = [];
  const keep = (chunk) => {
    tail.push(...chunk.toString().split("\n"));
    if (tail.length > 40) tail.splice(0, tail.length - 40);
  };
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  child.tail = () => tail.join("\n");
  child.label = label;
  children.push(child);
  return child;
}

function runToEnd(label, args, options = {}) {
  const done = spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8", ...options });
  if (done.status !== 0) {
    throw new Error(`${label} failed (exit ${done.status}):\n${done.stdout}\n${done.stderr}`);
  }
}

async function waitFor(label, probe, seconds = 60) {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    try {
      if (await probe()) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`${label} did not come up within ${seconds} seconds.`);
}

const rpcUp = async () => {
  const reply = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }) });
  return reply.ok;
};

async function main() {
  if (await rpcUp().catch(() => false)) {
    throw new Error("Something already answers on 8545. Stop that node first: these tests need a fresh chain.");
  }

  const hardhat = path.join(ROOT, "node_modules", "hardhat", "internal", "cli", "cli.js");
  const node = start("local node", [hardhat, "node", "--hostname", "127.0.0.1", "--port", "8545"]);
  await waitFor("the local node", rpcUp);

  runToEnd("deploy", ["scripts/hh.js", "deploy"], { env: { ...process.env, SABHA_NETWORK: "localhost" } });
  runToEnd("fixture", ["e2e/fixture.js"]);

  const vite = path.join(FRONTEND, "node_modules", "vite", "bin", "vite.js");
  runToEnd("build", [vite, "build"], { cwd: FRONTEND, env: { ...process.env, VITE_DEFAULT_NETWORK: "localhost" } });
  const preview = start("page", [vite, "preview", "--host", "127.0.0.1", "--port", PORT, "--strictPort"], { cwd: FRONTEND });
  await waitFor("the page", async () => (await fetch(PAGE)).ok);

  const tests = spawnSync(process.execPath, ["--test", "--test-concurrency=1", "e2e/ui.test.js"], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, E2E_PAGE: PAGE, E2E_RPC: RPC },
  });
  if (tests.status !== 0) {
    console.error(`\nnode log tail:\n${node.tail()}\npage log tail:\n${preview.tail()}`);
  }
  return tests.status ?? 1;
}

main()
  .then((code) => {
    children.forEach(stop);
    process.exit(code);
  })
  .catch((error) => {
    console.error(error.message);
    children.forEach(stop);
    process.exit(1);
  });
