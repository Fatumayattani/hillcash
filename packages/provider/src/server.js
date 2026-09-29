import dotenv from "dotenv";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { chainContract, liveEntitlement } from "./chain.js";
import { loadLedger, saveLedger } from "./ledger.js";

dotenv.config({ path: "../../.env" });

const path = resolve(process.env.HILLCASH_LEDGER_PATH || ".provider-data.json");
const contract = chainContract({ rpc: process.env.HEDERA_TESTNET_RPC_URL || "https://testnet.hashio.io/api",
  contract: process.env.HILLCASH_CONTRACT });
const port = Number(process.env.HILLCASH_PROVIDER_PORT || 3001);
let queue = Promise.resolve();

createServer(async (req, res) => {
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  if (req.method !== "POST" || req.url !== "/redeem") { res.writeHead(404); res.end(JSON.stringify({ error: "Not found" })); return; }
  try {
    let data = "";
    for await (const chunk of req) {
      data += chunk;
      if (data.length > 2048) throw new Error("Request too large");
    }
    const body = JSON.parse(data);
    const authorization = req.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) throw new Error("Bearer token required");
    const task = queue.then(async () => {
      const ledger = loadLedger(path);
      const result = await ledger.redeem({ offerId: body.offerId, buyer: body.buyer,
        token: authorization.slice(7), verify: value => liveEntitlement(contract, value) });
      saveLedger(path, ledger);
      return result;
    });
    queue = task.catch(() => {});
    const result = await task;
    res.writeHead(200); res.end(JSON.stringify(result));
  } catch (error) {
    res.writeHead(400); res.end(JSON.stringify({ error: error.message }));
  }
}).listen(port, "127.0.0.1", () => console.log(`Hillcash sample provider listening at http://127.0.0.1:${port}`));
