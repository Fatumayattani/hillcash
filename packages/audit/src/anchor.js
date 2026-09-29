import dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JsonRpcProvider } from "ethers";
import { TopicMessageSubmitTransaction } from "@hiero-ledger/sdk";
import { hcsClient } from "./client.js";
import { buildRecord, verifyActivationReceipt } from "./record.js";

dotenv.config({ path: "../../.env" });

const [file, txHash] = process.argv.slice(2);
if (!file || !txHash || !process.env.HILLCASH_CONTRACT || !process.env.HILLCASH_HCS_TOPIC_ID)
  throw new Error("Usage: npm run audit:anchor -- path/to/proposal.json 0xACTIVATION_TX; set HILLCASH_CONTRACT and HILLCASH_HCS_TOPIC_ID");
const proposal = JSON.parse(readFileSync(resolve(process.env.INIT_CWD || process.cwd(), file), "utf8"));
const record = buildRecord(proposal, txHash, process.env.HILLCASH_CONTRACT);
const rpc = new JsonRpcProvider(process.env.HEDERA_TESTNET_RPC_URL || "https://testnet.hashio.io/api", 296, { staticNetwork: true });
const receipt = await rpc.getTransactionReceipt(txHash);
if (!verifyActivationReceipt(receipt, record)) throw new Error("No matching successful Hillcash Activated event in this transaction");
const client = hcsClient();
try {
  const response = await new TopicMessageSubmitTransaction().setTopicId(process.env.HILLCASH_HCS_TOPIC_ID)
    .setMessage(JSON.stringify(record)).execute(client);
  const result = await response.getReceipt(client);
  console.log(JSON.stringify({ record, topicId: process.env.HILLCASH_HCS_TOPIC_ID,
    transactionId: response.transactionId.toString(), sequenceNumber: result.topicSequenceNumber?.toString() }));
} finally { client.close(); }
