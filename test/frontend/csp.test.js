const { expect } = require("chai");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const FRONTEND = path.join(__dirname, "..", "..", "frontend");

describe("the page's Content-Security-Policy", function () {
  let buildCsp;
  before(async function () {
    ({ buildCsp } = await import(pathToFileURL(path.join(FRONTEND, "vite-plugins", "csp.js")).href));
  });

  const directives = (policy) =>
    Object.fromEntries(
      policy.split("; ").map((d) => {
        const [name, ...values] = d.split(" ");
        return [name, values];
      })
    );

  describe("what the page may run", function () {
    it("runs only its own scripts: nothing inline, no eval, no other site", function () {
      const d = directives(buildCsp({ rpcUrls: ["https://rpc.example.org"] }));
      expect(d["script-src"]).to.deep.equal(["'self'"]);
    });

    it("never weakens itself with unsafe-inline, unsafe-eval or a wildcard", function () {
      const policy = buildCsp({ rpcUrls: ["https://rpc.example.org", "http://127.0.0.1:8545"], extraConnect: ["https://ipfs.example"] });
      expect(policy).to.not.match(/unsafe-/);
      expect(policy).to.not.match(/(^|\s)\*(\s|;|$)/);
      expect(policy).to.not.match(/https?:(\s|;|$)/); // a bare scheme allows every site on it
    });

    it("blocks everything it does not list", function () {
      const d = directives(buildCsp());
      expect(d["default-src"]).to.deep.equal(["'none'"]);
      expect(d["object-src"]).to.deep.equal(["'none'"]);
      expect(d["base-uri"]).to.deep.equal(["'none'"]);
      expect(d["form-action"]).to.deep.equal(["'none'"]);
    });

    it("allows the two typeface sources the dashboard still uses, and nothing else for styles and fonts", function () {
      const d = directives(buildCsp());
      expect(d["style-src"]).to.deep.equal(["'self'", "https://fonts.googleapis.com"]);
      expect(d["font-src"]).to.deep.equal(["https://fonts.gstatic.com"]);
    });
  });

  describe("where the page may send data", function () {
    it("lists exactly the networks' RPC origins, and no path or query", function () {
      const d = directives(buildCsp({ rpcUrls: ["https://rpc.example.org/v1/anything?key=abc", "https://sepolia.example/"] }));
      expect(d["connect-src"]).to.deep.equal(["'self'", "https://rpc.example.org", "https://sepolia.example"]);
    });

    it("keeps a port, so one local service does not open its neighbours", function () {
      const d = directives(buildCsp({ rpcUrls: ["http://127.0.0.1:8545"] }));
      expect(d["connect-src"]).to.deep.equal(["'self'", "http://127.0.0.1:8545"]);
    });

    it("lists each origin once", function () {
      const d = directives(buildCsp({ rpcUrls: ["https://a.example", "https://a.example/x"], extraConnect: ["https://a.example"] }));
      expect(d["connect-src"]).to.deep.equal(["'self'", "https://a.example"]);
    });

    it("allows only the page itself when no network is configured", function () {
      expect(directives(buildCsp())["connect-src"]).to.deep.equal(["'self'"]);
    });

    it("includes extra origins such as a document gateway", function () {
      const d = directives(buildCsp({ rpcUrls: ["https://a.example"], extraConnect: ["https://gateway.example"] }));
      expect(d["connect-src"]).to.include("https://gateway.example");
    });

    it("refuses anything that is not an http(s) address, rather than writing a bad policy", function () {
      for (const bad of ["not a url", "javascript:alert(1)", "data:text/html,x", "ftp://a.example", "file:///etc/passwd", "wss"]) {
        expect(() => buildCsp({ rpcUrls: [bad] }), bad).to.throw(/Content-Security-Policy|http\(s\)/);
      }
    });

    it("cannot be talked into a second directive by a hostile address", function () {
      // A policy is text. ";" starts a new directive and a space a new source,
      // and the URL parser lets some of those through in a host.
      for (const hostile of [
        "https://a.example;script-src https://evil.example",
        "https://a.example;script-src",
        "https://a.example;",
        "https://a.example,b.example",
        "https://a'b.example",
      ]) {
        expect(() => buildCsp({ rpcUrls: [hostile] }), JSON.stringify(hostile)).to.throw(/Content-Security-Policy/);
      }
    });

    it("keeps the policy intact even where the URL parser quietly rewrites an address", function () {
      // The parser drops newlines, so this becomes an odd but harmless host name.
      const policy = buildCsp({ rpcUrls: ["https://a.example\nscript-src"] });
      expect(policy).to.not.include("\n");
      expect(directives(policy)["script-src"]).to.deep.equal(["'self'"]);
      expect(policy.split("; ")).to.have.length(10);
    });

    it("accepts the forms of address a real network uses", function () {
      const d = directives(
        buildCsp({ rpcUrls: ["https://rpc.sub-domain.example.org", "http://127.0.0.1:8545", "http://localhost:8545", "http://[::1]:8545", "https://ethereum-sepolia-rpc.publicnode.com"] })
      );
      expect(d["connect-src"]).to.have.length(6);
    });
  });
});

describe("the hosting configuration", function () {
  const config = JSON.parse(fs.readFileSync(path.join(FRONTEND, "vercel.json"), "utf8"));
  const headersFor = (source) =>
    Object.fromEntries(config.headers.filter((h) => h.source === source).flatMap((h) => h.headers.map((x) => [x.key, x.value])));

  it("builds the page the way CI does", function () {
    expect(config.buildCommand).to.equal("npm run build");
    expect(config.outputDirectory).to.equal("dist");
    expect(config.installCommand).to.equal("npm ci");
  });

  it("forbids being framed, which a <meta> policy cannot do", function () {
    const all = headersFor("/(.*)");
    expect(all["Content-Security-Policy"]).to.equal("frame-ancestors 'none'");
    expect(all["X-Frame-Options"]).to.equal("DENY");
  });

  it("sends the standard hardening headers", function () {
    const all = headersFor("/(.*)");
    expect(all["X-Content-Type-Options"]).to.equal("nosniff");
    expect(all["Referrer-Policy"]).to.equal("no-referrer");
    expect(all["Permissions-Policy"]).to.match(/camera=\(\)/);
  });

  it("caches the fingerprinted assets for a year and nothing else", function () {
    expect(headersFor("/assets/(.*)")["Cache-Control"]).to.equal("public, max-age=31536000, immutable");
    expect(headersFor("/(.*)")).to.not.have.property("Cache-Control");
  });
});
