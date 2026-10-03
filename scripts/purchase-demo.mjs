import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import dotenv from "dotenv";
import {
  Contract,
  JsonRpcProvider,
  NonceManager,
  Wallet,
  formatUnits,
  id,
  parseEther,
} from "ethers";

import { planLivePurchases } from "../packages/agent/src/live.js";
import {
  TERMS_TYPES,
  termsDomain,
  verifyServiceTerms,
} from "../packages/agent/src/terms.js";
import {
  EntitlementLedger,
  loadLedger,
  saveLedger,
} from "../packages/provider/src/ledger.js";
import { liveEntitlement } from "../packages/provider/src/chain.js";
import { createProviderServer } from "../packages/provider/src/http.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runFile = promisify(execFile);

const abi = [
  "function nativeDecimals() view returns (uint8)",
  "function marketPriceE18() view returns (uint256 price,uint256 timeMs)",
  "function quoteWei(uint256) view returns (uint256)",
  "function createOffer(bytes32,uint256,uint32,uint64,uint64) returns (uint256)",
  "function join(uint256,uint256,uint16) payable",
  "function activate(uint256)",
  "function commitDelivery(uint256,address,bytes32)",
  "function accept(uint256)",
  "function offers(uint256) view returns (address provider,bytes32 serviceId,uint64 joinDeadline,uint64 deliveryDeadline,uint32 minimum,uint32 members,uint256 unitUsdCents,uint8 state)",
  "function orders(uint256,address) view returns (uint256 deposited,uint256 due,bool delivered,bool resolved,bool accepted,bytes32 entitlementHash,uint256 joinPriceE18,uint16 maxMovementBps)",
  "event OfferCreated(uint256 indexed offerId,address indexed provider,bytes32 indexed serviceId,uint256 unitUsdCents)",
  "event Activated(uint256 indexed offerId,uint256 price,uint256 decimals)",
  "event Accepted(uint256 indexed offerId,address indexed buyer,uint256 paid,uint256 returned)",
];

/**
 * Runs the existing purchasing modules together.
 * The supplied buyer wallets authorize this test purchase.
 */
