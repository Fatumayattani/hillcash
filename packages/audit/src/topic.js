import dotenv from "dotenv";
import { TopicCreateTransaction } from "@hiero-ledger/sdk";
import { hcsClient } from "./client.js";

dotenv.config({ path: "../../.env" });

const client = hcsClient();
try {
  const response = await new TopicCreateTransaction().setTopicMemo("Hillcash purchase decision digests").execute(client);
  const receipt = await response.getReceipt(client);
  console.log(JSON.stringify({ topicId: receipt.topicId.toString(), transactionId: response.transactionId.toString() }));
} finally { client.close(); }
