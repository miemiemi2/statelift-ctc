// Task 3: the source-chain at-most-once gate.
//
// These tests are the load-bearing evidence for the product's core promise:
// "the same payment goal is paid at most once, so a replacement executor is safe".
// Everything runs against real execution on a real (local) source chain.

const test = require("node:test");
const assert = require("node:assert/strict");
const { keccak256, toUtf8Bytes } = require("ethers");
const { compile } = require("../helpers.cjs");
const {
  sourceEnvironment,
  deployTo,
  fixtureSources,
  signReceiveWithAuthorization,
} = require("../fixtures/source-chain.cjs");

const SOURCE_CHAIN_ID = 31337;
const CTC_CHAIN_ID = 1337;
const AMOUNT = 5_000_000_000n; // 5,000 tdUSDC at 6 decimals — demo parameter

let compiled;
test.before(() => {
  compiled = compile(fixtureSources("MockUSDC3009.sol"));
});

async function setup() {
  const src = await sourceEnvironment({ chainId: SOURCE_CHAIN_ID });
  const [deployer, payerA, payerB, recipient, escrowStandIn, ownerStandIn] =
    src.signers;

  const token = await deployTo(
    compiled["tests/fixtures/MockUSDC3009.sol"].MockUSDC3009,
    deployer,
  );
  const router = await deployTo(
    compiled["contracts/source/GoalRouter.sol"].GoalRouter,
    deployer,
  );

  const addr = async (s) => await s.getAddress();
  await (await token.mintForTest(await addr(payerA), AMOUNT * 10n)).wait();
  await (await token.mintForTest(await addr(payerB), AMOUNT * 10n)).wait();

  const goal = {
    ctcChainId: CTC_CHAIN_ID,
    escrow: await addr(escrowStandIn),
    owner: await addr(ownerStandIn),
    businessRef: keccak256(toUtf8Bytes("invoice-2026-0042")),
    token: await token.getAddress(),
    recipient: await addr(recipient),
    amount: AMOUNT,
  };
  const goalId = await router.goalIdOf(goal);

  const now = () => Math.floor(Date.now() / 1000);

  /// Signs and submits one compliant fill attempt.
  async function fill({
    payerIndex = 1,
    roundNumber = 1,
    payBy = now() + 1800,
    winnerIndex = 1,
    overrideGoal = goal,
    overrideValue,
    validAfter = 0,
    validBefore = now() + 7200,
    submitterIndex = 1,
  } = {}) {
    const payer = src.signers[payerIndex];
    const winner = await addr(src.signers[winnerIndex]);
    const nonce = await router.fillNonce(
      await router.goalIdOf(overrideGoal),
      roundNumber,
      winner,
      payBy,
    );
    const signature = await signReceiveWithAuthorization({
      wallet: src.wallets[payerIndex],
      token: await token.getAddress(),
      chainId: SOURCE_CHAIN_ID,
      from: await addr(payer),
      to: await router.getAddress(),
      value: overrideValue ?? overrideGoal.amount,
      validAfter,
      validBefore,
      nonce,
    });
    return router
      .connect(src.signers[submitterIndex])
      .fill(
        overrideGoal,
        roundNumber,
        payBy,
        winner,
        { from: await addr(payer), validAfter, validBefore, signature },
      );
  }

  return {
    ...src,
    token,
    router,
    goal,
    goalId,
    fill,
    now,
    addr,
    recipientAddress: await addr(recipient),
  };
}

