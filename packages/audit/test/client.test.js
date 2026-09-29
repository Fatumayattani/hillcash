import test from "node:test";
import assert from "node:assert/strict";
import { Wallet } from "ethers";
import { hcsClient } from "../src/client.js";

test("HCS operator uses the ECDSA key matching the EVM wallet", () => {
  const oldId = process.env.HEDERA_OPERATOR_ID;
  const oldKey = process.env.HEDERA_OPERATOR_KEY;
  const oldWallet = process.env.HEDERA_PRIVATE_KEY;
  const wallet = Wallet.createRandom();

  process.env.HEDERA_OPERATOR_ID = "0.0.123456";
  delete process.env.HEDERA_OPERATOR_KEY;
  process.env.HEDERA_PRIVATE_KEY = wallet.privateKey;

  let client;
  try {
    client = hcsClient();
    assert.equal(
      client.operatorPublicKey.toEvmAddress(),
      wallet.address.slice(2).toLowerCase()
    );
  } finally {
    client?.close();
    if (oldId === undefined) delete process.env.HEDERA_OPERATOR_ID;
    else process.env.HEDERA_OPERATOR_ID = oldId;
    if (oldKey === undefined) delete process.env.HEDERA_OPERATOR_KEY;
    else process.env.HEDERA_OPERATOR_KEY = oldKey;
    if (oldWallet === undefined) delete process.env.HEDERA_PRIVATE_KEY;
    else process.env.HEDERA_PRIVATE_KEY = oldWallet;
  }
});
