# Complete testnet purchase demo

Run one complete purchase using the template's agent, escrow,
sample provider, and HCS audit tools.

## Setup

From the project root, install dependencies:

```bash
npm ci
```

Configure these variables in your local `.env`:

| Variable | Purpose |
| --- | --- |
| HEDERA_TESTNET_RPC_URL | Hedera testnet JSON-RPC URL |
| HILLCASH_CONTRACT | Deployed Hillcash testnet contract |
| HEDERA_PRIVATE_KEY | Funded provider's EVM private key |
| HILLCASH_BUYER_A_KEY | First buyer's EVM private key |
| HILLCASH_BUYER_B_KEY | Second buyer's EVM private key |
| HEDERA_OPERATOR_ID | Provider's Hedera testnet account ID |
| HILLCASH_HCS_TOPIC_ID | Existing HCS topic ID |

Use three distinct testnet wallets. Never commit `.env` or private keys.
The runner checks chain ID 296 and the contract's native precision.

The provider must have at least 5 test HBAR. Each buyer needs the live
$0.02 quote plus a 10% deposit buffer and a 1 HBAR fee allowance.
These are preflight thresholds, not a guarantee of total fees.

## Run

```bash
npm run demo:testnet
```

Running this command authorizes transactions with the supplied keys.
Each run creates a new purchase and spends test HBAR.

The runner:

1. Creates provider-signed offers at $0.03 and $0.02 per buyer.
2. Checks live chain data and selects the cheaper compatible offer.
3. Deposits for two buyers and activates the group.
4. Commits a unique private entitlement for each buyer.
5. Checks token commitments, accepts delivery, and settles escrow.
6. Redeems one service unit per buyer through the sample HTTP provider.
7. Publishes the signed plan's digest and activation reference to HCS.

The offers declare 100 service units per buyer. Quantity and comparison
prices are provider declarations; they are not independent market
verification. The included service is a sample metered computation.

The demo supplies buyer signing keys for automation. The planner itself
does not require a signing key or submit transactions.

## Output and private files

Success ends with `COMPLETE`, an activation transaction hash,
and an HCS topic and sequence number.

Run files are stored outside the checkout in
`~/hillcash-secrets/purchase-<unique-id>/`.
They include the signed catalog, requests, plan, transaction evidence,
provider ledger, and private entitlement tokens.

Do not publish the private run files or tokens.

If a run stops, preserve its files and inspect the existing orders
before retrying. Running the command again creates new offers;
it does not resume the previous purchase.

## Verified testnet run

On October 3, 2026, one command completed all seven stages for offer 8.
Both buyers received HTTP 200 and had 99 of 100 service units remaining.

- [Activation transaction](https://testnet.mirrornode.hedera.com/api/v1/contracts/results/0x96ef25eefb2dfa1a38299c137e0d002672cf278451e5b2ef79c46dc50cfa44ee)
- [HCS record: topic 0.0.10776777, sequence 5](https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10776777/messages/5)

## Local integration test

```bash
npm run test -w @hillcash/contracts -- test/PurchaseDemo.cjs
```

This checks matching, escrow, HTTP redemption, and the audit commitment
on a local EVM. It does not publish to Hedera or HCS.
