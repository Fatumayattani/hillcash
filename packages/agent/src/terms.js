import { getAddress, verifyTypedData } from 'ethers';

export const TERMS_TYPES = {
  ServiceTerms: [
    { name: 'offerId', type: 'uint256' },
    { name: 'serviceId', type: 'bytes32' },
    { name: 'unitsPerBuyer', type: 'uint256' },
    { name: 'unitUsdCents', type: 'uint256' },
    { name: 'soloUsdCents', type: 'uint256' },
    { name: 'validUntil', type: 'uint64' }
  ]
};
const positive = n => Number.isSafeInteger(n) && n > 0;

export function termsDomain(chainId, contract) {
  if (!positive(chainId)) throw new TypeError('Invalid terms chain ID');
  return {
    name: 'Hillcash Service Terms',
    version: '1',
    chainId,
    verifyingContract: getAddress(contract)
  };
}

/** A signature identifies the provider's declaration, not market value or quality. */
export function verifyServiceTerms(entry, {
  chainId, contract, offerId, offer, nowSeconds
}) {
  if (!entry || !positive(nowSeconds) || !positive(offerId))
    throw new TypeError('Invalid terms context');

  const t = entry.terms;
  if (!t || !positive(t.offerId) || !positive(t.unitsPerBuyer) ||
      !positive(t.unitUsdCents) || !positive(t.soloUsdCents) ||
      !positive(t.validUntil) || typeof t.serviceId !== 'string' ||
      !/^0x[0-9a-fA-F]{64}$/.test(t.serviceId))
    throw new TypeError('Malformed service terms');

  if (t.offerId !== offerId ||
      t.serviceId.toLowerCase() !== offer.serviceId.toLowerCase() ||
      BigInt(t.unitUsdCents) !== offer.unitUsdCents)
    throw new Error('Terms do not match onchain offer');

  if (t.validUntil <= nowSeconds ||
      BigInt(t.validUntil) < offer.joinDeadline)
    throw new Error('Terms expire before the join window closes');

  if (t.soloUsdCents <= t.unitUsdCents)
    throw new Error('Terms contain no group discount');

  const recovered = verifyTypedData(
    termsDomain(chainId, contract), TERMS_TYPES, t, entry.signature
  );
  if (getAddress(recovered) !== getAddress(offer.provider))
    throw new Error('Terms signer is not the offer provider');

  return {
    ...t,
    provider: recovered,
    priceBasis: 'provider-signed-declaration'
  };
}
