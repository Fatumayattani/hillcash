const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Hillcash escrow", function () {
  let contract, oracle, provider, alice, bob, stranger;
  let now;
  const serviceId = ethers.id("independent-provider:1000-calls");

  async function offer(minimum = 2) {
    await contract.connect(provider).createOffer(serviceId, 100, minimum, now + 3600, now + 7200);
    return await contract.nextOfferId();
  }
  async function join(id, signer, deposit = ethers.parseEther("2"), cap = 100, movementBps = 500) {
    return contract.connect(signer).join(id, cap, movementBps, { value: deposit });
  }
  async function clock(to) {
    await ethers.provider.send("evm_setNextBlockTimestamp", [to]);
    await ethers.provider.send("evm_mine", []);
  }

  beforeEach(async function () {
    [provider, alice, bob, stranger] = await ethers.getSigners();
    now = (await ethers.provider.getBlock("latest")).timestamp;
    oracle = await (await ethers.getContractFactory("MockSupra")).deploy();
    await oracle.set(100000000n, 8, now * 1000); // $1 per HBAR; Supra time is milliseconds
    contract = await (await ethers.getContractFactory("Hillcash")).deploy(await oracle.getAddress());
  });

  it("requires a deployed oracle", async function () {
    await expect((await ethers.getContractFactory("Hillcash")).deploy(ethers.ZeroAddress)).to.be.reverted;
  });
  it("rejects malformed offers", async function () {
    await expect(contract.createOffer(ethers.ZeroHash, 100, 2, now + 100, now + 200)).to.be.reverted;
    await expect(contract.createOffer(serviceId, 0, 2, now + 100, now + 200)).to.be.reverted;
    await expect(contract.createOffer(serviceId, 100, 1, now + 100, now + 200)).to.be.reverted;
    await expect(contract.createOffer(serviceId, 100, 33, now + 100, now + 200)).to.be.reverted;
  });
  it("rounds conversion up and checks price freshness", async function () {
    expect(await contract.quoteWei(101)).to.equal(ethers.parseEther("1.01"));
    await oracle.set(300000000n, 8, now * 1000);
    expect(await contract.quoteWei(100)).to.equal(333333333333333334n);
    await clock(now + 7201);
    await expect(contract.quoteWei(100)).to.be.reverted;
  });
  it("rejects zero, future and absurdly scaled feeds", async function () {
    await oracle.set(0, 8, now * 1000);
    await expect(contract.quoteWei(100)).to.be.reverted;
    await oracle.set(100, 19, now * 1000);
    await expect(contract.quoteWei(100)).to.be.reverted;
    await oracle.set(100, 8, (now + 100) * 1000);
    await expect(contract.quoteWei(100)).to.be.reverted;
    await oracle.set(100, 8, now);
    await expect(contract.quoteWei(100)).to.be.reverted; // seconds-format feed
  });
  it("quotes the live Hedera feed format: 18 decimals and millisecond time", async function () {
    await oracle.set(118190000000000000n, 18, now * 1000);
    const due = await contract.quoteWei(100); // $1 at $0.11819 per HBAR
    expect(due).to.equal(8460952703274388697n);
    expect(due).to.be.greaterThan(ethers.parseEther("8"));
  });
  it("requires a USD cap and a sufficient deposit", async function () {
    const id = await offer();
    await expect(join(id, alice, ethers.parseEther("2"), 99)).to.be.reverted;
    await expect(join(id, alice, ethers.parseEther("0.99"))).to.be.reverted;
    await join(id, alice);
    await expect(join(id, alice)).to.be.reverted;
    await expect(join(id, provider)).to.be.reverted;
  });
  it("requires a bounded nonzero market movement limit and records the join snapshot", async function () {
    const id = await offer();
    await expect(join(id, alice, ethers.parseEther("2"), 100, 0)).to.be.revertedWithCustomError(contract, "InvalidOffer");
    await expect(join(id, alice, ethers.parseEther("2"), 100, 2001)).to.be.revertedWithCustomError(contract, "InvalidOffer");
    await join(id, alice, ethers.parseEther("2"), 100, 300);
    const order = await contract.orders(id, alice.address);
    expect(order.joinPriceE18).to.equal(ethers.parseEther("1"));
    expect(order.maxMovementBps).to.equal(300);
    expect((await contract.marketPriceE18())[0]).to.equal(order.joinPriceE18);
  });
  it("blocks activation when a buyer's movement limit is exceeded, even if deposits cover the price", async function () {
    const id = await offer();
    await join(id, alice, ethers.parseEther("2"), 100, 100); // 1%
    await join(id, bob, ethers.parseEther("2"), 100, 500); // 5%
    await oracle.set(98000000n, 8, now * 1000); // $0.98; due stays below $2
    await expect(contract.activate(id)).to.be.revertedWithCustomError(contract, "MarketMoved");
    expect((await contract.offers(id)).state).to.equal(0);
    await oracle.set(99000000n, 8, now * 1000); // exactly 1% is accepted
    await contract.activate(id);
    expect((await contract.orders(id, alice.address)).due).to.equal(1010101010101010102n);
  });
  it("measures both price directions from each buyer's own join snapshot", async function () {
    const id = await offer();
    await join(id, alice, ethers.parseEther("2"), 100, 100);
    await oracle.set(102000000n, 8, now * 1000);
    await join(id, bob, ethers.parseEther("2"), 100, 500);
    await expect(contract.activate(id)).to.be.revertedWithCustomError(contract, "MarketMoved");
    await oracle.set(101000000n, 8, now * 1000);
    await contract.activate(id); // Alice +1%, Bob -0.98%
  });
  it("fails closed on a stale or malformed rate at join and activation", async function () {
    const id = await offer();
    await oracle.set(100000000n, 8, now);
    await expect(join(id, alice)).to.be.revertedWithCustomError(contract, "InvalidPrice");
    await oracle.set(100000000n, 8, now * 1000);
    await join(id, alice); await join(id, bob);
    await oracle.set(100000000n, 8, (now + 100) * 1000);
    await expect(contract.activate(id)).to.be.revertedWithCustomError(contract, "InvalidPrice");
  });
  it("activates only with minimum buyers", async function () {
    const id = await offer();
    await join(id, alice);
    await expect(contract.activate(id)).to.be.reverted;
    await join(id, bob);
    await contract.activate(id);
    expect((await contract.orders(id, alice.address)).due).to.equal(ethers.parseEther("1"));
    await expect(join(id, stranger)).to.be.reverted;
  });
  it("fails closed if the rate rises after deposit", async function () {
    const id = await offer();
    await join(id, alice, ethers.parseEther("1"));
    await join(id, bob, ethers.parseEther("1"));
    await oracle.set(50000000n, 8, now * 1000);
    await expect(contract.activate(id)).to.be.reverted;
  });
  it("rejects provider impersonation and duplicate delivery", async function () {
    const id = await offer();
    await join(id, alice); await join(id, bob); await contract.activate(id);
    await expect(contract.connect(stranger).commitDelivery(id, alice.address, ethers.id("token"))).to.be.reverted;
    await expect(contract.connect(provider).commitDelivery(id, alice.address, ethers.ZeroHash)).to.be.reverted;
    await contract.connect(provider).commitDelivery(id, alice.address, ethers.id("token"));
    await expect(contract.connect(provider).commitDelivery(id, alice.address, ethers.id("again"))).to.be.reverted;
  });
  it("pays only for accepted delivery and returns overpayment", async function () {
    const id = await offer();
    await join(id, alice); await join(id, bob); await contract.activate(id);
    await expect(contract.connect(alice).accept(id)).to.be.reverted;
    await contract.connect(provider).commitDelivery(id, alice.address, ethers.id("alice-token"));
    const before = await ethers.provider.getBalance(provider.address);
    await contract.connect(alice).accept(id);
    expect((await contract.orders(id, alice.address)).accepted).to.equal(true);
    expect(await ethers.provider.getBalance(provider.address) - before).to.equal(ethers.parseEther("1"));
    expect(await ethers.provider.getBalance(await contract.getAddress())).to.equal(ethers.parseEther("2"));
    await expect(contract.connect(alice).accept(id)).to.be.reverted;
  });
  it("refunds an expired open offer", async function () {
    const id = await offer(); await join(id, alice);
    await expect(contract.connect(alice).refund(id)).to.be.reverted;
    await clock(now + 3601);
    await contract.connect(alice).refund(id);
    expect(await ethers.provider.getBalance(await contract.getAddress())).to.equal(0n);
    await expect(contract.connect(alice).refund(id)).to.be.reverted;
  });
  it("refunds unaccepted delivery after the deadline", async function () {
    const id = await offer(); await join(id, alice); await join(id, bob); await contract.activate(id);
    await contract.connect(provider).commitDelivery(id, alice.address, ethers.id("proof"));
    await clock(now + 7201);
    await expect(contract.connect(alice).accept(id)).to.be.reverted;
    await contract.connect(alice).refund(id); await contract.connect(bob).refund(id);
    expect((await contract.orders(id, alice.address)).accepted).to.equal(false);
    expect(await ethers.provider.getBalance(await contract.getAddress())).to.equal(0n);
  });
  it("lets the provider cancel only before activation", async function () {
    const id = await offer(); await join(id, alice);
    await expect(contract.connect(alice).cancel(id)).to.be.reverted;
    await contract.connect(provider).cancel(id);
    await contract.connect(alice).refund(id);
    await expect(join(id, bob)).to.be.reverted;
  });
});
