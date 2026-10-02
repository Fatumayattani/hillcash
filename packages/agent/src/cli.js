import fs from 'node:fs';
import dotenv from 'dotenv';
import { Contract, JsonRpcProvider } from 'ethers';
import { fileURLToPath } from 'node:url';
import { planLivePurchases } from './live.js';

const abi = [
  'function marketPriceE18() view returns (uint256 price,uint256 timeMs)',
  'function offers(uint256) view returns (address provider,bytes32 serviceId,uint64 joinDeadline,uint64 deliveryDeadline,uint32 minimum,uint32 members,uint256 unitUsdCents,uint8 state)',
  'function orders(uint256,address) view returns (uint256 deposited,uint256 due,bool delivered,bool resolved,bool accepted,bytes32 entitlementHash,uint256 joinPriceE18,uint16 maxMovementBps)'
];

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: agent:plan <requests.json> <catalog.json> <private-output.json> [--allow-unsigned-demo]');
    return;
  }
  if (args.length !== 3 && !(args.length === 4 && args[3] === '--allow-unsigned-demo'))
    throw new Error('Expected requests, catalog, and private output file paths; use --help');

  dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
  const rpc = process.env.HEDERA_TESTNET_RPC_URL;
  const target = process.env.HILLCASH_CONTRACT;
  if (!rpc || !target)
    throw new Error('Set HEDERA_TESTNET_RPC_URL and HILLCASH_CONTRACT');

  const requests = JSON.parse(fs.readFileSync(args[0], 'utf8'));
  if (!Array.isArray(requests)) throw new Error('Requests must be a JSON array');
  for (const r of requests) {
    if (r.referencePriceE18 !== undefined) {
      if (typeof r.referencePriceE18 !== 'string' || !/^[1-9][0-9]*$/.test(r.referencePriceE18))
        throw new Error('referencePriceE18 must be a positive decimal string');
      r.referencePriceE18 = BigInt(r.referencePriceE18);
    }
  }

  const catalog = JSON.parse(fs.readFileSync(args[1], 'utf8'));
  const provider = new JsonRpcProvider(rpc);
  const contract = new Contract(target, abi, provider);
  try {
    const result = await planLivePurchases(requests, catalog, { provider, contract, allowUnsignedDemo: args[3] === '--allow-unsigned-demo' });
    fs.writeFileSync(args[2], JSON.stringify(result, null, 2) + '\n', {
      flag: 'wx', mode: 0o600
    });
    console.log(JSON.stringify({
      block: result.snapshot.blockNumber,
      proposals: result.proposals.length,
      unmatched: result.unmatched.length,
      expired: result.expired.length,
      skipped: result.skipped.length
    }));
  } finally {
    provider.destroy();
  }
}

main().catch(() => {
  console.error('Planning failed; check inputs, network, contract, oracle freshness, and that output does not exist. No transaction was sent.');
  process.exitCode = 1;
});
