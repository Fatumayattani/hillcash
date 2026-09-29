# Hillcash

Hillcash is an open source Scaffold-HBAR template for agent-assisted group purchasing of digital services. Buyers set individual USD caps and HBAR market movement limits; a deterministic matching agent proposes compatible groups; each buyer authorizes their own HBAR deposit. A Supra HBAR/USD feed determines the required deposit, snapshots the market price at each join, and checks each buyer's limit when the provider activates the group. A provider commits a hash of each buyer's individual entitlement. A buyer's explicit acceptance releases that buyer's payment; unresolved orders can be refunded after the delivery deadline.

**Status:** early testnet prototype. The first deployment (`0x765461D7d9466c9D36D8a60AB8B48D288Cb4Ebdf`) could not accept buyer deposits because Hedera testnet EVM execution exposed 8-decimal `msg.value`. The corrected contract (`0x9846D66b0EB16BB8aaF18eA789420c838583B6fc`) has a verified testnet flow through two joins, activation, delivery, buyer acceptance, provider payout, and sample service redemption. An outside provider, HCS testnet record, and independent external-template scaffold remain unverified. This prototype is unaudited and unsuitable for real-value commerce.

## Quick start

Requires Node.js 20.18.3+, npm, an EVM wallet, and testnet HBAR for on-chain actions.

```bash
npm install
npm test
npm run contracts:compile
npm run lint
npm run build
npm run dev
```

Open http://localhost:3000. Use **Load example marketplace** to try local matching; those accounts and offers are fixtures. Local planning requires no wallet or paid AI API. The agent's policy is deterministic and testable; a language model is not trusted with spending authorization.

## Hedera testnet

1. Copy `.env.example` to `.env` and configure `HEDERA_PRIVATE_KEY` for a **testnet-only funded account**. Never commit `.env`.
2. Run `npm run oracle:check`. It reads pair **432** from Supra's documented Hedera testnet push-oracle holder and fails if the price is absent or older than two hours. Do this before deployment. The published holder address is `0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917`; its documented update frequency is one hour. A live read on September 29, 2026 returned an 18-decimal price and a **millisecond** Unix timestamp. The checker and contract use that timestamp format.
3. Run `npm run deploy:testnet -w @hillcash/contracts` and record the resulting contract and transaction hash.
4. Set `NEXT_PUBLIC_HILLCASH_CONTRACT` in `.env`; restart `npm run dev`.
5. With a wallet on Hedera Testnet chain 296, create an offer, then have two independent buyer wallets join. Activate before the join deadline. The provider issues an individual entitlement as shown below; the buyer checks its private token in the dashboard before accepting. After the delivery deadline, unresolved buyers may refund.

The UI exposes offer creation, joining, activation, token commitment checking, acceptance and refund. Do not share entitlement secrets onchain: commit only a hash; deliver the secret privately. The contract does not arbitrate whether delivered content is valid.

At join, a buyer sets a market movement tolerance from 0.01% to 20%. The contract stores the fresh Supra HBAR/USD price for that buyer. Activation compares a new fresh price against **each buyer's own snapshot**, rejects either direction beyond their limit, and still requires every deposit to cover the new HBAR quote. This is a veto on the pooled activation: if any buyer is outside their limit, the whole group waits until the price returns inside the limits or the join deadline passes. After that deadline, every buyer can reclaim an unactivated deposit. The matching library can filter requests with `referencePriceE18` and `maxMovementBps` against a supplied fresh `marketPriceE18`; that check is advisory and does not replace the contract. The local fixture UI does not fetch a feed for its simulated requests. Earlier contract deployments must be redeployed to use this version.

### Live testnet evidence (September 29, 2026)

- Corrected deployment: `0x9846D66b0EB16BB8aaF18eA789420c838583B6fc`; transaction `0x761c0898cd04942111bd2b743d95ec11f58cabac97cc811831d49a663954d2f8`; `nativeDecimals=8`.
- Offer 1: `0xb85944dc5e826a99a360eb02174bed45cce0ff0d66384363ab643679689fc454`.
- Buyer joins: `0xf8b8ddd0d35303fc85a7a4525b78bc19b0f1bebb477a26c77a3c9605b9d06f12` and `0xa1f59ffe4d43f077db4e742cabe138ad06dd123ad023f462a491f47e74869708`.
- Activation: `0xab59718a1f93dcf9923717e3a9ca6e80bbb4dd87f89ec2df50cd7bb0d3939baf`.
- Buyer A delivery commitment: `0xcba0256dda1cd10f6a80bde237668991af0b2ed2e8fcda988bb5358451e570b9`.
- Buyer A acceptance: `0xa7696e96e467ab6f18c435123bacaa9f7c404ef2048b5b6b25173a8f9567c7a4`. The provider balance increased by exactly 4.21862608 HBAR.
- The local sample service returned HTTP 200 with 99 uses remaining after one redemption. This response is local evidence, not an on-chain transaction.

Buyer B remains unresolved pending delivery or refund after the delivery deadline. Private tokens are not included in this repository.

### Sample provider

Use the **same provider wallet** that created the offer. In `.env`, set `HILLCASH_CONTRACT` to your deployment and `HEDERA_PRIVATE_KEY` to that provider wallet's testnet key. After activation:

The sample issuer uses a testnet legacy gas-price default of `2000000000000` wei. Set `HILLCASH_GAS_PRICE_WEI` in `.env` if the network minimum changes.

```bash
npm run issue -w @hillcash/provider -- 1 0xBUYER_WALLET_ADDRESS 100
npm run provider:serve
```

