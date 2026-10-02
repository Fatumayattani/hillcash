"use client";
import { useState } from "react";
import { Contract, JsonRpcProvider, formatEther, formatUnits, id } from "ethers";
import { abi, address, walletContract } from "../lib/contract";

type Snapshot = {
  offerId: string; block: number; time: number; buyer: string; provider: string;
  price: string; minimum: number; members: number; state: number;
  joinBy: number; deliverBy: number; decimals: number; deposit: bigint; due: bigint;
  delivered: boolean; resolved: boolean; accepted: boolean; commitment: string;
  quote?: bigint; oracleError: boolean;
};
const rpcUrl = process.env.NEXT_PUBLIC_HEDERA_TESTNET_RPC_URL || "https://testnet.hashio.io/api";
const explorer = "https://hashscan.io/testnet/";
function cents(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value))
    throw new Error("Use a positive amount with at most two decimal places.");
  const [whole, fraction = ""] = value.split(".");
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (amount < 1n || amount > 100000000n)
    throw new Error("Amount is outside the supported range.");
  return amount;
}

export default function Escrow() {
  const [offerId, setOfferId] = useState("4");
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [cap, setCap] = useState("0.50");
  const [movement, setMovement] = useState("3.00");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [transaction, setTransaction] = useState("");

  async function read(buyer = "") {
    if (!address)
      throw new Error("Set NEXT_PUBLIC_HILLCASH_CONTRACT and restart the frontend.");
    if (!/^[1-9]\d*$/.test(offerId))
      throw new Error("Enter a positive offer ID.");
    const rpc = new JsonRpcProvider(rpcUrl);
    try {
      if ((await rpc.getNetwork()).chainId !== 296n)
        throw new Error("Read endpoint must use Hedera testnet.");
      const block = await rpc.getBlock("latest");
      if (!block) throw new Error("Latest block unavailable.");
      const options = { blockTag: block.number };
      if (await rpc.getCode(address, block.number) === "0x")
        throw new Error("Configured contract has no deployed code.");
      const contract = new Contract(address, [
        ...abi, "function nativeDecimals() view returns (uint8)"
      ], rpc);
      const offer = await contract.offers(offerId, options);
      if (BigInt(offer.provider) === 0n)
        throw new Error("Offer does not exist.");
      const decimals = Number(await contract.nativeDecimals(options));
      if (decimals !== 8)
        throw new Error("This dashboard requires a Hedera native-unit deployment (8 decimals).");
      const order = buyer
        ? await contract.orders(offerId, buyer, options) : undefined;
      let quote: bigint | undefined;
      try {
        quote = BigInt(await contract.quoteWei(offer.unitUsdCents, options));
      } catch {}
      const next: Snapshot = {
        offerId, block: block.number, time: block.timestamp, buyer,
        provider: offer.provider, price: Number(formatUnits(offer.unitUsdCents, 2)).toFixed(2),
        minimum: Number(offer.minimum), members: Number(offer.members),
        state: Number(offer.state), joinBy: Number(offer.joinDeadline),
        deliverBy: Number(offer.deliveryDeadline), decimals,
        deposit: order?.deposited ?? 0n, due: order?.due ?? 0n,
        delivered: order?.delivered ?? false,
        resolved: order?.resolved ?? false,
        accepted: order?.accepted ?? false,
        commitment: order?.entitlementHash ?? "",
        quote, oracleError: quote === undefined
      };
      setSnapshot(next);
      return next;
    } finally { rpc.destroy(); }
  }

  async function inspect(connect: boolean) {
    setBusy(true); setMessage(""); setSnapshot(undefined); setToken("");
    try {
      const buyer = connect
        ? await (await walletContract()).signer.getAddress() : "";
      await read(buyer);
      setMessage(connect
        ? "Connected wallet order inspected."
        : "Read-only offer snapshot loaded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Inspection failed.");
    } finally { setBusy(false); }
  }

  async function act(kind: "join" | "activate" | "accept" | "refund") {
    setBusy(true); setMessage(""); setTransaction("");
    try {
      const { contract, signer } = await walletContract();
      const buyer = await signer.getAddress();
      const current = await read(buyer);
      const options: {
        type: number; gasPrice: bigint; value?: bigint
      } = { type: 0, gasPrice: 2000000000000n };
      let args: (string | bigint)[] = [current.offerId];
      if (kind === "join") {
        const maximum = cents(cap), bps = cents(movement);
        if (bps > 2000n)
          throw new Error("Movement limit must be 0.01% to 20%.");
        if (current.quote === undefined)
          throw new Error("Fresh oracle quote unavailable; joining is blocked.");
        options.value = current.quote + current.quote / 20n + 10000000000n;
        args = [current.offerId, maximum, bps];
      }
      if (kind === "accept") {
        if (!/^[0-9a-f]{64}$/.test(token) ||
            id(token) !== current.commitment)
          throw new Error("Private token does not match this wallet's delivery commitment.");
      }
      await contract[kind].staticCall(...args, options);
      const tx = await contract[kind](...args, options);
      setTransaction(tx.hash);
      setMessage("Submitted. Waiting for confirmation…");
      const receipt = await tx.wait();
      if (receipt?.status !== 1)
        throw new Error("Transaction did not succeed.");
      setToken("");
      setMessage("Transaction confirmed. Refreshing your order…");
      try {
        await read(buyer);
        setMessage("Confirmed. Order snapshot refreshed.");
      } catch {
        setMessage("Transaction confirmed; refresh the order to retrieve its new status.");
      }
    } catch (error) {
      const value = error as { shortMessage?: string; message?: string };
      setMessage(value.shortMessage || value.message || "Transaction failed.");
    } finally { setBusy(false); }
  }

  const open = snapshot?.state === 0 && snapshot.time < snapshot.joinBy;
  const active = snapshot?.state === 1 && snapshot.time < snapshot.deliverBy;
  const refundable = snapshot && snapshot.deposit > 0n && !snapshot.resolved &&
    (snapshot.state === 2 ||
      (snapshot.state === 0 && snapshot.time >= snapshot.joinBy) ||
      (snapshot.state === 1 && snapshot.time >= snapshot.deliverBy));
  const native = (value: bigint) =>
    `${formatUnits(value, snapshot?.decimals ?? 8)} HBAR`;

  return <section className="panel compact live-workspace">
    <div className="panel-heading">
      <div><p className="eyebrow">LIVE HEDERA ESCROW</p>
        <h2>Inspect before you authorize</h2></div>
      <span className="pill">Chain 296</span>
    </div>
    <p className="footnote">
      Read any offer without a wallet. Connect to inspect your own order.
      Every payment requires your wallet approval.
    </p>
    <div className="inspect-controls">
      <label>On-chain offer ID
        <input value={offerId} disabled={busy} inputMode="numeric"
          onChange={e => {
            setOfferId(e.target.value); setSnapshot(undefined); setToken("");
          }} />
      </label>
      <button className="secondary" disabled={busy || !address}
        onClick={() => inspect(false)}>Inspect offer</button>
      <button className="secondary" disabled={busy || !address}
        onClick={() => inspect(true)}>Connect & inspect my order</button>
    </div>
    {!address && <p className="footnote">
      Contract not configured. Set NEXT_PUBLIC_HILLCASH_CONTRACT
      in your frontend environment.
    </p>}
    {snapshot && <>
      <div className="metrics">
        <div><small>GROUP PRICE / BUYER</small>
          <strong>${snapshot.price}</strong>
          <span>Provider's on-chain price</span></div>
        <div><small>GROUP MEMBERS</small>
          <strong>{snapshot.members} / {snapshot.minimum}</strong>
          <span>Joined / minimum required</span></div>
        <div><small>OFFER STATUS</small>
          <strong>{["Open", "Active", "Cancelled"][snapshot.state]}</strong>
          <span>At block {snapshot.block}</span></div>
        <div><small>LIVE QUOTE / BUYER</small>
          <strong>{snapshot.quote === undefined
            ? "Unavailable" : formatEther(snapshot.quote)}</strong>
          <span>HBAR · excluding deposit buffer and gas</span></div>
      </div>
      <dl className="snapshot-details">
        <dt>Join deadline</dt>
        <dd>{new Date(snapshot.joinBy * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</dd>
        <dt>Delivery deadline</dt>
        <dd>{new Date(snapshot.deliverBy * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</dd>
        <dt>Provider</dt><dd>{snapshot.provider}</dd>
        <dt>Inspected wallet</dt>
        <dd>{snapshot.buyer || "Connect to inspect an individual order"}</dd>
        {snapshot.buyer && <>
          <dt>Your deposit</dt><dd>{native(snapshot.deposit)}</dd>
          <dt>Your locked payment</dt><dd>{native(snapshot.due)}</dd>
          <dt>Your order</dt>
          <dd>{snapshot.accepted ? "Accepted and settled"
            : snapshot.resolved ? "Refunded"
            : snapshot.delivered ? "Delivery committed; awaiting acceptance"
            : snapshot.deposit > 0n ? "Deposit held; awaiting delivery"
            : "Not joined"}</dd>
        </>}
      </dl>
      {snapshot.oracleError && <p className="warning">
        Fresh Supra quote unavailable. Join and activation remain blocked;
        eligible acceptance and refunds do not require a new quote.
      </p>}
      {open && snapshot.buyer && snapshot.deposit === 0n && <div className="columns escrow-fields">
      <label>Maximum price · USD<input disabled={busy} value={cap} inputMode="decimal" onChange={e => setCap(e.target.value)} /></label>
      <label>Maximum market movement · %<input disabled={busy} value={movement} inputMode="decimal" onChange={e => setMovement(e.target.value)} /></label>
    </div>}
    {active && snapshot.buyer && snapshot.delivered && !snapshot.resolved &&
      <div className="columns escrow-fields"><label>Private entitlement token<input disabled={busy} type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} /></label></div>}
    {(open || (active && snapshot.buyer && snapshot.delivered && !snapshot.resolved) || refundable) && <div className="action-grid">
      {open && snapshot.buyer && snapshot.deposit === 0n && <button disabled={busy || snapshot.oracleError || snapshot.buyer.toLowerCase() === snapshot.provider.toLowerCase()} onClick={() => act("join")}>Join with my wallet</button>}
      {open && snapshot.members >= snapshot.minimum && <button disabled={busy || snapshot.oracleError} onClick={() => act("activate")}>Activate group</button>}
      {active && snapshot.buyer && snapshot.delivered && !snapshot.resolved && <button disabled={busy || !token} onClick={() => act("accept")}>Accept & release payment</button>}
      {refundable && <button disabled={busy} onClick={() => act("refund")}>Claim my refund</button>}
    </div>}
    <p className="footnote">Join deposits add a 5% buffer, returned at settlement if unused. A token match confirms the commitment; inspect the actual service before releasing payment. Deadlines use your local timezone. This is a block snapshot; each action rereads the connected wallet's order and simulates the transaction.</p></>}
    {message && <p className="inline-status" role="status">{message}</p>}
    {transaction && <a href={`${explorer}transaction/${transaction}`}
      target="_blank" rel="noreferrer">View transaction on Hashscan ↗</a>}
  </section>;
}
