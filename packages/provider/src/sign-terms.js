import fs from 'node:fs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { Contract, JsonRpcProvider, Wallet } from 'ethers';
import {
  TERMS_TYPES, termsDomain, verifyServiceTerms
} from '@hillcash/agent/terms';

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: provider:terms <offerId> <unitsPerBuyer> <soloUsdCents> <output.json>');
    return;
  }
  if (args.length !== 4 ||
      args.slice(0, 3).some(x => !/^[1-9][0-9]*$/.test(x)))
    throw new Error('Invalid signing arguments');

  dotenv.config({
    path: fileURLToPath(new URL('../../../.env', import.meta.url))
  });
  const [offerId, unitsPerBuyer, soloUsdCents] = args.slice(0, 3).map(Number);
  if (![offerId, unitsPerBuyer, soloUsdCents].every(Number.isSafeInteger))
    throw new Error('Unsafe signing values');
  if (fs.existsSync(args[3])) throw new Error('Output exists');

  const provider = new JsonRpcProvider(process.env.HEDERA_TESTNET_RPC_URL);
  try {
    if ((await provider.getNetwork()).chainId !== 296n)
      throw new Error('Wrong network');

    const wallet = new Wallet(process.env.HEDERA_PRIVATE_KEY);
    const contract = new Contract(process.env.HILLCASH_CONTRACT, [
      'function offers(uint256) view returns (address provider,bytes32 serviceId,uint64 joinDeadline,uint64 deliveryDeadline,uint32 minimum,uint32 members,uint256 unitUsdCents,uint8 state)'
    ], provider);
    const block = await provider.getBlock('latest');
    if (!block) throw new Error('Missing block');

    const target = await contract.getAddress();
    if (await provider.getCode(target, block.number) === '0x')
      throw new Error('Missing contract');

    const offer = await contract.offers(offerId, { blockTag: block.number });
    if (offer.provider.toLowerCase() !== wallet.address.toLowerCase())
      throw new Error('Not offer provider');

    const terms = {
      offerId,
      serviceId: offer.serviceId,
      unitsPerBuyer,
      unitUsdCents: Number(offer.unitUsdCents),
      soloUsdCents,
      validUntil: Number(offer.joinDeadline)
    };
    const signature = await wallet.signTypedData(
      termsDomain(296, target), TERMS_TYPES, terms
    );
    const entry = { offerId, terms, signature };

    verifyServiceTerms(entry, {
      chainId: 296, contract: target, offerId,
      offer, nowSeconds: block.timestamp
    });
    if ((await provider.getBlock(block.number))?.hash !== block.hash)
      throw new Error('Snapshot changed');

    fs.writeFileSync(args[3], JSON.stringify([entry], null, 2) + '\n', {
      flag: 'wx', mode: 0o600
    });
    console.log(JSON.stringify({
      signed: true, offerId, unitsPerBuyer,
      soloUsdCents, chainId: 296, transactionsSubmitted: 0
    }));
  } finally {
    provider.destroy();
  }
}

main().catch(() => {
  console.error('Signing failed; check arguments, provider key, network, offer, validity, and output path. No transaction was sent.');
  process.exitCode = 1;
});
