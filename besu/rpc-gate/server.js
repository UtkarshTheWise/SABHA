/**
 * Starts the gate from environment variables. See gate.js for what it does.
 *
 *   UPSTREAM_URL   validator 1's JSON-RPC           (default http://node1:8545)
 *   PORT           where the gate listens           (default 8080)
 *   TRUSTED_HOPS   proxies in front of the gate     (default 1: Caddy)
 *   MAX_BATCH      calls allowed in one request     (default 20)
 *   READ_RATE      calls per second per client      (default 40, burst 3x)
 *   WRITE_RATE     transactions per second          (default 0.5, burst 20x)
 *   FRONTEND_ORIGINS  browser origins allowed to read responses, separated by
 *                  commas or spaces, e.g. https://sabha.vercel.app https://sabha-*.vercel.app
 *                  (default none: browsers are refused, scripts and wallets still work)
 */
const { createGate, parseOrigins, DEFAULTS } = require("./gate");

const number = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    console.error(`${name} must be a positive number, got "${raw}".`);
    process.exit(1);
  }
  return value;
};

const readRate = number("READ_RATE", DEFAULTS.readBucket.refillPerSecond);
const writeRate = number("WRITE_RATE", DEFAULTS.writeBucket.refillPerSecond);

let allowedOrigins;
try {
  allowedOrigins = parseOrigins(process.env.FRONTEND_ORIGINS);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
if (allowedOrigins.length === 0) {
  console.warn("FRONTEND_ORIGINS is empty: web pages will not be able to read responses.");
}

const server = createGate({
  allowedOrigins,
  upstream: process.env.UPSTREAM_URL || DEFAULTS.upstream,
  trustedHops: number("TRUSTED_HOPS", DEFAULTS.trustedHops),
  maxBatch: number("MAX_BATCH", DEFAULTS.maxBatch),
  readBucket: { capacity: Math.ceil(readRate * 3), refillPerSecond: readRate },
  writeBucket: { capacity: Math.ceil(writeRate * 20), refillPerSecond: writeRate },
});

const port = number("PORT", 8080);
server.listen(port, "0.0.0.0", () => {
  console.log(JSON.stringify({ event: "listening", port, upstream: process.env.UPSTREAM_URL || DEFAULTS.upstream }));
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