The first command sends `commitDelivery`, persists an entitlement record in the ignored `.provider-data.json`, and prints a unique token **once**. Copy it to the corresponding buyer through a private channel. The buyer checks its hash against the contract in the UI, then explicitly accepts payment before redeeming the sample service:

```bash
curl -X POST http://127.0.0.1:3001/redeem \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer BUYER_PRIVATE_TOKEN' \
  -d '{"offerId":1,"buyer":"0xBUYER_WALLET_ADDRESS"}'
```

The sample provider listens only on localhost, tracks usage in a private local file, never saves plaintext tokens, and checks onchain delivery and acceptance for each call. It is a single-process demonstration; it has no hosted authentication, high-availability database, or concurrency across multiple server instances. Tokens stop working after a refund. The example service returns a usage receipt rather than supplying a paid third-party API.

### HCS decision audit

Set `HEDERA_OPERATOR_ID` and `HILLCASH_CONTRACT` in `.env`, then create an HCS topic. The client uses `HEDERA_PRIVATE_KEY` by default; set `HEDERA_OPERATOR_KEY` only for a different funded ECDSA account. Look up the numeric account ID from the operator's EVM address at the Hedera testnet Mirror Node.

```bash
npm run audit:topic
```

Set `HILLCASH_HCS_TOPIC_ID` to the printed topic ID. Write a JSON proposal file containing the numeric onchain `offerId`, an array of at least two unique buyer **request IDs**, `unitUsdCents`, and `savedUsdCents`. After activation, anchor it:

```bash
npm run anchor -w @hillcash/audit -- path/to/proposal.json 0xACTIVATION_TRANSACTION_HASH
```

The audit script first checks that the transaction succeeded at the configured Hillcash contract and emitted `Activated` for that offer. It then publishes only a digest, offer ID, contract address, and activation transaction hash to HCS. The digest is a timestamped commitment to the supplied decision data; it does **not** independently prove the buyer's stated solo price or a provider's actual discount. Do not include names, prompts, or tokens in a proposal file intended for sharing.

The `oracle:check` command requires access to a Hedera testnet JSON-RPC endpoint. A blocked network cannot establish that the feed is live. Oracle deployment documentation alone is insufficient validation.

## Purchase lifecycle

| Stage | Contract invariant |
| --- | --- |
| Create | Provider chooses service hash, USD cents price, minimum 2–32, and deadlines. |
| Join | Oracle price is fresh; buyer's USD cap covers offer; HBAR deposit covers price at that moment. |
| Activate | Minimum reached; a fresh rate is used again and every deposit covers that rate. Otherwise no activation. |
| Deliver | Provider commits a nonzero hash for an individual buyer before the delivery deadline. |
| Accept | Only buyer accepts; provider receives due HBAR and buyer receives unused deposit. |
| Refund | Buyer can reclaim the full unresolved deposit after an open offer expires, after delivery expires, or after provider cancellation. |

**Price movement:** if HBAR falls between join and activation, activation reverts until buyers have enough deposits. There is currently no top-up method, so that offer eventually expires and buyers refund. That is a deliberate fail-closed first version, but poor conversion under volatile prices.

**Units:** Supra's observed `HBAR_USD` value uses 18 decimals. A live Hedera testnet recorder transaction (`0xdd346d86f73828a19082a93f3d1c5fbf57bf6a2bbd9f5a5b617792236459d43d`) stored `msg.value == 1000000` for a wallet call carrying 0.01 HBAR (`10000000000000000` RPC wei): the EVM execution used 8-decimal native units. The deploy script passes native precision 8; local Ethereum tests use 18. `quoteWei` still returns an 18-decimal wallet amount rounded up to the next native unit. Joins, locked dues, payouts, and refunds use the configured EVM native precision. This observed testnet behavior differs from the current wording at https://docs.hedera.com/evm/differences/hbar-decimals; live execution takes priority for this template. The discrepancy should be rechecked after network or relay upgrades.

## Structure

- `packages/contracts`: Solidity escrow, Supra interface, mock feed, Hardhat tests, deployment and live oracle checker.
- `packages/agent`: deterministic matching policy with Node tests. It never holds buyer keys.
- `packages/web`: Next.js buyer/provider planning interface and optional testnet wallet transactions.
- `packages/provider`: individual token issuance, chain-gated sample redemption, and a private local usage ledger.
- `packages/audit`: HCS topic and audit submission tools; verifies a matching contract activation first.
- `.harness`: incremental feature brief and deterministic validator for Hedera Harness.

The sample provider supplies individual entitlements and a local redemption API. Connecting external providers requires their participation, authenticated offers, and a reliable delivery channel. The HCS tool is implemented but has not been exercised on testnet in this environment. Buyers can check a token's onchain commitment before paying; that check does not prove the provider will remain online or deliver a valuable service. This prototype is unsuitable for real-value commerce until provider reliability and dispute handling are resolved.

## External template gate

Once published as a public GitHub repository, validate the real CLI path from a fresh directory:

```bash
npm create scaffold-hbar@latest --template YOUR_GITHUB_USER/hillcash
```

The bounty requires a successful external-template scaffold, clean install/lint/build/boot, valid `template.json`, README and AGENTS, MIT license, and a verifiable Hedera testnet transaction. These have **not** all been checked yet. Repository docs: https://hedera.com/blog/scaffold-hbar-template-bounty/. The template author must submit the Harness spec and validators if using Harness.

Supra interface and pair documentation: https://docs.supra.com/oracles/data-feeds/push-oracle and https://docs.supra.com/oracles/data-feeds/data-feeds-index. Hedera testnet address: https://docs.supra.com/oracles/data-feeds/push-oracle/networks.
