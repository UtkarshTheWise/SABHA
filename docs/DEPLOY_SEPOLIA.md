# The public testnet fallback

Sepolia is an Ethereum test network anybody can use for free. Putting Sabha there
gives you something that stays up when your own server does not, and public
explorer pages to cite in the report. It is **not** a permissioned network: the
contracts still refuse anyone who is not on the roster, but the chain underneath
is open, and members pay (test) gas.

|  | Besu network (`besu/`) | Sepolia |
| --- | --- | --- |
| Who runs it | You | Everyone |
| Members need ether | No, gas is free | Yes, a little test ether |
| Who can see the ledger | Whoever you let | Everyone, forever |
| Stays up if your server dies | No | Yes |
| Block explorer | None | Yes, with verified source |

Use the Besu network for real ballots and Sepolia for the always-on demo and the
explorer links.

## 1. Make a throwaway deployer

Test ether has no value, but the key that holds it should still be new. Do **not**
reuse a key from a wallet you use for anything real. One command makes a fresh key
and a fresh twelve-word phrase and prints them as lines for `.env`. It writes
nothing to disk:

```bash
npm run keys
```

```
DEPLOYER_PRIVATE_KEY=0x...      # signer 0: deploys, and is the first officer
DEMO_MNEMONIC=word word ...     # the demo's other officers and voters
```

Paste both into the repository's `.env` (which is git-ignored). The scripts refuse to run against Sepolia without these,
and will not fall back to the public `test test ... junk` phrase.

## 2. Get some test ether

The deployer needs about 0.05 test ETH for a deployment plus the demo. The demo
tops its five voters up from the deployer, so they need nothing of their own.

Faucets change their limits and requirements often, and I could not check any of
them for you. Search for "Sepolia faucet" and try the ones run by large
infrastructure providers; some need an account or a small mainnet balance, and
some give only 0.05 a day. The explorer shows the balance:
<https://eth-sepolia.blockscout.com/address/YOUR_DEPLOYER_ADDRESS>.

## 3. Point the scripts at an RPC endpoint

```
SEPOLIA_RPC_URL=https://...             # what scripts use; may contain an API key
PUBLIC_RPC_URL_SEPOLIA=https://...      # what browsers use; NO API key
EXPLORER_URL_SEPOLIA=https://eth-sepolia.blockscout.com
```

The comments in `.env.example` say what was observed about public endpoints when
this was written. Test the one you choose: browsers will query event logs over
ranges of blocks, and endpoints differ in how large a range they allow.

## 4. Deploy, seed, run the demo

```bash
SABHA_NETWORK=sepolia npm run deploy
SABHA_NETWORK=sepolia npm run seed
SABHA_NETWORK=sepolia npm run demo      # prints every transaction hash; takes a few minutes
```

(In PowerShell, set the variable first: `$env:SABHA_NETWORK = "sepolia"`, or add
`-- --network sepolia` after the npm command.)

The demo waits for the ballot's window to close in real time, because a public
network cannot be fast-forwarded. `DEMO_WINDOW_SECONDS` shortens it.

## 5. Publish the source

```bash
SABHA_NETWORK=sepolia npm run verify
```

This submits both contracts to Blockscout and Sourcify, which need no account, and
to Etherscan too if `ETHERSCAN_API_KEY` is set. A brand-new contract can take a
minute to be indexed; if it reports a failure, wait and run it again. Afterwards
the explorer shows the exact Solidity that is deployed, which is the point: a
member does not have to trust that the code matches what you say it does.

## 6. Commit the network file

`npm run deploy` wrote `frontend/src/chain/networks/sepolia.json` and
`deployments/sepolia.json`. Both contain only public facts (addresses, chain id,
the public RPC address, the explorer) and are meant to be committed, so the
hosted frontend can build without a chain. Check `git diff` before you commit:
the public RPC address must not carry an API key.