export async function runPurchaseDemo({
  provider,
  contract,
  seller,
  buyers,
  directory,
  anchor,
  txOptions = {},
  report = console.log,
}) {
  assert.equal(buyers.length, 2, "Two buyer wallets required");

  const addresses = await Promise.all(
    [seller, ...buyers].map((wallet) => wallet.getAddress()),
  );

  assert.equal(
    new Set(addresses.map((address) => address.toLowerCase())).size,
    3,
    "Use three distinct wallets",
  );
  assert.equal(typeof anchor, "function", "Audit publisher required");

  mkdirSync(directory, { recursive: false, mode: 0o700 });

  const write = (name, data) =>
    writeFileSync(join(directory, name), JSON.stringify(data, null, 2) + "\n", {
      mode: 0o600,
    });

  const evidence = {
    contract: await contract.getAddress(),
    offers: [],
    transactions: [],
    stage: "starting",
  };

  const stage = (message) => {
    evidence.stage = message;
    write("evidence.json", evidence);
    report(message);
  };

  const transact = async (wallet, method, args, options = {}) => {
    const connected = contract.connect(wallet);
    const overrides = { ...txOptions, ...options };

    await connected[method].staticCall(...args, overrides);
    const transaction = await connected[method](...args, overrides);
    const receipt = await transaction.wait();

    assert.equal(receipt.status, 1, `${method} did not succeed`);

    evidence.transactions.push({
      action: method,
      hash: transaction.hash,
    });
    write("evidence.json", evidence);

    return receipt;
  };

  const findEvent = (receipt, name) =>
    receipt.logs
      .filter(
        (log) => log.address.toLowerCase() === evidence.contract.toLowerCase(),
      )
      .map((log) => {
        try {
          return contract.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((event) => event?.name === name);

  let server;

  try {
    const decimals = Number(await contract.nativeDecimals());
    const unit = 10n ** BigInt(18 - decimals);
    const block = await provider.getBlock("latest");

    assert(block, "Latest block unavailable");
    await contract.marketPriceE18();

    const serviceId = id(`hillcash-demo:${randomUUID()}:100-calls`);
    const joinDeadline = block.timestamp + 3600;
    const deliveryDeadline = joinDeadline + 3600;
    const catalog = [];

    stage("1/7 Provider creates two offers: $0.03 and $0.02 per buyer.");

    for (const price of [3, 2]) {
      const receipt = await transact(seller, "createOffer", [
        serviceId,
        price,
        2,
        joinDeadline,
        deliveryDeadline,
      ]);

      const offerId = Number(findEvent(receipt, "OfferCreated")?.args.offerId);

      assert(
        Number.isSafeInteger(offerId) && offerId > 0,
        "Missing OfferCreated event",
      );

      const offer = await contract.offers(offerId);
      const terms = {
        offerId,
        serviceId,
        unitsPerBuyer: 100,
        unitUsdCents: price,
        soloUsdCents: 5,
        validUntil: joinDeadline,
      };

      const signature = await seller.signTypedData(
        termsDomain(296, evidence.contract),
        TERMS_TYPES,
        terms,
      );

      const entry = { offerId, terms, signature };

      verifyServiceTerms(entry, {
        chainId: 296,
        contract: evidence.contract,
        offerId,
        offer,
        nowSeconds: block.timestamp,
      });

      catalog.push(entry);
      evidence.offers.push({ offerId, priceCents: price });
    }

    write("catalog.json", catalog);

    const requests = addresses.slice(1).map((buyer, index) => ({
      id: `demo-buyer-${index + 1}`,
      buyer,
      serviceId,
      units: 100,
      maxUsdCents: 5,
      soloUsdCents: 5,
      maxMovementBps: 300,
      expiresAt: (deliveryDeadline + 3600) * 1000,
    }));

    write("requests.json", requests);

    stage("2/7 Agent checks the signed offers against the chain.");

    const plan = await planLivePurchases(requests, catalog, {
      provider,
      contract,
    });

    assert.equal(plan.proposals.length, 1, "Expected one viable group");

    const proposal = plan.proposals[0];

    assert.equal(
      proposal.unitUsdCents,
      2,
      "Agent did not select the cheaper offer",
    );
    assert.equal(proposal.buyerIds.length, 2, "Both buyers must be included");

    write("plan.json", plan);
    evidence.offerId = proposal.offerId;

    report(
      `    Selected offer ${proposal.offerId}: $0.02 each; 100 provider-declared units each.`,
    );

    stage("3/7 Each supplied buyer wallet deposits; the group activates.");

    for (const buyer of buyers) {
      const quote = await contract.quoteWei(2);
      const deposit = ((quote + quote / 10n + unit - 1n) / unit) * unit;

      await transact(buyer, "join", [proposal.offerId, 5, 300], {
        value: deposit,
      });
    }

    const activation = await transact(seller, "activate", [proposal.offerId]);

    evidence.activationTransaction = activation.hash;

    stage("4/7 Provider commits a unique entitlement for each buyer.");

    const ledgerPath = join(directory, "ledger.json");
    const ledger = new EntitlementLedger();
    const entitlements = [];

    for (const buyer of addresses.slice(1)) {
      const issued = ledger.issue({
        offerId: proposal.offerId,
        buyer,
        units: 100,
        expiresAt: (deliveryDeadline + 30 * 86400) * 1000,
      });

      entitlements.push(issued);
      write("private-entitlements.json", entitlements);

      await transact(seller, "commitDelivery", [
        proposal.offerId,
        buyer,
        issued.commitment,
      ]);

      saveLedger(ledgerPath, ledger);
    }

    stage("5/7 Each buyer checks the commitment and accepts; escrow settles.");

    evidence.settlements = [];

    for (let index = 0; index < buyers.length; index++) {
      const order = await contract.orders(
        proposal.offerId,
        addresses[index + 1],
      );

      assert.equal(
        order.entitlementHash,
        id(entitlements[index].token),
        "Token commitment mismatch",
      );

      const receipt = await transact(
        buyers[index],
        "accept",
        [proposal.offerId],
        { gasLimit: 250_000n },
      );
      const accepted = findEvent(receipt, "Accepted");

      assert(accepted, "Acceptance event missing");
      assert.equal(accepted.args.paid, order.due, "Wrong provider payment");
      assert.equal(
        accepted.args.returned,
        order.deposited - order.due,
        "Wrong deposit surplus",
      );

      const settled = await contract.orders(
        proposal.offerId,
        addresses[index + 1],
      );

      assert(settled.accepted && settled.resolved, "Order did not resolve");

      evidence.settlements.push({
        buyer: `Buyer ${index + 1}`,
        transaction: receipt.hash,
        providerPayment: formatUnits(accepted.args.paid, decimals),
        returned: formatUnits(accepted.args.returned, decimals),
      });
    }

    stage(
      "6/7 Both buyers redeem through the actual sample provider HTTP server.",
    );

    server = createProviderServer({
      redeem: async (input) => {
        const current = loadLedger(ledgerPath);

        const result = await current.redeem({
          ...input,
          verify: (value) => liveEntitlement(contract, value),
        });

        saveLedger(ledgerPath, current);
        return result;
      },
    });

    await new Promise((resolveListen, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolveListen);
    });

    const port = server.address().port;
    evidence.redemptions = [];

    for (let index = 0; index < buyers.length; index++) {
      const response = await fetch(`http://127.0.0.1:${port}/redeem`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${entitlements[index].token}`,
        },
        body: JSON.stringify({
          offerId: proposal.offerId,
          buyer: addresses[index + 1],
        }),
      });

      assert.equal(response.status, 200, "Provider rejected redemption");

      const result = await response.json();

      assert.equal(result.remaining, 99, "Wrong remaining quota");

      evidence.redemptions.push({
        buyer: `Buyer ${index + 1}`,
        status: response.status,
        ...result,
      });

      report(
        `    Buyer ${index + 1}: HTTP 200 — ${result.result}; 99 units remain.`,
      );
    }

    stage(
      "7/7 Audit tool checks the signed plan and publishes its HCS record.",
    );

    evidence.audit = await anchor({
      plan,
      planFile: join(directory, "plan.json"),
      activation,
      transactionHash: activation.hash,
      contract: evidence.contract,
    });

    stage(
      "COMPLETE: signed selection, deposits, settlement, service redemption, and audit.",
    );

    report(`Private run files: ${directory}`);
    report(`Activation: ${activation.hash}`);

    return evidence;
  } catch (error) {
    write("evidence.json", evidence);
    report(
      `Run stopped at: ${evidence.stage}. Private run files: ${directory}`,
    );
    throw error;
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise((resolveClose) => server.close(resolveClose));
    }
  }
}

async function main() {
  if (process.argv.includes("--help")) {
    console.log(
      "Usage: npm run demo:testnet\n" +
        "Uses the provider and two buyer testnet keys from .env. " +
        "Creates fresh offers, deposits, accepts, redeems, and anchors to HCS.",
    );
    return;
  }

  console.log("Checking testnet configuration, network, oracle, and wallet balances...");
  dotenv.config({ path: join(root, ".env") });

  for (const name of [
    "HEDERA_PRIVATE_KEY",
    "HILLCASH_BUYER_A_KEY",
    "HILLCASH_BUYER_B_KEY",
  ]) {
    assert(
      /^(?:0x)?[0-9a-fA-F]{64}$/.test(process.env[name] || ""),
      `Set ${name} to a testnet EVM key`,
    );
  }

  for (const name of ["HEDERA_OPERATOR_ID", "HILLCASH_HCS_TOPIC_ID"]) {
    assert(/^\d+\.\d+\.\d+$/.test(process.env[name] || ""), `Set ${name}`);
  }

  const rpc = new JsonRpcProvider(
    process.env.HEDERA_TESTNET_RPC_URL || "https://testnet.hashio.io/api",
  );

  try {
    assert.equal(
      (await rpc.getNetwork()).chainId,
      296n,
      "Only Hedera testnet is allowed",
    );

    const contract = new Contract(process.env.HILLCASH_CONTRACT, abi, rpc);

    assert.notEqual(
      await rpc.getCode(await contract.getAddress()),
      "0x",
      "Missing deployment",
    );
    assert.equal(
      await contract.nativeDecimals(),
      8n,
      "Expected Hedera native precision 8",
    );

    await contract.marketPriceE18();

    const wallets = [
      "HEDERA_PRIVATE_KEY",
      "HILLCASH_BUYER_A_KEY",
      "HILLCASH_BUYER_B_KEY",
    ].map((name) => new Wallet(process.env[name], rpc));

    assert.equal(
      new Set(wallets.map((wallet) => wallet.address.toLowerCase())).size,
      3,
      "Use three distinct wallets",
    );

    const quote = await contract.quoteWei(2);

    for (let index = 0; index < wallets.length; index++) {
      const required =
        index === 0 ? parseEther("5") : quote + quote / 10n + parseEther("1");

      assert(
        (await rpc.getBalance(wallets[index].address)) >= required,
        `Fund ${index === 0 ? "provider" : `buyer ${index}`} with more test HBAR before running`,
      );
    }

    const privateParent = join(homedir(), "hillcash-secrets");

    mkdirSync(privateParent, {
      recursive: true,
      mode: 0o700,
    });

    const directory = join(privateParent, `purchase-${randomUUID()}`);

    console.log(
      "Hedera TESTNET purchase demo. Supplied buyer keys authorize " +
        "$0.02 of service each plus transaction fees.",
    );

    await runPurchaseDemo({
      provider: rpc,
      contract,
      seller: new NonceManager(wallets[0]),
      buyers: wallets.slice(1).map((wallet) => new NonceManager(wallet)),
      directory,
      txOptions: {
        type: 0,
        gasPrice: BigInt(process.env.HILLCASH_GAS_PRICE_WEI || "2000000000000"),
      },
      anchor: async ({ planFile, transactionHash }) => {
        let result;

        try {
          result = await runFile(
            "npm",
            ["run", "audit:anchor", "--", planFile, transactionHash],
            {
              cwd: root,
              encoding: "utf8",
              timeout: 60000,
              maxBuffer: 1048576,
            },
          );
        } catch {
          throw new Error(
            "HCS anchoring failed; preserve the run files and retry audit:anchor",
          );
        }

        const jsonLine = result.stdout
          .split("\n")
          .findLast((line) => line.trim().startsWith("{"));

        const published = JSON.parse(jsonLine);

        console.log(
          `    HCS topic ${published.topicId}, sequence ${published.sequenceNumber}`,
        );

        return published;
      },
    });
  } finally {
    rpc.destroy();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const keepAlive = setInterval(() => {}, 1000);
  main().catch((error) => {
    console.error(error.shortMessage || error.message);
    process.exitCode = 1;
  }).finally(() => clearInterval(keepAlive));
}
