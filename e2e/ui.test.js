/**
 * The interface, in a real browser, against a real chain. Run through `npm run e2e`,
 * which starts the node, deploys, fills the chain and serves the built page.
 *
 * Every test starts from a new browser context, so nothing is shared except the
 * chain, which only the tests that vote or open a ballot change.
 */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");
const { JsonRpcProvider, Contract } = require("ethers");

const ROOT = path.resolve(__dirname, "..");
const PAGE = process.env.E2E_PAGE || "http://127.0.0.1:5199/";
const RPC = process.env.E2E_RPC || "http://127.0.0.1:8545";
const deployment = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments", "localhost.json"), "utf8"));
const votingAbi = JSON.parse(fs.readFileSync(path.join(ROOT, "frontend", "src", "chain", "abi", "DirectDemocracy.json"), "utf8"));

const provider = new JsonRpcProvider(RPC, undefined, { staticNetwork: false });
const voting = new Contract(deployment.contracts.DirectDemocracy.address, votingAbi, provider);

// Ballot ids as the fixture creates them
const CARRIED = 0;
const ADVISORY = 1;
const TIED = 2;
const COUNTING = 3;
const WITHDRAWN = 4;
const OPEN = 5;
const PENDING = 6;

let browser;
let accounts;

before(async () => {
  const options = { headless: true };
  if (process.env.E2E_BROWSER) options.executablePath = process.env.E2E_BROWSER;
  else options.channel = process.env.E2E_CHANNEL || "chrome";
  try {
    browser = await chromium.launch(options);
  } catch (error) {
    if (process.env.E2E_BROWSER || process.env.E2E_CHANNEL) throw error;
    browser = await chromium.launch({ headless: true, channel: "msedge" });
  }
  accounts = await provider.send("eth_accounts", []);
});

after(async () => {
  await browser?.close();
  provider.destroy();
});

/** A new browser, with everything that should never happen recorded. */
async function session({ width = 1280, height = 900, lang = "en" } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, locale: "en-IN", acceptDownloads: true });
  await context.addInitScript((l) => {
    try {
      if (!localStorage.getItem("sabha.lang")) localStorage.setItem("sabha.lang", l);
    } catch {
      // storage can be unavailable; the page must cope
    }
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  }, lang);
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  page.on("response", (r) => r.status() >= 400 && problems.push(`${r.status()} ${r.url()}`));

  return {
    page,
    context,
    async visit(hash = "#/") {
      await page.goto(PAGE + hash, { waitUntil: "load" });
      await page.locator("h1").first().waitFor({ timeout: 30000 });
    },
    async finish() {
      const csp = await page.evaluate(() => window.__csp).catch(() => []);
      await context.close();
      assert.deepEqual(problems, [], "the browser reported errors");
      assert.deepEqual(csp, [], "the Content-Security-Policy blocked something");
    },
  };
}

/** Elements that run past the right edge, ignoring the filter row that scrolls on purpose. */
const pastTheEdge = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("body *")]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.right > window.innerWidth + 1 && !e.closest(".sr-only, .skip, .filters");
      })
      .slice(0, 3)
      .map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(" ")[0]}`)
  );

async function connectDevAccount(s, address) {
  await s.page.getByRole("button", { name: "Connect a wallet" }).first().click();
  const dialog = s.page.getByRole("dialog");
  await dialog.getByLabel("Account", { exact: true }).selectOption(address);
  await dialog.getByRole("button", { name: "Use this account" }).click();
  await dialog.waitFor({ state: "hidden" });
}

test("a visitor with no wallet sees a ballot in every state, read from the chain", async () => {
  const s = await session();
  await s.visit();
  const body = s.page.locator("main");
  for (const text of ["Carried: For", "Advisory: MG Auditorium led", "Tied, nothing carried", "Waiting for the count", "Withdrawn", "Voting is open", "Not open yet"]) {
    await body.getByText(text).first().waitFor({ timeout: 15000 });
  }
  assert.equal(await s.page.getByRole("button", { name: "Connect a wallet" }).first().isVisible(), true);
  await s.finish();
});

test("the filter narrows the list to what is open", async () => {
  const s = await session();
  await s.visit();
  await s.page.getByText("Raise the annual society fee").first().waitFor();
  await s.page.getByText("Open now", { exact: true }).click();
  await s.page.getByText("Approve the sports day budget").waitFor();
  assert.equal(await s.page.getByText("Raise the annual society fee").count(), 0);
  await s.finish();
});

test("a carried ballot says it carried, and shows the count and the rules", async () => {
  const s = await session();
  await s.visit(`#/ballot/${CARRIED}`);
  await s.page.getByText("Carried: For.").waitFor();
  await s.page.getByText("Final count").waitFor();
  await s.page.getByText("Members who could vote").waitFor();
  await s.finish();
});

