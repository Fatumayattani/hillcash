const { expect } = require("chai");
const { ethers } = require("hardhat");
const assert = require("node:assert/strict");

describe("Sample provider and escrow integration", function () {
  let contract, oracle, provider, alice, bob, now;
  let EntitlementLedger, liveEntitlement;
  before(async function () {
    ({ EntitlementLedger } = await import("../../provider/src/ledger.js"));
    ({ liveEntitlement } = await import("../../provider/src/chain.js"));
  });
  beforeEach(async function () {
    [provider, alice, bob] = await ethers.getSigners();
    now = (await ethers.provider.getBlock("latest")).timestamp;
    oracle = await (await ethers.getContractFactory("MockSupra")).deploy();
    await oracle.set(100000000n, 8, now * 1000);
    contract = await (await ethers.getContractFactory("Hillcash")).deploy(await oracle.getAddress());
    await contract.connect(provider).createOffer(ethers.id("compute:100-calls"), 100, 2, now + 3600, now + 7200);
    await contract.connect(alice).join(1, 125, 500, { value: ethers.parseEther("1.2") });
    await contract.connect(bob).join(1, 125, 500, { value: ethers.parseEther("1.2") });
    await contract.activate(1);
  });
  it("binds a unique token to one buyer and unlocks service only after acceptance", async function () {
    const ledger = new EntitlementLedger();
    const issued = ledger.issue({ offerId: 1, buyer: alice.address, units: 2, expiresAt: Date.now() + 86400000 });
    await contract.connect(provider).commitDelivery(1, alice.address, issued.commitment);
    const verify = input => liveEntitlement(contract, input);
    await assert.rejects(ledger.redeem({ offerId: 1, buyer: alice.address, token: issued.token, verify }));
    await contract.connect(alice).accept(1);
    const receipt = await ledger.redeem({ offerId: 1, buyer: alice.address, token: issued.token, verify });
    expect(receipt.remaining).to.equal(1);
    await assert.rejects(ledger.redeem({ offerId: 1, buyer: bob.address, token: issued.token, verify }));
  });
  it("revokes a committed entitlement when the buyer refunds after expiry", async function () {
    const ledger = new EntitlementLedger();
    const issued = ledger.issue({ offerId: 1, buyer: alice.address, units: 2, expiresAt: Date.now() + 86400000 });
    await contract.connect(provider).commitDelivery(1, alice.address, issued.commitment);
    await ethers.provider.send("evm_setNextBlockTimestamp", [now + 7201]);
    await ethers.provider.send("evm_mine", []);
    await contract.connect(alice).refund(1);
    expect(await liveEntitlement(contract, { offerId: 1, buyer: alice.address, commitment: issued.commitment })).to.equal(false);
  });
});
