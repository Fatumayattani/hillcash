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

## Scaffold setup and verification

Scaffold-HBAR CLI 0.4.1 requires Yarn to be available even when this
template selects npm. Enable it with Corepack before scaffolding.

Create a copy outside an existing checkout with:
`npx create-scaffold-hbar@0.4.1 hillcash-fresh --template Fatumayattani/hillcash --frontend nextjs-app --solidity-framework hardhat --network testnet --yes --skip-install --skip-hedera-skills`

Enter `hillcash-fresh`, then run `npm ci`, `npm test`, `npm run lint`,
`npm run build`, and `npm run dev`. For a production server, run
`npm run build` followed by `npm start`.

On October 1, 2026, a fresh external scaffold passed installation,
54 tests, TypeScript checks, and a production build. Its production
server returned HTTP 200 with Hillcash's page without copying an existing
.env. Local example matching still uses fixtures.

### Dependency audit

The updated dependency resolution passed `npm audit --omit=dev` with
zero reported vulnerabilities. Root overrides select patched gRPC,
WebSocket, PostCSS, and protobuf releases.

The full audit still reports 20 development-dependency findings,
including 7 high severity. Those require further remediation.
A clean runtime audit is not a security audit of the escrow or product.

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

### Verified HCS testnet record

The manual testnet activation for offer 1 was anchored to HCS topic
[`0.0.10776777`](https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10776777/messages/1),
sequence 1, in transaction `0.0.10775178@1790686424.381005862`. The public
mirror returned digest
`0x1b3620920fca0b5591a7caac840ae75501aaedea68f1483677d8a71e339e4451`
and activation transaction
`0xab59718a1f93dcf9923717e3a9ca6e80bbb4dd87f89ec2df50cd7bb0d3939baf`.

This record documents a **manual testnet flow**, with `savedUsdCents: 0`.
It does not establish an agent-generated match, an independently verified
discount, or successful delivery to both buyers. The proposal stays local;
only its digest and the activation reference were published to HCS.

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

The sample provider supplies individual entitlements and a local redemption API. Connecting external providers requires their participation, authenticated offers, and a reliable delivery channel. The HCS tool has been exercised on testnet for one manual activation; this does not verify an agent-generated match. Buyers can check a token's onchain commitment before paying; that check does not prove the provider will remain online or deliver a valuable service. This prototype is unsuitable for real-value commerce until provider reliability and dispute handling are resolved.

## External template gate

Once published as a public GitHub repository, validate the real CLI path from a fresh directory:

```bash
npm create scaffold-hbar@latest --template YOUR_GITHUB_USER/hillcash
```

The bounty requires a successful external-template scaffold, clean install/lint/build/boot, valid `template.json`, README and AGENTS, MIT license, and a verifiable Hedera testnet transaction. These have **not** all been checked yet. Repository docs: https://hedera.com/blog/scaffold-hbar-template-bounty/. The template author must submit the Harness spec and validators if using Harness.

Supra interface and pair documentation: https://docs.supra.com/oracles/data-feeds/push-oracle and https://docs.supra.com/oracles/data-feeds/data-feeds-index. Hedera testnet address: https://docs.supra.com/oracles/data-feeds/push-oracle/networks.

## Verified testnet refund

Offer 1's expired, unaccepted Buyer B order was refunded on Hedera
testnet. The receipt's Refunded event matched the original deposit:
4.64048869 HBAR. After refund, resolved was true and accepted was false.

- Contract: 0x9846D66b0EB16BB8aaF18eA789420c838583B6fc
- Transaction: 0xf137ff047a3a7981c709d522803ccac28cd7ddf777e1cd5529635d00262b9bf4
- Verification date: 2026-10-01

## Live agent proposals

Run `npm run agent:plan -- REQUESTS CATALOG OUTPUT` with absolute JSON
paths. Keep buyer requests and proposal output outside the checkout.
The runner needs HEDERA_TESTNET_RPC_URL and HILLCASH_CONTRACT.
It requires no signing key and submits no transactions.

REQUESTS is an array containing id, buyer, serviceId (bytes32 hex),
units, maxUsdCents, soloUsdCents, expiresAt (Unix milliseconds), and
maxMovementBps (1–2000). Optional referencePriceE18 is a positive decimal
string. Signed planning uses the provider-declared solo price rather
than the request's solo price.

Signed catalogs are required by default. Create one with
`npm run provider:terms -- OFFER_ID UNITS_PER_BUYER SOLO_USD_CENTS OUTPUT`.
The command uses HEDERA_PRIVATE_KEY locally and submits no transaction.
It derives service ID, group price, and validity from the live offer.

Each catalog entry contains offerId, terms, and an EIP-712 signature.
Terms bind the offer, service, quantity, group price, solo price, expiry,
chain, and contract. The planner verifies the signer against the onchain
provider and rejects altered, mismatched, or expired declarations.

For explicitly unsigned fixtures, append `--allow-unsigned-demo` to
the agent command. Those catalogs contain offerId and unitsPerBuyer;
their quantities are unverified and savings use buyer-stated solo prices.

A provider signature establishes who declared the terms. It does not
independently establish market value, service quality, or guaranteed savings.

