import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import { TERMS_TYPES, termsDomain } from '../src/terms.js';
import { planLivePurchases } from '../src/live.js';

const wallet = n => '0x' + n.toString(16).padStart(40, '0');
const serviceId = '0x' + 'ab'.repeat(32);
const timestamp = 1790850000;

function fixture() {
  const reads = [];
  const block = { number: 100, hash: '0x' + '12'.repeat(32), timestamp };
  const offer = {
    provider: wallet(9), serviceId, joinDeadline: BigInt(timestamp + 600),
    unitUsdCents: 20n, minimum: 2n, members: 0n, state: 0n
  };
  const provider = {
    getNetwork: async () => ({ chainId: 296n }),
    getBlock: async () => block,
    getCode: async () => '0x1234'
  };
  const contract = {
    getAddress: async () => wallet(10),
    marketPriceE18: async options => {
      reads.push(options);
      return [100000000000000000n, BigInt(timestamp * 1000)];
    },
    offers: async (id, options) => {
      reads.push(options);
      return offer;
    },
    orders: async (id, buyer, options) => {
      reads.push(options);
      return { deposited: 0n, resolved: false };
    }
  };
  const requests = [1, 2].map(n => ({
    id: 'buyer-' + n, buyer: wallet(n), serviceId,
    units: 100, maxUsdCents: 25, soloUsdCents: 50,
    expiresAt: (timestamp + 1200) * 1000, maxMovementBps: 300
  }));
  const catalog = [{ offerId: 1, unitsPerBuyer: 100 }];
  return { provider, contract, requests, catalog, offer, reads, allowUnsignedDemo: true };
}

const run = f => planLivePurchases(f.requests, f.catalog, f);

test('live proposal binds a block snapshot and identifies claimed savings', async () => {
  const f = fixture();
  const result = await run(f);
  assert.equal(result.proposals[0].offerId, 1);
  assert.equal(result.proposals[0].savedUsdCents, 60);
  assert.equal(result.proposals[0].quantityBasis, 'unverified-catalog');
  assert.equal(result.proposals[0].requiresBuyerAuthorization, true);
  assert.ok(f.reads.every(o => o.blockTag === 100));
});

for (const [name, mutate, reason] of [
  ['active', f => f.offer.state = 1n, 'offer-not-open'],
  ['cancelled', f => f.offer.state = 2n, 'offer-not-open'],
  ['expired', f => f.offer.joinDeadline = BigInt(timestamp), 'join-deadline-passed'],
  ['partially joined', f => f.offer.members = 1n, 'existing-members-not-supported'],
  ['nonexistent', f => f.offer.provider = wallet(0), 'missing-offer']
]) test(`skips ${name} offers`, async () => {
  const f = fixture();
  mutate(f);
  const result = await run(f);
  assert.equal(result.proposals.length, 0);
  assert.equal(result.skipped[0].reason, reason);
});

test('provider cannot be selected as a buyer', async () => {
  const f = fixture();
  f.requests[0].buyer = f.offer.provider;
  assert.equal((await run(f)).proposals.length, 0);
});

test('existing deposit is excluded', async () => {
  const f = fixture();
  f.contract.orders = async () => ({ deposited: 1n, resolved: false });
  assert.equal((await run(f)).proposals.length, 0);
});

test('same wallet cannot satisfy the group minimum twice', async () => {
  const f = fixture();
  f.requests[1].buyer = f.requests[0].buyer;
  assert.equal((await run(f)).proposals.length, 0);
});

for (const [name, mutate] of [
  ['wrong chain', f => f.provider.getNetwork = async () => ({ chainId: 1n })],
  ['missing contract', f => f.provider.getCode = async () => '0x'],
  ['stale feed', f => f.contract.marketPriceE18 = async () => [1n, BigInt((timestamp - 7201) * 1000)]],
  ['future feed', f => f.contract.marketPriceE18 = async () => [1n, BigInt((timestamp + 1) * 1000)]],
  ['seconds feed', f => f.contract.marketPriceE18 = async () => [1n, BigInt(timestamp)]],
  ['zero price', f => f.contract.marketPriceE18 = async () => [0n, BigInt(timestamp * 1000)]],
  ['duplicate request IDs', f => f.requests[1].id = f.requests[0].id],
  ['duplicate offer IDs', f => f.catalog.push(f.catalog[0])],
  ['missing movement limit', f => delete f.requests[0].maxMovementBps]
]) test(`rejects ${name}`, async () => {
  const f = fixture();
  mutate(f);
  await assert.rejects(run(f));
});

test('rejects a changed block hash', async () => {
  const f = fixture();
  const getBlock = f.provider.getBlock;
  f.provider.getBlock = async tag => ({
    ...await getBlock(), hash: tag === 'latest' ? 'first' : 'changed'
  });
  await assert.rejects(run(f), /Snapshot changed/);
});

test('market movement excludes guarded requests', async () => {
  const f = fixture();
  f.requests[0].referencePriceE18 = 200000000000000000n;
  assert.equal((await run(f)).proposals.length, 0);
});

test('expired requests are reported separately', async () => {
  const f = fixture();
  f.requests[0].expiresAt = timestamp * 1000;
  assert.deepEqual((await run(f)).expired, ['buyer-1']);
});

test('unsigned catalog requires explicit demo mode', async () => {
  const f = fixture();
  f.allowUnsignedDemo = false;
  await assert.rejects(run(f), /Invalid catalog/);
});

async function signedFixture() {
  const f = fixture();
  const signer = new Wallet('0x' + '11'.repeat(32));
  f.allowUnsignedDemo = false;
  f.offer.provider = signer.address;
  const terms = {
    offerId: 1, serviceId, unitsPerBuyer: 100,
    unitUsdCents: 20, soloUsdCents: 40,
    validUntil: timestamp + 600
  };
  f.catalog = [{
    offerId: 1,
    terms,
    signature: await signer.signTypedData(
      termsDomain(296, wallet(10)), TERMS_TYPES, terms
    )
  }];
  return f;
}

test('live planner uses signed solo price rather than buyer comparison claims', async () => {
  const f = await signedFixture();
  f.requests.forEach(r => r.soloUsdCents = 10000);
  const p = (await run(f)).proposals[0];
  assert.equal(p.savedUsdCents, 40);
  assert.equal(p.quantityBasis, 'provider-signed-quantity');
  assert.equal(p.savingsBasis, 'provider-signed-solo-price');
});

test('unsigned quantity override cannot replace signed quantity', async () => {
  const f = await signedFixture();
  f.catalog[0].unitsPerBuyer = 999;
  f.requests.forEach(r => r.units = 101);
  assert.equal((await run(f)).proposals.length, 0);
});

test('live planning fails on modified signed terms', async () => {
  const f = await signedFixture();
  f.catalog[0].terms.soloUsdCents++;
  await assert.rejects(run(f));
});
