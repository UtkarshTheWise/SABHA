const { expect } = require("chai");
const http = require("node:http");

const {
  createGate,
  ALLOWED_METHODS,
  bucketKey,
  clientAddress,
  compileOriginPattern,
  originMatcher,
  parseOrigins,
} = require("../../besu/rpc-gate/gate");

/**
 * A stand-in for validator 1 that records exactly what reaches it. The point of
 * most tests below is what the node did NOT see.
 */
function startUpstream({ delayMs = 0 } = {}) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const call = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      seen.push(call);
      const reply = () => {
        const result = call.method === "eth_blockNumber" ? "0x10" : `echo:${call.method}`;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, result }));
      };
      delayMs ? setTimeout(reply, delayMs) : reply();
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}` }))
  );
}

const listen = (server) =>
  new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`)));
const close = (server) => new Promise((resolve) => server.close(resolve));

const call = (method, params = [], id = 1) => ({ jsonrpc: "2.0", id, method, params });

async function post(url, body, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: response.status, headers: response.headers, json, text };
}

describe("RPC gate", function () {
  let upstream;
  let gate;
  let url;
  let clock;

  async function boot(options = {}) {
    upstream = await startUpstream(options.upstream);
    clock = { t: 1_000_000 };
    gate = createGate({
      upstream: upstream.url,
      now: () => clock.t,
      log: () => {},
      ...options.gate,
    });
    url = await listen(gate);
  }

  afterEach(async function () {
    if (gate && gate.listening) await close(gate);
    if (upstream && upstream.server.listening) await close(upstream.server);
  });

  describe("methods that are allowed", function () {
    beforeEach(() => boot());

    it("forwards a read and returns the node's answer with the caller's id", async function () {
      const r = await post(url, call("eth_blockNumber", [], 77));
      expect(r.status).to.equal(200);
      expect(r.json).to.deep.equal({ jsonrpc: "2.0", id: 77, result: "0x10" });
    });

    it("forwards a string id untouched", async function () {
      const r = await post(url, call("eth_chainId", [], "abc-1"));
      expect(r.json.id).to.equal("abc-1");
    });

    it("lets through every method on the list, and only those reach the node", async function () {
      for (const method of ALLOWED_METHODS) {
        const r = await post(url, call(method));
        expect(r.json.result, method).to.equal(method === "eth_blockNumber" ? "0x10" : `echo:${method}`);
      }
      expect(upstream.seen.map((c) => c.method)).to.have.members([...ALLOWED_METHODS]);
    });

    it("lists no administrative, debugging, signing or consensus method", function () {
      const forbidden = /^(admin|debug|qbft|ibft|txpool|personal|miner|trace|perm|priv|plugins|engine|clique)_|^eth_(sign|sendTransaction|accounts|signTransaction|subscribe|newFilter|newBlockFilter|getFilter)/;
      const offenders = [...ALLOWED_METHODS].filter((m) => forbidden.test(m));
      expect(offenders).to.deep.equal([]);
    });
  });

  describe("methods that are refused", function () {
    beforeEach(() => boot());

    const dangerous = [
      "admin_peers",
      "admin_nodeInfo",
      "admin_addPeer",
      "admin_removePeer",
      "debug_traceTransaction",
      "debug_setHead",
      "qbft_getValidatorsByBlockNumber",
      "qbft_proposeValidatorVote",
      "qbft_discardValidatorVote",
      "ibft_getValidatorsByBlockNumber",
      "txpool_content",
      "txpool_besuTransactions",
      "personal_unlockAccount",
      "personal_sign",
      "miner_start",
      "eth_sendTransaction",
      "eth_sign",
      "eth_signTransaction",
      "eth_accounts",
      "eth_subscribe",
      "eth_newFilter",
      "eth_coinbase",
      "perm_addNodesToAllowlist",
      "trace_block",
      "priv_call",
      "plugins_reloadPluginConfig",
      "engine_newPayloadV3",
      "rpc_modules",
    ];

    for (const method of dangerous) {
      it(`refuses ${method} and never sends it to the node`, async function () {
        const r = await post(url, call(method));
        expect(r.status).to.equal(200);
        expect(r.json.error.code).to.equal(-32601);
        expect(r.json.id).to.equal(1);
        expect(upstream.seen).to.deep.equal([]);
      });
    }

    const disguised = [
      "ETH_blockNumber",
      "Eth_BlockNumber",
      " eth_blockNumber",
      "eth_blockNumber ",
      "eth_blockNumber\n",
      "eth_blockNumber\u0000",
      "eth_blockNumber\u0000admin_peers",
      "eth_blockNumber,admin_peers",
      "eth_blockNumber/../admin_peers",
      "еth_blockNumber", // Cyrillic е
      "eth_",
      "",
      "__proto__",
      "constructor",
      "toString",
    ];

    for (const method of disguised) {
      it(`refuses the look-alike ${JSON.stringify(method)}`, async function () {
        const r = await post(url, call(method));
        expect(r.json.error.code).to.equal(-32601);
        expect(upstream.seen).to.deep.equal([]);
      });
    }

    it("refuses a method that is not a string", async function () {
      for (const method of [123, null, ["eth_blockNumber"], { toString: "eth_blockNumber" }, true]) {
        const r = await post(url, { jsonrpc: "2.0", id: 1, method, params: [] });
        expect(r.json.error.code, JSON.stringify(method)).to.equal(-32600);
      }
      expect(upstream.seen).to.deep.equal([]);
    });
  });

  describe("batches", function () {
    beforeEach(() => boot());

    it("answers each call in order and sends only the allowed ones to the node", async function () {
      const r = await post(url, [
        call("eth_blockNumber", [], 1),
        call("admin_peers", [], 2),
        call("eth_chainId", [], 3),
        call("txpool_content", [], 4),
      ]);
      expect(r.status).to.equal(200);
      expect(r.json.map((x) => x.id)).to.deep.equal([1, 2, 3, 4]);
      expect(r.json[0].result).to.equal("0x10");
      expect(r.json[1].error.code).to.equal(-32601);
      expect(r.json[2].result).to.equal("echo:eth_chainId");
      expect(r.json[3].error.code).to.equal(-32601);
      expect(upstream.seen.map((c) => c.method)).to.have.members(["eth_blockNumber", "eth_chainId"]);
    });

    it("does not let a refused call ride along with duplicate ids", async function () {
      const r = await post(url, [call("eth_blockNumber", [], 1), call("admin_nodeInfo", [], 1)]);
      expect(r.json[0].result).to.equal("0x10");
      expect(r.json[1].error.code).to.equal(-32601);
      expect(upstream.seen.map((c) => c.method)).to.deep.equal(["eth_blockNumber"]);
    });

    it("accepts a full batch and refuses one call too many", async function () {
      const ok = await post(url, Array.from({ length: 20 }, (_, i) => call("eth_blockNumber", [], i)));
      expect(ok.json).to.have.length(20);

      const tooMany = await post(url, Array.from({ length: 21 }, (_, i) => call("eth_blockNumber", [], i)));
      expect(tooMany.status).to.equal(400);
      expect(tooMany.json.error.code).to.equal(-32600);
    });

    it("refuses an empty batch", async function () {
      const r = await post(url, []);
      expect(r.status).to.equal(400);
    });

    it("answers malformed entries one by one", async function () {
      const r = await post(url, [call("eth_blockNumber", [], 1), 5, "x", null, { jsonrpc: "1.0", method: "eth_chainId", id: 2 }]);
      expect(r.json[0].result).to.equal("0x10");
      for (const entry of r.json.slice(1)) expect(entry.error.code).to.equal(-32600);
      expect(upstream.seen).to.have.length(1);
    });

    it("sends no answer for a notification, as JSON-RPC says", async function () {
      const r = await post(url, [{ jsonrpc: "2.0", method: "eth_blockNumber" }, call("eth_chainId", [], 9)]);
      expect(r.json.map((x) => x.id)).to.deep.equal([9]);
    });
  });

  describe("malformed requests", function () {
    beforeEach(() => boot());

    it("answers invalid JSON with a parse error", async function () {
      const r = await post(url, "{not json");
      expect(r.status).to.equal(400);
      expect(r.json.error.code).to.equal(-32700);
    });

    it("refuses anything but POST", async function () {
      for (const method of ["GET", "PUT", "DELETE", "PATCH"]) {
        const r = await fetch(url, { method });
        expect(r.status, method).to.equal(405);
      }
    });

    it("refuses a path other than the root", async function () {
      const r = await post(`${url}/admin`, call("eth_blockNumber"));
      expect(r.status).to.equal(405);
      expect(upstream.seen).to.deep.equal([]);
    });

    it("refuses a body that is not declared as JSON", async function () {
      const r = await post(url, call("eth_blockNumber"), { "content-type": "text/plain" });
      expect(r.status).to.equal(415);
      expect(upstream.seen).to.deep.equal([]);
    });

    it("refuses wrong field types", async function () {
      const bad = [
        { jsonrpc: "2.0", id: {}, method: "eth_chainId" },
        { jsonrpc: "2.0", id: [], method: "eth_chainId" },
        { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: "0x1" },
        { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: null },
        { jsonrpc: 2, id: 1, method: "eth_chainId" },
        { id: 1, method: "eth_chainId" },
      ];
      for (const body of bad) {
        const r = await post(url, body);
        expect(r.json.error.code, JSON.stringify(body)).to.equal(-32600);
      }
      expect(upstream.seen).to.deep.equal([]);
    });

    it("accepts params given as an object", async function () {
      const r = await post(url, { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: {} });
      expect(r.json.result).to.equal("echo:eth_chainId");
    });
  });

  describe("request size", function () {
    beforeEach(() => boot({ gate: { maxBodyBytes: 2048 } }));

    it("refuses a body over the limit from its declared length, buffering none of it", async function () {
      const r = await post(url, call("eth_sendRawTransaction", ["0x" + "ab".repeat(3000)]));
      expect(r.status).to.equal(413);
      expect(r.json.error.code).to.equal(-32600);
      expect(upstream.seen).to.deep.equal([]);
    });

    it("still answers 413 when the body is streamed with no declared length", async function () {
      const status = await new Promise((resolve, reject) => {
        const req = http.request(url, { method: "POST", headers: { "content-type": "application/json" } }, (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode));
        });
        req.on("error", reject);
        // chunked: Content-Length is absent, so only the running total can catch it
        req.write('{"jsonrpc":"2.0","id":1,"method":"eth_sendRawTransaction","params":["0x');
        req.write("ab".repeat(1500));
        req.write("ab".repeat(1500));
        req.end('"]}');
      });
      expect(status).to.equal(413);
      expect(upstream.seen).to.deep.equal([]);
    });

    // What a reverse proxy does: announce the size, then keep sending while the
    // gate has already decided to refuse. Hanging up here shows the proxy's
    // client a 502 instead of the 413.
    it("delivers the 413 to a client that is still uploading when it is refused", async function () {
      const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: ["0x" + "ab".repeat(20000)] });
      const outcome = await new Promise((resolve) => {
        const req = http.request(
          url,
          { method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) } },
          (res) => {
            res.resume();
            res.on("end", () => resolve({ status: res.statusCode }));
          }
        );
        req.on("error", (error) => resolve({ error: error.code }));
        let sent = 0;
        const piece = 2000;
        (function next() {
          if (sent >= body.length) return req.end();
          req.write(body.slice(sent, sent + piece));
          sent += piece;
          setTimeout(next, 5);
        })();
      });
      expect(outcome).to.deep.equal({ status: 413 });
      expect(upstream.seen).to.deep.equal([]);
    });

    it("stops reading an endless refused upload, and keeps serving others", async function () {
      await close(gate);
      gate = createGate({ upstream: upstream.url, log: () => {}, maxBodyBytes: 2048, maxDrainBytes: 16 * 1024 });
      url = await listen(gate);

      const outcome = await new Promise((resolve) => {
        const req = http.request(url, { method: "POST", headers: { "content-type": "application/json" } }, (res) => {
          res.resume();
          res.on("end", () => resolve({ status: res.statusCode }));
        });
        req.on("error", (error) => resolve({ error: error.code }));
        let writes = 0;
        (function next() {
          if (writes++ > 400) return req.end();
          if (!req.write("x".repeat(1024))) return req.once("drain", next);
          setImmediate(next);
        })();
      });
      // Either the 413 got through before the cut-off, or the connection was cut:
      // what must not happen is the upload being accepted.
      expect(outcome.status === 413 || outcome.error !== undefined, JSON.stringify(outcome)).to.equal(true);

      const next = await post(url, call("eth_blockNumber"));
      expect(next.status).to.equal(200);
      expect(upstream.seen.map((c) => c.method)).to.deep.equal(["eth_blockNumber"]);
    });

    it("accepts a body just under the limit", async function () {
      const r = await post(url, call("eth_sendRawTransaction", ["0x" + "ab".repeat(900)]));
      expect(r.status).to.equal(200);
      expect(r.json.result).to.equal("echo:eth_sendRawTransaction");
    });
  });

  describe("rate limiting", function () {
    beforeEach(() =>
      boot({
        gate: {
          readBucket: { capacity: 5, refillPerSecond: 1 },
          writeBucket: { capacity: 2, refillPerSecond: 0.1 },
        },
      })
    );

    const as = (address) => ({ "x-forwarded-for": address });

    it("serves a burst up to capacity, then answers 429 with a Retry-After", async function () {
      for (let i = 0; i < 5; i++) expect((await post(url, call("eth_blockNumber"), as("10.0.0.1"))).status).to.equal(200);

      const r = await post(url, call("eth_blockNumber"), as("10.0.0.1"));
      expect(r.status).to.equal(429);
      expect(r.json.error.code).to.equal(-32005);
      expect(Number(r.headers.get("retry-after"))).to.be.greaterThan(0);
    });

    it("refills over time and not faster", async function () {
      for (let i = 0; i < 5; i++) await post(url, call("eth_blockNumber"), as("10.0.0.2"));
      clock.t += 2000;
      expect((await post(url, call("eth_blockNumber"), as("10.0.0.2"))).status).to.equal(200);
      expect((await post(url, call("eth_blockNumber"), as("10.0.0.2"))).status).to.equal(200);
      expect((await post(url, call("eth_blockNumber"), as("10.0.0.2"))).status).to.equal(429);
    });

    it("never refills beyond capacity however long the client was idle", async function () {
      clock.t += 10 * 60 * 1000;
      for (let i = 0; i < 5; i++) expect((await post(url, call("eth_blockNumber"), as("10.0.0.3"))).status).to.equal(200);
      expect((await post(url, call("eth_blockNumber"), as("10.0.0.3"))).status).to.equal(429);
    });

    it("charges a batch for every call in it", async function () {
      const batch = [call("eth_blockNumber", [], 1), call("eth_blockNumber", [], 2), call("eth_blockNumber", [], 3)];
      expect((await post(url, batch, as("10.0.0.4"))).status).to.equal(200);
      expect((await post(url, batch, as("10.0.0.4"))).status).to.equal(429);
      expect(upstream.seen).to.have.length(3);
    });

    it("charges nothing for a refused request", async function () {
      for (let i = 0; i < 5; i++) await post(url, call("eth_blockNumber"), as("10.0.0.5"));
      for (let i = 0; i < 20; i++) await post(url, call("eth_blockNumber"), as("10.0.0.5")); // all 429
      clock.t += 1000; // exactly one token back, however many were refused
      expect((await post(url, call("eth_blockNumber"), as("10.0.0.5"))).status).to.equal(200);
      expect((await post(url, call("eth_blockNumber"), as("10.0.0.5"))).status).to.equal(429);
    });

    it("keeps clients apart", async function () {
      for (let i = 0; i < 6; i++) await post(url, call("eth_blockNumber"), as("10.0.0.6"));
      expect((await post(url, call("eth_blockNumber"), as("10.0.0.7"))).status).to.equal(200);
    });

    it("cannot be dodged by inventing X-Forwarded-For entries", async function () {
      // Caddy appends the real address last; whatever precedes it is the client's claim.
      const real = "10.0.0.8";
      for (let i = 0; i < 5; i++) await post(url, call("eth_blockNumber"), as(`1.1.1.${i}, ${real}`));
      const r = await post(url, call("eth_blockNumber"), as(`9.9.9.9, ${real}`));
      expect(r.status).to.equal(429);
    });

    it("limits transactions separately and more tightly than reads", async function () {
      const tx = call("eth_sendRawTransaction", ["0x00"]);
      expect((await post(url, tx, as("10.0.0.9"))).status).to.equal(200);
      expect((await post(url, tx, as("10.0.0.9"))).status).to.equal(200);
      const refused = await post(url, tx, as("10.0.0.9"));
      expect(refused.status).to.equal(429);
      expect(Number(refused.headers.get("retry-after"))).to.be.greaterThan(1);
    });

    it("gives a refused transaction its read allowance back", async function () {
      const tx = call("eth_sendRawTransaction", ["0x00"]);
      await post(url, tx, as("10.0.0.10"));
      await post(url, tx, as("10.0.0.10"));
      for (let i = 0; i < 10; i++) await post(url, tx, as("10.0.0.10")); // all refused by the write bucket
      // 5 read tokens, 2 spent on the accepted transactions; the refused ones must have cost none.
      for (let i = 0; i < 3; i++) expect((await post(url, call("eth_blockNumber"), as("10.0.0.10"))).status).to.equal(200);
      expect((await post(url, call("eth_blockNumber"), as("10.0.0.10"))).status).to.equal(429);
    });

    it("refuses a batch of transactions larger than the write bucket could ever hold", async function () {
      const batch = Array.from({ length: 3 }, (_, i) => call("eth_sendRawTransaction", ["0x00"], i));
      const r = await post(url, batch, as("10.0.0.11"));
      expect(r.status).to.equal(429);
      expect(upstream.seen).to.deep.equal([]);
    });
  });

  describe("telling clients apart", function () {
    it("keys IPv6 clients by their /64, since one person holds all of it", function () {
      expect(bucketKey("2001:db8:1:2:3:4:5:6")).to.equal(bucketKey("2001:db8:1:2:ffff:ffff:ffff:ffff"));
      expect(bucketKey("2001:db8::1")).to.equal(bucketKey("2001:0db8:0000:0000:abcd::2"));
      expect(bucketKey("2001:db8:1:2::1")).to.not.equal(bucketKey("2001:db8:1:3::1"));
      expect(bucketKey("2001:DB8::1")).to.equal(bucketKey("2001:db8::1"));
    });

    it("treats an IPv4-mapped address as the IPv4 address", function () {
      expect(bucketKey("::ffff:203.0.113.9")).to.equal("203.0.113.9");
      expect(bucketKey("203.0.113.9")).to.equal("203.0.113.9");
    });

    it("counts forwarded addresses from the end by the number of trusted proxies", function () {
      const req = (xff) => ({ headers: xff ? { "x-forwarded-for": xff } : {}, socket: { remoteAddress: "172.18.0.5" } });
      expect(clientAddress(req("7.7.7.7, 203.0.113.9"), 1)).to.equal("203.0.113.9");
      expect(clientAddress(req("203.0.113.9"), 1)).to.equal("203.0.113.9");
      expect(clientAddress(req("7.7.7.7, 203.0.113.9, 172.18.0.2"), 2)).to.equal("203.0.113.9");
      expect(clientAddress(req(undefined), 1)).to.equal("172.18.0.5");
      expect(clientAddress(req("203.0.113.9"), 0)).to.equal("172.18.0.5");
      expect(clientAddress(req("203.0.113.9"), 2)).to.equal("172.18.0.5");
    });
  });

  describe("origin patterns", function () {
    const accepts = (patterns, origin) => originMatcher(patterns)(origin);

    it("matches an exact origin and nothing that merely resembles it", function () {
      const patterns = ["https://sabha.vercel.app"];
      expect(accepts(patterns, "https://sabha.vercel.app")).to.equal(true);
      for (const lookalike of [
        "https://sabhaxvercel.app", // an unescaped dot would admit this
        "http://sabha.vercel.app", // wrong scheme
        "https://sabha.vercel.app:8443", // wrong port
        "https://x.sabha.vercel.app", // a subdomain
        "https://sabha.vercel.app.evil.com", // a longer host
        "https://evil.com/https://sabha.vercel.app",
        "https://sabha.vercel.app/",
        "null",
        "",
        "chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn",
      ]) {
        expect(accepts(patterns, lookalike), lookalike).to.equal(false);
      }
    });

    it("lets a wildcard stand for one hostname label, no more and no less", function () {
      const patterns = ["https://sabha-*.vercel.app"];
      expect(accepts(patterns, "https://sabha-git-main-abc.vercel.app")).to.equal(true);
      expect(accepts(patterns, "https://sabha-1.vercel.app")).to.equal(true);
      expect(accepts(patterns, "https://sabha-.vercel.app")).to.equal(false);
      expect(accepts(patterns, "https://sabha-a.b.vercel.app")).to.equal(false);
      expect(accepts(patterns, "https://sabha-a.vercel.app.evil.com")).to.equal(false);
      expect(accepts(patterns, "https://other-a.vercel.app")).to.equal(false);
      expect(accepts(patterns, "https://sabha-a.vercelxapp")).to.equal(false);
    });

    it("keeps the port in the match when the pattern has one", function () {
      const patterns = ["http://localhost:5173"];
      expect(accepts(patterns, "http://localhost:5173")).to.equal(true);
      expect(accepts(patterns, "http://localhost:5174")).to.equal(false);
      expect(accepts(patterns, "http://localhost")).to.equal(false);
    });

    it("ignores case, since a host name has none", function () {
      expect(accepts(["https://Sabha.Vercel.app"], "https://sabha.vercel.app")).to.equal(true);
    });

    it("matches nothing when no origin is listed", function () {
      expect(accepts([], "https://sabha.vercel.app")).to.equal(false);
    });

    it("refuses patterns that are too broad or malformed, so a typo fails at startup", function () {
      for (const bad of [
        "https://*.vercel.app", // every site on the host
        "*",
        "https://*",
        "https://sabha-*.app", // wildcard directly under a public suffix
        "https://a*b*c.vercel.app",
        "sabha.vercel.app", // no scheme
        "ftp://sabha.vercel.app",
        "https://sabha.vercel.app/path",
        "https://sabha.vercel.app/",
        "https://sab ha.com",
        "https://a..com",
        "https://.a.com",
        "https://sabha.vercel.app:99999x",
        "",
      ]) {
        expect(() => compileOriginPattern(bad), JSON.stringify(bad)).to.throw(/Invalid origin pattern/);
      }
    });

    it("reads a list separated by commas, spaces or both", function () {
      expect(parseOrigins("https://a.example.com, https://b.example.com  https://sabha-*.vercel.app")).to.deep.equal([
        "https://a.example.com",
        "https://b.example.com",
        "https://sabha-*.vercel.app",
      ]);
      expect(parseOrigins("")).to.deep.equal([]);
      expect(parseOrigins(undefined)).to.deep.equal([]);
      expect(() => parseOrigins("https://a.example.com, https://*.vercel.app")).to.throw(/Invalid origin pattern/);
    });

    it("does not split an origin on the letter s", function () {
      expect(parseOrigins("https://sabha.vercel.app")).to.deep.equal(["https://sabha.vercel.app"]);
    });
  });

  describe("browser access (CORS)", function () {
    const ORIGIN = "https://sabha.vercel.app";

    beforeEach(() =>
      boot({
        gate: {
          allowedOrigins: [ORIGIN, "https://sabha-*.vercel.app"],
          readBucket: { capacity: 2, refillPerSecond: 0.01 },
          maxBodyBytes: 2048,
        },
      })
    );

    const preflight = (origin) =>
      fetch(url, {
        method: "OPTIONS",
        headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
      });

    it("answers the preflight of a listed origin with exactly what a JSON POST needs", async function () {
      const r = await preflight(ORIGIN);
      expect(r.status).to.equal(204);
      expect(r.headers.get("access-control-allow-origin")).to.equal(ORIGIN);
      expect(r.headers.get("access-control-allow-methods")).to.equal("POST, OPTIONS");
      expect(r.headers.get("access-control-allow-headers")).to.equal("content-type");
      expect(r.headers.get("vary")).to.equal("Origin");
      expect(upstream.seen).to.deep.equal([]);
    });

    it("answers the preflight of a preview deployment matched by a wildcard", async function () {
      const r = await preflight("https://sabha-git-feature-x.vercel.app");
      expect(r.status).to.equal(204);
      expect(r.headers.get("access-control-allow-origin")).to.equal("https://sabha-git-feature-x.vercel.app");
    });

    it("refuses the preflight of any other origin, and says nothing to help it", async function () {
      for (const origin of ["https://evil.example", "https://sabhaxvercel.app", "null"]) {
        const r = await preflight(origin);
        expect(r.status, origin).to.equal(403);
        expect(r.headers.get("access-control-allow-origin"), origin).to.equal(null);
        expect(r.headers.get("access-control-allow-methods"), origin).to.equal(null);
      }
    });

    it("never reflects the origin back as a wildcard", async function () {
      const r = await preflight(ORIGIN);
      expect(r.headers.get("access-control-allow-origin")).to.not.equal("*");
    });

    it("lets a listed origin read the answer to a real request", async function () {
      const r = await post(url, call("eth_blockNumber"), { origin: ORIGIN });
      expect(r.status).to.equal(200);
      expect(r.headers.get("access-control-allow-origin")).to.equal(ORIGIN);
      expect(r.headers.get("vary")).to.equal("Origin");
    });

    it("serves an unlisted origin the data but gives the browser no permission to read it", async function () {
      const r = await post(url, call("eth_blockNumber"), { origin: "https://evil.example" });
      expect(r.status).to.equal(200);
      expect(r.headers.get("access-control-allow-origin")).to.equal(null);
    });

    it("still serves a caller with no Origin at all, such as a script", async function () {
      const r = await post(url, call("eth_blockNumber"));
      expect(r.status).to.equal(200);
      expect(r.headers.get("access-control-allow-origin")).to.equal(null);
    });

    it("still serves a wallet extension, which calls with its own origin and needs no CORS", async function () {
      const r = await post(url, call("eth_chainId"), { origin: "chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn" });
      expect(r.status).to.equal(200);
      expect(r.json.result).to.equal("echo:eth_chainId");
      expect(r.headers.get("access-control-allow-origin")).to.equal(null);
    });

    it("lets the page read a rate-limit refusal, and its Retry-After", async function () {
      await post(url, call("eth_blockNumber"), { origin: ORIGIN });
      await post(url, call("eth_blockNumber"), { origin: ORIGIN });
      const r = await post(url, call("eth_blockNumber"), { origin: ORIGIN });
      expect(r.status).to.equal(429);
      expect(r.headers.get("access-control-allow-origin")).to.equal(ORIGIN);
      expect(r.headers.get("access-control-expose-headers")).to.equal("Retry-After");
    });

    it("lets the page read a refusal of a forbidden method", async function () {
      const r = await post(url, call("admin_peers"), { origin: ORIGIN });
      expect(r.json.error.code).to.equal(-32601);
      expect(r.headers.get("access-control-allow-origin")).to.equal(ORIGIN);
    });

    it("lets the page read an oversize refusal", async function () {
      const r = await post(url, call("eth_sendRawTransaction", ["0x" + "ab".repeat(3000)]), { origin: ORIGIN });
      expect(r.status).to.equal(413);
      expect(r.headers.get("access-control-allow-origin")).to.equal(ORIGIN);
    });

    it("does not answer a preflight on a path other than the root", async function () {
      const r = await fetch(`${url}/admin`, { method: "OPTIONS", headers: { origin: ORIGIN } });
      expect(r.status).to.equal(405);
      expect(r.headers.get("access-control-allow-methods")).to.equal(null);
    });

    it("sends no CORS headers at all if no origin was configured", async function () {
      await close(gate);
      gate = createGate({ upstream: upstream.url, log: () => {} });
      url = await listen(gate);
      const r = await post(url, call("eth_blockNumber"), { origin: ORIGIN });
      expect(r.status).to.equal(200);
      expect(r.headers.get("access-control-allow-origin")).to.equal(null);
      expect((await preflight(ORIGIN)).status).to.equal(403);
    });
  });

  describe("when the node misbehaves", function () {
    it("answers with a JSON-RPC error instead of hanging or crashing if the node is down", async function () {
      await boot();
      await close(upstream.server);
      const r = await post(url, call("eth_blockNumber", [], 5));
      expect(r.status).to.equal(200);
      expect(r.json.id).to.equal(5);
      expect(r.json.error.code).to.equal(-32603);
    });

    it("answers with an error if the node returns something that is not JSON", async function () {
      upstream = await new Promise((resolve) => {
        const server = http.createServer((req, res) => {
          req.resume();
          req.on("end", () => res.end("<html>oops</html>"));
        });
        server.listen(0, "127.0.0.1", () => resolve({ server, seen: [], url: `http://127.0.0.1:${server.address().port}` }));
      });
      gate = createGate({ upstream: upstream.url, log: () => {} });
      url = await listen(gate);
      const r = await post(url, call("eth_blockNumber"));
      expect(r.json.error.code).to.equal(-32603);
    });

    it("gives up on a node that never answers", async function () {
      await boot({ upstream: { delayMs: 1500 }, gate: { upstreamTimeoutMs: 100 } });
      const r = await post(url, call("eth_blockNumber"));
      expect(r.json.error.code).to.equal(-32603);
    });

    it("sheds load with 503 rather than queueing without limit", async function () {
      await boot({ upstream: { delayMs: 300 }, gate: { maxInFlight: 2 } });
      const results = await Promise.all(Array.from({ length: 5 }, () => post(url, call("eth_blockNumber"))));
      const statuses = results.map((r) => r.status);
      expect(statuses.filter((s) => s === 200).length).to.be.greaterThan(0);
      expect(statuses.filter((s) => s === 503).length).to.be.greaterThan(0);
    });
  });

  describe("health check", function () {
    it("reports the node's block height when it is up", async function () {
      await boot();
      const r = await fetch(`${url}/healthz`);
      expect(r.status).to.equal(200);
      expect(await r.json()).to.deep.equal({ ok: true, blockNumber: 16 });
    });

    it("reports failure when the node is down", async function () {
      await boot();
      await close(upstream.server);
      const r = await fetch(`${url}/healthz`);
      expect(r.status).to.equal(503);
    });

    it("is not a way to call other methods", async function () {
      await boot();
      const r = await fetch(`${url}/healthz?method=admin_peers`);
      expect(r.status).to.equal(200);
      expect(upstream.seen.map((c) => c.method)).to.deep.equal(["eth_blockNumber"]);
    });
  });
});
