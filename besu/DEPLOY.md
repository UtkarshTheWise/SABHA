# Putting the network on a server

This is the runbook for hosting the four-validator network so members can reach
it from their phones. It covers: choosing a machine, setting it up, checking it
is healthy, backing it up, and what to do when a validator stops.

Read [README.md](README.md) first if you have not run the network locally. Do
that before paying for or configuring anything: every step here assumes you have
seen it work on your own machine.

## What you will end up with

```
 member's phone or laptop
        │  HTTPS (wallet, dashboard)
        ▼
 ┌────────────────────────────── one virtual machine ───────────────────────────┐
 │  Caddy ── certificates, TLS               the only thing on ports 80 and 443 │
 │    │                                                                         │
 │    ▼  plain HTTP, private network                                            │
 │  rpc-gate ── method allowlist, rate limits, which web pages may read answers │
 │    │                                                                         │
 │    ▼                                                                         │
 │  validator 1 ◄──── QBFT ────► validators 2, 3, 4      (private bridge only)  │
 └──────────────────────────────────────────────────────────────────────────────┘
        ▲
        │  SSH tunnel, you only
   admin RPC on validators 2, 3 and 4 (loopback ports 8546, 8547, 8548)
```

Nothing but Caddy listens on the internet. The administrative methods exist on
the validators but are bound to the machine's own loopback, and the gate would
refuse them anyway. Members never hold any currency: transactions cost nothing.

## Be clear about what this does and does not give you

- **Four validators on one machine are one operator.** Whoever has the machine
  has all four keys. The consensus is real and it survives a crashed *process*,
  but not a dishonest or compromised host. For the protection the design
  describes, each office bearer must run their own validator on their own
  server. `BESU_VALIDATOR_HOSTS` in `arrange.mjs` supports that; this runbook
  covers the single-machine case that fits a demonstration and a small society.
- **One machine is one point of failure.** If it goes down, nobody can vote
  until it is back. The data is safe if you keep backups (below), and members
  can still verify past results from any copy of the chain.
- **The free public testnet is the fallback**, not this network. See the main
  README for the Sepolia deployment, which stays up when your machine does not.

## 1. Choose a machine

You need roughly **2 vCPUs, 4 GB of RAM, 20 GB of disk and a public IP**, running
Ubuntu 24.04 LTS or similar. Measured with Besu 26.10.1 on a 512 MB heap, each
validator used about 600 MB, so the four use about 2.4 GB; a 2 GB machine does
not fit. The chain itself is tiny.

The Besu and Caddy images are published for both `amd64` and `arm64`, so Intel,
AMD and Ampere (Arm) machines all work. Besu 26.x needs Java 25; the Docker image
brings its own, so there is nothing to install for that.

Options, cheapest first. **Check each provider's current terms yourself**: free
tiers change, and what follows is a starting point, not a quote.

