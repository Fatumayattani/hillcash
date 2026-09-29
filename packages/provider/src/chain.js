import { Contract, JsonRpcProvider } from "ethers";

const abi = [
  "function offers(uint256) view returns (address provider,bytes32 serviceId,uint64 joinDeadline,uint64 deliveryDeadline,uint32 minimum,uint32 members,uint256 unitUsdCents,uint8 state)",
  "function orders(uint256,address) view returns (uint256 deposited,uint256 due,bool delivered,bool resolved,bool accepted,bytes32 entitlementHash)",
  "function commitDelivery(uint256,address,bytes32)"
];

export function chainContract(config) {
  if (!config.rpc || !config.contract) throw new Error("Configure HEDERA_TESTNET_RPC_URL and HILLCASH_CONTRACT");
  const provider = new JsonRpcProvider(config.rpc, 296, { staticNetwork: true });
  return new Contract(config.contract, abi, config.signer || provider);
}

export async function liveEntitlement(contract, { offerId, buyer, commitment }) {
  const [offer, order] = await Promise.all([contract.offers(offerId), contract.orders(offerId, buyer)]);
  // Access begins only after the buyer approves payment. A refunded token never grants access.
  return offer.state === 1n && order.delivered && order.resolved && order.accepted &&
    order.entitlementHash.toLowerCase() === commitment.toLowerCase();
}
