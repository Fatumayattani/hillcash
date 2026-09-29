import { Client } from "@hiero-ledger/sdk";

export function hcsClient() {
  const id = process.env.HEDERA_OPERATOR_ID;
  const key = process.env.HEDERA_OPERATOR_KEY;
  if (!id || !key) throw new Error("Set HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY for a funded testnet account");
  return Client.forTestnet().setOperator(id, key);
}
