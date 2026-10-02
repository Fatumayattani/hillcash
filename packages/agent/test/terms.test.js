import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import {
  TERMS_TYPES, termsDomain, verifyServiceTerms
} from '../src/terms.js';

// Public test-only key; never fund this wallet.
const signer = new Wallet('0x' + '11'.repeat(32));
const contract = '0x' + '22'.repeat(20);
const serviceId = '0x' + '33'.repeat(32);

async function fixture() {
  const terms = {
    offerId: 2, serviceId, unitsPerBuyer: 100,
    unitUsdCents: 20, soloUsdCents: 50, validUntil: 2000
  };
  const signature = await signer.signTypedData(
    termsDomain(296, contract), TERMS_TYPES, terms
  );
  const context = {
    chainId: 296, contract, offerId: 2, nowSeconds: 1000,
    offer: {
      provider: signer.address, serviceId,
      unitUsdCents: 20n, joinDeadline: 1500n
    }
  };
  return { entry: { terms, signature }, context };
}

test('verifies provider-signed quantity and pricing declarations', async () => {
  const f = await fixture();
  const result = verifyServiceTerms(f.entry, f.context);
  assert.equal(result.provider, signer.address);
  assert.equal(result.unitsPerBuyer, 100);
  assert.equal(result.priceBasis, 'provider-signed-declaration');
});

for (const field of [
  'offerId', 'unitsPerBuyer', 'unitUsdCents', 'soloUsdCents', 'validUntil'
]) test(`rejects tampered ${field}`, async () => {
  const f = await fixture();
  f.entry.terms[field]++;
  assert.throws(() => verifyServiceTerms(f.entry, f.context));
});

for (const [name, mutate] of [
  ['service identity', f => f.entry.terms.serviceId = '0x' + '44'.repeat(32)],
  ['other chain', f => f.context.chainId = 1],
  ['other contract', f => f.context.contract = '0x' + '55'.repeat(20)],
  ['other provider', f => f.context.offer.provider = '0x' + '66'.repeat(20)],
  ['other onchain offer', f => f.context.offerId = 3],
  ['changed onchain price', f => f.context.offer.unitUsdCents = 21n],
  ['expired declaration', f => f.context.nowSeconds = 2000],
  ['insufficient validity', f => f.context.offer.joinDeadline = 2001n],
  ['missing signature', f => delete f.entry.signature],
  ['malformed signature', f => f.entry.signature = '0x1234'],
  ['missing terms', f => delete f.entry.terms]
]) test(`rejects ${name}`, async () => {
  const f = await fixture();
  mutate(f);
  assert.throws(() => verifyServiceTerms(f.entry, f.context));
});

for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '100'])
  test(`rejects invalid quantity ${value}`, async () => {
    const f = await fixture();
    f.entry.terms.unitsPerBuyer = value;
    assert.throws(() => verifyServiceTerms(f.entry, f.context));
  });

test('accepts validity exactly at the join deadline', async () => {
  const f = await fixture();
  f.context.offer.joinDeadline = 2000n;
  assert.equal(verifyServiceTerms(f.entry, f.context).validUntil, 2000);
});
