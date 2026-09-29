# Hillcash purchase lifecycle

Build a scaffold-hbar compatible Next.js + Hardhat template for individual buyer authorization of group purchases. A matching policy compares service, units, buyer USD limits, solo prices and provider capacity. A Supra HBAR/USD push feed supplies an onchain price at join and activation. Each buyer can accept delivery and release their payment or refund after expiry.

Acceptance criteria: clean installation, compile, deterministic matching tests, contract lifecycle tests, typecheck and production build. A live oracle read and actual Hedera testnet transaction are separate deployment gates; do not substitute mocks for these claims. Do not put entitlement secrets onchain. No paid AI API.
