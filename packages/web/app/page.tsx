"use client";

import { useMemo, useState } from "react";
import { id as hashId } from "ethers";
import { planPurchases } from "@hillcash/agent";
import { address, walletContract } from "../lib/contract";

type Request = { id: string; buyer: string; serviceId: string; units: number; maxUsdCents: number; soloUsdCents: number; expiresAt: number };
type Offer = { id: string; provider: string; serviceId: string; unitsPerBuyer: number; unitUsdCents: number; minimum: number; capacity: number; joinDeadline: number };
const exampleBuyers = [1, 2, 3].map(n => `0x${n.toString(16).padStart(40, "0")}`);
const exampleProvider = `0x${(100).toString(16).padStart(40, "0")}`;
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default function Home() {
  const [tab, setTab] = useState<"overview" | "buyer" | "provider">("overview");
  const [requests, setRequests] = useState<Request[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [service, setService] = useState("compute:100-calls");
  const [cap, setCap] = useState("1.25");
  const [price, setPrice] = useState("1.00");
  const [chainOfferId, setChainOfferId] = useState("");
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
  async function chainAction(kind: "create" | "join" | "activate" | "accept" | "refund") {
    setBusy(true); setNotice("");
    try {
      const { contract } = await walletContract();
      const offerId = kind === "create" ? 0n : BigInt(chainOfferId);
      let tx;
      if (kind === "create") {
        const cents = Math.round(Number(price) * 100);
        if (!Number.isSafeInteger(cents) || cents < 1 || !service.trim()) throw new Error("Enter a valid service and price.");
        const seconds = Math.floor(Date.now() / 1000);
        tx = await contract.createOffer(hashId(service.trim()), cents, 2, seconds + 3600, seconds + 7200);
      } else {
        if (offerId < 1n) throw new Error("Enter a valid on-chain offer ID.");
        if (kind === "join") {
          const cents = Math.round(Number(cap) * 100);
          const offer = await contract.offers(offerId);
          if (BigInt(cents) < offer.unitUsdCents) throw new Error("Your USD cap is below this offer.");
          const due = await contract.quoteWei(offer.unitUsdCents);
          // Quote immediately before signing; the contract checks the price again.
          tx = await contract.join(offerId, cents, { value: due + due / 20n + 1n });
        } else tx = await contract[kind](offerId);
      }
      setNotice(`Transaction submitted: ${tx.hash}. Waiting for confirmation…`);
      const receipt = await tx.wait();
      setNotice(`Confirmed: ${receipt.hash}. View it on Hashscan Testnet.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Transaction failed."); }
    finally { setBusy(false); }
  }

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="mark">H</span><span>hillcash<small>GROUP COMMERCE</small></span></div>
      <nav aria-label="Primary navigation">
        {(["overview", "buyer", "provider"] as const).map(item => <button key={item} className={tab === item ? "selected" : ""} onClick={() => setTab(item)}>{item === "overview" ? "◫" : item === "buyer" ? "↗" : "▤"}<span>{item[0].toUpperCase() + item.slice(1)}</span></button>)}
      </nav>
      <div className="sidebar-bottom"><div className="dot" /> Hedera testnet<br /><span>Built for independent buyers.</span></div>
    </aside>
    <main>
      <header><span>WORKSPACE / {tab.toUpperCase()}</span><span className="network">TESTNET · CHAIN 296</span></header>
      <section className="hero"><div><p className="eyebrow">A BETTER WAY TO BUY TOGETHER</p><h1>More buying power.<br /><em>On your terms.</em></h1><p>Hillcash finds compatible demand, compares group offers, and keeps every buyer in control of their own payment.</p><button className="primary" onClick={seed}>Load example marketplace <span>↗</span></button></div><div className="hero-art"><div className="orbit one"/><div className="orbit two"/><span className="center-icon">H</span><span className="orb a"/><span className="orb b"/><span className="orb c"/></div></section>
      <section className="metrics"><div><small>BUYER REQUESTS</small><strong>{requests.length.toString().padStart(2, "0")}</strong><span>Independent caps</span></div><div><small>PROVIDER OFFERS</small><strong>{offers.length.toString().padStart(2, "0")}</strong><span>Comparable terms</span></div><div><small>VIABLE GROUPS</small><strong>{result.proposals.length.toString().padStart(2, "0")}</strong><span>Approval required</span></div><div><small>POTENTIAL SAVINGS</small><strong>{money(result.proposals.reduce((n: number, p: { savedUsdCents: number }) => n + p.savedUsdCents, 0))}</strong><span>Versus stated solo prices</span></div></section>
      {tab !== "provider" && <section className="panel"><div className="panel-heading"><div><p className="eyebrow">AGENT ANALYSIS</p><h2>Group opportunities</h2></div><span className="pill">{result.proposals.length} matched</span></div>
        {result.proposals.length ? result.proposals.map((p: {offerId: string; buyerIds: string[]; unitUsdCents: number; savedUsdCents: number; explanation: string}) => <div className="opportunity" key={p.offerId}><div className="offer-icon">↗</div><div><strong>{p.offerId}</strong><p>{p.buyerIds.length} buyers · {p.explanation}</p></div><div className="offer-price"><strong>{money(p.unitUsdCents)}</strong><small>save {money(p.savedUsdCents)} total</small></div></div>) : <div className="empty"><div className="empty-symbol">◇</div><strong>No group ready yet</strong><p>Load the example marketplace or add requests and offers below to see the matching policy work.</p></div>}
      </section>}
      <div className="columns">
        {tab !== "provider" && <section className="panel compact"><p className="eyebrow">FOR BUYERS</p><h2>State your limit</h2><label>Digital service<input value={service} onChange={e => setService(e.target.value)} /></label><label>Maximum price · USD<input value={cap} onChange={e => setCap(e.target.value)} inputMode="decimal" /></label><button className="secondary" onClick={addRequest}>Add local request <span>＋</span></button><p className="footnote">Local planning is illustrative. Joining a real offer requires your wallet approval.</p></section>}
        <section className="panel compact"><p className="eyebrow">FOR PROVIDERS</p><h2>Post a group price</h2><label>Price per buyer · USD<input value={price} onChange={e => setPrice(e.target.value)} inputMode="decimal" /></label><button className="secondary" onClick={addOffer}>Add local offer <span>＋</span></button><button className="text-button" disabled={busy || !address} onClick={() => chainAction("create")}>Create offer on Hedera ↗</button><p className="footnote">Minimum 2 buyers; 1 hour join window; 2 hour delivery window. On-chain settlement uses Supra HBAR/USD.</p></section>
        <section className="panel compact"><p className="eyebrow">TESTNET CONTRACT</p><h2>Buyer-controlled escrow</h2><label>On-chain offer ID<input value={chainOfferId} onChange={e => setChainOfferId(e.target.value)} inputMode="numeric" placeholder="e.g. 1" /></label><div className="action-grid">{(["join", "activate", "accept", "refund"] as const).map(kind => <button key={kind} disabled={busy || !address} onClick={() => chainAction(kind)}>{kind}</button>)}</div><p className="footnote">{address ? `Contract ${address.slice(0, 8)}…${address.slice(-6)}` : "Set NEXT_PUBLIC_HILLCASH_CONTRACT to enable transactions."}</p></section>
      </div>
      {notice && <div className="notice" role="status">{notice}</div>}
      <footer>HILLCASH · INDIVIDUAL CONTROL, COLLECTIVE LEVERAGE <span>Prototype · Testnet HBAR has no monetary value</span></footer>
    </main>
  </div>;
}