test("a compliant fill pays the recipient exactly once and records the winner", async (t) => {
  const s = await setup();
  t.after(s.close);

  assert.equal(await s.token.balanceOf(s.recipientAddress), 0n);
  assert.equal(await s.router.isFilled(s.goalId), false);

  const receipt = await (await s.fill({ roundNumber: 1 })).wait();

  assert.equal(await s.token.balanceOf(s.recipientAddress), AMOUNT);
  assert.equal(await s.router.isFilled(s.goalId), true);

  const record = await s.router.fillOf(s.goalId);
  assert.equal(record.roundNumber, 1n);
  assert.equal(record.winner, await s.addr(s.signers[1]));
  assert.notEqual(record.filledAt, 0n);

  const log = receipt.logs
    .map((l) => {
      try {
        return s.router.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((l) => l?.name === "GoalFilled");
  assert.ok(log, "GoalFilled must be emitted");
  assert.equal(log.args.goalId, s.goalId);
  assert.equal(log.args.roundNumber, 1n);
  assert.equal(log.args.amount, AMOUNT);
  assert.equal(log.args.recipient, s.recipientAddress);
  // The router must not retain any of the payment.
  assert.equal(await s.token.balanceOf(await s.router.getAddress()), 0n);
});

test("a second round on the same goal reverts and spends no second payment", async (t) => {
  const s = await setup();
  t.after(s.close);

  await (await s.fill({ roundNumber: 1, payerIndex: 1, winnerIndex: 1 })).wait();
  const afterFirst = await s.token.balanceOf(s.recipientAddress);
  const payerBBefore = await s.token.balanceOf(await s.addr(s.signers[2]));

  // A completely different executor, round number, winner and ERC-3009 nonce.
  // This is exactly the relay case: without the gate it would pay a second time.
  await assert.rejects(
    async () => {
      const tx = await s.fill({ roundNumber: 2, payerIndex: 2, winnerIndex: 2, submitterIndex: 2 });
      await tx.wait();
    },
    (e) => /AlreadyFilled|revert/i.test(e.message),
  );

  assert.equal(await s.token.balanceOf(s.recipientAddress), afterFirst);
  assert.equal(
    await s.token.balanceOf(await s.addr(s.signers[2])),
    payerBBefore,
    "the second executor must not be debited",
  );
  const record = await s.router.fillOf(s.goalId);
  assert.equal(record.roundNumber, 1n, "the winning round must not change");
});

test("replaying the identical fill reverts", async (t) => {
  const s = await setup();
  t.after(s.close);
  const payBy = s.now() + 1800;
  await (await s.fill({ roundNumber: 1, payBy })).wait();
  await assert.rejects(async () => {
    const tx = await s.fill({ roundNumber: 1, payBy });
    await tx.wait();
  });
  assert.equal(await s.token.balanceOf(s.recipientAddress), AMOUNT);
});

test("a fill after the round deadline T reverts", async (t) => {
  const s = await setup();
  t.after(s.close);
  await assert.rejects(
    s.fill({ roundNumber: 1, payBy: s.now() - 1 }),
    (e) => /RoundExpired|revert/i.test(e.message),
  );
  assert.equal(await s.token.balanceOf(s.recipientAddress), 0n);
  assert.equal(await s.router.isFilled(s.goalId), false);
});

test("an authorization for a different amount cannot fill the goal", async (t) => {
  const s = await setup();
  t.after(s.close);
  // Signature covers a smaller value than the goal requires; the token would move
  // the signed value, so the router's exact-amount check must reject it.
  await assert.rejects(s.fill({ overrideValue: AMOUNT - 1n }));
  assert.equal(await s.token.balanceOf(s.recipientAddress), 0n);
  assert.equal(await s.router.isFilled(s.goalId), false);
});

test("an authorization bound to another goal cannot fill this goal", async (t) => {
  const s = await setup();
  t.after(s.close);
  const otherGoal = {
    ...s.goal,
    businessRef: keccak256(toUtf8Bytes("invoice-2026-9999")),
  };
  // Nonce is derived from the other goal, then submitted against the real goal.
  const winner = await s.addr(s.signers[1]);
  const payBy = s.now() + 1800;
  const validBefore = s.now() + 7200;
  const nonce = await s.router.fillNonce(
    await s.router.goalIdOf(otherGoal),
    1,
    winner,
    payBy,
  );
  const signature = await signReceiveWithAuthorization({
    wallet: s.wallets[1],
    token: await s.token.getAddress(),
    chainId: SOURCE_CHAIN_ID,
    from: await s.addr(s.signers[1]),
    to: await s.router.getAddress(),
    value: s.goal.amount,
    validAfter: 0,
    validBefore,
    nonce,
  });
  await assert.rejects(
    s.router.fill(s.goal, 1, payBy, winner, {
      from: await s.addr(s.signers[1]),
      validAfter: 0,
      validBefore,
      signature,
    }),
  );
  assert.equal(await s.router.isFilled(s.goalId), false);
});

test("an authorization signed for a different round number is not reusable", async (t) => {
  const s = await setup();
  t.after(s.close);
  const winner = await s.addr(s.signers[1]);
  const payBy = s.now() + 1800;
  const validBefore = s.now() + 7200;
  const nonce = await s.router.fillNonce(s.goalId, 7, winner, payBy);
  const signature = await signReceiveWithAuthorization({
    wallet: s.wallets[1],
    token: await s.token.getAddress(),
    chainId: SOURCE_CHAIN_ID,
    from: await s.addr(s.signers[1]),
    to: await s.router.getAddress(),
    value: s.goal.amount,
    validAfter: 0,
    validBefore,
    nonce,
  });
  await assert.rejects(
    s.router.fill(s.goal, 1, payBy, winner, {
      from: await s.addr(s.signers[1]),
      validAfter: 0,
      validBefore,
      signature,
    }),
  );
  assert.equal(await s.router.isFilled(s.goalId), false);
});

test("the router authorization cannot be redirected to pay the recipient directly", async (t) => {
  const s = await setup();
  t.after(s.close);
  const winner = await s.addr(s.signers[1]);
  const payBy = s.now() + 1800;
  const validBefore = s.now() + 7200;
  const nonce = await s.router.fillNonce(s.goalId, 1, winner, payBy);
  const signature = await signReceiveWithAuthorization({
    wallet: s.wallets[1],
    token: await s.token.getAddress(),
    chainId: SOURCE_CHAIN_ID,
    from: await s.addr(s.signers[1]),
    to: await s.router.getAddress(),
    value: s.goal.amount,
    validAfter: 0,
    validBefore,
    nonce,
  });
  // EIP-3009 requires msg.sender == to, so only the router can consume it.
  await assert.rejects(
    s.token
      .connect(s.signers[3])
      .receiveWithAuthorization(
        await s.addr(s.signers[1]),
        await s.router.getAddress(),
        s.goal.amount,
        0,
        validBefore,
        nonce,
        signature,
      ),
  );
  assert.equal(await s.token.balanceOf(s.recipientAddress), 0n);
});

test("zero round number and zero winner are rejected", async (t) => {
  const s = await setup();
  t.after(s.close);
  await assert.rejects(s.fill({ roundNumber: 0 }));
  const payBy = s.now() + 1800;
  const validBefore = s.now() + 7200;
  const nonce = await s.router.fillNonce(
    s.goalId,
    1,
    "0x" + "00".repeat(20),
    payBy,
  );
  const signature = await signReceiveWithAuthorization({
    wallet: s.wallets[1],
    token: await s.token.getAddress(),
    chainId: SOURCE_CHAIN_ID,
    from: await s.addr(s.signers[1]),
    to: await s.router.getAddress(),
    value: s.goal.amount,
    validAfter: 0,
    validBefore,
    nonce,
  });
  await assert.rejects(
    s.router.fill(s.goal, 1, payBy, "0x" + "00".repeat(20), {
      from: await s.addr(s.signers[1]),
      validAfter: 0,
      validBefore,
      signature,
    }),
  );
  assert.equal(await s.router.isFilled(s.goalId), false);
});
