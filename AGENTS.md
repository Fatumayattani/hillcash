# Hillcash agent instructions

This repository is an early testnet template. Read `README.md` and the escrow contract before editing payment code. Keep buyer authority onchain: the matching agent proposes opportunities, and no agent may join or accept for a buyer without explicit wallet authorization. Never put private requests, tokens, credentials, or entitlements into an event or HCS message.

The contract's key invariants are one membership per wallet per offer, a USD cap at join, a fresh Supra pair 432 at join and activation, no provider payout without individual buyer acceptance, and full refunds after relevant deadlines. Never bypass a stale feed with a fabricated price. Maintain the 32-buyer bound or replace the activation loop with a safe scalable design.

Run `npm test`, `npm run lint`, and `npm run build`. For any contract changes, include boundary and failure-path tests; for deployment, run `npm run oracle:check` and record real testnet evidence. Do not claim the template qualifies for the bounty until the external scaffold command and testnet transaction have been independently verified. Do not introduce a paid API requirement.