Reads use one block number with a final block-hash check. The adapter
checks chain 296, deployed code, and a fresh Supra price. Existing groups
with members are currently skipped. Providers cannot join their own offers.

OUTPUT includes the snapshot, proposals, unmatched and expired request IDs,
and skipped-offer reasons. It is created with owner-only permissions and
will not overwrite an existing file. Each buyer authorizes their own deposit.

## Verified live agent activation

On October 1, 2026, the read-only agent evaluated live Hedera testnet
offer 2 using block 41217274 and a fresh Supra HBAR/USD price. It produced
one proposal for two buyers, with no unmatched or expired requests.

Each buyer independently submitted a deposit of 2.11004864 HBAR.
Activation locked 1.92003073 HBAR per buyer, with individual market
movement limits of 300 basis points.

- Contract: 0x9846D66b0EB16BB8aaF18eA789420c838583B6fc
- Offer creation: 0xbfca1bdbf8151f07a052502f11a883f6dcda7b3f135cf6c8250ade25528d6ebc
- Buyer A join: 0xcbb6673fc127db2daf33f43b66bb8fc309c3bb28f9f1fa4b9ca0384bdb0943d7
- Buyer B join: 0x6deb1a896c8e32856e85bf1c509c5bbe348acf37587daec55fde7ef7fce1dd33
- Activation: 0x9baec2d1e6656ba3112785fc464792c104bb76a07a7683df7b4feb3805e228bb
- HCS topic: 0.0.10776777; sequence: 2
- HCS transaction: 0.0.10775178@1790852973.184320587
- Consensus timestamp: 1790852979.429476830
- Proposal digest: 0x24676021ff7ba62f1e10bebc3064773417f82b27747657ac6243b2b82bb6a1f6

The mirror message was verified, and the digest was recomputed from the
private proposal. The current digest commits to offer ID, sorted buyer
request IDs, unit USD price, and stated savings. It does not commit to
the complete planning snapshot or every proposal field.

The $0.60 comparison savings uses demo buyer-stated solo prices.
Catalog service quantities remain unverified offchain claims.
HCS records the proposal commitment and activation reference; it does
not independently prove savings or service quality.

Offer 2 subsequently completed delivery, buyer acceptance, and sample
service redemption for both buyers, as documented below.

Validation: 75 tests passed; lint and production build passed;
production dependency audit reported zero vulnerabilities.

## Verified agent purchase completion

On October 2, 2026, both buyers completed the agent-selected offer 2
purchase on Hedera testnet.

| Evidence | Buyer A | Buyer B |
| --- | --- | --- |
| Provider payment | 1.92003073 HBAR | 1.92003073 HBAR |
| Deposit surplus returned | 0.19001791 HBAR | 0.19001791 HBAR |
| Redemption HTTP status | 200 | 200 |
| Remaining service units | 99 of 100 | 99 of 100 |

Delivery transactions:
- Buyer A: 0x646f7ef19f5cb80c80d4bfec159156ab76bc1f28b969c7204f2bcdc5e9c158f6
- Buyer B: 0x7ec76795919dd38589394826a48ddf8ab0f197046b3207b9e51f697779de3606

Acceptance transactions:
- Buyer A: 0x592cc1bf00ee403dde88cd7344e7f8f6afc18a8e86a24b9e3f87f3e41bc892ff
- Buyer B: 0x2582f053f34d11ec61fb24accbc804836d70fe2f22af2bf7bd675d4163fd9b44

Private tokens were checked against onchain commitments before acceptance.
Accepted events matched each locked payment and deposit surplus.
The local sample provider then verified accepted onchain entitlements
and redeemed one service unit for each buyer.

This verifies the complete sample-provider workflow. It does not establish
independent provider adoption, market-validated savings, or production readiness.
Private tokens, ledgers, and buyer request files remain outside the repository.

## Verified signed catalog selection

On October 2, 2026, the live agent evaluated two Hedera testnet offers
for the same service using provider-signed EIP-712 commercial terms.

| Offer | Group price per buyer | Declared units | Selected |
| --- | --- | --- | --- |
| 3 | $0.25 | 100 | No |
| 4 | $0.20 | 100 | Yes |

- Offer 3 creation: 0x35dc3303d93c7b0e526c480562692bb0bc53ec75d8e154295dc4d348ad531e56
- Offer 4 creation: 0x194f1e6b39249341c1c7365cb8736a22c1e14e8722abfdacf4761ae5aa1e0fd0
- Planning block: 41252185
- Result: one proposal for two buyers; no unmatched, expired, or skipped entries
- Savings basis: provider-signed-solo-price
- Quantity basis: provider-signed-quantity

Each provider declaration specified a $0.50 solo price. The selected
proposal calculated a $0.60 total comparison saving across two buyers.
These are provider-declared demo prices, not independently verified
market prices. Signatures authenticate declarations, not service quality.

The signing commands submitted no blockchain transactions. The agent
performed read-only planning; neither buyer deposited for these offers.

Validation: all 102 tests passed, including 27 new signature and integration
tests. Lint, build, CLI help, and whitespace checks passed.
Production dependency audit reported zero vulnerabilities; the full audit
still reported 20 development dependency findings.