test("an advisory result says why it does not bind", async () => {
  const s = await session();
  await s.visit(`#/ballot/${ADVISORY}`);
  await s.page.getByText("Advisory: MG Auditorium led.").waitFor();
  await s.page.getByText(/does not bind the society/).waitFor();
  await s.page.getByText("Quorum not reached yet").waitFor();
  await s.finish();
});

test("a tie says nothing carried", async () => {
  const s = await session();
  await s.visit(`#/ballot/${TIED}`);
  await s.page.getByText("Tied: nothing carried.").waitFor();
  await s.finish();
});

test("a ballot that voting has ended on offers the count to anyone", async () => {
  const s = await session();
  await s.visit(`#/ballot/${COUNTING}`);
  await s.page.getByText(/not final until someone counts/).waitFor();
  await s.page.getByRole("heading", { name: "Count the votes" }).waitFor();
  await s.finish();
});

test("a withdrawn ballot says so and offers no vote", async () => {
  const s = await session();
  await s.visit(`#/ballot/${WITHDRAWN}`);
  await s.page.getByText("This ballot was withdrawn before voting opened.").waitFor();
  assert.equal(await s.page.getByRole("button", { name: "Cast vote" }).count(), 0);
  await s.finish();
});

test("a ballot that is not open yet says when it opens", async () => {
  const s = await session();
  await s.visit(`#/ballot/${PENDING}`);
  await s.page.getByText(/Voting has not opened yet/).waitFor();
  await s.finish();
});

test("an unknown ballot is reported, not a blank page", async () => {
  const s = await session();
  await s.visit("#/ballot/999");
  await s.page.getByText("There is no such ballot").waitFor();
  await s.finish();
});

test("the browser recount agrees with the contract", async () => {
  const s = await session();
  await s.visit(`#/ballot/${CARRIED}`);
  await s.page.getByRole("button", { name: "Recount from the ledger" }).click();
  await s.page.getByText("The recount matches the contract.").waitFor({ timeout: 30000 });
  await s.finish();
});

test("the network page shows the node and its blocks", async () => {
  const s = await session();
  await s.visit("#/network");
  await s.page.getByRole("heading", { name: "Recent blocks" }).waitFor();
  await s.page.getByText("does not use QBFT").waitFor();
  await s.finish();
});

test("the language can be changed to Hindi and Tamil, and what officers wrote stays as written", async () => {
  const s = await session();
  await s.visit(`#/ballot/${ADVISORY}`);
  await s.page.getByLabel("Language").first().selectOption("hi");
  await s.page.getByRole("heading", { name: "अंतिम गिनती" }).waitFor({ timeout: 10000 });
  assert.equal(await s.page.locator("html").getAttribute("lang"), "hi");
  await s.page.getByRole("heading", { name: "Pick the venue for the annual cultural night" }).waitFor();

  await s.page.getByLabel(/भाषा/).first().selectOption("ta");
  await s.page.getByText("இறுதி எண்ணிக்கை").first().waitFor({ timeout: 10000 });
  assert.equal(await s.page.locator("html").getAttribute("lang"), "ta");
  await s.finish();
});

test("the language choice is remembered after a reload", async () => {
  const s = await session();
  await s.visit();
  await s.page.getByLabel("Language").first().selectOption("hi");
  await s.page.getByRole("heading", { name: "मतदान" }).waitFor();
  await s.page.reload();
  await s.page.getByRole("heading", { name: "मतदान" }).waitFor();
  await s.finish();
});

