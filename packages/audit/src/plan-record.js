import { createHash } from 'node:crypto';
import { isAddress } from 'ethers';
import { buildRecord } from './record.js';
import { verifyServiceTerms } from '@hillcash/agent/terms';

const positive = n => Number.isSafeInteger(n) && n > 0;
const hash = /^0x[0-9a-fA-F]{64}$/;
const decimal = /^[1-9][0-9]*$/;

function canonical(value, depth = 0) {
  if (depth > 12) throw new TypeError('Audit plan nesting exceeds limit');
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value))
    return JSON.stringify(value);
  if (Array.isArray(value))
    return '[' + value.map(x => canonical(x, depth + 1)).join(',') + ']';
  if (value && Object.getPrototypeOf(value) === Object.prototype)
    return '{' + Object.keys(value).sort().map(k =>
      JSON.stringify(k) + ':' + canonical(value[k], depth + 1)
    ).join(',') + '}';
  throw new TypeError('Audit plan must contain plain JSON values');
}

/** Commits to the full single-group plan, signature, snapshot and activation reference. */
export function buildPlanRecord(plan, transactionHash, contractAddress) {
  if (!plan || !Array.isArray(plan.proposals) || plan.proposals.length !== 1)
    throw new TypeError('Audit requires exactly one proposed group');

  const p = plan.proposals[0], s = plan.snapshot;
  const base = buildRecord(p, transactionHash, contractAddress);

  if (!s || s.chainId !== 296 || !isAddress(s.contract) ||
      s.contract.toLowerCase() !== base.contract ||
      !positive(s.blockNumber) || !hash.test(s.blockHash) ||
      !positive(s.timestamp) ||
      typeof s.marketPriceE18 !== 'string' || !decimal.test(s.marketPriceE18) ||
      typeof s.oracleTimestampMs !== 'string' || !decimal.test(s.oracleTimestampMs))
    throw new TypeError('Invalid audit snapshot');

  const observedMs = BigInt(s.oracleTimestampMs);
  const blockTime = BigInt(s.timestamp);
  if (observedMs < 1000000000000n || observedMs / 1000n > blockTime ||
      blockTime - observedMs / 1000n > 7200n)
    throw new TypeError('Invalid audit oracle freshness');

  if (!isAddress(p.provider) || !hash.test(p.serviceId) ||
      p.requiresBuyerAuthorization !== true ||
      p.savingsBasis !== 'provider-signed-solo-price' ||
      p.quantityBasis !== 'provider-signed-quantity' ||
      !Number.isSafeInteger(p.totalUsdCents) ||
      p.totalUsdCents !== p.unitUsdCents * p.buyerIds.length)
    throw new TypeError('Invalid signed proposal');

  const terms = p.serviceTerms;
  if (!terms) throw new TypeError('Missing signed service terms');

  const verified = verifyServiceTerms({ terms, signature: terms.signature }, {
    chainId: 296,
    contract: base.contract,
    offerId: p.offerId,
    nowSeconds: s.timestamp,
    offer: {
      provider: p.provider,
      serviceId: p.serviceId,
      unitUsdCents: BigInt(p.unitUsdCents),
      joinDeadline: BigInt(terms.validUntil)
    }
  });
  if (p.savedUsdCents !==
      (verified.soloUsdCents - p.unitUsdCents) * p.buyerIds.length)
    throw new TypeError('Signed savings do not match declared terms');

  const normalizedPlan = {
    ...plan,
    proposals: [{ ...p, buyerIds: [...p.buyerIds].sort() }]
  };
  const payload = canonical({
    version: 2,
    contract: base.contract,
    transactionHash: base.transactionHash,
    plan: normalizedPlan
  });
  if (Buffer.byteLength(payload) > 131072)
    throw new TypeError('Audit plan exceeds size limit');

  return {
    ...base,
    version: 2,
    digest: '0x' + createHash('sha256').update(payload).digest('hex')
  };
}
