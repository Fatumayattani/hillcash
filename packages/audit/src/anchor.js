import dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Contract, JsonRpcProvider } from "ethers";
import { TopicMessageSubmitTransaction } from "@hiero-ledger/sdk";
import { hcsClient } from "./client.js";
import { buildRecord, verifyActivationReceipt } from "./record.js";
import { buildPlanRecord } from "./plan-record.js";

dotenv.config({ path: "../../.env" });

const [file, txHash] = process.argv.slice(2);
if (!file || !txHash || !process.env.HILLCASH_CONTRACT ||
    !process.env.HILLCASH_HCS_TOPIC_ID)
  throw new Error("Usage: npm run audit:anchor -- proposal-or-plan.json 0xACTIVATION_TX; configure contract and topic");

const proposal = JSON.parse(readFileSync(
  resolve(process.env.INIT_CWD || process.cwd(), file), "utf8"
));
const fullPlan = proposal.snapshot !== undefined;
const record = fullPlan
  ? buildPlanRecord(proposal, txHash, process.env.HILLCASH_CONTRACT)
  : buildRecord(proposal, txHash, process.env.HILLCASH_CONTRACT);

const rpc = new JsonRpcProvider(
  process.env.HEDERA_TESTNET_RPC_URL || "https://testnet.hashio.io/api",
  296, { staticNetwork: true }
);

if (fullPlan) {
  const s = proposal.snapshot, p = proposal.proposals[0];
  if ((await rpc.getNetwork()).chainId !== 296n)
    throw new Error("Wrong audit network");

  const block = await rpc.getBlock(s.blockNumber);
  if (!block || block.hash.toLowerCase() !== s.blockHash.toLowerCase() ||
      block.timestamp !== s.timestamp)
    throw new Error("Planning block does not match the chain");

  const chain = new Contract(record.contract, [
    "function marketPriceE18() view returns (uint256 price,uint256 timeMs)",
    "function offers(uint256) view returns (address provider,bytes32 serviceId,uint64 joinDeadline,uint64 deliveryDeadline,uint32 minimum,uint32 members,uint256 unitUsdCents,uint8 state)"
  ], rpc);
  const options = { blockTag: s.blockNumber };
  const offer = await chain.offers(p.offerId, options);
  const [price, timeMs] = await chain.marketPriceE18(options);

  if (offer.provider.toLowerCase() !== p.provider.toLowerCase() ||
      offer.serviceId.toLowerCase() !== p.serviceId.toLowerCase() ||
      offer.unitUsdCents !== BigInt(p.unitUsdCents) ||
      offer.state !== 0n || offer.members !== 0n ||
      offer.minimum > BigInt(p.buyerIds.length) ||
      offer.joinDeadline > BigInt(p.serviceTerms.validUntil) ||
      price.toString() !== s.marketPriceE18 ||
      timeMs.toString() !== s.oracleTimestampMs)
    throw new Error("Signed plan does not match its onchain snapshot");
}

const receipt = await rpc.getTransactionReceipt(txHash);
if (!verifyActivationReceipt(receipt, record))
  throw new Error("No matching successful Hillcash Activated event in this transaction");

const client = hcsClient();
try {
  const response = await new TopicMessageSubmitTransaction()
    .setTopicId(process.env.HILLCASH_HCS_TOPIC_ID)
    .setMessage(JSON.stringify(record))
    .execute(client);
  const result = await response.getReceipt(client);
  console.log(JSON.stringify({
    record,
    topicId: process.env.HILLCASH_HCS_TOPIC_ID,
    transactionId: response.transactionId.toString(),
    sequenceNumber: result.topicSequenceNumber?.toString()
  }));
} finally {
  client.close();
  rpc.destroy();
}
