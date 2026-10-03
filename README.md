# Hillcash

Hillcash is an open source Scaffold-HBAR template for group purchasing of digital services. A deterministic agent matches compatible buyer requests to provider-signed offers, while every buyer authorizes their own HBAR deposit. Hedera smart contracts handle escrow and settlement, a Supra HBAR/USD feed guards prices, and Hedera Consensus Service (HCS) records a digest of the selected purchase plan.

The template includes a sample metered service, a sidebar dashboard, and a local matching sandbox. It requires no paid AI API.

## Start from the template

Requires Node.js 20.18.3+ and npm. Scaffold-HBAR CLI 0.4.1 also checks for Yarn when npm is selected. If Yarn is unavailable, run `corepack prepare yarn@stable --activate`.

From a fresh directory:

```bash
npm create scaffold-hbar -- --template Fatumayattani/hillcash
cd YOUR_PROJECT_NAME
npm test
npm run lint
npm run build
npm run dev
```

Choose **Testnet** when prompted, then open http://localhost:3000. Click **Load example marketplace** to try local matching without a wallet or blockchain transaction. The sandbox uses example buyers, offers, and stated solo prices.

On October 3, 2026, the exact external scaffold command completed installation, formatting, and Git initialization. The fresh project passed **201 tests** (agent 61, provider 36, audit 39, contracts 65), lint, and build. `npm audit --omit=dev` reported zero production dependency vulnerabilities. A separate fresh-scaffold check served the production page with HTTP 200.

## How a purchase works

1. A provider creates an on-chain offer and signs its service quantity and comparison price.
2. The read-only agent checks live offers and proposes a compatible group. It cannot deposit or accept on a buyer’s behalf.
3. Each buyer independently approves a deposit and sets a USD cap and HBAR price movement limit.
4. The provider activates the group once enough buyers have joined. The contract checks a fresh Supra price and every buyer’s limit.
5. The provider commits a hash of each buyer’s private entitlement. Each buyer verifies their token and decides whether to accept.
6. Acceptance pays the provider for that buyer’s order and returns unused deposit. Eligible unresolved orders can instead be refunded.

The contract rejects stale oracle data, insufficient deposits, and activation outside any buyer’s movement limit. It supports up to 32 buyers per offer. Wallet quotes use 18-decimal RPC units; the deployed contract accounts for Hedera testnet’s observed 8-decimal native execution units.

## Inspect the testnet example

Copy `.env.example` to `.env` and set:

```dotenv
NEXT_PUBLIC_HILLCASH_CONTRACT=0x9846D66b0EB16BB8aaF18eA789420c838583B6fc
```

Restart `npm run dev`, open **Escrow**, and inspect offer **4**. Reading an offer does not require a wallet. Offer 4 is a completed historical purchase on Hedera Testnet, chain ID 296; use **Evidence** for its transaction links.

To deploy your own contract, use a funded **testnet-only** account. Set `HEDERA_PRIVATE_KEY` in the ignored `.env`, then run:

```bash
npm run oracle:check
npm run deploy:testnet -w @hillcash/contracts
```

Set `HILLCASH_CONTRACT` and `NEXT_PUBLIC_HILLCASH_CONTRACT` to the new address and restart the app. Wallet actions require an EVM wallet connected to Hedera Testnet and test HBAR. Never commit `.env`, buyer requests, entitlement tokens, or provider ledgers.

## Agent, provider, and HCS tools

The planner reads buyer requests and signed provider terms without a signing key or transaction:

```bash
npm run agent:plan -- REQUESTS_JSON CATALOG_JSON OUTPUT_JSON
```

`REQUESTS_JSON` is an array of requests with `id`, `buyer`, `serviceId` (bytes32 hex), `units`, `maxUsdCents`, `soloUsdCents`, `expiresAt` (Unix milliseconds), and `maxMovementBps` (1–2000). An optional `referencePriceE18` is a positive decimal string. Keep requests and the resulting plan outside the repository.

The provider signs commercial terms for an existing on-chain offer with:

```bash
npm run provider:terms -- OFFER_ID UNITS_PER_BUYER SOLO_USD_CENTS OUTPUT_JSON
```

Signed catalog entries bind the offer, provider, service, quantity, group price, solo comparison price, expiry, chain, and contract. The planner verifies the signature against the on-chain provider and rejects altered, mismatched, or expired terms. A signature authenticates a declaration; it does not prove service quality or a market discount.

