import test from "node:test";
import assert from "node:assert/strict";
import { planPurchases } from "../src/match.js";

const now = 1_000_000;
const address = n => `0x${n.toString(16).padStart(40, "0")}`;
const request = (n, overrides = {}) => ({ id: `r${n}`, buyer: address(n), serviceId: "compute",
  units: 100, maxUsdCents: 120, soloUsdCents: 150, expiresAt: now + 2000, ...overrides });
const offer = (id = "a", overrides = {}) => ({ id, provider: address(100), serviceId: "compute", unitsPerBuyer: 100,
  unitUsdCents: 100, minimum: 2, capacity: 32, joinDeadline: now + 1000, ...overrides });

test("groups compatible buyers and calculates individual savings", () => {
  assert.deepEqual(planPurchases([request(1), request(2)], [offer()], now).proposals[0], {
    offerId: "a", provider: address(100), serviceId: "compute", buyerIds: ["r1", "r2"],
    unitUsdCents: 100, totalUsdCents: 200, savedUsdCents: 100,
    explanation: "2 buyers can each save against their stated solo price; each must approve their own deposit."
  });
});
test("does not invent a group if minimum is missing", () => {
  assert.deepEqual(planPurchases([request(1)], [offer()], now), { proposals: [], unmatched: ["r1"] });
});
test("honors the buyer cap and capacity", () => {
  const result = planPurchases([request(1), request(2), request(3, { maxUsdCents: 99 })], [offer("a", { capacity: 2 })], now);
  assert.equal(result.proposals[0].buyerIds.length, 2);
  assert.deepEqual(result.unmatched, ["r3"]);
});
test("separates services, units, and deadline constraints", () => {
  const input = [request(1), request(2, { serviceId: "storage" }), request(3, { units: 101 }),
    request(4, { expiresAt: now + 500 }), request(5, { soloUsdCents: 100 })];
  assert.equal(planPurchases(input, [offer()], now).proposals.length, 0);
});
test("picks cheaper offers and never allocates the same buyer twice", () => {
  const result = planPurchases([request(1), request(2)], [offer("expensive", { unitUsdCents: 110 }), offer("cheap")], now);
  assert.deepEqual(result.proposals.map(p => p.offerId), ["cheap"]);
});
test("caps membership at 32 and leaves the rest unmatched", () => {
  const result = planPurchases(Array.from({ length: 34 }, (_, i) => request(i + 1)), [offer()], now);
  assert.equal(result.proposals[0].buyerIds.length, 32);
  assert.equal(result.unmatched.length, 2);
});
test("deduplicates by wallet and service", () => {
  const result = planPurchases([request(1), request(2), request(3, { buyer: address(2), maxUsdCents: 130 })], [offer()], now);
  assert.equal(result.proposals[0].buyerIds.length, 2);
  assert.deepEqual(result.proposals[0].buyerIds, ["r1", "r3"]);
});
test("ignores invalid and expired offers and requests", () => {
  const result = planPurchases([request(1), request(2, { expiresAt: now })], [offer("a", { joinDeadline: now })], now);
  assert.deepEqual(result, { proposals: [], unmatched: ["r1"] });
});
test("rejects malformed top-level input", () => {
  assert.throws(() => planPurchases(null, [], now), TypeError);
  assert.throws(() => planPurchases([], {}, now), TypeError);
});
