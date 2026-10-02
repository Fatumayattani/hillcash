"use client";

import { useMemo, useState } from "react";
import { id as hashId } from "ethers";
import { planPurchases } from "@hillcash/agent";
import Escrow from "../components/Escrow";
import { address, walletContract } from "../lib/contract";

type Request = { id: string; buyer: string; serviceId: string; units: number; maxUsdCents: number; soloUsdCents: number; expiresAt: number };
type Offer = { id: string; provider: string; serviceId: string; unitsPerBuyer: number; unitUsdCents: number; minimum: number; capacity: number; joinDeadline: number };
const exampleBuyers = [1, 2, 3].map(n => `0x${n.toString(16).padStart(40, "0")}`);
const exampleProvider = `0x${(100).toString(16).padStart(40, "0")}`;
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default function Home() {
  const [tab, setTab] = useState<"overview" | "sandbox" | "provider" | "escrow" | "evidence">("overview");
  const [requests, setRequests] = useState<Request[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [service, setService] = useState("compute:100-calls");
  const [cap, setCap] = useState("1.25");

  const [price, setPrice] = useState("1.00");


  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const now = Date.now();
  const result = useMemo(() => planPurchases(requests, offers, now), [requests, offers, now]);

  function seed() {
    const deadline = Date.now() + 3600_000;
    setRequests(exampleBuyers.map((buyer, i) => ({ id: `request-${i + 1}`, buyer, serviceId: "compute:100-calls",
      units: 100, maxUsdCents: 125, soloUsdCents: 160, expiresAt: deadline + 3600_000 })));
    setOffers([{ id: "sample-offer", provider: exampleProvider, serviceId: "compute:100-calls", unitsPerBuyer: 100,
      unitUsdCents: 100, minimum: 2, capacity: 10, joinDeadline: deadline }]);
    setNotice("Sample requests loaded. These are local examples, not real buyers or a live provider.");
  }
  function addRequest() {
    const cents = Math.round(Number(cap) * 100);
    if (!Number.isSafeInteger(cents) || cents < 1 || !service.trim()) return setNotice("Enter a service and a positive USD cap.");
    const index = requests.length + 4;
    setRequests([...requests, { id: `request-${index}`, buyer: `0x${index.toString(16).padStart(40, "0")}`,
      serviceId: service.trim(), units: 100, maxUsdCents: cents, soloUsdCents: Math.max(cents + 1, 160),
      expiresAt: Date.now() + 7200_000 }]);
    setNotice("Local request added. A deployed app must associate this with a verified wallet.");
  }
  function addOffer() {
    const cents = Math.round(Number(price) * 100);
    if (!Number.isSafeInteger(cents) || cents < 1 || !service.trim()) return setNotice("Enter a service and a positive USD price.");
    setOffers([...offers, { id: `offer-${offers.length + 1}`, provider: exampleProvider, serviceId: service.trim(),
      unitsPerBuyer: 100, unitUsdCents: cents, minimum: 2, capacity: 10, joinDeadline: Date.now() + 3600_000 }]);
    setNotice("Local offer added. Deploy a real offer with your wallet below.");
  }
  async function createOffer() {
    setBusy(true); setNotice("");
    try {
      if (!/^\d+(\.\d{1,2})?$/.test(price) || !service.trim())
        throw new Error("Enter a service and a USD price with at most two decimal places.");
      const cents = Math.round(Number(price) * 100);
      if (!Number.isSafeInteger(cents) || cents < 1 || cents > 100000000)
        throw new Error("Price is outside the supported range.");
      const { contract, signer } = await walletContract();
      const block = await signer.provider!.getBlock("latest");
      if (!block) throw new Error("Latest block unavailable.");
      const args = [
        hashId(service.trim()), cents, 2,
        block.timestamp + 3600, block.timestamp + 7200
      ];
      const options = { type: 0, gasPrice: 2000000000000n };
      await contract.createOffer.staticCall(...args, options);
      const tx = await contract.createOffer(...args, options);
      setNotice(`Submitted: ${tx.hash}. Waiting for confirmation…`);
      const receipt = await tx.wait();
      if (receipt?.status !== 1) throw new Error("Creation did not succeed.");
      const created = receipt.logs
        .filter((log: {address: string}) =>
          log.address.toLowerCase() === contract.target.toString().toLowerCase())
        .map((log: {topics: string[]; data: string}) => {
          try { return contract.interface.parseLog(log); } catch { return null; }
        })
        .find((event: {name: string} | null) => event?.name === "OfferCreated");
      setNotice(`Offer ${created?.args.offerId ?? ""} confirmed: ${tx.hash}. Inspect it in Escrow. Publish signed service terms with provider:terms before live agent planning.`);
    } catch (error) {
      const e = error as {shortMessage?: string; message?: string};
      setNotice(e.shortMessage || e.message || "Creation failed.");
    } finally { setBusy(false); }
  }

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="mark">H</span><span>hillcash<small>GROUP COMMERCE</small></span></div>
      <nav aria-label="Primary navigation">
        {(["overview", "sandbox", "escrow", "provider", "evidence"] as const).map(item => <button key={item} aria-current={tab === item ? "page" : undefined} className={tab === item ? "selected" : ""} onClick={() => setTab(item)}>{item === "overview" ? "◫" : item === "sandbox" ? "↗" : "▤"}<span>{item[0].toUpperCase() + item.slice(1)}</span></button>)}
      </nav>
      <div className="sidebar-bottom"><div className="dot" /> Hedera testnet<br /><span>Built for independent buyers.</span></div>
    </aside>
    <main>
      <header><span>WORKSPACE / {tab.toUpperCase()}</span><span className="network">TESTNET · CHAIN 296</span></header>
      {tab === "overview" && <section className="hero"><div><p className="eyebrow">A BETTER WAY TO BUY TOGETHER</p><h1>More buying power.<br /><em>On your terms.</em></h1><p>Hillcash finds compatible demand, compares group offers, and keeps every buyer in control of their own payment.</p><button className="primary" onClick={seed}>Load example marketplace <span>↗</span></button></div><div className="hero-art"><div className="orbit one"/><div className="orbit two"/><span className="center-icon">H</span><span className="orb a"/><span className="orb b"/><span className="orb c"/></div></section>}
      {(tab === "overview" || tab === "sandbox") && <><p className="mode-label">LOCAL SANDBOX · EXAMPLE ACCOUNTS · NO TRANSACTIONS</p><section className="metrics"><div><small>BUYER REQUESTS</small><strong>{requests.length.toString().padStart(2, "0")}</strong><span>Independent caps</span></div><div><small>PROVIDER OFFERS</small><strong>{offers.length.toString().padStart(2, "0")}</strong><span>Comparable terms</span></div><div><small>VIABLE GROUPS</small><strong>{result.proposals.length.toString().padStart(2, "0")}</strong><span>Approval required</span></div><div><small>POTENTIAL SAVINGS</small><strong>{money(result.proposals.reduce((n: number, p: { savedUsdCents: number }) => n + p.savedUsdCents, 0))}</strong><span>Versus stated solo prices</span></div></section>
      <section className="panel"><div className="panel-heading"><div><p className="eyebrow">AGENT ANALYSIS</p><h2>Group opportunities</h2></div><span className="pill">{result.proposals.length} matched</span></div>
        {result.proposals.length ? result.proposals.map((p: {offerId: string; buyerIds: string[]; unitUsdCents: number; savedUsdCents: number; explanation: string}) => <div className="opportunity" key={p.offerId}><div className="offer-icon">↗</div><div><strong>{p.offerId}</strong><p>{p.buyerIds.length} buyers · {p.explanation}</p></div><div className="offer-price"><strong>{money(p.unitUsdCents)}</strong><small>save {money(p.savedUsdCents)} total</small></div></div>) : <div className="empty"><div className="empty-symbol">◇</div><strong>No group ready yet</strong><p>Load the example marketplace or add requests and offers below to see the matching policy work.</p></div>}
      </section></>}
      {(tab === "sandbox" || tab === "provider") && <div className="columns">
        {tab === "sandbox" && <section className="panel compact"><p className="eyebrow">FOR BUYERS</p><h2>State your limit</h2><label>Digital service<input value={service} onChange={e => setService(e.target.value)} /></label><label>Maximum price · USD<input value={cap} onChange={e => setCap(e.target.value)} inputMode="decimal" /></label><button className="secondary" onClick={addRequest}>Add local request <span>＋</span></button><p className="footnote">The on-chain limit is measured from your join price to activation. If any buyer's limit is exceeded, activation waits; unactivated orders can be refunded after the join deadline. Local planning is illustrative.</p></section>}
        <section className="panel compact"><p className="eyebrow">{tab === "provider" ? "LIVE PROVIDER OFFER" : "LOCAL EXAMPLE OFFER"}</p><h2>Post a group price</h2><label>Price per buyer · USD<input value={price} onChange={e => setPrice(e.target.value)} inputMode="decimal" /></label>{tab === "sandbox" && <button className="secondary" onClick={addOffer}>Add local offer <span>＋</span></button>}<button className="text-button" disabled={busy || !address} onClick={createOffer}>Create offer on Hedera ↗</button><p className="footnote">Minimum 2 buyers; 1 hour join window; 2 hour delivery window. On-chain settlement uses Supra HBAR/USD.</p></section>

      </div>}
      {tab === "escrow" && <Escrow />}
      {tab === "sandbox" && <button className="text-button" onClick={seed}>Reset to example marketplace</button>}
      {tab === "evidence" && <section className="panel compact">
        <p className="eyebrow">RECORDED TESTNET VERIFICATION</p>
        <h2>Follow the purchase evidence</h2>
        <p>The README records completed testnet flows, including offer 4's signed selection, full-plan HCS commitment, individual settlements, and service redemptions.</p>
        <dl className="snapshot-details">
          <dt>Signed competing prices</dt><dd>$0.25 and $0.20 per buyer</dd>
          <dt>Selected offer</dt><dd>Offer 4 · 100 provider-declared units per buyer</dd>
          <dt>Comparison basis</dt><dd>Provider-signed $0.50 solo price; not an independent market quote</dd>
          <dt>HCS commitment</dt><dd>Topic 0.0.10776777 · sequence 3 · record version 2</dd>
          <dt>Service demonstration</dt><dd>Included sample computation provider</dd>
        </dl>
        <a href="https://github.com/Fatumayattani/hillcash#verified-signed-purchase-completion" target="_blank" rel="noreferrer">Open recorded transactions and verification ↗</a>
        <p className="footnote">This view presents historical documentation. Use Escrow for a current on-chain snapshot. The full plan remains private; HCS contains its digest.</p>
      </section>}
      {notice && <div className="notice" role="status">{notice}</div>}
      <footer>HILLCASH · INDIVIDUAL CONTROL, COLLECTIVE LEVERAGE <span>Prototype · Testnet HBAR has no monetary value</span></footer>
    </main>
  </div>;
}
