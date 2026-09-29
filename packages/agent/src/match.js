/** Deterministic purchasing agent. It proposes groups; buyers authorize each on-chain join. */
export function planPurchases(requests, offers, now = Date.now(), marketPriceE18) {
  if (!Array.isArray(requests) || !Array.isArray(offers) || !Number.isSafeInteger(now)) throw new TypeError("Invalid input");
  if (marketPriceE18 !== undefined && !validPrice(marketPriceE18)) throw new TypeError("Invalid market price");
  const eligible = new Map();
  for (const request of requests) {
    if (!validRequest(request, now)) continue;
    // One buyer may create several requests, but can join a contract offer only once.
    const key = `${request.buyer.toLowerCase()}|${request.serviceId}`;
    const old = eligible.get(key);
    if (!old || request.maxUsdCents > old.maxUsdCents ||
      (request.maxUsdCents === old.maxUsdCents && request.id < old.id)) eligible.set(key, request);
  }

  const remaining = [...eligible.values()].sort((a, b) => a.id.localeCompare(b.id));
  const proposals = [];
  const sortedOffers = [...offers].filter(o => validOffer(o, now)).sort((a, b) =>
    a.unitUsdCents - b.unitUsdCents || a.id.localeCompare(b.id));

  for (const offer of sortedOffers) {
    const candidates = remaining.filter(r => r.serviceId === offer.serviceId &&
      r.units <= offer.unitsPerBuyer && r.maxUsdCents >= offer.unitUsdCents &&
      r.soloUsdCents > offer.unitUsdCents && r.expiresAt >= offer.joinDeadline &&
      (r.referencePriceE18 === undefined || (marketPriceE18 !== undefined &&
        rateWithinLimit(r.referencePriceE18, marketPriceE18, r.maxMovementBps))));
    if (candidates.length < offer.minimum) continue;
    const buyers = candidates.slice(0, Math.min(offer.capacity, 32));
    if (buyers.length < offer.minimum) continue;
    const ids = new Set(buyers.map(r => r.id));
    for (let i = remaining.length - 1; i >= 0; i--) if (ids.has(remaining[i].id)) remaining.splice(i, 1);
    proposals.push({ offerId: offer.id, provider: offer.provider, serviceId: offer.serviceId,
      buyerIds: buyers.map(r => r.id), unitUsdCents: offer.unitUsdCents,
      totalUsdCents: buyers.length * offer.unitUsdCents,
      savedUsdCents: buyers.reduce((sum, r) => sum + r.soloUsdCents - offer.unitUsdCents, 0),
      explanation: `${buyers.length} buyers can each save against their stated solo price; each must approve their own deposit.` });
  }
  return { proposals, unmatched: remaining.map(r => r.id) };
}

function validRequest(r, now) {
  return r && typeof r.id === "string" && r.id.length > 0 &&
    typeof r.buyer === "string" && /^0x[0-9a-fA-F]{40}$/.test(r.buyer) &&
    typeof r.serviceId === "string" && r.serviceId.length > 0 &&
    safePositive(r.units) && safePositive(r.maxUsdCents) && safePositive(r.soloUsdCents) &&
    Number.isSafeInteger(r.expiresAt) && r.expiresAt > now &&
    (r.referencePriceE18 === undefined ||
      (validPrice(r.referencePriceE18) && validBps(r.maxMovementBps)));
}

function validOffer(o, now) {
  return o && typeof o.id === "string" && o.id.length > 0 &&
    typeof o.provider === "string" && /^0x[0-9a-fA-F]{40}$/.test(o.provider) &&
    typeof o.serviceId === "string" && o.serviceId.length > 0 &&
    safePositive(o.unitsPerBuyer) && safePositive(o.unitUsdCents) &&
    Number.isSafeInteger(o.minimum) && o.minimum >= 2 && o.minimum <= 32 &&
    Number.isSafeInteger(o.capacity) && o.capacity >= o.minimum && o.capacity <= 32 &&
    Number.isSafeInteger(o.joinDeadline) && o.joinDeadline > now;
}

function safePositive(n) { return Number.isSafeInteger(n) && n > 0; }
function validPrice(n) { return typeof n === "bigint" && n > 0n; }
function validBps(n) { return Number.isInteger(n) && n >= 1 && n <= 2000; }

/** Advisory filter only. The contract verifies a fresh feed again at activation. */
export function rateWithinLimit(referencePriceE18, currentPriceE18, maxMovementBps) {
  if (!validPrice(referencePriceE18) || !validPrice(currentPriceE18) || !validBps(maxMovementBps))
    throw new TypeError("Invalid rate limit");
  const delta = referencePriceE18 > currentPriceE18
    ? referencePriceE18 - currentPriceE18 : currentPriceE18 - referencePriceE18;
  return delta * 10000n <= referencePriceE18 * BigInt(maxMovementBps);
}
