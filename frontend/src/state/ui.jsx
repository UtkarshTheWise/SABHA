import { createContext, useContext, useEffect, useState } from "react";

/** Lets any page open the wallet dialog without owning it. */
const UiContext = createContext({ openWallet() {} });
export const UiProvider = UiContext.Provider;
export const useUi = () => useContext(UiContext);

/** Follows a CSS media query, so layout choices that change the markup (not just the style) can use it. */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => (typeof window === "undefined" ? false : window.matchMedia(query).matches));
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}
