/**
 * A Content-Security-Policy for the production page, built from the networks it
 * is configured to talk to.
 *
 * Why it matters here: the page will hold wallet keys in the browser, and the
 * main defence against a script injected into the page reading them is that the
 * page only runs its own scripts and can only send data to the endpoints it
 * needs. The endpoints are the RPC address of each network, which come from
 * src/chain/networks/*.json, so the policy cannot be a fixed file.
 *
 * It is injected as a <meta> tag by the build. That covers everything except
 * `frame-ancestors`, which only works as an HTTP header; vercel.json sets that.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnv } from "vite";

import { withRpcOverride } from "../src/lib/networkParams.js";

/** Reduces an address to the origin CSP wants, refusing anything that is not http(s). */
function originOf(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Not a URL, so it cannot go in the Content-Security-Policy: ${JSON.stringify(url)}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Only http(s) endpoints can be allowed, got ${parsed.protocol} in ${JSON.stringify(url)}`);
  }
  // A policy is text: ";" ends a directive and a space ends a source. The URL
  // parser accepts some of those characters in a host, so allow only what a real
  // host name, IPv4 or IPv6 address and port are made of.
  if (!/^https?:\/\/([a-z0-9-]+(\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])(:\d{1,5})?$/i.test(parsed.origin)) {
    throw new Error(`Cannot put this address in the Content-Security-Policy safely: ${JSON.stringify(url)}`);
  }
  return parsed.origin;
}

export function buildCsp({ rpcUrls = [], extraConnect = [] } = {}) {
  const connect = [...new Set([...rpcUrls, ...extraConnect].filter(Boolean).map(originOf))];
  return [
    "default-src 'none'",
    "script-src 'self'",
    // The dashboard still loads its two typefaces from Google Fonts.
    "style-src 'self' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data:",
    `connect-src 'self'${connect.length ? ` ${connect.join(" ")}` : ""}`,
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ].join("; ");
}

function readNetworks(root, env) {
  const dir = join(root, "src", "chain", "networks");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => withRpcOverride(JSON.parse(readFileSync(join(dir, f), "utf8")), env));
}

export default function contentSecurityPolicy() {
  let policy;
  return {
    name: "sabha-content-security-policy",
    apply: "build", // the dev server injects inline scripts for hot reload, which the policy forbids
    configResolved(config) {
      const env = loadEnv(config.mode, config.root, "VITE_");
      const networks = readNetworks(config.root, env);
      // Anything else the page must reach (a document gateway, say), by origin.
      const extraConnect = (env.VITE_CSP_EXTRA_CONNECT || "").split(/[\s,]+/).filter(Boolean);
      policy = buildCsp({ rpcUrls: networks.map((n) => n.rpcUrl), extraConnect });
    },
    transformIndexHtml(html) {
      return html.replace(/(<meta charset="[^"]*"\s*\/?>)/i, `$1\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
    },
  };
}