test("nothing runs past the edge of a 360px phone, in any language", async () => {
  for (const lang of ["en", "hi", "ta"]) {
    const s = await session({ width: 360, height: 800, lang });
    for (const hash of ["#/", `#/ballot/${OPEN}`, `#/ballot/${ADVISORY}`, `#/ballot/${COUNTING}`, "#/network", "#/mine"]) {
      await s.visit(hash);
      await s.page.waitForTimeout(400);
      assert.deepEqual(await pastTheEdge(s.page), [], `${lang} ${hash} has something past the edge`);
    }
    await s.finish();
  }
});

test("the wallet dialog opens, keeps focus inside, and gives focus back on Escape", async () => {
  const s = await session();
  await s.visit();
  const opener = s.page.getByRole("button", { name: "Connect a wallet" }).first();
  await opener.focus();
  await opener.press("Enter");
  const dialog = s.page.getByRole("dialog");
  await dialog.waitFor();
  for (let i = 0; i < 12; i++) {
    await s.page.keyboard.press("Tab");
    // a modal dialog may hand focus to the browser's own controls, but never to the page behind it
    assert.equal(await s.page.evaluate(() => document.activeElement === document.body || !!document.activeElement?.closest("dialog")), true, "focus reached the page behind the dialog");
  }
  await s.page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await opener.evaluate((el) => el === document.activeElement), true, "focus did not return to the button");
  await s.finish();
});

test("the skip link is the first thing the keyboard reaches and it moves focus to the content", async () => {
  const s = await session();
  await s.visit();
  await s.page.keyboard.press("Tab");
  const skip = s.page.getByRole("link", { name: "Skip to content" });
  assert.equal(await skip.evaluate((el) => el === document.activeElement), true);
  await s.page.keyboard.press("Enter");
  assert.equal(await s.page.evaluate(() => document.activeElement?.id), "main");
  assert.equal(new URL(s.page.url()).hash, "#/", "the skip link must not overwrite the route");
  await s.finish();
});

test("a member votes with a development account, sees the transaction, and the chain holds the receipt", async () => {
  const member = accounts[4]; // enrolled, has not voted on the open ballot
  const s = await session();
  await s.visit(`#/ballot/${OPEN}`);
  await connectDevAccount(s, member);

  await s.page.getByText("Voting is open").first().waitFor({ state: "attached" }).catch(() => {});
  await s.page.getByRole("radio", { name: "Approve", exact: true }).check();
  await s.page.getByText(/You are voting for Approve/).waitFor();
  await s.page.getByRole("button", { name: "Cast vote" }).click();

  await s.page.getByText("Your vote is recorded").waitFor({ timeout: 30000 });
  await s.page.getByText(/Your vote is now part of the ledger/).waitFor();
  // the local node charges gas, so the fee is shown as an amount, with the code, block and gas beside it
  const facts = await s.page.locator(".tx__facts").innerText();
  assert.match(facts, /0x[0-9a-f]{64}/i, "the transaction code is shown");
  for (const label of ["Block", "Gas used", "Fee paid"]) assert.ok(facts.includes(label), label + " is shown");

  const receipt = await voting.receiptOf(OPEN, member);
  assert.equal(receipt.voted, true);
  assert.equal(receipt.option, 0n);

  // the same wallet cannot vote twice: the form is replaced by the receipt
  await s.page.reload();
  await s.page.getByText("Your vote is recorded").waitFor({ timeout: 30000 });
  assert.equal(await s.page.getByRole("button", { name: "Cast vote" }).count(), 0);
  await s.finish();
});

test("the votes page lists the ballots a wallet has voted on", async () => {
  const s = await session();
  await s.visit("#/mine");
  await s.page.getByText("Connect a wallet to see your votes").waitFor();
  await connectDevAccount(s, accounts[1]);
  await s.page.getByText("Approve the sports day budget").waitFor({ timeout: 20000 });
  await s.finish();
});

test("a wallet that is not on the roster is told so, with the address to give an officer", async () => {
  const outsider = accounts[9];
  const s = await session();
  await s.visit(`#/ballot/${OPEN}`);
  await connectDevAccount(s, outsider);
  await s.page.getByText(/not on the roster, so it cannot vote here/).waitFor({ timeout: 20000 });
  await s.page.getByText(outsider, { exact: false }).first().waitFor();
  await s.finish();
});

