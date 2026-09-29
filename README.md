# Hillcash

Hillcash is an open source Scaffold-HBAR template for agent-assisted group purchasing of digital services. Buyers set individual USD caps; a deterministic matching agent proposes compatible groups; each buyer authorizes their own HBAR deposit. A Supra HBAR/USD feed determines the required deposit and checks the price again when the provider activates the group. A provider commits a hash of each buyer's individual entitlement. A buyer's explicit acceptance releases that buyer's payment; unresolved orders can be refunded after the delivery deadline.

**Status:** early testnet prototype. This repository does not yet have a deployed contract, a verified live Supra read, a real outside provider, an HCS testnet record, or a submitted bounty transaction. The local marketplace uses clearly labeled example records. A sample provider implements limited-use entitlements; it is not a third-party marketplace integration. Do not pay real money or use this escrow in production; it has not been audited. The entitlement hash is a commitment, not proof that a service works, and buyer acceptance is the payment trigger.

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

### Sample provider

Use the **same provider wallet** that created the offer. In `.env`, set `HILLCASH_CONTRACT` to your deployment and `HEDERA_PRIVATE_KEY` to that provider wallet's testnet key. After activation:

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

Set `HEDERA_OPERATOR_ID`, `HEDERA_OPERATOR_KEY`, and `HILLCASH_CONTRACT` in `.env`, then create an HCS topic:

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

**Units:** Supra's observed `HBAR_USD` value uses 18 decimals, while Solidity `msg.value` from the JSON-RPC relay uses 18-decimal wei units. The contract's HBAR quote uses `1 ether` for one HBAR. Hedera's native tinybar and system-contract argument values use 8 decimals; do not substitute tinybars for `msg.value`. See https://docs.hedera.com/evm/differences/hbar-decimals.

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
