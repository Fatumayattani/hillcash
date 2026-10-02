import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { chainContract, liveEntitlement } from './chain.js';
import { loadLedger, saveLedger } from './ledger.js';
import { createProviderServer } from './http.js';

dotenv.config({ path: '../../.env' });

const ledgerPath = resolve(
  process.env.HILLCASH_LEDGER_PATH || '.provider-data.json'
);
const contract = chainContract({
  rpc: process.env.HEDERA_TESTNET_RPC_URL || 'https://testnet.hashio.io/api',
  contract: process.env.HILLCASH_CONTRACT
});
const port = Number(process.env.HILLCASH_PROVIDER_PORT || 3001);

createProviderServer({
  redeem: async input => {
    const ledger = loadLedger(ledgerPath);
    const result = await ledger.redeem({
      ...input,
      verify: value => liveEntitlement(contract, value)
    });
    saveLedger(ledgerPath, ledger);
    return result;
  }
}).listen(port, '127.0.0.1', () =>
  console.log(`Hillcash sample provider listening at http://127.0.0.1:${port}`)
);
