import { createHash } from "node:crypto";
import { Interface, isAddress } from "ethers";

const activation = new Interface(["event Activated(uint256 indexed offerId,uint256 price,uint256 decimals)"]);
const hashPattern = /^0x[0-9a-fA-F]{64}$/;

/** Public record has a digest of the full decision, but never buyer identities or service secrets. */
export function buildRecord(proposal, transactionHash, contractAddress) {
  if (!proposal || !Number.isSafeInteger(proposal.offerId) || proposal.offerId < 1 ||
      !Array.isArray(proposal.buyerIds) || proposal.buyerIds.length < 2 || proposal.buyerIds.length > 32 ||
      proposal.buyerIds.some(x => typeof x !== "string" || !x) || new Set(proposal.buyerIds).size !== proposal.buyerIds.length ||
      !Number.isSafeInteger(proposal.unitUsdCents) || proposal.unitUsdCents < 1 ||
      !Number.isSafeInteger(proposal.savedUsdCents) || proposal.savedUsdCents < 0 ||
      !hashPattern.test(transactionHash) || !isAddress(contractAddress)) throw new TypeError("Invalid activation record");
  const canonical = JSON.stringify({ v: 1, offerId: proposal.offerId,
    buyerIds: [...proposal.buyerIds].sort(), unitUsdCents: proposal.unitUsdCents,
    savedUsdCents: proposal.savedUsdCents });
  const digest = `0x${createHash("sha256").update(canonical).digest("hex")}`;
  return { version: 1, kind: "hillcash.activation", offerId: proposal.offerId,
    contract: contractAddress.toLowerCase(), transactionHash: transactionHash.toLowerCase(), digest };
}

export function verifyActivationReceipt(receipt, record) {
  if (!receipt || receipt.status !== 1 || receipt.hash.toLowerCase() !== record.transactionHash ||
      receipt.to?.toLowerCase() !== record.contract) return false;
  return receipt.logs.some(log => {
    if (log.address.toLowerCase() !== record.contract) return false;
    try {
      const parsed = activation.parseLog(log);
      return parsed?.name === "Activated" && parsed.args.offerId === BigInt(record.offerId);
    } catch { return false; }
  });
}
