const { expect } = require("chai");
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..", "..", "frontend", "src", "i18n");
const load = (lang) => JSON.parse(fs.readFileSync(path.join(DIR, `${lang}.json`), "utf8"));

/** Every leaf as "a.b.c" -> string. */
function flatten(node, prefix = "", out = {}) {
  for (const [key, value] of Object.entries(node)) {
    const here = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") flatten(value, here, out);
    else out[here] = value;
  }
  return out;
}

const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("the translations", function () {
  const en = flatten(load("en"));

  for (const lang of ["hi", "ta"]) {
    describe(lang, function () {
      const dict = flatten(load(lang));

      it("has every key English has, and no others", function () {
        const missing = Object.keys(en).filter((k) => !(k in dict));
        const extra = Object.keys(dict).filter((k) => !(k in en));
        expect(missing, "missing from " + lang).to.deep.equal([]);
        expect(extra, "not in English").to.deep.equal([]);
      });

      it("leaves no string empty", function () {
        const empty = Object.entries(dict).filter(([, v]) => typeof v !== "string" || v.trim() === "");
        expect(empty).to.deep.equal([]);
      });

      it("keeps every {placeholder} of the English text, so no value is dropped or renamed", function () {
        for (const [key, text] of Object.entries(en)) {
          expect(placeholders(dict[key] ?? ""), key).to.deep.equal(placeholders(text));
        }
      });

      it("keeps the same plural forms English has", function () {
        const forms = (d) => Object.keys(d).filter((k) => /_(one|other)$/.test(k)).sort();
        expect(forms(dict)).to.deep.equal(forms(en));
      });

      it("follows the house style: no em dash, no middle dot", function () {
        const bad = Object.entries(dict).filter(([, v]) => /[—·]/.test(v));
        expect(bad).to.deep.equal([]);
      });
    });
  }

  it("English itself follows the house style: no em dash, no middle dot", function () {
    const bad = Object.entries(en).filter(([, v]) => /[—·]/.test(v));
    expect(bad).to.deep.equal([]);
  });

  it("uses keys the code asks for: every t(\"...\") in the sources exists in English", function () {
    const used = new Set();
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(jsx?|mjs)$/.test(entry.name)) {
          const source = fs.readFileSync(full, "utf8");
          for (const m of source.matchAll(/\bt\(\s*"([A-Za-z0-9_.]+)"/g)) used.add(m[1]);
        }
      }
    };
    walk(path.join(DIR, ".."));
    const known = (key) => key in en || `${key}_other` in en || Object.keys(en).some((k) => k.startsWith(`${key}.`));
    const unknown = [...used].filter((k) => !known(k));
    expect(unknown).to.deep.equal([]);
  });
});