| Option | Cost | Architecture | Things to check |
| --- | --- | --- | --- |
| Oracle Cloud "Always Free" Ampere A1 | Free, no expiry | arm64 | Reports conflict on whether the free allowance is still 4 CPU / 24 GB or has been cut to 2 / 12; either is plenty. Popular regions often have no free capacity, and signup asks for a card for verification. |
| A student cloud credit (for example through the GitHub Student Developer Pack or your university's Azure agreement) | Free while the credit lasts | usually amd64 | The credit has an end date, and a 2 vCPU / 4 GB machine uses it steadily. Fine for a semester; not a place to leave a society's records. |
| Hetzner Cloud, arm64 plan with 4 vCPU / 8 GB (CAX21) | About €10 a month at the time of writing | arm64 | Prices changed in 2026 and some plans were showing as unavailable. Confirm on their site. |

Not suitable: any plan with 1 GB of RAM (four validators will not fit), and
free plans that expire after six months, because a chain that disappears halfway
through a term is worse than none.

You create the account and the machine yourself.

## 2. Prepare the machine

Log in over SSH, then:

```bash
# Firewall: SSH, HTTP (certificate issuance and redirect) and HTTPS. Nothing else.
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Your provider may also have its own firewall or "security list" in its web
console. Open 22, 80 and 443 there too; on some providers that is the only
firewall that counts.

Install Docker Engine with the Compose plugin by following the official
instructions for your distribution (<https://docs.docker.com/engine/install/ubuntu/>),
and Node 18 or newer, which the setup script uses:

```bash
sudo apt-get install -y nodejs git
node --version      # 18 or newer
docker compose version
sudo usermod -aG docker "$USER"   # then log out and back in
```

Turn on automatic security updates (`sudo apt-get install unattended-upgrades`),
and switch SSH to keys only. A server holding validator keys is worth a few
minutes of hardening.

## 3. Get the code and configure it

```bash
git clone <your repository URL> sabha
cd sabha/besu
cp .env.example .env
nano .env
```

What to set in `besu/.env`:

| Variable | What to put |
| --- | --- |
| `BESU_VERSION` | Leave the pinned version. Upgrade on purpose (section 8). |
| `BESU_CHAIN_ID` | Leave 40717 unless you have a reason. It must match `BESU_CHAIN_ID` in the root `.env` on your laptop. Changing it later means a new chain. |
| `BESU_HEAP` | `512m` on a 4 GB machine. |
| `RPC_DOMAIN` | The name members will connect to, for example `rpc.yoursociety.example`. See section 4. |
| `FRONTEND_ORIGINS` | The address of your dashboard, for example `https://sabha.vercel.app`, plus `https://sabha-*.vercel.app` if you want preview deployments to work. The `*` may stand for part of one name only; `https://*.vercel.app` is refused on purpose. |
| `COMPOSE_PROFILES` | Uncomment `public` so a plain `docker compose up -d` always starts the public endpoint, including after a reboot. |

## 4. Point a name at the machine

Caddy gets a free certificate for `RPC_DOMAIN` automatically, but only if the
name already points at this machine and ports 80 and 443 are reachable from the
internet.

- With a domain of your own, add an `A` record (and `AAAA` if the machine has
  an IPv6 address) for the name, pointing at the machine's public IP.
- Without one, a free dynamic-DNS name such as one from DuckDNS works the same
  way: create a name there and point it at the machine's IP.

Check from anywhere:

```bash
dig +short rpc.yoursociety.example     # should print the machine's public IP
```

Wait until it does. Starting Caddy before DNS is ready makes it retry and, if you
keep restarting it, can exhaust the certificate authority's rate limits.

## 5. Create the network and start it

```bash
cd sabha/besu
./setup.sh                        # keys, genesis, peer list, node allowlist
docker compose up -d --build      # four validators, the gate, and Caddy
docker compose ps                 # everything should say running
docker compose logs -f caddy      # wait for "certificate obtained successfully"
```

`setup.sh` creates a **new chain** every time. Run it once. It asks for
confirmation if a network already exists, and re-running it after real votes
would throw those votes away.

If a validator stops with a permission error on `/data`, the container's user
cannot write the directory that `setup.sh` created. The Besu image runs as an
unprivileged user; ask the image which, rather than guess:

```bash
set -a; . ./.env; set +a
UID_IN_IMAGE=$(docker run --rm --entrypoint id "hyperledger/besu:$BESU_VERSION" -u)
GID_IN_IMAGE=$(docker run --rm --entrypoint id "hyperledger/besu:$BESU_VERSION" -g)
sudo chown -R "$UID_IN_IMAGE:$GID_IN_IMAGE" nodes
docker compose up -d
```

(The check that runs this project's tests does the same thing, so a change in the
image's user shows up there first.) After this the keys belong to that user, not
to you. If your own user is a different one, `./backup.sh` has to run with
`sudo` to read them: `sudo env "PATH=$PATH" ./backup.sh /var/backups/sabha`.

## 6. Check that it is healthy and closed

From your own laptop, against the public name:

```bash
node besu/check-health.mjs https://rpc.yoursociety.example
```

It confirms the chain id, that blocks are being produced, that validator 1 sees
its three peers, and **that `admin_*`, `qbft_*`, `txpool_*`, `debug_*` and
`eth_accounts` do not answer publicly**. Every line should say `PASS`. If any
public-exposure check says `FAIL`, take the endpoint offline
(`docker compose stop caddy`) and find out why before anything else.

On the server, or over an SSH tunnel to it, add the administrative view:

```bash
# from your laptop:  ssh -L 8546:127.0.0.1:8546 you@the-machine
node besu/check-health.mjs https://rpc.yoursociety.example --admin http://127.0.0.1:8546
```

which also confirms there are four validators and that the admin node is linked
to its peers.

When nobody is voting the chain pauses between blocks (`BESU_EMPTY_BLOCK_SECONDS`,
60 seconds by default), so a "block is 40 seconds old" reading while idle is
normal. A transaction is included within about two seconds. The check allows for
this.

Put it in cron so you hear about problems before members do:

```bash
# every 10 minutes; mail or alert on a non-zero exit as suits you
*/10 * * * * cd /home/you/sabha/besu && node check-health.mjs http://127.0.0.1:8545 --admin http://127.0.0.1:8546 > /tmp/sabha-health.log 2>&1 || echo "sabha unhealthy" | logger -t sabha
```

## 7. Deploy the contracts

From your laptop (not the server), in the repository root, set the root `.env`:

```
BESU_RPC_URL=https://rpc.yoursociety.example
PUBLIC_RPC_URL_BESU=https://rpc.yoursociety.example
BESU_CHAIN_ID=40717
DEPLOYER_PRIVATE_KEY=<a fresh key, not one you use for anything else>
DEMO_MNEMONIC=<a fresh throwaway phrase, for the demo's officers and voters>
```

then:

```bash
npm run deploy:besu
npm run seed:besu       # optional: sample members and ballots
npm run demo:besu       # optional: the whole workflow, with real transaction hashes
```

The deployer needs no balance: gas is free. A key from this phrase has no value
anywhere, which is the point; do **not** reuse the public `test test ... junk`
phrase on a network other people can reach. The scripts refuse to run against a
non-local network without keys of your own.

## 8. Operating it

### Backups

```bash
cd sabha/besu
./backup.sh /var/backups/sabha            # keys and settings, then each validator's data
./backup.sh /var/backups/sabha --keys-only
```

Copy the result **off the machine**. The part you cannot replace is the keys
archive (`nodes/*/key`, `genesis.json`, `.env`): with it, the network can be
rebuilt from any surviving validator, and without it, a total loss of the
machine is a total loss of the chain. The script archives validators one at a
time, waits for each to rejoin before touching the next, and refuses to start if
any validator is not already healthy. It starts with validator 4 and ends with
validator 1, so the public endpoint pauses for a short moment at the end.

Run it from cron, nightly, and prune old copies yourself:

```bash
17 3 * * * cd /home/you/sabha/besu && ./backup.sh /var/backups/sabha && find /var/backups/sabha -name 'sabha-*.tgz' -mtime +14 -delete
```

A backup you have never restored is a hope. Once, before you rely on it,
restore to a spare machine and see the chain come up.

To restore: `docker compose down`, unpack the keys archive in `besu/`, unpack the
node archives into `besu/nodes/`, then `docker compose up -d`.

### A validator has stopped

```bash
docker compose ps                  # which one
docker compose logs --tail=100 node3
docker compose restart node3
```

Four validators tolerate **one** being down: the other three keep producing
blocks and nobody notices. Treat one down as an incident to fix today. If **two**
are down the chain stops producing blocks. Nothing is lost, and votes cannot be
cast until one returns; restart them and it carries on from where it stopped.
`docker compose up -d` brings everything back after a reboot, because the
containers restart on their own.

If a validator's data directory is damaged, restore that one node from its
archive. If it was damaged and there is no archive, the other three hold the
whole chain: stop the node, delete `nodes/nodeN/database` (never `key`), and
start it; it re-syncs from its peers.

If a validator's **key** is lost with no backup, that validator cannot come back
as itself. Replacing it means the remaining validators voting it out and a new
one in (`qbft_proposeValidatorVote` on at least three of them, through the admin
ports, then adding the new node to every `permissions_config.toml` and
restarting). That procedure is outlined here and has not been rehearsed: the real
protection is the key backup above.

### Upgrading Besu

```bash
# 1. read the release notes for every version between yours and the target
# 2. edit BESU_VERSION in besu/.env
docker compose pull
# 3. one validator at a time, checking in between:
docker compose up -d node4 && node check-health.mjs http://127.0.0.1:8545 --admin http://127.0.0.1:8546
docker compose up -d node3 && ...
docker compose up -d node2 && ...
docker compose up -d node1 && ...
```

Never restart two at once. Do this in the first week of a term, not the night
before a ballot closes.

### Starting over

`./setup.sh` again. This is a new chain with new contracts; the old results are
gone from it. Keep the old backups if anyone might need to audit the old chain.

## 9. When something does not work

| Symptom | Likely cause |
| --- | --- |
| Caddy logs say it cannot obtain a certificate | DNS does not point at this machine yet, or port 80 or 443 is blocked by the provider's own firewall. Fix, then `docker compose restart caddy`. |
| A wallet says "chain id mismatch" or "network already exists" | `BESU_CHAIN_ID` differs between `besu/.env`, the root `.env` and what the wallet has saved. 1337 is registered to another network and should not be used. |
| The dashboard shows "cannot reach the node" in a browser but `curl` works | The dashboard's address is not in `FRONTEND_ORIGINS`, so the browser refuses to let the page read the answer. Add it and `docker compose up -d rpc-gate`. |
| Requests fail with 429 | One address sent too many calls; it recovers within seconds. Members sharing one network (a campus, a mobile carrier's NAT) share one allowance, so if that happens to real users, raise `READ_RATE` for the gate. |
| `check-health` says blocks are old | If nobody has voted for a while, compare the age with `BESU_EMPTY_BLOCK_SECONDS`. If it is far above that, look at `docker compose ps` and the validators' logs. |
| A validator exits at once with "permission denied" | See section 5: give the data directories to the user the Besu image runs as. |
| `docker compose` complains a variable is not set | Copy `besu/.env.example` to `besu/.env` and fill it in. |

## Keep these secret

`nodes/*/key` sign the blocks. `.env` holds your domain and settings. Neither is
ever committed (both are in `.gitignore`), and neither belongs in a chat message
or an email. Anyone holding enough validator keys can rewrite what the chain
says; the allowlist and the gate protect the network's edge, not a stolen key.
