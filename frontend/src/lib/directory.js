/**
 * Names for addresses, from the demo register `npm run seed` writes for the local
 * node. The register holds registration numbers, so it must never reach a
 * production bundle, whoever builds it: `import.meta.env.DEV` is a constant at
 * build time, so the glob below (and the file with it) is removed from
 * `vite build`. Only names leave this module, never the numbers.
 */
const files = import.meta.env.DEV ? import.meta.glob("../chain/directory.json", { eager: true, import: "default" }) : {};
const entries = Object.values(files)[0] || [];

const byAddress = Object.fromEntries(entries.map((person) => [person.address.toLowerCase(), person.name]));

/** A member's name if the local demo register knows it, otherwise null. */
export const nameOf = (address) => (address ? byAddress[String(address).toLowerCase()] ?? null : null);