test("an officer opens a ballot from the desk and it appears in the list", async () => {
  const s = await session();
  await s.visit("#/officer");
  await s.page.getByText("Connect a wallet to continue").waitFor();
  await connectDevAccount(s, accounts[0]);

  await s.page.getByLabel("Question").fill("Choose the freshers' week theme");
  await s.page.getByLabel("Options, one per line").fill("Retro\nSpace\nMonsoon");
  await s.page.getByLabel("Open for (hours)").fill("48");
  await s.page.getByLabel("Quorum (percent of members)").fill("40");
  await s.page.getByRole("button", { name: "Open the ballot" }).click();

  await s.page.getByText(/The ballot now exists on the ledger/).waitFor({ timeout: 30000 });
  const count = Number(await voting.proposalCount());
  assert.equal(count, 8);

  await s.visit("#/");
  await s.page.getByText("Choose the freshers' week theme").waitFor();
  await s.finish();
});

test("the officer desk asks a visitor to connect, and turns away a wallet with no role", async () => {
  const s = await session();
  await s.visit("#/officer");
  await s.page.getByText("Connect a wallet to continue").waitFor();
  await connectDevAccount(s, accounts[9]);
  await s.page.getByText("This wallet is not an officer").waitFor({ timeout: 20000 });
  await s.finish();
});

test("anyone can count the votes once voting has ended", async () => {
  const s = await session();
  await s.visit(`#/ballot/${COUNTING}`);
  await connectDevAccount(s, accounts[9]);
  await s.page.getByRole("button", { name: "Count the votes" }).click();
  await s.page.getByText(/The result is now published/).waitFor({ timeout: 30000 });
  await s.page.getByText(/Carried|Advisory|Tied/).first().waitFor({ timeout: 20000 });
  await s.finish();
});

test("a wallet made in the browser is created, backed up, locked, and unlocked again", async () => {
  const s = await session();
  await s.visit(`#/ballot/${OPEN}`);
  await s.page.getByRole("button", { name: "Connect a wallet" }).first().click();
  const dialog = s.page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Create a wallet" }).click();

  // too short is refused in words, before anything is made
  await dialog.getByLabel("Passphrase").fill("short");
  await dialog.getByLabel("Type it again").fill("short");
  await dialog.getByRole("button", { name: "Create a wallet" }).click();
  await dialog.getByText("Use at least 10 characters.").waitFor();

  const passphrase = "a long enough passphrase";
  await dialog.getByLabel("Passphrase").fill(passphrase);
  await dialog.getByLabel("Type it again").fill(passphrase);
  await dialog.getByRole("button", { name: "Create a wallet" }).click();

  await dialog.getByText("Your wallet is ready").waitFor({ timeout: 30000 });
  await dialog.getByText(/Download the backup file now/).waitFor();
  const download = s.page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download backup file" }).click();
  const file = await download;
  const saved = JSON.parse(fs.readFileSync(await file.path(), "utf8"));
  assert.ok(saved.crypto || saved.Crypto, "the backup is an encrypted keystore");
  assert.equal(JSON.stringify(saved).includes(passphrase), false);
  const address = (await dialog.locator("p.num").first().innerText()).trim();
  assert.match(address, /^0x[0-9a-fA-F]{40}$/);
  await dialog.getByRole("button", { name: "Done" }).click();

  // a wallet that is not on the roster is told so on the open ballot
  await s.page.getByText(/not on the roster/).first().waitFor({ timeout: 20000 });

  // after a reload it is locked: the wrong passphrase is refused, the right one opens it
  await s.page.reload();
  await s.page.getByRole("button", { name: "Connect a wallet" }).first().click();
  await dialog.getByRole("heading", { name: "Unlock your wallet" }).waitFor();
  await dialog.getByLabel("Passphrase").fill("not the passphrase");
  await dialog.getByRole("button", { name: "Unlock", exact: true }).click();
  await dialog.getByText("That passphrase did not open the wallet.").waitFor({ timeout: 30000 });
  await dialog.getByLabel("Passphrase").fill(passphrase);
  await dialog.getByRole("button", { name: "Unlock", exact: true }).click();
  await dialog.waitFor({ state: "hidden", timeout: 30000 });

  await s.page.getByRole("button", { name: new RegExp(address.slice(0, 6)) }).first().waitFor();
  await s.finish();
});
