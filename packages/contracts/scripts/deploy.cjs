const { ethers } = require("hardhat");

async function main() {
  const holder = process.env.SUPRA_HEDERA_TESTNET_HOLDER || "0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917";
  const factory = await ethers.getContractFactory("Hillcash");
  // Live Hedera testnet EVM execution was measured to expose msg.value in tinybars.
  const contract = await factory.deploy(holder, 8);
  await contract.waitForDeployment();
  console.log(JSON.stringify({ contract: await contract.getAddress(), transaction: contract.deploymentTransaction().hash,
    oracle: holder, nativeDecimals: (await contract.nativeDecimals()).toString(),
    chainId: (await ethers.provider.getNetwork()).chainId.toString() }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
