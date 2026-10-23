/**
 * A small router over the URL hash, so the dashboard works on any static host
 * with no server rules, and every state worth sharing is in the address:
 *
 *   #/                      the ballots
 *   #/?show=open            ballots, filtered
 *   #/ballot/3              one ballot
 *   #/mine                  the member's own votes
 *   #/officer?tab=roster    the officer desk
 *   #/network               how the network is doing
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

/** "#/ballot/3?show=open" → { path: ["ballot", "3"], query: URLSearchParams } */
export function parseHash(hash) {
  const raw = String(hash || "").replace(/^#/, "");
  const [pathPart, queryPart = ""] = raw.split("?");
  const path = pathPart.split("/").filter(Boolean).map(decodeURIComponent);
  return { path, query: new URLSearchParams(queryPart) };
}

/** The inverse, used for every link the page writes. */
export function buildHash(path, query = {}) {
  const base = `#/${[].concat(path).map(encodeURIComponent).join("/")}`;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null && value !== "") params.set(key, value);
  const text = params.toString();
  return text ? `${base}?${text}` : base;
}

const RouterContext = createContext(null);

export function RouterProvider({ children }) {
  const [hash, setHash] = useState(() => window.location.hash);

  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const route = useMemo(() => parseHash(hash), [hash]);

  const navigate = useCallback((to, { replace = false } = {}) => {
    const target = typeof to === "string" ? to : buildHash(to.path, to.query);
    if (replace) window.history.replaceState(null, "", target);
    else window.location.hash = target;
    setHash(target.startsWith("#") ? target : `#${target}`);
  }, []);

  const value = useMemo(() => ({ ...route, navigate }), [route, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRoute() {
  const value = useContext(RouterContext);
  if (!value) throw new Error("useRoute must be used inside <RouterProvider>");
  return value;
}

/** A link that is a real <a href>, so it opens in a new tab, copies and is announced as a link. */
export function Link({ to, query, children, ...rest }) {
  return (
    <a href={buildHash(to, query)} {...rest}>
      {children}
    </a>
  );
}

/**
 * When the page changes, move focus to its heading and set the tab title, so a
 * keyboard or screen-reader user lands at the top of the new page rather than
 * wherever the old one left them.
 */
export function useRouteFocus(title) {
  const { path } = useRoute();
  const first = useRef(true);
  const key = path.join("/");

  useEffect(() => {
    document.title = title ? `${title} | Sabha` : "Sabha";
  }, [title]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const heading = document.getElementById("page-title");
    if (heading) {
      heading.focus({ preventScroll: true });
      window.scrollTo({ top: 0 });
    }
  }, [key]);
}
