import { BrowserProvider, Contract } from "ethers";

export const address = process.env.NEXT_PUBLIC_HILLCASH_CONTRACT;
export const abi = [
  "function createOffer(bytes32 serviceId,uint256 unitUsdCents,uint32 minimum,uint64 joinDeadline,uint64 deliveryDeadline) returns (uint256)",
  "function join(uint256 id,uint256 maxUsdCents,uint16 maxMovementBps) payable",
  "function activate(uint256 id)",
  "function quoteWei(uint256 usdCents) view returns (uint256)",
  "function marketPriceE18() view returns (uint256 price,uint256 timeMs)",
  "function offers(uint256 id) view returns (address provider,bytes32 serviceId,uint64 joinDeadline,uint64 deliveryDeadline,uint32 minimum,uint32 members,uint256 unitUsdCents,uint8 state)",
  "function orders(uint256 id,address buyer) view returns (uint256 deposited,uint256 due,bool delivered,bool resolved,bool accepted,bytes32 entitlementHash,uint256 joinPriceE18,uint16 maxMovementBps)",
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
  let chainId = await provider.send("eth_chainId", []);
  if (BigInt(chainId) !== 296n) {
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x128" }]
      });
    } catch (error) {
      const code = (error as { code?: number })?.code;
      if (code === 4902)
        throw new Error("Add Hedera Testnet (296) to this wallet, then try again.");
      if (code === 4001)
        throw new Error("Network switch was declined; select Hedera Testnet (296) to inspect your order.");
      throw error;
    }
    chainId = await provider.send("eth_chainId", []);
    if (BigInt(chainId) !== 296n)
      throw new Error(`Wallet still reports chain ${BigInt(chainId).toString()} (${chainId}) after the switch; Hedera Testnet is 296 (0x128).`);
  }
  const signer = await provider.getSigner();
  return { contract: new Contract(address, abi, signer), signer };
}
