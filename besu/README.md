# The permissioned network

Four Besu validators running QBFT consensus, which is the network layer of the
design. Everything here is optional for development — the contracts and the
frontend run perfectly well against a single Hardhat node — but this is the part
that makes the word "permissioned" mean something at the network level rather
than only inside the contracts.

Putting it on a server for real members is covered in [DEPLOY.md](DEPLOY.md).
This file is about what the network is and how to run it on your own machine.

## What QBFT gives us that a single node does not

A block is final the moment it is committed. There is no mining, no probabilistic
confirmation, and no reorganisation, so a vote recorded in block 200 stays in
block 200. Validators take turns proposing, and a block needs signatures from
more than two thirds of them before it counts. With four validators the network
keeps running correctly if one of them crashes or lies; with three it would not,
which is why four is the smallest sensible committee.

Membership of the validator set is itself a governed thing: an existing validator
proposes an addition or removal through `qbft_proposeValidatorVote`, and the
change takes effect once a majority agrees. For a student council this maps onto
something real — each of four office bearers runs one node, and no single one of
them can rewrite a result.

## Three layers of permissioning, and they are not the same

Worth keeping straight, because it is the obvious question in a review:

- **Who may be a node (here, enforced by Besu).** `nodes-allowlist` lists the
  four validators' public keys. A fifth node with the right genesis file still
  cannot connect: the validators drop it. Written by `arrange.mjs`, loaded
  through `permissions-nodes-config-file-enabled` in `config.toml`.
- **What may be asked of a node (here, enforced by the API list).** Validator 1
  serves `ETH`, `NET` and `WEB3` only. The administrative methods exist on
  validators 2, 3 and 4, bound to the machine's loopback (ports 8546 to 8548),
  and are never routed outward. They are on three validators, not one, because
  changing the validator set needs votes from a majority and each validator
  votes through its own RPC. On a server, a gateway in front of validator 1
  allows an explicit list of methods and rate-limits each client.
- **Who may vote (`MemberRegistry`).** Controlled by the roster. Running a node
  does not let anybody cast a vote, and being on the roster does not let a
  member produce blocks.

We deliberately do not allowlist *accounts* at the network layer. A member who
has just been invited, or whose wallet has just been rotated, would be unable to
send their first transaction until an administrator edited a file on the server.
The contracts already refuse a wallet that is not on the roster, and that check
is the one a member can reason about.

Gas is free: validators accept transactions at gas price zero, so members never
need to hold any currency. The cost of that is that the network cannot use price
to ration abuse, so the public RPC gateway rate-limits instead (see DEPLOY.md).

## Setup

Requires Docker and Node.

```bash
cd besu
cp .env.example .env    # pins the Besu version, chain id and heap size
./setup.sh              # generates keys, genesis block, peer list and allowlist
docker compose up -d    # starts four validators
```

`setup.sh` shells out to Besu's own `operator generate-blockchain-config` rather
than hand-writing the genesis `extraData`, which for QBFT is an RLP structure
containing the initial validator set and is easy to get subtly wrong. Re-running
it creates a **new chain**: it asks for confirmation first.

The chain id (`BESU_CHAIN_ID`, default 40717) is deliberately not 1337. That id
is registered to another network and collides with the "Localhost" entry in
wallets such as MetaMask.

Blocks arrive within two seconds of a transaction. When nobody is voting the
chain pauses between blocks (`BESU_EMPTY_BLOCK_SECONDS`, 60 by default) instead
of writing an empty block every two seconds all night, which keeps the disk and
the log-scanning audit page small. The block-time figure on the network health
page reflects that rather than hiding it.

## Checking that it actually formed a network

Validator 1's RPC is published on the machine's loopback only:

```bash
# blocks exist, and the chain id is the one in besu/.env
curl -s -X POST -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' http://127.0.0.1:8545

# validator 1 has three peers
curl -s -X POST -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","method":"net_peerCount","params":[],"id":1}' http://127.0.0.1:8545

# all four validators are recognised: the administrative API is on validator 2
curl -s -X POST -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","method":"qbft_getValidatorsByBlockNumber","params":["latest"],"id":1}' http://127.0.0.1:8546
```

The validator list should have four entries and the peer count should be `0x3`.

## Deploying to it

Set `BESU_CHAIN_ID` in the root `.env` to match `besu/.env`, then:

```bash
cd ..
npm run deploy:besu
npm run seed:besu
npm run demo:besu
```

The genesis block funds nothing, because nothing here costs anything. On your
own machine the scripts use the public Hardhat test mnemonic, which is fine for
a chain nobody else can reach. Any other RPC URL refuses to start without keys
of your own: see the root `.env.example`.

`demo.js` detects that this chain has no time-travel RPC and waits out the voting
window in real time instead of skipping ahead.

## Tearing it down

```bash
docker compose down
./setup.sh   # regenerates from scratch, discarding the old chain
```

## Two honest limits

**Four validators on one machine are one operator.** The consensus is real and
the fault tolerance against a crashed *process* is real, but whoever controls
the machine controls all four keys. The setup shows the mechanism; the
protection against a dishonest operator only appears when each validator runs on
a different office bearer's own server. `BESU_VALIDATOR_HOSTS` in `arrange.mjs`
exists for exactly that.

**The keys are secrets.** `nodes/*/key` are the validators' signing keys and
are git-ignored. Losing them, or leaking them, is a security event for the
network, not an inconvenience: back them up as DEPLOY.md describes.
