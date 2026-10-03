const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

describe("Complete purchase demo orchestration", function () {
  this.timeout(60000);

  it("runs signed matching, escrow settlement, HTTP redemption and an audit commitment", async function () {
    const [seller, buyerA, buyerB] = await ethers.getSigners();

    const feed = await (
      await ethers.getContractFactory("MockSupra")
    ).deploy();

    const block = await ethers.provider.getBlock("latest");

    await feed.set(
      ethers.parseEther("0.10"),
      18,
      BigInt(block.timestamp) * 1000n,
    );

    const contract = await (
      await ethers.getContractFactory("Hillcash")
    ).deploy(await feed.getAddress(), 18);

    const parent = mkdtempSync(
      join(tmpdir(), "hillcash-purchase-test-"),
    );
    const directory = join(parent, "run");

    // Local EVM accounting uses 18 decimals.
    // This adapter models the expected chain identity for local testing.
    // The actual CLI separately checks Hedera testnet and 8 native decimals.
    const provider = {
      getNetwork: async () => ({ chainId: 296n }),
      getBlock: (...args) => ethers.provider.getBlock(...args),
      getCode: (...args) => ethers.provider.getCode(...args),
    };

    try {
      const { runPurchaseDemo } = await import(
        "../../../scripts/purchase-demo.mjs"
      );
      const { buildPlanRecord } = await import(
        "../../audit/src/plan-record.js"
      );
      const { verifyActivationReceipt } = await import(
        "../../audit/src/record.js"
      );

      const reports = [];

      const result = await runPurchaseDemo({
        provider,
        contract,
        seller,
        buyers: [buyerA, buyerB],
        directory,
        report: (line) => reports.push(line),
        anchor: async ({
          plan,
          transactionHash,
          activation,
          contract: target,
        }) => {
          const record = buildPlanRecord(
            plan,
            transactionHash,
            target,
          );

          expect(
            verifyActivationReceipt(activation, record),
          ).to.equal(true);

          // Checks the commitment locally; does not publish to HCS.
          return { record, mode: "local-commitment-test" };
        },
      });

      expect(result.stage).to.match(/^COMPLETE/);

      expect(
        result.offers.map((offer) => offer.priceCents),
      ).to.deep.equal([3, 2]);

      expect(result.offerId).to.equal(
        result.offers[1].offerId,
      );

      expect(
        result.redemptions.map((item) => item.remaining),
      ).to.deep.equal([99, 99]);

      expect(result.audit.record.version).to.equal(2);

      expect(
        await ethers.provider.getBalance(
          await contract.getAddress(),
        ),
      ).to.equal(0n);

      for (const buyer of [buyerA, buyerB]) {
        const order = await contract.orders(
          result.offerId,
          buyer.address,
        );

        expect(order.accepted).to.equal(true);
        expect(order.resolved).to.equal(true);
      }

      const tokenFile = join(
        directory,
        "private-entitlements.json",
      );

      expect(
        statSync(tokenFile).mode & 0o777,
      ).to.equal(0o600);

      const tokens = JSON.parse(
        readFileSync(tokenFile, "utf8"),
      ).map((item) => item.token);

      const publicOutput =
        JSON.stringify(result) + reports.join("\n");

      expect(
        tokens.every((token) => !publicOutput.includes(token)),
      ).to.equal(true);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});