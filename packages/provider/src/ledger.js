import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, chmodSync } from "node:fs";
import { id as hashId, isAddress } from "ethers";

const key = (offerId, buyer) => `${offerId}:${buyer.toLowerCase()}`;
const validId = value => Number.isSafeInteger(value) && value > 0;

/** Example provider ledger. Store commitment and quota, never a plaintext token. */
export class EntitlementLedger {
  constructor(records = []) {
    this.records = new Map();
    for (const record of records) {
      if (!validId(record.offerId) || !isAddress(record.buyer) || !validId(record.units) ||
        !Number.isSafeInteger(record.remaining) || record.remaining < 0 || record.remaining > record.units ||
        !validId(record.expiresAt) || !/^0x[0-9a-f]{64}$/i.test(record.commitment)) throw new TypeError("Invalid ledger record");
      const recordKey = key(record.offerId, record.buyer);
      if (this.records.has(recordKey)) throw new TypeError("Duplicate entitlement");
      this.records.set(recordKey, { ...record, buyer: record.buyer.toLowerCase() });
    }
  }

  issue({ offerId, buyer, units, expiresAt }, now = Date.now()) {
    if (!validId(offerId) || !isAddress(buyer) || !validId(units) || !Number.isSafeInteger(expiresAt) || expiresAt <= now)
      throw new TypeError("Invalid entitlement");
    const recordKey = key(offerId, buyer);
    if (this.records.has(recordKey)) throw new Error("Entitlement already issued");
    const token = randomBytes(32).toString("hex");
    const commitment = hashId(token);
    const record = { offerId, buyer: buyer.toLowerCase(), units, remaining: units, expiresAt, commitment };
    this.records.set(recordKey, record);
    return { token, ...record };
  }

  get(offerId, buyer) { return this.records.get(key(offerId, buyer)); }
  revoke(offerId, buyer) { this.records.delete(key(offerId, buyer)); }

  async redeem({ offerId, buyer, token, now = Date.now(), verify }) {
    if (!validId(offerId) || !isAddress(buyer) || typeof token !== "string" || typeof verify !== "function")
      throw new TypeError("Invalid redemption");
    const record = this.get(offerId, buyer);
    if (!record || token.length !== 64 || hashId(token) !== record.commitment) throw new Error("Invalid entitlement token");
    if (now >= record.expiresAt) throw new Error("Entitlement expired");
    if (record.remaining === 0) throw new Error("Usage exhausted");
    // The live adapter must check chain state on every call; refund revokes service.
    if (!(await verify({ offerId, buyer, commitment: record.commitment }))) throw new Error("Onchain delivery is not active");
    --record.remaining;
    return { remaining: record.remaining, result: `Hillcash sample computation ${record.units - record.remaining}/${record.units}` };
  }

  toJSON() { return [...this.records.values()].map(record => ({ ...record })); }
}

export function loadLedger(path) {
  try { return new EntitlementLedger(JSON.parse(readFileSync(path, "utf8"))); }
  catch (error) { if (error.code === "ENOENT") return new EntitlementLedger(); throw error; }
}

export function saveLedger(path, ledger) {
  const temp = `${path}.tmp`;
  writeFileSync(temp, JSON.stringify(ledger.toJSON(), null, 2), { mode: 0o600, flag: "w" });
  chmodSync(temp, 0o600);
  renameSync(temp, path);
}
