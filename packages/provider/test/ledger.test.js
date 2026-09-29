import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { id as hashId } from "ethers";
import { EntitlementLedger, loadLedger, saveLedger } from "../src/ledger.js";
import { liveEntitlement } from "../src/chain.js";

const buyer = `0x${"1".padStart(40, "0")}`;
const other = `0x${"2".padStart(40, "0")}`;
const now = 1_000_000;
const opts = { offerId: 1, buyer, units: 2, expiresAt: now + 1000 };

test("issues a random 256-bit secret and stores only its commitment", () => {
  const ledger = new EntitlementLedger();
  const issued = ledger.issue(opts, now);
  assert.match(issued.token, /^[0-9a-f]{64}$/);
  assert.equal(issued.commitment, hashId(issued.token));
  assert.equal(ledger.get(1, buyer).token, undefined);
  assert.equal(JSON.stringify(ledger.toJSON()).includes(issued.token), false);
});
test("tokens are unique per buyer", () => {
  const ledger = new EntitlementLedger();
  const a = ledger.issue(opts, now), b = ledger.issue({ ...opts, buyer: other }, now);
  assert.notEqual(a.token, b.token);
});
test("rejects duplicate entitlement for same offer and buyer", () => {
  const ledger = new EntitlementLedger(); ledger.issue(opts, now);
  assert.throws(() => ledger.issue(opts, now), /already issued/);
  assert.doesNotThrow(() => ledger.issue({ ...opts, offerId: 2 }, now));
});
test("rejects malformed issuance", () => {
  const ledger = new EntitlementLedger();
  for (const value of [{ ...opts, offerId: 0 }, { ...opts, buyer: "invalid" },
    { ...opts, units: 0 }, { ...opts, expiresAt: now }]) assert.throws(() => ledger.issue(value, now));
});
test("redeems one unit with live onchain approval", async () => {
  const ledger = new EntitlementLedger(); const issued = ledger.issue(opts, now);
  const result = await ledger.redeem({ offerId: 1, buyer, token: issued.token, now, verify: async () => true });
  assert.equal(result.remaining, 1);
  assert.match(result.result, /1\/2/);
});
test("rejects wrong token without consuming a unit", async () => {
  const ledger = new EntitlementLedger(); ledger.issue(opts, now);
  await assert.rejects(ledger.redeem({ offerId: 1, buyer, token: "x".repeat(64), now, verify: async () => true }));
  assert.equal(ledger.get(1, buyer).remaining, 2);
});
test("does not accept another buyer's token", async () => {
  const ledger = new EntitlementLedger(); const issued = ledger.issue(opts, now);
  await assert.rejects(ledger.redeem({ offerId: 1, buyer: other, token: issued.token, now, verify: async () => true }));
});
test("rejects a refunded order and leaves quota intact", async () => {
  const ledger = new EntitlementLedger(); const issued = ledger.issue(opts, now);
  await assert.rejects(ledger.redeem({ offerId: 1, buyer, token: issued.token, now, verify: async () => false }), /not active/);
  assert.equal(ledger.get(1, buyer).remaining, 2);
});
test("rejects expiry and exhausted quota", async () => {
  const ledger = new EntitlementLedger(); const issued = ledger.issue({ ...opts, units: 1 }, now);
  await assert.rejects(ledger.redeem({ offerId: 1, buyer, token: issued.token, now: now + 1000, verify: async () => true }), /expired/);
  await ledger.redeem({ offerId: 1, buyer, token: issued.token, now, verify: async () => true });
  await assert.rejects(ledger.redeem({ offerId: 1, buyer, token: issued.token, now, verify: async () => true }), /exhausted/);
});
test("persists quota without saving the bearer token", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hillcash-")), path = join(dir, "ledger.json");
  try {
    const ledger = loadLedger(path), issued = ledger.issue(opts, now);
    saveLedger(path, ledger);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    const reloaded = loadLedger(path);
    assert.equal(reloaded.get(1, buyer).remaining, 2);
    await reloaded.redeem({ offerId: 1, buyer, token: issued.token, now, verify: async () => true });
    saveLedger(path, reloaded);
    assert.equal(loadLedger(path).get(1, buyer).remaining, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("rejects duplicate or corrupted stored records", () => {
  const ledger = new EntitlementLedger(); ledger.issue(opts, now);
  const [record] = ledger.toJSON();
  assert.throws(() => new EntitlementLedger([record, record]), /Duplicate/);
  assert.throws(() => new EntitlementLedger([{ ...record, remaining: -1 }]), /Invalid/);
});
test("onchain verifier requires activation, matching hash, and no refund", async () => {
  const commitment = hashId("secret");
  const fake = { offers: async () => ({ state: 1n }), orders: async () => ({ delivered: true, resolved: false, accepted: false, entitlementHash: commitment }) };
  assert.equal(await liveEntitlement(fake, { offerId: 1, buyer, commitment }), false);
  fake.orders = async () => ({ delivered: true, resolved: true, accepted: false, entitlementHash: commitment });
  assert.equal(await liveEntitlement(fake, { offerId: 1, buyer, commitment }), false);
  fake.orders = async () => ({ delivered: true, resolved: true, accepted: true, entitlementHash: commitment });
  assert.equal(await liveEntitlement(fake, { offerId: 1, buyer, commitment }), true);
  assert.equal(await liveEntitlement(fake, { offerId: 1, buyer, commitment: hashId("other") }), false);
});
