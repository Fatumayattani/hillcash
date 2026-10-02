import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderServer } from '../src/http.js';

const token = 'ab'.repeat(32);
const buyer = '0x' + '11'.repeat(20);
const body = { offerId: 4, buyer };

async function withServer(redeem, run, options = {}) {
  const server = createProviderServer({ redeem, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/redeem`;
  const request = (data = body, extra = {}) => fetch(url, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token },
    body: JSON.stringify(data),
    ...extra
  });
  try {
    await run(request, url);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

test('successful redemption passes identity and token to the ledger', async () => {
  await withServer(async input => {
    assert.deepEqual(input, { ...body, token });
    return { remaining: 99, result: 'computed' };
  }, async request => {
    const response = await request();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.deepEqual(await response.json(), {
      remaining: 99, result: 'computed'
    });
  });
});

for (const [name, headers] of [
  ['missing authorization', {}],
  ['wrong scheme', { authorization: 'Basic abc' }],
  ['short token', { authorization: 'Bearer ab' }],
  ['invalid token alphabet', { authorization: 'Bearer ' + 'z'.repeat(64) }]
]) test(`rejects ${name} without reaching the ledger`, async () => {
  let calls = 0;
  await withServer(async () => { calls++; }, async request => {
    assert.equal((await request(body, { headers })).status, 401);
    assert.equal(calls, 0);
  });
});

for (const [name, payload] of [
  ['null payload', null],
  ['array payload', []],
  ['missing buyer', { offerId: 4 }],
  ['invalid address', { ...body, buyer: 'wrong' }],
  ['zero offer', { ...body, offerId: 0 }],
  ['negative offer', { ...body, offerId: -1 }],
  ['fractional offer', { ...body, offerId: 1.5 }],
  ['string offer', { ...body, offerId: '4' }],
  ['unsafe offer', { ...body, offerId: Number.MAX_SAFE_INTEGER + 1 }],
  ['extra payload fields', { ...body, secret: 'unwanted' }]
]) test(`rejects ${name} without reaching the ledger`, async () => {
  let calls = 0;
  await withServer(async () => { calls++; }, async request => {
    assert.equal((await request(payload)).status, 400);
    assert.equal(calls, 0);
  });
});

test('rejects malformed JSON', async () => {
  await withServer(async () => assert.fail('ledger called'), async request => {
    assert.equal((await request(body, { body: '{' })).status, 400);
  });
});

test('body exactly at the byte limit is accepted', async () => {
  await withServer(async () => ({ remaining: 99 }), async request => {
    assert.equal((await request()).status, 200);
  }, { maxBodyBytes: Buffer.byteLength(JSON.stringify(body)) });
});

test('body one byte above the limit is rejected', async () => {
  await withServer(async () => assert.fail('ledger called'), async request => {
    assert.equal((await request()).status, 413);
  }, { maxBodyBytes: Buffer.byteLength(JSON.stringify(body)) - 1 });
});

test('multibyte input is limited by bytes rather than character count', async () => {
  const payload = JSON.stringify({ ...body, note: 'é'.repeat(20) });
  await withServer(async () => assert.fail('ledger called'), async request => {
    assert.equal((await request(body, { body: payload })).status, 413);
  }, { maxBodyBytes: payload.length });
});

test('GET requests cannot redeem', async () => {
  await withServer(async () => assert.fail('ledger called'), async (_, url) => {
    assert.equal((await fetch(url)).status, 404);
  });
});

test('unknown routes cannot redeem', async () => {
  await withServer(async () => assert.fail('ledger called'), async (_, url) => {
    assert.equal((await fetch(url + '/other', { method: 'POST' })).status, 404);
  });
});

test('concurrent redemptions are serialized', async () => {
  let active = 0, peak = 0, remaining = 100;
  await withServer(async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 10));
    active--;
    return { remaining: --remaining };
  }, async request => {
    const responses = await Promise.all([request(), request()]);
    assert.ok(responses.every(r => r.status === 200));
    const results = await Promise.all(responses.map(r => r.json()));
    assert.deepEqual(results.map(r => r.remaining).sort(), [98, 99]);
    assert.equal(peak, 1);
  });
});

test('a failed redemption does not poison later requests or expose internal errors', async () => {
  let calls = 0;
  await withServer(async () => {
    if (++calls === 1) throw new Error('internal-private-detail');
    return { remaining: 99 };
  }, async request => {
    const first = await request();
    assert.equal(first.status, 400);
    assert.deepEqual(await first.json(), { error: 'Redemption rejected' });
    assert.equal((await request()).status, 200);
  });
});

test('successful response waits for the redemption operation to finish', async () => {
  let persisted = false;
  await withServer(async () => {
    await new Promise(resolve => setTimeout(resolve, 10));
    persisted = true;
    return { remaining: 99 };
  }, async request => {
    assert.equal((await request()).status, 200);
    assert.equal(persisted, true);
  });
});
