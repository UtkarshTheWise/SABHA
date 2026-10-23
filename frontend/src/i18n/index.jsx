/**
 * Translation, kept deliberately small: a dictionary per language, `t(key, params)`
 * with {placeholders}, and plural forms chosen by the browser's own rules
 * (`key_one`, `key_other`). English is always loaded; Hindi and Tamil are fetched
 * the first time they are used, so an English reader never downloads them.
 *
 * Only the interface is translated. A ballot's title, description and options are
 * shown exactly as the officer wrote them.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import en from "./en.json";

export const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "hi", name: "हिन्दी" },
  { code: "ta", name: "தமிழ்" },
];

const loaders = {
  hi: () => import("./hi.json"),
  ta: () => import("./ta.json"),
};

const STORAGE_KEY = "sabha.lang";

function stored() {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** ?lang= in the link, then the last choice, then the browser's language, then English. */
export function initialLanguage() {
  const known = (code) => LANGUAGES.some((l) => l.code === code);
  const fromLink = new URLSearchParams(window.location.hash.split("?")[1] || "").get("lang");
  if (known(fromLink)) return fromLink;
  const saved = stored();
  if (known(saved)) return saved;
  for (const tag of navigator.languages || [navigator.language]) {
    const base = String(tag).slice(0, 2).toLowerCase();
    if (known(base)) return base;
  }
  return "en";
}

/** Look a key up in a dictionary of nested objects: "errors.AlreadyVoted". */
function lookup(dictionary, key) {
  let value = dictionary;
  for (const part of key.split(".")) {
    if (value == null || typeof value !== "object") return undefined;
    value = value[part];
  }
  return typeof value === "string" ? value : undefined;
}

function fill(template, params) {
  return template.replace(/\{(\w+)\}/g, (whole, name) => (params[name] === undefined ? whole : String(params[name])));
}

/** Build a translate function over a dictionary, falling back to English. Exported for tests. */
export function makeTranslator(lang, dictionary) {
  const plural = new Intl.PluralRules(lang);
  return function t(key, params = {}) {
    let template;
    if (typeof params.count === "number") {
      const form = plural.select(params.count);
      template = lookup(dictionary, `${key}_${form}`) ?? lookup(dictionary, `${key}_other`) ?? lookup(en, `${key}_${form}`) ?? lookup(en, `${key}_other`);
    }
    template ??= lookup(dictionary, key) ?? lookup(en, key);
    return template === undefined ? key : fill(template, params);
  };
}

const LocaleContext = createContext(null);

export function LocaleProvider({ children }) {
  const [lang, setLang] = useState(initialLanguage);
  const [dictionaries, setDictionaries] = useState({ en });

  useEffect(() => {
    let live = true;
    if (lang !== "en" && !dictionaries[lang]) {
      loaders[lang]().then((module) => live && setDictionaries((d) => ({ ...d, [lang]: module.default })));
    }
    document.documentElement.lang = lang;
    return () => {
      live = false;
    };
  }, [lang, dictionaries]);

  const choose = useCallback((code) => {
    setLang(code);
    try {
      window.localStorage.setItem(STORAGE_KEY, code);
    } catch {
      /* a remembered choice is a convenience, never a requirement */
    }
  }, []);

  const value = useMemo(() => {
    const dictionary = dictionaries[lang] ?? en;
    return { lang, setLang: choose, t: makeTranslator(lang, dictionary) };
  }, [lang, dictionaries, choose]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("useLocale must be used inside <LocaleProvider>");
  return value;
}
