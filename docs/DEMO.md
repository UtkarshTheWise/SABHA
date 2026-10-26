# Running the demo

## Where everything is

| What | Address |
| --- | --- |
| Dashboard | https://sabha-three.vercel.app |
| Public RPC (chain id 40717, gas is free) | https://sabha-demo.duckdns.org |
| Contracts | `frontend/src/chain/networks/besu.json` |
| Source | https://github.com/UtkarshTheWise/SABHA |

The server is one Google Cloud VM running four Besu validators behind a method
allowlist and rate limiter (see [besu/DEPLOY.md](../besu/DEPLOY.md)). Check it any
time with `node besu/check-health.mjs https://sabha-demo.duckdns.org`.

## Accounts

`demo-wallets/` on the presenter's laptop holds encrypted keystore files for
throwaway keys. They are git-ignored and are not in this repository.

| File | Role |
| --- | --- |
| `officer-admin.json` | Officer: opens proposals, enrols members |
| `member-aanya.json`, `member-utkarsh.json`, `member-rhea.json` | Enrolled members who can vote |

On the dashboard choose **Connect a wallet**, then under **Use a wallet on this device**
choose **Restore from a backup file**, pick a file and enter the passphrase. Each browser profile holds one wallet; use a separate
profile (or a private window) per role to show an officer and a member side by
side.

## A five-minute walkthrough

1. Open the dashboard with no wallet. Every ballot is readable by anyone.
2. Open the **Network** page: four validators, block height climbing, peers.
3. Restore the officer's keystore, go to **Officer desk** and open a new proposal with a short window.
4. In another profile import a member's keystore and cast a vote. The receipt shows the block and digest.
5. After the window closes, finalise it, then press **Recount from the ledger** on the ballot. It rebuilds the tally from event logs and should say the recount matches the contract.

## If something looks wrong

- "Cannot reach the node" in the browser while `curl` works: the dashboard's address is missing from `FRONTEND_ORIGINS` in `besu/.env` on the VM. Add it and run `docker compose up -d rpc-gate`.
- No new blocks for a minute while idle is normal; the chain pauses between blocks until a transaction arrives.
- Wallet apps differ in how they treat a zero-currency network. Test the phones you will demo on beforehand.
