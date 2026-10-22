/**
 * The public face of the Sabha network's JSON-RPC.
 *
 * Sits between Caddy (TLS, CORS) and validator 1. Besu already limits which API
 * groups are on, but a group is coarse: "ETH" includes methods nobody on the
 * internet needs, and Besu has no per-client rate limit. This gate is the second
 * boundary. It lets through an explicit list of methods, bounds the size of what
 * it reads, and rate-limits per client.
 *
 * It does not authenticate anyone. Every voter is anonymous to it, and the
 * contracts decide who may do what.
 *
 * No dependencies on purpose: it is short enough to read in one sitting, which
 * matters more for a security boundary than any feature a library would add.
 */
const http = require("node:http");
const net = require("node:net");

// Read-only methods, plus the one write a client needs. An explicit list, not a
// pattern: "eth_*" would also admit eth_sendTransaction, eth_sign and
// eth_accounts, and whatever Besu adds under that prefix next year.
const ALLOWED_METHODS = new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_chainId",
  "eth_createAccessList",
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getBlockByHash",
  "eth_getBlockByNumber",
  "eth_getBlockReceipts",
  "eth_getBlockTransactionCountByHash",
  "eth_getBlockTransactionCountByNumber",
  "eth_getCode",
  "eth_getLogs",
  "eth_getStorageAt",
  "eth_getTransactionByBlockHashAndIndex",
  "eth_getTransactionByBlockNumberAndIndex",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_maxPriorityFeePerGas",
  "eth_sendRawTransaction",
  "eth_syncing",
  "net_listening",
  "net_peerCount", // read-only; the network health page shows it
  "net_version",
  "web3_clientVersion",
]);

const WRITE_METHODS = new Set(["eth_sendRawTransaction"]);

const DEFAULTS = {
  upstream: "http://node1:8545",
  maxBodyBytes: 256 * 1024, // a 24 KB contract is ~100 KB of hex inside a transaction
  maxBatch: 20, // matches rpc-http-max-batch-size in besu/config.toml
  upstreamTimeoutMs: 10_000,
  maxInFlight: 32, // Besu refuses beyond 80 connections; stay well under
  trustedHops: 1, // how many proxies sit in front (Caddy)
  allowedOrigins: [], // browser origins that may read responses; see compileOriginPattern
  // Token buckets, per client address. Cost is per call, so a batch of 10 costs 10.
  readBucket: { capacity: 120, refillPerSecond: 40 },
  writeBucket: { capacity: 10, refillPerSecond: 0.5 },
  maxClients: 50_000,
  now: () => Date.now(),
  log: (entry) => console.log(JSON.stringify(entry)),
};

// JSON-RPC 2.0 error codes
const E = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INTERNAL: -32603,
  LIMIT_EXCEEDED: -32005,
};

const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/** One client's allowance: it refills continuously and never exceeds capacity. */
class TokenBucket {
  constructor({ capacity, refillPerSecond }, now) {
    this.capacity = capacity;
    this.refillPerSecond = refillPerSecond;
    this.tokens = capacity;
    this.updatedAt = now;
  }

  /** Take `cost` tokens if available. Returns 0 on success, else seconds until it would succeed. */
  take(cost, now) {
    const elapsed = Math.max(0, now - this.updatedAt) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSecond);
    this.updatedAt = now;
    if (cost > this.capacity) return Infinity; // can never succeed
    if (this.tokens >= cost) {
      this.tokens -= cost;
      return 0;
    }
    return (cost - this.tokens) / this.refillPerSecond;
  }
}

/**
 * Who is calling. Behind Caddy the socket address is always Caddy, so the real
 * client is in X-Forwarded-For. A client can put anything it likes at the START
 * of that header, but each proxy appends the address it actually saw to the END,
 * so counting from the end by the number of trusted proxies cannot be spoofed.
 */
function clientAddress(req, trustedHops) {
  const header = req.headers["x-forwarded-for"];
  if (trustedHops > 0 && typeof header === "string" && header.length > 0) {
    const parts = header.split(",").map((p) => p.trim()).filter(Boolean);
    const index = parts.length - trustedHops;
    if (index >= 0) return parts[index];
  }
  return req.socket.remoteAddress || "unknown";
}

