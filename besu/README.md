# The permissioned network

Four Besu validators running QBFT consensus, which is the network layer of the
design. Everything here is optional for development — the contracts and the
frontend run perfectly well against a single Hardhat node — but this is the part
that makes the word "permissioned" mean something at the network level rather
than only inside the contracts.

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

## Two layers of permissioning, and they are not the same

Worth keeping straight, because it is the obvious question in a review:

- **Network layer (here).** Who may run a node and produce blocks. Controlled by
  the validator set and the peer list.
- **Contract layer (`MemberRegistry`).** Who may vote. Controlled by the
  registrar's roster.

Running an unauthorised node would not let anybody cast a vote, and being on the
roster does not let a member produce blocks. The two answer different questions.

## Setup

Requires Docker.

```bash
cd besu
./setup.sh              # generates keys, genesis block and the peer list
docker compose up -d    # starts four validators
```

`setup.sh` shells out to Besu's own `operator generate-blockchain-config` rather
than hand-writing the genesis `extraData`, which for QBFT is an RLP structure
containing the initial validator set and is easy to get subtly wrong.

## Checking that it actually formed a network

```bash
# blocks are being produced
curl -s -X POST --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  -H 'Content-Type: application/json' http://127.0.0.1:8545

# all four validators are recognised
curl -s -X POST --data '{"jsonrpc":"2.0","method":"qbft_getValidatorsByBlockNumber","params":["latest"],"id":1}' \
  -H 'Content-Type: application/json' http://127.0.0.1:8545

# node1 has three peers
curl -s -X POST --data '{"jsonrpc":"2.0","method":"net_peerCount","params":[],"id":1}' \
  -H 'Content-Type: application/json' http://127.0.0.1:8545
```

Block height should climb by one every two seconds, the validator list should
have four entries, and the peer count should be `0x3`.

## Deploying to it

The genesis block funds the ten standard Hardhat test accounts, so the deployer
address is the same one used on the local node. Gas price is zero: a society's
own chain has no reason to charge its members for voting.

```bash
cd ..
npx hardhat run scripts/deploy.js --network besu
npx hardhat run scripts/seed.js   --network besu
npx hardhat run scripts/demo.js   --network besu
```

`demo.js` detects that this chain has no time-travel RPC and waits out the voting
window in real time instead of skipping ahead.

Point the frontend at it with `VITE_RPC_URL=http://127.0.0.1:8545`, which is the
default anyway.

## Tearing it down

```bash
docker compose down
./setup.sh   # regenerates from scratch, discarding the old chain
```

## A caution about the keys

The genesis funds accounts derived from the public `test test test ... junk`
mnemonic that Hardhat and Anvil ship with. Everyone on the internet has those
private keys. They are fine for a chain running on your laptop and unusable for
anything else.
