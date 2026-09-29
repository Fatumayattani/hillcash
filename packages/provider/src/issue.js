import dotenv from "dotenv";
import { Wallet, JsonRpcProvider } from "ethers";
import { resolve } from "node:path";
import { chainContract } from "./chain.js";
import { loadLedger, saveLedger } from "./ledger.js";

dotenv.config({ path: "../../.env" });

async function main() {
  const [offerArg, buyer, unitsArg] = process.argv.slice(2);
  const offerId = Number(offerArg), units = Number(unitsArg);
  if (!process.env.HEDERA_PRIVATE_KEY) throw new Error("Set HEDERA_PRIVATE_KEY for the provider's funded testnet wallet");
  const rpc = process.env.HEDERA_TESTNET_RPC_URL || "https://testnet.hashio.io/api";
  const signer = new Wallet(process.env.HEDERA_PRIVATE_KEY, new JsonRpcProvider(rpc, 296, { staticNetwork: true }));
  const contract = chainContract({ rpc, contract: process.env.HILLCASH_CONTRACT, signer });
  const offer = await contract.offers(offerId);
  const order = await contract.orders(offerId, buyer);
  if (offer.provider.toLowerCase() !== signer.address.toLowerCase()) throw new Error("Signer is not the offer provider");
  if (offer.state !== 1n || order.due === 0n || order.delivered || order.resolved) throw new Error("Buyer has no active undelivered order");
  const path = resolve(process.env.HILLCASH_LEDGER_PATH || ".provider-data.json");
  const ledger = loadLedger(path);
  const issued = ledger.issue({ offerId, buyer, units, expiresAt: (Number(offer.deliveryDeadline) + 30 * 86400) * 1000 });
  try {
    const gasPrice = BigInt(process.env.HILLCASH_GAS_PRICE_WEI || "2000000000000");
    const tx = await contract.commitDelivery(offerId, buyer, issued.commitment,
      { gasLimit: 750000n, gasPrice, type: 0 });
    await tx.wait();
    saveLedger(path, ledger);
    // This CLI prints the token once. Run it only in a private terminal and deliver it through a private channel.
    process.stdout.write(JSON.stringify({ offerId, buyer, transaction: tx.hash, token: issued.token, commitment: issued.commitment }) + "\n");
  } catch (error) {
    ledger.revoke(offerId, buyer);
    throw error;
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
