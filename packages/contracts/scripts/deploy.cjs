const { ethers } = require("hardhat");

async function main() {
  const holder = process.env.SUPRA_HEDERA_TESTNET_HOLDER || "0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917";
  const factory = await ethers.getContractFactory("Hillcash");
  const contract = await factory.deploy(holder);
  await contract.waitForDeployment();
  console.log(JSON.stringify({ contract: await contract.getAddress(), transaction: contract.deploymentTransaction().hash,
    oracle: holder, chainId: (await ethers.provider.getNetwork()).chainId.toString() }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
