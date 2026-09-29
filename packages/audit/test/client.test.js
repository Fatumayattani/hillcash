import test from "node:test";
import assert from "node:assert/strict";
import { Wallet } from "ethers";
import { hcsClient } from "../src/client.js";

test("HCS operator uses the ECDSA key matching the EVM wallet", () => {
  const previous = {
    id: process.env.HEDERA_OPERATOR_ID,
    key: process.env.HEDERA_OPERATOR_KEY,
    wallet: process.env.HEDERA_PRIVATE_KEY
  };
  const wallet = Wallet.createRandom();
  process.env.HEDERA_OPERATOR_ID = "0.0.123456";
  delete process.env.HEDERA_OPERATOR_KEY;
  process.env.HEDERA_PRIVATE_KEY = wallet.privateKey;
  let client;
  try {
    client = hcsClient();
    assert.equal(client.operatorPublicKey.toEvmAddress(), wallet.address.slice(2).toLowerCase());
  } finally {
    client?.close();
    for (const [name, value] of [
      ["HEDERA_OPERATOR_ID", previous.id],
      ["HEDERA_OPERATOR_KEY", previous.key],
      ["HEDERA_PRIVATE_KEY", previous.wallet]
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