After activation, the provider issues an individual entitlement and starts the sample service:

```bash
npm run provider:issue -- OFFER_ID BUYER_ADDRESS 100
npm run provider:serve
```

Deliver the printed private token to the buyer privately. Once that buyer accepts on-chain, they can redeem a unit:

```bash
curl -X POST http://127.0.0.1:3001/redeem \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer BUYER_PRIVATE_TOKEN' \
  -d '{"offerId":4,"buyer":"0xBUYER_WALLET_ADDRESS"}'
```

The sample provider checks on-chain acceptance and keeps its usage ledger locally. It is a single-process demonstration.

For a new HCS topic, configure `HEDERA_OPERATOR_ID`, then run `npm run audit:topic` and set `HILLCASH_HCS_TOPIC_ID` to the result. After activating a signed group, anchor its private full plan with:

```bash
npm run audit:anchor -- FULL_PLAN_JSON ACTIVATION_TX
```

The audit tool verifies the historical planning snapshot and matching successful activation before submitting the public record. HCS receives the plan digest and activation reference, not buyer IDs, private tokens, or the full plan.

## Verified signed purchase completion

On October 2, 2026, the agent selected provider-signed offer **4** at **$0.20 per buyer** over a competing **$0.25** offer. Both offers declared 100 units of the sample service and a $0.50 solo comparison price. The calculated $0.60 total group saving is **provider-declared**, not an independently measured market saving.

| Hedera testnet evidence | Link |
| --- | --- |
| Contract deployment | [Transaction](https://testnet.mirrornode.hedera.com/api/v1/contracts/results/0x761c0898cd04942111bd2b743d95ec11f58cabac97cc811831d49a663954d2f8) |
| Buyer joins | [Buyer A](https://testnet.mirrornode.hedera.com/api/v1/contracts/results/0x82aaa89b39240f6f1e84d004f3f26447da866344a5bc0ec0cb58aa9834307caf) · [Buyer B](https://testnet.mirrornode.hedera.com/api/v1/contracts/results/0x46af72679202cabc0ad239da314633b8e889b52c7b7eb8a5350c4dd9a9e25ee9) |
| Offer 4 activation | [Transaction](https://testnet.mirrornode.hedera.com/api/v1/contracts/results/0x34377b1300ff6df87296a5dfa4eb96d617f05aeb87d71f603156acefac32762c) |
| HCS topic `0.0.10776777`, sequence `3` | [Public message](https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10776777/messages/3) |
| Buyer acceptances | [Buyer A](https://testnet.mirrornode.hedera.com/api/v1/contracts/results/0xee158117c478df1a9d378ba2cc9a723411f46e16c0bfbb9d7bd8a6e878d62fe5) · [Buyer B](https://testnet.mirrornode.hedera.com/api/v1/contracts/results/0x8f9281835800858d9074464115a961cfb1d9dce862b6f79d10c745692c732b93) |
| Expired-order refund, offer 1 | [Transaction](https://testnet.mirrornode.hedera.com/api/v1/contracts/results/0xf137ff047a3a7981c709d522803ccac28cd7ddf777e1cd5529635d00262b9bf4) |

The HCS record references the activation transaction and commits to the private signed plan with digest `0x1e4e5e467895852106e1fc3b50d5198c1f78896846d3820ecd3504e1c0112793`. A read-only testnet check confirmed successful activation and two delivered, accepted, resolved orders.

Each offer 4 acceptance paid the provider **1.92817547 HBAR** and returned **0.19220428 HBAR** of unused deposit to the buyer, excluding fees. Both buyers redeemed one unit from the included sample provider: HTTP 200 with 99 of 100 units remaining.

## Repository structure

| Package | Purpose |
| --- | --- |
| `packages/agent` | Matching policy, live offer checks, and signed-term validation |
| `packages/contracts` | Escrow, Supra feed checks, deployment, and Hardhat tests |
| `packages/provider` | Individual entitlements and sample redemption service |
| `packages/audit` | HCS records and activation verification |
| `packages/web` | Sidebar dashboard, local sandbox, and wallet-authorized testnet actions |

`AGENTS.md` records implementation constraints; `.harness/` contains the feature specification and validator. The project is MIT licensed.

The escrow has not received an independent security audit. The included provider demonstrates the workflow, but an independent external provider, independently verified market savings, long-term service reliability, and production dispute handling remain unverified. Use **testnet HBAR only**.