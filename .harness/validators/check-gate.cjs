const { existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const root = join(__dirname, "../..");
for (const file of ["template.json", "README.md", "AGENTS.md", "LICENSE", "packages/contracts/contracts/Hillcash.sol", "packages/web/app/page.tsx"]) {
  if (!existsSync(join(root, file))) throw new Error(`Missing ${file}`);
}
const manifest = JSON.parse(readFileSync(join(root, "template.json"), "utf8"));
if (manifest["create-scaffold-hbar"]?.defaults?.solidityFramework !== "hardhat") throw new Error("Invalid framework manifest");
console.log("Static eligibility files present. External scaffold and testnet proof still need independent verification.");
