/**
 * Is the Sabha network healthy, and is it closed the way it should be?
 *
 *   node check-health.mjs https://rpc.example.org
 *   node check-health.mjs https://rpc.example.org --admin http://127.0.0.1:8546
 *
 * The first argument is the JSON-RPC URL members use (the public one, or
 * http://127.0.0.1:8545 on the server). With --admin, which needs an SSH tunnel
 * or a run on the server itself, it also confirms the validator set and the
 * peer links. Exits 1 if anything fails, so it can sit in cron or CI.
 *
 * Reads BESU_CHAIN_ID and BESU_EMPTY_BLOCK_SECONDS from besu/.env or the
 * environment, so it knows what "right" looks like.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

function readEnvFile() {
  const file = join(HERE, ".env");
  if (!existsSync(file)) return {};
  const values = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && !line.trim().startsWith("#")) values[match[1]] = match[2];
  }
  return values;
}

const fileEnv = readEnvFile();
const setting = (name, fallback) => process.env[name] || fileEnv[name] || fallback;

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const rpcUrl = args.find((a, i) => !a.startsWith("--") && (i === 0 || !args[i - 1].startsWith("--"))) || "http://127.0.0.1:8545";
const adminUrl = flag("--admin");
const expectedChain = Number(flag("--chain-id") || setting("BESU_CHAIN_ID", 40717));
const expectedValidators = Number(flag("--validators") || 4);
const idleSeconds = Number(setting("BESU_EMPTY_BLOCK_SECONDS", 0));
// While nobody is voting the chain waits idleSeconds between blocks; allow a few missed rounds.
const maxBlockAge = Number(flag("--max-block-age") || Math.max(idleSeconds * 3 + 10, 30));

let failed = 0;
const report = (status, name, detail = "") => {
  if (status === "FAIL") failed++;
  console.log(`${status.padEnd(4)}  ${name}${detail ? `  (${detail})` : ""}`);
};

async function rpc(url, method, params = []) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: null, text };
  }
}

console.log(`Checking ${rpcUrl}${adminUrl ? ` and admin ${adminUrl}` : ""}\n`);

try {
  const chain = await rpc(rpcUrl, "eth_chainId");
  const id = chain.body?.result ? parseInt(chain.body.result, 16) : null;
  id === expectedChain
    ? report("PASS", "chain id", String(id))
    : report("FAIL", "chain id", `expected ${expectedChain}, got ${id ?? JSON.stringify(chain.body ?? chain.text)}`);

  const latest = await rpc(rpcUrl, "eth_getBlockByNumber", ["latest", false]);
  const block = latest.body?.result;
  if (!block) {
    report("FAIL", "blocks are being produced", "no latest block");
  } else {
    const age = Math.floor(Date.now() / 1000) - parseInt(block.timestamp, 16);
    age <= maxBlockAge
      ? report("PASS", "blocks are being produced", `block ${parseInt(block.number, 16)}, ${age}s old`)
      : report("FAIL", "blocks are being produced", `latest block ${parseInt(block.number, 16)} is ${age}s old, limit ${maxBlockAge}s`);
  }

  const peers = await rpc(rpcUrl, "net_peerCount");
  const count = peers.body?.result ? parseInt(peers.body.result, 16) : null;
  count !== null && count >= expectedValidators - 1
    ? report("PASS", "validator 1 sees its peers", `${count}`)
    : report("FAIL", "validator 1 sees its peers", `expected ${expectedValidators - 1}, got ${count ?? "no answer"}`);

  // The point of the gateway: these must not answer, whoever asks.
  for (const method of ["admin_peers", "qbft_getValidatorsByBlockNumber", "txpool_content", "debug_metrics", "eth_accounts"]) {
    const attempt = await rpc(rpcUrl, method, method === "qbft_getValidatorsByBlockNumber" ? ["latest"] : []);
    const leaked = attempt.body && Object.hasOwn(attempt.body, "result") && !(Array.isArray(attempt.body.result) && attempt.body.result.length === 0 && method === "eth_accounts");
    leaked
      ? report("FAIL", `${method} is not available publicly`, "IT ANSWERED")
      : report("PASS", `${method} is not available publicly`);
  }

  if (adminUrl) {
    const validators = await rpc(adminUrl, "qbft_getValidatorsByBlockNumber", ["latest"]);
    const list = validators.body?.result;
    Array.isArray(list) && list.length === expectedValidators
      ? report("PASS", "validator set", `${list.length} validators`)
      : report("FAIL", "validator set", `expected ${expectedValidators}, got ${Array.isArray(list) ? list.length : "no answer"}`);

    const links = await rpc(adminUrl, "admin_peers");
    const linked = Array.isArray(links.body?.result) ? links.body.result.length : null;
    linked !== null && linked >= expectedValidators - 1
      ? report("PASS", "admin node is linked to its peers", `${linked}`)
      : report("FAIL", "admin node is linked to its peers", `expected ${expectedValidators - 1}, got ${linked ?? "no answer"}`);
  } else {
    report("SKIP", "validator set and peer links", "pass --admin <url> to check them");
  }
} catch (error) {
  report("FAIL", "reaching the endpoint", error.cause?.code || error.message);
}

console.log(failed === 0 ? "\nHealthy." : `\n${failed} check${failed === 1 ? "" : "s"} failed.`);
process.exit(failed === 0 ? 0 : 1);
