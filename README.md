# Hillcash

Hillcash is an open source Scaffold-HBAR template for agent-assisted group purchasing of digital services. Buyers set individual USD caps; a deterministic matching agent proposes compatible groups; each buyer authorizes their own HBAR deposit. A Supra HBAR/USD feed determines the required deposit and checks the price again when the provider activates the group. A provider commits a hash of each buyer's individual entitlement. A buyer's explicit acceptance releases that buyer's payment; unresolved orders can be refunded after the delivery deadline.

**Status:** early testnet prototype. This repository does not yet have a deployed contract, a verified live Supra read, a real provider service, HCS records, or a submitted bounty transaction. The local marketplace uses clearly labeled example records. Do not pay real money or use this escrow in production; it has not been audited. The entitlement hash is a commitment, not proof that a service works, and buyer acceptance is the payment trigger.

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
2. Run `npm run oracle:check`. It reads pair **432** from Supra's documented Hedera testnet push-oracle holder and fails if the price is absent or older than two hours. Do this before deployment. The published holder address is `0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917`; its documented update frequency is one hour.
3. Run `npm run deploy:testnet -w @hillcash/contracts` and record the resulting contract and transaction hash.
4. Set `NEXT_PUBLIC_HILLCASH_CONTRACT` in `.env`; restart `npm run dev`.
5. With a wallet on Hedera Testnet chain 296, create an offer, then have two independent buyer wallets join. Activate before the join deadline. Commit an entitlement for a buyer using the contract's `commitDelivery` method; that buyer may accept. After the delivery deadline, unresolved buyers may refund.

The UI exposes offer creation, joining, activation, acceptance and refund. Provider entitlement delivery currently requires a contract call outside the UI. Do not share entitlement secrets onchain: commit only a hash; deliver the secret privately. The contract does not arbitrate whether delivered content is valid.

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

## Structure

- `packages/contracts`: Solidity escrow, Supra interface, mock feed, Hardhat tests, deployment and live oracle checker.
- `packages/agent`: deterministic matching policy with Node tests. It never holds buyer keys.
- `packages/web`: Next.js buyer/provider planning interface and optional testnet wallet transactions.
- `.harness`: incremental feature brief and deterministic validator for Hedera Harness.

The eventual provider adapter needs authenticated offer signing, an independently issued entitlement per buyer, and a private redemption API. The eventual HCS integration should anchor hashes of offers and decision records, never private request text or access tokens. Neither is implemented yet.

## External template gate

Once published as a public GitHub repository, validate the real CLI path from a fresh directory:

```bash
npm create scaffold-hbar@latest --template YOUR_GITHUB_USER/hillcash
```

The bounty requires a successful external-template scaffold, clean install/lint/build/boot, valid `template.json`, README and AGENTS, MIT license, and a verifiable Hedera testnet transaction. These have **not** all been checked yet. Repository docs: https://hedera.com/blog/scaffold-hbar-template-bounty/. The template author must submit the Harness spec and validators if using Harness.

Supra interface and pair documentation: https://docs.supra.com/oracles/data-feeds/push-oracle and https://docs.supra.com/oracles/data-feeds/data-feeds-index. Hedera testnet address: https://docs.supra.com/oracles/data-feeds/push-oracle/networks.