/**
 * Browser origins that may read responses. A pattern is an exact origin, or an
 * origin with ONE "*" inside a hostname label that also has fixed text beside
 * it, for hosts such as Vercel preview deployments:
 *
 *   https://sabha.vercel.app            exactly that
 *   https://sabha-*.vercel.app          sabha-git-main-x.vercel.app, but not a.b.vercel.app
 *
 * A bare "*" label (https://*.vercel.app) is refused: it would let anybody who
 * can deploy to that host call this endpoint from a browser. This is a small
 * language rather than a hand-written regex because one unescaped dot in a
 * regex quietly admits look-alike domains such as sabhaxvercel.app.
 */
function compileOriginPattern(pattern) {
  const fail = (why) => {
    throw new Error(`Invalid origin pattern "${pattern}": ${why}`);
  };
  const text = String(pattern).trim().toLowerCase();
  const parts = /^(https?):\/\/([^/?#:]+)(?::(\d{1,5}))?$/.exec(text);
  if (!parts) fail("expected scheme://host or scheme://host:port, with no path");

  const [, scheme, host, port] = parts;
  if (!/^[a-z0-9.*-]+$/.test(host)) fail("a host may only hold letters, digits, dots, hyphens and one *");
  if (host.startsWith(".") || host.endsWith(".") || host.includes("..")) fail("the host is malformed");
  if (host.split("*").length > 2) fail("only one * is allowed");

  const labels = host.split(".");
  const starred = labels.find((label) => label.includes("*"));
  if (starred === "*") fail("a wildcard label needs fixed text beside the *, or it admits every site on that host");
  if (starred && labels.length < 3) fail("a wildcard host needs a registrable domain after it");

  // Every label is now made only of [a-z0-9-], so none needs regex escaping.
  const source = labels
    .map((label) => (label === starred ? label.replace("*", "[a-z0-9-]+") : label))
    .join("\\.");
  return new RegExp(`^${scheme}://${source}${port ? `:${port}` : ""}$`);
}

/** "a, b  c" becomes ["a", "b", "c"]. Throws if any entry is not a valid pattern. */
function parseOrigins(text) {
  const patterns = String(text || "").split(/[\s,]+/).filter(Boolean);
  patterns.forEach(compileOriginPattern);
  return patterns;
}

function originMatcher(patterns) {
  const compiled = patterns.map(compileOriginPattern);
  return (origin) => typeof origin === "string" && compiled.some((re) => re.test(origin.toLowerCase()));
}

/**
 * The key a client is rate-limited under. One person normally holds a whole
 * IPv6 /64, which is 2^64 addresses, so limiting per full address would let them
 * start a fresh allowance on every request. IPv4 is keyed as is.
 */
function bucketKey(address) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return mapped[1];
  if (!net.isIPv6(address)) return address;

  const [head, tail] = address.split("::");
  const front = head ? head.split(":") : [];
  const back = tail ? tail.split(":") : [];
  const filler = address.includes("::") ? new Array(Math.max(0, 8 - front.length - back.length)).fill("0") : [];
  const hextets = [...front, ...filler, ...back].map((h) => h.toLowerCase().padStart(4, "0"));
  return `${hextets.slice(0, 4).join(":")}::/64`;
}

function validateCall(call) {
  if (call === null || typeof call !== "object" || Array.isArray(call)) return "request must be an object";
  if (call.jsonrpc !== "2.0") return 'jsonrpc must be "2.0"';
  if (typeof call.method !== "string") return "method must be a string";
  if (call.id !== undefined && call.id !== null && typeof call.id !== "string" && typeof call.id !== "number") {
    return "id must be a string, number or null";
  }
  if (call.params !== undefined && (call.params === null || typeof call.params !== "object")) {
    return "params must be an array or object";
  }
  return null;
}

function createGate(options = {}) {
  const config = { ...DEFAULTS, ...options };
  const readBuckets = new Map();
  const writeBuckets = new Map();
  let inFlight = 0;
  const originAllowed = originMatcher(config.allowedOrigins);

  const agent = new http.Agent({ keepAlive: true, maxSockets: config.maxInFlight });
  const upstream = new URL(config.upstream);

  function bucketFor(map, spec, address) {
    let bucket = map.get(address);
    if (!bucket) {
      // A flood of distinct addresses must not grow memory without bound.
      if (map.size >= config.maxClients) map.delete(map.keys().next().value);
      bucket = new TokenBucket(spec, config.now());
      map.set(address, bucket);
    }
    return bucket;
  }

  function sweep() {
    const now = config.now();
    for (const map of [readBuckets, writeBuckets]) {
      for (const [address, bucket] of map) {
        // A bucket idle long enough to be full again carries no information.
        if (now - bucket.updatedAt > (bucket.capacity / bucket.refillPerSecond) * 1000) map.delete(address);
      }
    }
  }

  function forward(call) {
    return new Promise((resolve) => {
      const payload = JSON.stringify(call);
      const request = http.request(
        {
          agent,
          host: upstream.hostname,
          port: upstream.port,
          path: "/",
          method: "POST",
          headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) },
          timeout: config.upstreamTimeoutMs,
        },
        (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () => {
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            } catch {
              resolve(rpcError(call.id, E.INTERNAL, "The node returned something that was not JSON."));
            }
          });
        }
      );
      request.on("timeout", () => request.destroy(new Error("timeout")));
      request.on("error", () => resolve(rpcError(call.id, E.INTERNAL, "The node did not answer. Try again shortly.")));
      request.end(payload);
    });
  }

  // CORS lets a browser page read a response. It is not access control: curl
  // ignores it. A caller with no Origin, or one we do not list (a script, a
  // wallet extension), is served normally and simply gets no CORS headers.
  function corsHeaders(req) {
    const origin = req.headers.origin;
    if (!origin || !originAllowed(origin)) return {};
    return {
      "access-control-allow-origin": origin,
      "access-control-expose-headers": "Retry-After",
      vary: "Origin",
    };
  }

  function send(res, status, body, headers = {}) {
    const text = JSON.stringify(body);
    res.writeHead(status, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(text),
      ...res.corsHeaders,
      ...headers,
    });
    res.end(text);
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const tooLarge = () => Object.assign(new Error("too large"), { tooLarge: true });
      const declared = Number(req.headers["content-length"]);
      if (Number.isFinite(declared) && declared > config.maxBodyBytes) return reject(tooLarge());

      const chunks = [];
      let size = 0;
      let refused = false;
      req.on("data", (chunk) => {
        if (refused) return; // keep draining, buffer nothing
        size += chunk.length;
        if (size > config.maxBodyBytes) {
          refused = true;
          chunks.length = 0;
          reject(tooLarge());
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => !refused && resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
  }

  async function handleRpc(req, res) {
    const address = bucketKey(clientAddress(req, config.trustedHops));

    let text;
    try {
      text = await readBody(req);
    } catch (error) {
      if (error.tooLarge) {
        // Answer first, then close: destroying the request now would take the
        // socket, and the reply, with it. The server's request timeout bounds
        // how long an endless body can keep the connection open meanwhile.
        res.on("finish", () => req.destroy());
        return send(res, 413, rpcError(null, E.INVALID_REQUEST, `Request is larger than ${config.maxBodyBytes} bytes.`), {
          connection: "close",
        });
      }
      return send(res, 400, rpcError(null, E.INVALID_REQUEST, "Could not read the request."));
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return send(res, 400, rpcError(null, E.PARSE, "Request is not valid JSON."));
    }

    const isBatch = Array.isArray(parsed);
    const calls = isBatch ? parsed : [parsed];
    if (calls.length === 0) return send(res, 400, rpcError(null, E.INVALID_REQUEST, "Empty batch."));
    if (calls.length > config.maxBatch) {
      return send(res, 400, rpcError(null, E.INVALID_REQUEST, `A batch may hold at most ${config.maxBatch} calls.`));
    }

    // Decide each call's fate before spending anything on the node.
    const plan = calls.map((call) => {
      const problem = validateCall(call);
      if (problem) return { error: rpcError(call && call.id, E.INVALID_REQUEST, problem) };
      if (!ALLOWED_METHODS.has(call.method)) {
        config.log({ event: "denied", method: String(call.method).slice(0, 64), address });
        return { error: rpcError(call.id, E.METHOD_NOT_FOUND, "This method is not available on the public endpoint.") };
      }
      return { call, write: WRITE_METHODS.has(call.method) };
    });

    const reads = plan.filter((p) => p.call && !p.write).length;
    const writes = plan.filter((p) => p.call && p.write).length;
    const now = config.now();

    // Charge both buckets before either is committed, so a refusal costs nothing.
    const readBucket = bucketFor(readBuckets, config.readBucket, address);
    const writeBucket = bucketFor(writeBuckets, config.writeBucket, address);
    const readWait = reads + writes > 0 ? readBucket.take(reads + writes, now) : 0;
    const writeWait = writes > 0 && readWait === 0 ? writeBucket.take(writes, now) : 0;
    const wait = Math.max(readWait, writeWait);
    if (wait > 0) {
      if (readWait === 0 && reads + writes > 0) readBucket.tokens += reads + writes; // refund: the write bucket refused
      config.log({ event: "rate-limited", address, writes });
      const seconds = Number.isFinite(wait) ? Math.ceil(wait) : 3600;
      return send(res, 429, rpcError(null, E.LIMIT_EXCEEDED, "Too many requests. Slow down and retry."), {
        "retry-after": String(seconds),
      });
    }

    const wanted = reads + writes;
    if (inFlight + wanted > config.maxInFlight) {
      return send(res, 503, rpcError(null, E.LIMIT_EXCEEDED, "The endpoint is busy. Retry shortly."), { "retry-after": "1" });
    }

    inFlight += wanted;
    let results;
    try {
      // One upstream request per allowed call, so answers cannot be mismatched
      // by an upstream that reorders a batch, and a denied call is never sent.
      results = await Promise.all(plan.map((p) => (p.error ? p.error : forward(p.call))));
    } finally {
      inFlight -= wanted;
    }

    // A notification (no id) gets no answer, as the spec says; keep batch order.
    const answered = results.filter((_, i) => !(calls[i] && calls[i].id === undefined && !plan[i].error));
    if (!isBatch) return send(res, 200, answered.length > 0 ? answered[0] : {});
    return send(res, 200, answered);
  }

  async function handleHealth(res) {
    const answer = await forward({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] });
    if (answer && typeof answer.result === "string") {
      return send(res, 200, { ok: true, blockNumber: parseInt(answer.result, 16) });
    }
    return send(res, 503, { ok: false });
  }

  const server = http.createServer((req, res) => {
    const path = (req.url || "/").split("?")[0];
    res.corsHeaders = corsHeaders(req);

    // A browser asks permission before a cross-origin JSON POST. Only a listed
    // origin gets it; a wallet extension never sends a preflight.
    if (req.method === "OPTIONS" && path === "/" && req.headers.origin) {
      if (Object.keys(res.corsHeaders).length === 0) {
        return send(res, 403, rpcError(null, E.INVALID_REQUEST, "This origin is not allowed."));
      }
      res.writeHead(204, {
        ...res.corsHeaders,
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "600",
      });
      return res.end();
    }

    if (req.method === "GET" && path === "/healthz") return void handleHealth(res);
    if (req.method !== "POST" || path !== "/") {
      return send(res, 405, rpcError(null, E.INVALID_REQUEST, "Use POST with a JSON-RPC body."), { allow: "POST" });
    }
    const type = String(req.headers["content-type"] || "");
    if (!type.toLowerCase().startsWith("application/json")) {
      return send(res, 415, rpcError(null, E.INVALID_REQUEST, "Content-Type must be application/json."));
    }
    handleRpc(req, res).catch(() => send(res, 500, rpcError(null, E.INTERNAL, "Internal error.")));
  });

  // Slow-loris protection: a request must arrive promptly and in full.
  server.headersTimeout = 5_000;
  server.requestTimeout = 10_000;
  server.keepAliveTimeout = 5_000;

  const timer = setInterval(sweep, 60_000);
  timer.unref();
  server.on("close", () => {
    clearInterval(timer);
    agent.destroy();
  });

  return server;
}

module.exports = {
  createGate,
  ALLOWED_METHODS,
  TokenBucket,
  clientAddress,
  bucketKey,
  compileOriginPattern,
  originMatcher,
  parseOrigins,
  DEFAULTS,
};
