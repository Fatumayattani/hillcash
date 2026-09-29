import test from "node:test";
import assert from "node:assert/strict";
import { Interface } from "ethers";
import { buildRecord, verifyActivationReceipt } from "../src/record.js";

const contract = `0x${"3".padStart(40, "0")}`;
const tx = `0x${"a".repeat(64)}`;
const proposal = { offerId: 7, buyerIds: ["b2", "b1"], unitUsdCents: 100, savedUsdCents: 40 };
const iface = new Interface(["event Activated(uint256 indexed offerId,uint256 price,uint256 decimals)"]);
const log = (offerId, address = contract) => ({ address, ...iface.encodeEventLog(iface.getEvent("Activated"), [offerId, 1000, 8]) });

test("record is stable regardless of buyer ordering", () => {
  assert.deepEqual(buildRecord(proposal, tx, contract), buildRecord({ ...proposal, buyerIds: ["b1", "b2"] }, tx, contract));
});
test("record binds the actual offer, amount and savings", () => {
  const a = buildRecord(proposal, tx, contract);
  assert.notEqual(a.digest, buildRecord({ ...proposal, unitUsdCents: 101 }, tx, contract).digest);
  assert.notEqual(a.digest, buildRecord({ ...proposal, savedUsdCents: 41 }, tx, contract).digest);
  assert.notEqual(a.digest, buildRecord({ ...proposal, offerId: 8 }, tx, contract).digest);
});
test("public record contains no buyer IDs", () => {
  const record = buildRecord(proposal, tx, contract);
  assert.equal(JSON.stringify(record).includes("b1"), false);
  assert.match(record.digest, /^0x[0-9a-f]{64}$/);
});
test("rejects malformed decision and transaction", () => {
  for (const p of [{ ...proposal, buyerIds: ["b1"] }, { ...proposal, buyerIds: ["b1", "b1"] },
    { ...proposal, savedUsdCents: -1 }, { ...proposal, offerId: 0 }]) assert.throws(() => buildRecord(p, tx, contract));
  assert.throws(() => buildRecord(proposal, "wrong", contract));
  assert.throws(() => buildRecord(proposal, tx, "not-an-address"));
});
test("anchors only a successful matching contract activation", () => {
  const record = buildRecord(proposal, tx, contract);
  const receipt = { status: 1, hash: tx, to: contract, logs: [log(7)] };
  assert.equal(verifyActivationReceipt(receipt, record), true);
  assert.equal(verifyActivationReceipt({ ...receipt, status: 0 }, record), false);
  assert.equal(verifyActivationReceipt({ ...receipt, logs: [log(8)] }, record), false);
  assert.equal(verifyActivationReceipt({ ...receipt, logs: [log(7, `0x${"4".padStart(40, "0")}`)] }, record), false);
  assert.equal(verifyActivationReceipt({ ...receipt, to: `0x${"4".padStart(40, "0")}` }, record), false);
});
