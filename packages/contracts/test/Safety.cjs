const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('Escrow lifecycle and adversarial payment safety', function () {
  let c, oracle, provider, alice, bob, stranger, now;
  const service = ethers.id('safety:service');
  const proof = ethers.id('private-token');
  const eth = n => ethers.parseEther(String(n));
  const gas = { gasLimit: 800000n };

  beforeEach(async function () {
    [provider, alice, bob, stranger] = await ethers.getSigners();
    now = (await ethers.provider.getBlock('latest')).timestamp;
    oracle = await (await ethers.getContractFactory('MockSupra')).deploy();
    await oracle.set(100000000n, 8, now * 1000);
    c = await (await ethers.getContractFactory('Hillcash')).deploy(
      await oracle.getAddress(), 18
    );
  });

  async function offer(min = 2, end = 3600, delivery = 7200) {
    await c.createOffer(service, 100, min, now + end, now + delivery);
    return await c.nextOfferId();
  }
  const join = (i, s = alice, amount = eth(2), cap = 100, bps = 500) =>
    c.connect(s).join(i, cap, bps, { ...gas, value: amount });
  async function active() {
    const i = await offer();
    await join(i); await join(i, bob); await c.activate(i);
    return i;
  }
  const next = t => ethers.provider.send('evm_setNextBlockTimestamp', [t]);
  async function clock(t) {
    await next(t); await ethers.provider.send('evm_mine', []);
  }
  const order = (i, s = alice) => c.orders(i, s.address);
  const balance = () => ethers.provider.getBalance(c.getAddress());
  const actor = async () =>
    (await ethers.getContractFactory('PaymentActor')).deploy(await c.getAddress());

  it('rejects a join at the exact join deadline', async () => {
    const i = await offer(); await next(now + 3600);
    await expect(join(i)).to.be.revertedWithCustomError(c, 'InvalidState');
    expect((await c.offers(i)).members).to.equal(0);
  });

  it('rejects activation at the exact join deadline', async () => {
    const i = await offer(); await join(i); await join(i, bob);
    await next(now + 3600);
    await expect(c.activate(i, gas)).to.be.revertedWithCustomError(c, 'InvalidState');
    expect((await order(i)).due).to.equal(0);
  });

  it('allows an open-offer refund at the exact join deadline', async () => {
    const i = await offer(); await join(i); await next(now + 3600);
    await c.connect(alice).refund(i, gas);
    expect((await order(i)).resolved).to.equal(true);
    expect(await balance()).to.equal(0);
  });

  it('rejects acceptance at the exact delivery deadline', async () => {
    const i = await active(); await c.commitDelivery(i, alice.address, proof);
    await next(now + 7200);
    await expect(c.connect(alice).accept(i, gas))
      .to.be.revertedWithCustomError(c, 'InvalidState');
    expect((await order(i)).accepted).to.equal(false);
  });

  it('rejects delivery commitment at the exact delivery deadline', async () => {
    const i = await active(); await next(now + 7200);
    await expect(c.commitDelivery(i, alice.address, proof, gas))
      .to.be.revertedWithCustomError(c, 'InvalidState');
    expect((await order(i)).delivered).to.equal(false);
  });

  it('allows an active-order refund at the exact delivery deadline', async () => {
    const i = await active(); await next(now + 7200);
    await c.connect(alice).refund(i, gas);
    expect((await order(i)).resolved).to.equal(true);
    expect(await balance()).to.equal(eth(2));
  });

  it('allows joining one second before the join deadline', async () => {
    const i = await offer(); await next(now + 3599); await join(i);
    expect((await c.offers(i)).members).to.equal(1);
  });

  it('allows acceptance one second before the delivery deadline', async () => {
    const i = await active(); await c.commitDelivery(i, alice.address, proof);
    await next(now + 7199); await c.connect(alice).accept(i, gas);
    expect((await order(i)).accepted).to.equal(true);
  });

  it('accepts an oracle timestamp exactly at the maximum age', async () => {
    await clock(now + 7200);
    expect(await c.quoteWei(100)).to.equal(eth(1));
  });

  it('stale activation leaves every due and the escrow state unchanged', async () => {
    const i = await offer(2, 20000, 30000);
    await join(i); await join(i, bob); await clock(now + 7201);
    await expect(c.activate(i)).to.be.revertedWithCustomError(c, 'InvalidPrice');
    expect((await order(i)).due).to.equal(0);
    expect((await order(i, bob)).due).to.equal(0);
    expect((await c.offers(i)).state).to.equal(0);
    expect(await balance()).to.equal(eth(4));
  });

  it('rejects a delivery deadline equal to the join deadline', async () => {
    await expect(offer(2, 3600, 3600))
      .to.be.revertedWithCustomError(c, 'InvalidOffer');
    expect(await c.nextOfferId()).to.equal(0);
  });

  it('failed offer creation does not consume an offer ID', async () => {
    await offer(); await expect(offer(1)).to.be.reverted; await offer();
    expect(await c.nextOfferId()).to.equal(2);
  });

  it('repeated activation cannot reset locked dues', async () => {
    const i = await active(); const due = (await order(i)).due;
    await expect(c.activate(i)).to.be.revertedWithCustomError(c, 'InvalidState');
    expect((await order(i)).due).to.equal(due);
    expect(await balance()).to.equal(eth(4));
  });

  it('provider cannot cancel an activated group', async () => {
    const i = await active();
    await expect(c.cancel(i)).to.be.revertedWithCustomError(c, 'InvalidState');
    expect((await c.offers(i)).state).to.equal(1);
  });

  it('an outsider cannot cancel an open group', async () => {
    const i = await offer(); await join(i);
    await expect(c.connect(stranger).cancel(i))
      .to.be.revertedWithCustomError(c, 'Unauthorized');
    expect((await c.offers(i)).state).to.equal(0);
  });

  it('cancelled groups cannot activate or consume deposits', async () => {
    const i = await offer(); await join(i); await join(i, bob); await c.cancel(i);
    await expect(c.activate(i)).to.be.reverted;
    expect(await balance()).to.equal(eth(4));
  });

  it('cancelled groups cannot gain new members', async () => {
    const i = await offer(); await join(i); await c.cancel(i);
    await expect(join(i, bob)).to.be.reverted;
    expect((await c.offers(i)).members).to.equal(1);
    expect((await order(i, bob)).deposited).to.equal(0);
  });

  it('a nonmember cannot refund another buyer deposit', async () => {
    const i = await offer(); await join(i); await c.cancel(i);
    await expect(c.connect(stranger).refund(i)).to.be.reverted;
    expect(await balance()).to.equal(eth(2));
    expect((await order(i)).resolved).to.equal(false);
  });

  it('a refunded delivery cannot later be accepted', async () => {
    const i = await active(); await c.commitDelivery(i, alice.address, proof);
    await clock(now + 7200); await c.connect(alice).refund(i);
    await expect(c.connect(alice).accept(i)).to.be.reverted;
    expect((await order(i)).accepted).to.equal(false);
  });

  it('an accepted order cannot later be refunded', async () => {
    const i = await active(); await c.commitDelivery(i, alice.address, proof);
    await c.connect(alice).accept(i); await clock(now + 7200);
    await expect(c.connect(alice).refund(i)).to.be.reverted;
    expect(await balance()).to.equal(eth(2));
  });

  it('one buyer acceptance leaves the other buyer unresolved', async () => {
    const i = await active(); await c.commitDelivery(i, alice.address, proof);
    await c.connect(alice).accept(i);
    const other = await order(i, bob);
    expect(other.resolved).to.equal(false);
    expect(other.deposited).to.equal(eth(2));
  });

  it('one cancelled-order refund leaves other deposits claimable', async () => {
    const i = await offer(); await join(i); await join(i, bob); await c.cancel(i);
    await c.connect(alice).refund(i);
    expect((await order(i, bob)).resolved).to.equal(false);
    await c.connect(bob).refund(i);
    expect(await balance()).to.equal(0);
  });

  it('delivery in one group grants no acceptance in another', async () => {
    const first = await active(), second = await active();
    await c.commitDelivery(first, alice.address, proof);
    await expect(c.connect(alice).accept(second)).to.be.reverted;
    expect((await order(first)).resolved).to.equal(false);
    expect((await order(second)).delivered).to.equal(false);
  });

  it('provider cannot commit delivery for a nonmember', async () => {
    const i = await active();
    await expect(c.commitDelivery(i, stranger.address, proof)).to.be.reverted;
    expect((await order(i, stranger)).entitlementHash).to.equal(ethers.ZeroHash);
  });

  it('empty groups cannot activate', async () => {
    const i = await offer(); await expect(c.activate(i)).to.be.reverted;
    expect(await balance()).to.equal(0);
    expect((await c.offers(i)).state).to.equal(0);
  });

  it('failed USD-cap checks leave membership, order and balance untouched', async () => {
    const i = await offer();
    await expect(join(i, alice, eth(2), 99)).to.be.reverted;
    expect((await c.offers(i)).members).to.equal(0);
    expect((await order(i)).deposited).to.equal(0);
    expect(await balance()).to.equal(0);
  });

  it('failed oracle checks leave no joined order', async () => {
    const i = await offer(); await oracle.set(0, 8, now * 1000);
    await expect(join(i)).to.be.reverted;
    expect((await order(i)).joinPriceE18).to.equal(0);
    expect((await c.offers(i)).members).to.equal(0);
  });

  it('one insufficient buyer prevents all activation accounting writes', async () => {
    const i = await offer(); await join(i); await join(i, bob, eth(1));
    await oracle.set(95000000n, 8, now * 1000);
    await expect(c.activate(i)).to.be.reverted;
    expect((await order(i)).due).to.equal(0);
    expect((await order(i, bob)).due).to.equal(0);
    expect(await balance()).to.equal(eth(3));
  });

  it('different join snapshots lock to one common activation due', async () => {
    const i = await offer(); await join(i);
    await oracle.set(103000000n, 8, now * 1000);
    await join(i, bob); await c.activate(i);
    expect((await order(i)).joinPriceE18)
      .not.to.equal((await order(i, bob)).joinPriceE18);
    expect((await order(i)).due).to.equal((await order(i, bob)).due);
  });

  it('complete settlement conserves deposits and empties escrow', async () => {
    const i = await offer();
    await join(i, alice, eth(2)); await join(i, bob, eth(3)); await c.activate(i);
    await c.commitDelivery(i, alice.address, proof);
    await c.commitDelivery(i, bob.address, ethers.id('bob-token'));
    const before = await ethers.provider.getBalance(provider.address);
    await c.connect(alice).accept(i); await c.connect(bob).accept(i);
    expect(await ethers.provider.getBalance(provider.address) - before)
      .to.equal(eth(2));
    expect(await balance()).to.equal(0);
  });

  it('offers isolate the same buyer deposits and participant lists', async () => {
    const first = await offer(), second = await offer();
    await join(first); await join(second); await c.cancel(first);
    await c.connect(alice).refund(first);
    expect((await order(second)).resolved).to.equal(false);
    expect((await c.offers(second)).state).to.equal(0);
    expect(await c.participantsOf(second)).to.deep.equal([alice.address]);
    expect(await balance()).to.equal(eth(2));
  });

  it('accepts the maximum movement limit at its exact boundary', async () => {
    const i = await offer();
    await join(i, alice, eth(2), 100, 2000);
    await join(i, bob, eth(2), 100, 2000);
    await oracle.set(80000000n, 8, now * 1000); await c.activate(i);
    expect((await order(i)).due).to.equal(eth(1.25));
  });

  it('one basis point limit rejects a price just beyond its boundary', async () => {
    const i = await offer();
    await join(i, alice, eth(2), 100, 1); await join(i, bob, eth(2), 100, 1);
    await oracle.set(100010100n, 8, now * 1000);
    await expect(c.activate(i)).to.be.revertedWithCustomError(c, 'MarketMoved');
    expect((await order(i)).due).to.equal(0);
  });

  it('rejects zero-value quotations', async () => {
    await expect(c.quoteWei(0)).to.be.revertedWithCustomError(c, 'InvalidPrice');
  });

  it('quotes the supported commercial ceiling without overflow', async () => {
    expect(await c.quoteWei(100000000)).to.equal(eth(1000000));
  });

  it('rejects amounts above the supported commercial ceiling', async () => {
    await expect(c.quoteWei(100000001))
      .to.be.revertedWithCustomError(c, 'InvalidPrice');
  });

  it('rounds sub-tinybar obligations up and settles exactly one native unit', async () => {
    await oracle.set(200000000000000n, 8, now * 1000);
    const tiny = await (await ethers.getContractFactory('Hillcash')).deploy(
      await oracle.getAddress(), 8
    );
    await tiny.createOffer(service, 1, 2, now + 3600, now + 7200);
    expect(await tiny.quoteWei(1)).to.equal(10000000000n);
    await tiny.connect(alice).join(1, 1, 500, { value: 1 });
    await tiny.connect(bob).join(1, 1, 500, { value: 1 });
    await tiny.activate(1); await tiny.commitDelivery(1, alice.address, proof);
    const before = await ethers.provider.getBalance(provider.address);
    await tiny.connect(alice).accept(1);
    expect(await ethers.provider.getBalance(provider.address) - before).to.equal(1);
    expect(await ethers.provider.getBalance(tiny.getAddress())).to.equal(1);
  });

  it('failed receiver refund rolls back resolution and can be retried', async () => {
    const a = await actor(), i = await offer();
    await a.join(i, { value: eth(2) }); await c.cancel(i);
    await a.configure(true, 0, false);
    await expect(a.refund(i)).to.be.revertedWithCustomError(c, 'TransferFailed');
    expect((await c.orders(i, a.getAddress())).resolved).to.equal(false);
    expect(await balance()).to.equal(eth(2));
    await a.configure(false, 0, false); await a.refund(i);
    expect(await balance()).to.equal(0);
  });

  it('failed provider payout rolls back acceptance and can be retried', async () => {
    const a = await actor();
    await a.create(service, 100, now + 3600, now + 7200);
    const i = await c.nextOfferId();
    await join(i); await join(i, bob); await c.activate(i);
    await a.deliver(i, alice.address, proof); await a.configure(true, 0, false);
    await expect(c.connect(alice).accept(i))
      .to.be.revertedWithCustomError(c, 'TransferFailed');
    expect((await order(i)).resolved).to.equal(false);
    expect(await balance()).to.equal(eth(4));
    await a.configure(false, 0, false); await c.connect(alice).accept(i);
    expect(await ethers.provider.getBalance(a.getAddress())).to.equal(eth(1));
  });

  it('failed surplus transfer also rolls back the preceding provider payout', async () => {
    const a = await actor();
    await c.connect(bob).createOffer(service, 100, 2, now + 3600, now + 7200);
    const i = await c.nextOfferId();
    await a.join(i, { value: eth(2) }); await join(i); await c.activate(i);
    await c.connect(bob).commitDelivery(i, a.getAddress(), proof);
    await a.configure(true, 0, false);
    const before = await ethers.provider.getBalance(bob.address);
    await expect(a.accept(i)).to.be.revertedWithCustomError(c, 'TransferFailed');
    expect(await ethers.provider.getBalance(bob.address)).to.equal(before);
    expect((await c.orders(i, a.getAddress())).accepted).to.equal(false);
    expect(await balance()).to.equal(eth(4));
  });

  it('refund callback cannot reenter another refundable order', async () => {
    const a = await actor(), first = await offer(), second = await offer();
    await a.join(first, { value: eth(2) }); await a.join(second, { value: eth(2) });
    await c.cancel(first); await c.cancel(second);
    await a.configure(false, second, false); await a.refund(first);
    expect(await a.callbackAttempts()).to.equal(1);
    expect(await a.lastCallbackSucceeded()).to.equal(false);
    expect((await c.orders(second, a.getAddress())).resolved).to.equal(false);
    expect(await balance()).to.equal(eth(2));
  });

  it('acceptance surplus callback cannot reenter another refundable order', async () => {
    const a = await actor(), first = await offer(), second = await offer();
    await a.join(first, { value: eth(2) }); await join(first, bob);
    await c.activate(first); await c.commitDelivery(first, a.getAddress(), proof);
    await a.join(second, { value: eth(2) }); await c.cancel(second);
    await a.configure(false, second, false); await a.accept(first);
    expect(await a.lastCallbackSucceeded()).to.equal(false);
    expect(await a.callbackAttempts()).to.equal(1);
    expect((await c.orders(second, a.getAddress())).resolved).to.equal(false);
    expect(await balance()).to.equal(eth(4));
  });
});
