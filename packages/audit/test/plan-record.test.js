import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import { TERMS_TYPES, termsDomain } from '@hillcash/agent/terms';
import { buildPlanRecord } from '../src/plan-record.js';

const wallet = new Wallet('0x' + '11'.repeat(32));
const contract = '0x' + '22'.repeat(20);
const tx = '0x' + '33'.repeat(32);
const time = 1790850000;
const serviceId = '0x' + '44'.repeat(32);

async function fixture() {
  const terms = {
    offerId: 4, serviceId, unitsPerBuyer: 100,
    unitUsdCents: 20, soloUsdCents: 50, validUntil: time + 600
  };
  const signature = await wallet.signTypedData(
    termsDomain(296, contract), TERMS_TYPES, terms
  );
  return {
    snapshot: {
      chainId: 296, contract, blockNumber: 100,
      blockHash: '0x' + '55'.repeat(32), timestamp: time,
      marketPriceE18: '100000000000000000',
      oracleTimestampMs: String(time * 1000)
    },
    proposals: [{
      offerId: 4, provider: wallet.address, serviceId,
      buyerIds: ['a', 'b'], unitUsdCents: 20,
      totalUsdCents: 40, savedUsdCents: 60,
      requiresBuyerAuthorization: true,
      savingsBasis: 'provider-signed-solo-price',
      quantityBasis: 'provider-signed-quantity',
      serviceTerms: { ...terms, signature }
    }],
    unmatched: [], expired: [], skipped: []
  };
}

test('version 2 validates the signed plan and emits only a commitment', async () => {
  const plan = await fixture();
  const r = buildPlanRecord(plan, tx, contract);
  assert.equal(r.version, 2);
  assert.match(r.digest, /^0x[0-9a-f]{64}$/);
  assert.deepEqual(Object.keys(r).sort(), [
    'contract', 'digest', 'kind', 'offerId', 'transactionHash', 'version'
  ]);
});

test('digest is stable under object-key and buyer ordering', async () => {
  const p = await fixture();
  const other = JSON.parse(JSON.stringify(p));
  other.snapshot = Object.fromEntries(Object.entries(other.snapshot).reverse());
  other.proposals[0].buyerIds.reverse();
  assert.equal(
    buildPlanRecord(p, tx, contract).digest,
    buildPlanRecord(other, tx, contract).digest
  );
});

for (const [name, mutate] of [
  ['block number', p => p.snapshot.blockNumber++],
  ['block hash', p => p.snapshot.blockHash = '0x' + '66'.repeat(32)],
  ['market price', p => p.snapshot.marketPriceE18 = '100000000000000001'],
  ['oracle timestamp', p => p.snapshot.oracleTimestampMs = String(time * 1000 - 1)],
  ['block timestamp', p => p.snapshot.timestamp++],
  ['buyer identity', p => p.proposals[0].buyerIds[0] = 'different'],
  ['explanation', p => p.proposals[0].explanation = 'changed reasoning'],
  ['unmatched requests', p => p.unmatched.push('left-out')]
]) test(`commitment binds ${name}`, async () => {
  const p = await fixture();
  const before = buildPlanRecord(p, tx, contract).digest;
  mutate(p);
  assert.notEqual(buildPlanRecord(p, tx, contract).digest, before);
});

for (const [name, mutate] of [
  ['missing snapshot', p => delete p.snapshot],
  ['wrong chain', p => p.snapshot.chainId = 1],
  ['wrong contract', p => p.snapshot.contract = wallet.address],
  ['bad block hash', p => p.snapshot.blockHash = 'wrong'],
  ['zero price', p => p.snapshot.marketPriceE18 = '0'],
  ['numeric price', p => p.snapshot.marketPriceE18 = 1],
  ['seconds oracle timestamp', p => p.snapshot.oracleTimestampMs = String(time)],
  ['future oracle timestamp', p => p.snapshot.oracleTimestampMs = String((time + 1) * 1000)],
  ['stale oracle timestamp', p => p.snapshot.oracleTimestampMs = String((time - 7201) * 1000)],
  ['missing signature', p => delete p.proposals[0].serviceTerms.signature],
  ['tampered signed quantity', p => p.proposals[0].serviceTerms.unitsPerBuyer++],
  ['tampered signed solo price', p => p.proposals[0].serviceTerms.soloUsdCents++],
  ['wrong provider', p => p.proposals[0].provider = contract],
  ['wrong group total', p => p.proposals[0].totalUsdCents++],
  ['wrong declared savings', p => p.proposals[0].savedUsdCents++],
  ['unsigned savings', p => p.proposals[0].savingsBasis = 'buyer-stated-solo-price'],
  ['unverified quantity', p => p.proposals[0].quantityBasis = 'unverified-catalog'],
  ['missing buyer authority', p => p.proposals[0].requiresBuyerAuthorization = false],
  ['multiple groups', p => p.proposals.push(p.proposals[0])],
  ['empty groups', p => p.proposals = []],
  ['non-JSON value', p => p.extra = undefined],
  ['oversized plan', p => p.extra = 'x'.repeat(131073)]
]) test(`rejects ${name}`, async () => {
  const p = await fixture();
  mutate(p);
  assert.throws(() => buildPlanRecord(p, tx, contract));
});

test('commitment binds activation transaction', async () => {
  const p = await fixture();
  assert.notEqual(
    buildPlanRecord(p, tx, contract).digest,
    buildPlanRecord(p, '0x' + '77'.repeat(32), contract).digest
  );
});
