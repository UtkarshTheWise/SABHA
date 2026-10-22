/**
 * Fails if a compiled contract cannot be deployed everywhere Sabha runs.
 *
 *   - Runtime code over 24,576 bytes is refused by every EVM chain (EIP-170).
 *   - Init code over 49,152 bytes is refused from Shanghai on (EIP-3860), which
 *     includes Sepolia even though our own Besu genesis predates it.
 *   - The Besu genesis activates London only, so code must not use opcodes added
 *     later (PUSH0, MCOPY, TLOAD, TSTORE). hardhat.config.js pins the compiler to
 *     the `paris` target; this proves the output actually obeys it.
 *
 * Run after `npm run compile`.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
// An optional argument points at another artifacts directory (used to test this script).
const ARTIFACTS = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, "artifacts", "contracts");

const MAX_RUNTIME = 24576;
const MAX_INITCODE = 49152;
const WARN_AT = 0.8;

const LATE_OPCODES = { 0x5f: "PUSH0", 0x5e: "MCOPY", 0x5c: "TLOAD", 0x5d: "TSTORE" };

/** Opcodes in the executable part of the code, skipping PUSH data and the CBOR metadata tail. */
function lateOpcodes(code) {
  const metadataLength = code.readUInt16BE(code.length - 2) + 2;
  const executable = code.subarray(0, code.length - metadataLength);
  const found = new Set();
  for (let i = 0; i < executable.length; i++) {
    const op = executable[i];
    if (LATE_OPCODES[op]) found.add(LATE_OPCODES[op]);
    if (op >= 0x60 && op <= 0x7f) i += op - 0x5f; // skip the bytes a PUSHn carries
  }
  return [...found];
}

function artifactFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...artifactFiles(full));
    else if (entry.name.endsWith(".json") && !entry.name.endsWith(".dbg.json")) files.push(full);
  }
  return files;
}

if (!fs.existsSync(ARTIFACTS)) {
  console.error("No compiled artifacts. Run: npm run compile");
  process.exit(1);
}

let failed = false;
const rows = [];

for (const file of artifactFiles(ARTIFACTS)) {
  const artifact = JSON.parse(fs.readFileSync(file, "utf8"));
  const runtime = Buffer.from(artifact.deployedBytecode.slice(2), "hex");
  if (runtime.length === 0) continue; // interfaces and abstract contracts

  const initcode = (artifact.bytecode.length - 2) / 2;
  const late = lateOpcodes(runtime);

  const problems = [];
  if (runtime.length > MAX_RUNTIME) problems.push(`runtime ${runtime.length} > ${MAX_RUNTIME}`);
  if (initcode > MAX_INITCODE) problems.push(`initcode ${initcode} > ${MAX_INITCODE}`);
  if (late.length > 0) problems.push(`uses ${late.join(", ")} (chain activates London only)`);
  if (problems.length > 0) failed = true;

  rows.push({
    name: artifact.contractName,
    runtime: runtime.length,
    initcode,
    note: problems.length > 0 ? `FAIL: ${problems.join("; ")}` : runtime.length > MAX_RUNTIME * WARN_AT ? "near the limit" : "ok",
  });
}

rows.sort((a, b) => b.runtime - a.runtime);
const width = Math.max(...rows.map((r) => r.name.length), 8);
console.log(`${"contract".padEnd(width)}  ${"runtime".padStart(8)}  ${"limit".padStart(6)}  ${"initcode".padStart(9)}`);
for (const r of rows) {
  const pct = `${Math.round((r.runtime / MAX_RUNTIME) * 100)}%`.padStart(6);
  console.log(`${r.name.padEnd(width)}  ${String(r.runtime).padStart(8)}  ${pct}  ${String(r.initcode).padStart(9)}  ${r.note}`);
}

if (failed) {
  console.error("\nContract size or opcode check failed.");
  process.exit(1);
}
