import { BrowserProvider, Contract } from "ethers";

export const address = process.env.NEXT_PUBLIC_HILLCASH_CONTRACT;
export const abi = [
  "function createOffer(bytes32 serviceId,uint256 unitUsdCents,uint32 minimum,uint64 joinDeadline,uint64 deliveryDeadline) returns (uint256)",
  "function join(uint256 id,uint256 maxUsdCents) payable",
  "function activate(uint256 id)",
  "function quoteWei(uint256 usdCents) view returns (uint256)",
  "function offers(uint256 id) view returns (address provider,bytes32 serviceId,uint64 joinDeadline,uint64 deliveryDeadline,uint32 minimum,uint32 members,uint256 unitUsdCents,uint8 state)",
  "function orders(uint256 id,address buyer) view returns (uint256 deposited,uint256 due,bool delivered,bool resolved,bool accepted,bytes32 entitlementHash)",
  "function commitDelivery(uint256 id,address buyer,bytes32 entitlementHash)",
  "function accept(uint256 id)", "function refund(uint256 id)", "function cancel(uint256 id)",
  "event OfferCreated(uint256 indexed offerId,address indexed provider,bytes32 indexed serviceId,uint256 unitUsdCents)"
];

declare global { interface Window { ethereum?: { request(args: { method: string; params?: unknown[] }): Promise<unknown> } } }

export async function walletContract() {
  if (!address) throw new Error("Configure NEXT_PUBLIC_HILLCASH_CONTRACT first.");
  if (!window.ethereum) throw new Error("Install or open an EVM wallet.");
  const provider = new BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  const network = await provider.getNetwork();
  if (network.chainId !== 296n) throw new Error("Switch your wallet to Hedera Testnet (chain 296).");
  const signer = await provider.getSigner();
  return { contract: new Contract(address, abi, signer), signer };
}
