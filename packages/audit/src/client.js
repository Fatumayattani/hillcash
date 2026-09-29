import { Client, PrivateKey } from "@hiero-ledger/sdk";

export function hcsClient() {
  const id = process.env.HEDERA_OPERATOR_ID;
  const key = process.env.HEDERA_OPERATOR_KEY || process.env.HEDERA_PRIVATE_KEY;

  if (!id || !key) {
    throw new Error(
      "Set HEDERA_OPERATOR_ID and an ECDSA HEDERA_OPERATOR_KEY or HEDERA_PRIVATE_KEY for a funded testnet account"
    );
  }

  return Client.forTestnet().setOperator(id, PrivateKey.fromStringECDSA(key));
}
