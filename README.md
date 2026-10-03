# Hillcash

A Scaffold-HBAR template for group purchasing of digital services.

Providers publish signed offers. A deterministic agent matches buyers and selects a compatible offer. Buyers pay through Hedera escrow, receive individual service entitlements, and redeem their purchased service.

No paid AI API is required.

## Integrations

| Integration | Purpose |
| --- | --- |
| Scaffold-HBAR | Creates a fresh, installable project from this repository |
| Hedera Smart Contract Service | Holds buyer deposits, settles payments, returns surplus, and supports refunds |
| Supra HBAR/USD feed | Converts USD prices into HBAR and enforces price freshness and buyer movement limits |
| Hedera Consensus Service | Records a digest of the signed purchase plan and its activation transaction |
| Hedera Mirror Node | Reads published HCS records and transaction evidence |
| Ethers and Hardhat | Connect the application to Hedera's EVM and test the contracts |

## Create the template

Prerequisites: Node.js 20.18.3 or later, npm, and Yarn available for the Scaffold-HBAR CLI.

```bash
npm create scaffold-hbar -- --template Fatumayattani/hillcash
```

Choose:

- Project name: `hillcash-demo`
- Hedera Skills: optional
- Frontend: Next.js App Router, if prompted
- Solidity framework: Hardhat, if prompted
- Package manager: npm, if prompted
- Network: Testnet

The CLI installs dependencies and formats the project.

```bash
cd hillcash-demo
npm test
npm run lint
npm run build
npm run dev
```

Open **http://localhost:3000**.

The local matching sandbox requires no wallet or private keys. Its example offers and buyers are fixtures, not live purchases.

## Configure Hedera testnet

Create a local environment file:

```bash
cp .env.example .env
```

Configure the following values:

```dotenv
HEDERA_TESTNET_RPC_URL=https://testnet.hashio.io/api

HEDERA_PRIVATE_KEY=
HEDERA_OPERATOR_ID=

HILLCASH_BUYER_A_KEY=
HILLCASH_BUYER_B_KEY=

SUPRA_HEDERA_TESTNET_HOLDER=0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917

HILLCASH_CONTRACT=
HILLCASH_HCS_TOPIC_ID=
HILLCASH_GAS_PRICE_WEI=2000000000000

NEXT_PUBLIC_HILLCASH_CONTRACT=
NEXT_PUBLIC_HEDERA_CHAIN_ID=296
```

Use three distinct, funded **testnet** accounts:

- `HEDERA_PRIVATE_KEY`: provider's ECDSA EVM private key.
- `HEDERA_OPERATOR_ID`: the Hedera account ID belonging to that provider key, such as `0.0.123456`.
- `HILLCASH_BUYER_A_KEY` and `HILLCASH_BUYER_B_KEY`: the two buyers' EVM private keys.

If `HEDERA_OPERATOR_KEY` is configured separately, it must match `HEDERA_OPERATOR_ID`. Otherwise, the HCS client uses `HEDERA_PRIVATE_KEY`.

Never commit `.env`, private keys, or entitlement tokens.

### Deploy and create an audit topic

```bash
npm run oracle:check
npm run deploy:testnet -w @hillcash/contracts
npm run audit:topic
```

From the command outputs:

1. Copy the deployed `contract` address into both `HILLCASH_CONTRACT` and `NEXT_PUBLIC_HILLCASH_CONTRACT`.
2. Copy the created `topicId` into `HILLCASH_HCS_TOPIC_ID`.

Restart the frontend after changing its environment configuration.

## Complete a live purchase

From the project root:

```bash
npm run demo:testnet
```

This command submits real **testnet transactions** using the configured provider and buyer keys.

It completes seven stages:

1. Creates signed offers at $0.03 and $0.02 per buyer, each declaring 100 service units.
2. Checks signatures and live chain data, then selects the cheaper compatible offer.
3. Deposits for both buyers and activates the group.
4. Commits a unique private entitlement for each buyer.
5. Accepts delivery, pays the provider, and returns deposit surplus.
6. Redeems one unit per buyer through the sample HTTP provider.
7. Publishes the purchase plan's digest and activation reference to HCS.

Successful output ends with:

```text
COMPLETE: signed selection, deposits, settlement, service redemption, and audit.
```

It also prints the selected offer ID, activation transaction hash, and HCS topic and sequence number.

The provider must have at least 5 test HBAR. Each buyer needs the live $0.02 quote, a 10% deposit buffer, and a 1 HBAR fee allowance. These are preflight thresholds, not guaranteed total costs.

Each execution creates a new purchase. Private run files are saved outside the checkout in `~/hillcash-secrets/purchase-<unique-id>/`.

For output details and interrupted runs, see [the purchase demo guide](docs/purchase-demo.md).

## Inspect the purchase in the browser

```bash
npm run dev
```

Open **http://localhost:3000** and select **Escrow**.

Find the terminal line:

```text
Selected offer NUMBER: $0.02 each; 100 provider-declared units each.
```

Enter that number into **On-chain offer ID**, then click **Inspect offer**. The dashboard reads the same offer from Hedera; inspection requires no wallet.

To inspect the activation transaction, copy the hash printed after `Activation:` and search it on [HashScan Testnet](https://hashscan.io/testnet).

HashScan labels these EVM calls “Ethereum Transaction.” They execute on Hedera testnet, chain ID **296**, with fees paid in HBAR.

## Verified signed purchase completion

The deployed testnet contract is:

```text
0x9846D66b0EB16BB8aaF18eA789420c838583B6fc
```

| Verified purchase | Activation transaction | HCS record |
| --- | --- | --- |
| Offer 4: signed selection, both buyer settlements, and service redemption | [Transaction receipt](https://testnet.mirrornode.hedera.com/api/v1/contracts/results/0x34377b1300ff6df87296a5dfa4eb96d617f05aeb87d71f603156acefac32762c) | [Topic 0.0.10776777, sequence 3](https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10776777/messages/3) |
| Offer 12: all seven stages completed in one command from a fresh scaffold | [Transaction receipt](https://testnet.mirrornode.hedera.com/api/v1/contracts/results/0xd6f25607b1f7cebead0eb98735ad70d21d6703f588fd12fa9f298d09583c3af2) | [Topic 0.0.10776777, sequence 7](https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10776777/messages/7) |

For offer 12, both buyers received HTTP 200 after redemption, with 99 of 100 units remaining.

HCS stores a digest and activation reference. The full purchase plan and private tokens remain off-chain.

## Tests

```bash
npm test
npm run lint
npm run build
npm audit --omit=dev
```

The verified suite contains **202 passing tests**:

| Package | Tests |
| --- | ---: |
| Agent | 61 |
| Provider | 36 |
| Audit | 39 |
| Contracts | 66 |

The complete local purchase test can also be run separately:

```bash
npm run test -w @hillcash/contracts -- test/PurchaseDemo.cjs
```

It tests matching, escrow settlement, HTTP redemption, and the audit commitment locally. It does not publish to Hedera or HCS.

## Reuse

| Package | Responsibility |
| --- | --- |
| `packages/agent` | Matching, signed offer verification, and live proposals |
| `packages/contracts` | Escrow, oracle safeguards, settlement, and refunds |
| `packages/provider` | Entitlement issuance and metered service access |
| `packages/audit` | Purchase commitments and HCS publication |
| `packages/web` | Matching sandbox and testnet inspection |

Replace the sample computation service with your own provider integration while retaining the purchasing and settlement flow.

The included provider is a sample service. Signed quantities and comparison prices are provider declarations, not independent verification of service quality or market savings. The contracts are unaudited; use testnet funds.

## License

MIT.