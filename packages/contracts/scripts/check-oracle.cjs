require("dotenv").config({ path: "../../.env" });
const { ethers } = require("ethers");

const address = process.env.SUPRA_HEDERA_TESTNET_HOLDER || "0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917";
const url = process.env.HEDERA_TESTNET_RPC_URL || "https://testnet.hashio.io/api";
const abi = ["function getSvalue(uint256) view returns ((uint256 round,uint256 decimals,uint256 time,uint256 price))"];

async function main() {
  const rpc = new ethers.JsonRpcProvider(url, 296, { staticNetwork: true });
  const code = await rpc.getCode(address);
  if (code === "0x") throw new Error(`No code at Supra holder ${address}`);
  const feed = await new ethers.Contract(address, abi, rpc).getSvalue(432);
  const timestampMs = Number(feed.time);
  const age = Math.floor(Date.now() / 1000) - Math.floor(timestampMs / 1000);
  const result = { address, pair: 432, round: feed.round.toString(), decimals: feed.decimals.toString(),
    price: feed.price.toString(), timestampMs: feed.time.toString(),
    timestampUtc: Number.isSafeInteger(timestampMs) && timestampMs <= 8_640_000_000_000_000
      ? new Date(timestampMs).toISOString() : null,
    ageSeconds: age, fresh: timestampMs >= 1_000_000_000_000 && age >= 0 && age <= 7200 };
  console.log(JSON.stringify(result, null, 2));
  if (feed.price === 0n || feed.decimals > 18n || !result.fresh) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
