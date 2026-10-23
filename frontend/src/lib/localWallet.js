/**
 * A wallet that lives in this browser, for members who have no wallet app.
 *
 * The key is created here, encrypted with the member's passphrase into a standard
 * keystore file (the format every wallet app can import), and that encrypted file
 * is all that is ever stored. The passphrase is never stored; the unlocked key
 * lives in memory until the page is closed or the wallet is locked.
 *
 * What this does and does not protect against, in plain terms:
 *   - someone reading the browser's storage gets an encrypted file, not a key;
 *   - a weak passphrase can be guessed offline, so the length rule is the defence;
 *   - a script running inside this page could read the unlocked key, which is why
 *     the page is served with a strict Content-Security-Policy;
 *   - if the browser's data is cleared and there is no backup file, the wallet is gone.
 */
import { Wallet, encryptKeystoreJson, getAddress } from "ethers";

export const STORAGE_KEY = "sabha.keystore.v1";

// scrypt cost. The library's default (2^17) wants 128 MB and several seconds on a
// phone; 2^15 is a quarter of a second on a laptop and is the cost of a guess
// against a passphrase of ten characters or more.
export const SCRYPT = { N: 2 ** 15, r: 8, p: 1 };

export const MIN_PASSPHRASE = 10;

/** null if the passphrase is acceptable, otherwise the reason, as a translation key. */
export function passphraseProblem(passphrase) {
  const text = String(passphrase ?? "");
  if (text.length < MIN_PASSPHRASE) return "wallet.local.tooShort";
  if (/^(.)\1+$/.test(text)) return "wallet.local.tooSimple";
  return null;
}

/** The keystore store, over whatever storage it is given (the browser's, or an object in a test). */
export function keystoreStore(storage) {
  const guard = (fn, fallback) => {
    try {
      return fn();
    } catch {
      return fallback; // private windows and blocked storage throw; the wallet then lasts one visit
    }
  };
  return {
    load: () => guard(() => storage.getItem(STORAGE_KEY), null),
    save: (json) => guard(() => (storage.setItem(STORAGE_KEY, json), true), false),
    forget: () => guard(() => (storage.removeItem(STORAGE_KEY), true), false),
  };
}

/** The address a keystore belongs to, without the passphrase. */
export function keystoreAddress(json) {
  try {
    const address = JSON.parse(json).address;
    return address ? getAddress(address.startsWith("0x") ? address : `0x${address}`) : null;
  } catch {
    return null;
  }
}

/** Make a new wallet and its encrypted keystore. The caller keeps the Wallet in memory and stores the json. */
export async function createLocalWallet(passphrase, { scrypt = SCRYPT, onProgress } = {}) {
  const problem = passphraseProblem(passphrase);
  if (problem) throw Object.assign(new Error(problem), { code: "WEAK_PASSPHRASE", key: problem });
  const wallet = Wallet.createRandom();
  const json = await encryptKeystoreJson({ address: wallet.address, privateKey: wallet.privateKey }, passphrase, { scrypt, progressCallback: onProgress });
  return { wallet: new Wallet(wallet.privateKey), json };
}

/** Unlock a keystore. A wrong passphrase rejects with code INVALID_ARGUMENT. */
export async function unlockLocalWallet(json, passphrase, { onProgress } = {}) {
  const unlocked = await Wallet.fromEncryptedJson(json, passphrase, onProgress);
  return new Wallet(unlocked.privateKey);
}

/** A readable name for the backup file the member downloads. */
export function backupFileName(address) {
  return `sabha-wallet-${String(address).slice(0, 8).toLowerCase()}.json`;
}

/** Is this text a keystore a restore could use? Checked before asking for a passphrase. */
export function looksLikeKeystore(text) {
  try {
    const parsed = JSON.parse(text);
    return Boolean(parsed && (parsed.crypto || parsed.Crypto) && parsed.address && Number(parsed.version) === 3);
  } catch {
    return false;
  }
}
