import { planPurchases } from './match.js';

const address = /^0x[0-9a-fA-F]{40}$/;
const service = /^0x[0-9a-fA-F]{64}$/;
const positive = n => Number.isSafeInteger(n) && n > 0;

/** Read-only adapter. Catalog quantities and buyer solo prices are offchain claims. */
export async function planLivePurchases(requests, catalog, { provider, contract }) {
  if (!Array.isArray(requests) || !Array.isArray(catalog) || requests.length > 256 || catalog.length > 64)
    throw new TypeError('Expected bounded request and catalog arrays');

  const ids = new Set();
  for (const r of requests) {
    if (!r || typeof r.id !== 'string' || !r.id || ids.has(r.id) || !address.test(r.buyer) ||
        !service.test(r.serviceId) || !positive(r.units) || !positive(r.maxUsdCents) ||
        !positive(r.soloUsdCents) || !positive(r.expiresAt) ||
        !Number.isInteger(r.maxMovementBps) || r.maxMovementBps < 1 || r.maxMovementBps > 2000 ||
        (r.referencePriceE18 !== undefined && (typeof r.referencePriceE18 !== 'bigint' || r.referencePriceE18 <= 0n)))
      throw new TypeError('Invalid request or duplicate request ID');
    ids.add(r.id);
  }

  const offerIds = new Set();
  for (const c of catalog) {
    if (!c || !positive(c.offerId) || offerIds.has(c.offerId) || !positive(c.unitsPerBuyer))
      throw new TypeError('Invalid catalog or duplicate offer ID');
    offerIds.add(c.offerId);
  }

  if ((await provider.getNetwork()).chainId !== 296n)
    throw new Error('Expected Hedera testnet chain 296');

  const block = await provider.getBlock('latest');
  if (!block || !block.hash || !positive(block.number) || !positive(block.timestamp))
    throw new Error('Missing block snapshot');

  const blockTag = block.number;
  const target = await contract.getAddress();
  if (await provider.getCode(target, blockTag) === '0x')
    throw new Error('Contract has no code');

  const [price, timeMs] = await contract.marketPriceE18({ blockTag });
  if (typeof price !== 'bigint' || price <= 0n || typeof timeMs !== 'bigint' ||
      timeMs < 1_000_000_000_000n || timeMs / 1000n > BigInt(block.timestamp) ||
      BigInt(block.timestamp) - timeMs / 1000n > 7200n)
    throw new Error('Invalid or stale oracle snapshot');

  const now = block.timestamp * 1000;
  const skipped = [];
  const offers = [];

  for (const c of catalog) {
    const o = await contract.offers(c.offerId, { blockTag });
    let reason;
    if (!address.test(o.provider) || /^0x0{40}$/i.test(o.provider))
      reason = 'missing-offer';
    else if (o.state !== 0n)
      reason = 'offer-not-open';
    else if (o.joinDeadline * 1000n <= BigInt(now))
      reason = 'join-deadline-passed';
    // Existing members have their own price snapshots and deposits. Do not imply
    // activation is safe until those obligations are included in the planner.
    else if (o.members !== 0n)
      reason = 'existing-members-not-supported';
    else if (!service.test(o.serviceId) || !positive(Number(o.unitUsdCents)) ||
             o.unitUsdCents > 100_000_000n || o.minimum < 2n || o.minimum > 32n ||
             o.joinDeadline > BigInt(Math.floor(Number.MAX_SAFE_INTEGER / 1000)))
      reason = 'invalid-offer';

    if (reason) {
      skipped.push({ offerId: c.offerId, reason });
      continue;
    }

    offers.push({
      id: String(c.offerId), provider: o.provider, serviceId: o.serviceId,
      unitUsdCents: Number(o.unitUsdCents), minimum: Number(o.minimum), capacity: 32,
      joinDeadline: Number(o.joinDeadline) * 1000, unitsPerBuyer: c.unitsPerBuyer
    });
  }

  offers.sort((a, b) => a.unitUsdCents - b.unitUsdCents || Number(a.id) - Number(b.id));
  let remaining = requests.filter(r => r.expiresAt > now);
  const proposals = [];

  for (const o of offers) {
    const candidates = [];
    for (const r of remaining) {
      if (r.buyer.toLowerCase() === o.provider.toLowerCase() ||
          r.serviceId.toLowerCase() !== o.serviceId.toLowerCase()) continue;
      const order = await contract.orders(o.id, r.buyer, { blockTag });
      if (order.deposited === 0n && !order.resolved)
        candidates.push({ ...r, serviceId: o.serviceId });
    }

    const planned = planPurchases(candidates, [o], now, price);
    for (const p of planned.proposals) {
      if (!Number.isSafeInteger(p.totalUsdCents) || !Number.isSafeInteger(p.savedUsdCents))
        throw new Error('Unsafe proposal totals');

      proposals.push({
        ...p, offerId: Number(p.offerId),
        savingsBasis: 'buyer-stated-solo-price',
        quantityBasis: 'unverified-catalog',
        requiresBuyerAuthorization: true
      });

      const selected = new Set(
        p.buyerIds.map(id => candidates.find(r => r.id === id).buyer.toLowerCase())
      );
      remaining = remaining.filter(r => !selected.has(r.buyer.toLowerCase()));
    }
  }

  if ((await provider.getBlock(blockTag))?.hash !== block.hash)
    throw new Error('Snapshot changed; retry planning');

  return {
    snapshot: {
      chainId: 296, contract: target, blockNumber: blockTag, blockHash: block.hash,
      timestamp: block.timestamp, marketPriceE18: price.toString(),
      oracleTimestampMs: timeMs.toString()
    },
    proposals,
    unmatched: remaining.map(r => r.id),
    expired: requests.filter(r => r.expiresAt <= now).map(r => r.id),
    skipped
  };
}
