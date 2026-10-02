import { createServer } from 'node:http';
import { isAddress } from 'ethers';

/** Serialized redemption boundary; replies follow ledger persistence. */
export function createProviderServer({ redeem, maxBodyBytes = 2048 }) {
  if (typeof redeem !== 'function' || !Number.isSafeInteger(maxBodyBytes) ||
      maxBodyBytes < 1 || maxBodyBytes > 65536)
    throw new TypeError('Invalid provider HTTP configuration');

  let queue = Promise.resolve();
  const server = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    const reply = (status, body) => {
      res.writeHead(status);
      res.end(JSON.stringify(body));
    };

    if (req.method !== 'POST' || req.url !== '/redeem')
      return reply(404, { error: 'Not found' });

    const authorization = req.headers.authorization;
    if (typeof authorization !== 'string' ||
        !/^Bearer [0-9a-f]{64}$/.test(authorization))
      return reply(401, { error: 'Valid bearer token required' });

    try {
      const chunks = [];
      let size = 0, oversized = false;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > maxBodyBytes) {
          oversized = true;
          chunks.length = 0;
        } else if (!oversized) {
          chunks.push(chunk);
        }
      }
      if (oversized) return reply(413, { error: 'Request too large' });

      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!body || Array.isArray(body) || typeof body !== 'object' ||
          Object.keys(body).length !== 2 ||
          !Number.isSafeInteger(body.offerId) || body.offerId < 1 ||
          typeof body.buyer !== 'string' || !isAddress(body.buyer))
        return reply(400, { error: 'Invalid redemption request' });

      const task = queue.then(() => redeem({
        offerId: body.offerId,
        buyer: body.buyer,
        token: authorization.slice(7)
      }));
      queue = task.catch(() => {});
      const result = await task;
      return reply(200, result);
    } catch {
      return reply(400, { error: 'Redemption rejected' });
    }
  });

  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  return server;
}
