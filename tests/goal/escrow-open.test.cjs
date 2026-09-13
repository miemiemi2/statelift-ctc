// Task 5: goal/round skeleton and the guarantee capital pool.
//
// The point of these tests is that an "insured quote" cannot exist unless the
// guarantee is fully funded and dedicated, and that R / B / pi / credits are
// tracked as four separate pools that always add up to the contract balance.

const test = require("node:test");
const assert = require("node:assert/strict");
const { keccak256, toUtf8Bytes, ZeroAddress } = require("ethers");
const {
  compileAll,
  twoChain,
  AMOUNT,
  MIN_CLEARING_WINDOW,
} = require("../fixtures/two-chain.cjs");

// Demo parameters from PRODUCT-SLICE.md, scaled to the local chain's native unit.
const R = 5_150n;
const B = 5_150n;
const PREMIUM = 31n;

let compiled;
test.before(() => {
  compiled = compileAll();
});

const GUARANTOR = 4;

async function setup() {
  const env = await twoChain(compiled);
  const g = await env.escrowGoal();
  const guarantorAddress = await env.ctc.signers[GUARANTOR].getAddress();

  async function deposit(amount) {
    await (
      await env.escrow
        .connect(env.ctc.signers[GUARANTOR])
        .depositCapital({ value: amount }));
  }

  let nonce = 0;
  async function quote(overrides = {}) {
    const now = await env.ctcNow();
    const payBy = overrides.payBy ?? now + 600;
    return {
      goalId: g.goalId,
      roundNumber: 1,
      guarantor: guarantorAddress,
      payBy,
      clearBy: overrides.clearBy ?? payBy + MIN_CLEARING_WINDOW,
      principal: R,
      guarantee: B,
      premium: PREMIUM,
      acceptBefore: now + 300,
      guarantorNonce: ++nonce,
      ...overrides,
    };
  }

  /// Always awaits the receipt: on ganache a reverting call is sometimes mined
  /// with status 0 instead of failing gas estimation, and only `wait()` surfaces it.
  async function open(q, { value, ownerIndex = 1 } = {}) {
    const signature = await env.signQuote(q, GUARANTOR);
    const tx = await env.escrow
      .connect(env.ctc.signers[ownerIndex])
      .openRound(q, signature, {
        value: value ?? q.principal + q.premium,
      });
    return tx.wait();
  }

  /// Asserts the contract balance equals the sum of the four tracked pools.
  async function assertInvariant() {
    const [balance, held, available, locked, creditsTotal] =
      await env.escrow.invariant();
    assert.equal(
      balance,
      held + available + locked + creditsTotal,
      `balance ${balance} != held ${held} + available ${available} + locked ${locked} + credits ${creditsTotal}`,
    );
    return { balance, held, available, locked, creditsTotal };
  }

  return { ...env, g, guarantorAddress, deposit, quote, open, assertInvariant };
}

test("both chains derive the same goal id from the same terms", async (t) => {
  const s = await setup();
  t.after(s.close);
  // If these ever diverge, a real source payment would produce a fact that
  // matches no goal, and the whole product would silently stop working.
  assert.equal(await s.router.goalIdOf(s.g.ref), s.g.goalId);
});

test("a goal fixes recipient and amount and cannot be created twice", async (t) => {
  const s = await setup();
  t.after(s.close);

  const goal = await s.escrow.getGoal(s.g.goalId);
  assert.equal(goal.owner, s.g.ownerAddress);
  assert.equal(goal.terms.recipient, s.g.terms.recipient);
  assert.equal(goal.terms.amount, AMOUNT);
  assert.equal(goal.state, 1n); // Open
  assert.equal(goal.roundCount, 0n);
  assert.equal(goal.winnerPaid, ZeroAddress);

  await assert.rejects(
    s.escrow
      .connect(s.ctc.signers[1])
      .createGoal(s.g.terms, 8)
      .then((tx) => tx.wait()),
  );
});

test("opening a round splits R, B and the premium into separate pools", async (t) => {
  const s = await setup();
  t.after(s.close);
  await s.deposit(B * 3n);

  const before = await s.assertInvariant();
  assert.equal(before.available, B * 3n);
  assert.equal(before.locked, 0n);
  assert.equal(before.held, 0n);

  const q = await s.quote();
  await s.open(q);

  const after = await s.assertInvariant();
  assert.equal(after.held, R, "R is escrowed as round principal");
  assert.equal(after.locked, B, "B is locked against this round");
  assert.equal(after.available, B * 3n - B, "B leaves available capital");
  assert.equal(after.creditsTotal, PREMIUM, "the premium is earned at open");

  assert.equal(await s.escrow.capitalLocked(s.guarantorAddress), B);
  assert.equal(await s.escrow.capitalAvailable(s.guarantorAddress), B * 2n);
  assert.equal(await s.escrow.credits(s.guarantorAddress), PREMIUM);

  const roundId = await s.escrow.roundIdOf(s.g.goalId, 1);
  const round = await s.escrow.getRound(roundId);
  assert.equal(round.principal, R);
  assert.equal(round.guarantee, B);
  assert.equal(round.premium, PREMIUM);
  assert.equal(round.state, 1n); // Pending
  assert.equal(round.principalReturned, false);
  assert.equal(round.payBy, BigInt(q.payBy));
  assert.equal(round.clearBy, BigInt(q.clearBy));
});

test("a quote with guarantee below the principal is refused", async (t) => {
  const s = await setup();
  t.after(s.close);
  await s.deposit(B * 3n);
  await assert.rejects(
    s.open(await s.quote({ guarantee: R - 1n })),
    (e) => /UnderCollateralised|revert/i.test(e.message),
  );
});

test("a quote the guarantor cannot fund is refused", async (t) => {
  const s = await setup();
  t.after(s.close);
  await s.deposit(B - 1n);
  await assert.rejects(
    s.open(await s.quote()),
    (e) => /InsufficientGuaranteeCapital|revert/i.test(e.message),
  );
  // Nothing was locked and no round exists.
  assert.equal(await s.escrow.capitalLocked(s.guarantorAddress), 0n);
  const round = await s.escrow.getRound(
    await s.escrow.roundIdOf(s.g.goalId, 1),
  );
  assert.equal(round.state, 0n);
});

test("the same capital cannot underwrite two live rounds", async (t) => {
  const s = await setup();
  t.after(s.close);
  // Exactly enough for one round only.
  await s.deposit(B);

  const q1 = await s.quote();
  await s.open(q1);
  assert.equal(await s.escrow.capitalAvailable(s.guarantorAddress), 0n);

  // Wait out round 1's T so a replacement round is allowed, then try again.
  await s.ctcTravel(700);
  const now = await s.ctcNow();
  const q2 = await s.quote({
    roundNumber: 2,
    payBy: now + 600,
    clearBy: now + 600 + MIN_CLEARING_WINDOW,
    acceptBefore: now + 300,
  });
  await assert.rejects(
    s.open(q2),
    (e) => /InsufficientGuaranteeCapital|revert/i.test(e.message),
  );
  await s.assertInvariant();
});

test("locked capital cannot be withdrawn by the guarantor", async (t) => {
  const s = await setup();
  t.after(s.close);
  await s.deposit(B);
  await s.open(await s.quote());
  await assert.rejects(
    s.escrow
      .connect(s.ctc.signers[GUARANTOR])
      .withdrawCapital(1n)
      .then((tx) => tx.wait()),
  );
  await s.assertInvariant();
});

test("a clearing deadline that is not clear of the payment deadline is refused", async (t) => {
  const s = await setup();
  t.after(s.close);
  await s.deposit(B * 2n);
  const now = await s.ctcNow();

  // D before T: refunding at D while the source window is still open would let a
  // participant manufacture a guaranteed claim with no failure at all.
  await assert.rejects(
    s.open(
      await s.quote({ payBy: now + 600, clearBy: now + 500 }),
    ),
    (e) => /DeadlineWindowTooShort|revert/i.test(e.message),
  );
  // D == T, still no proof window.
  await assert.rejects(
    s.open(
      await s.quote({ payBy: now + 600, clearBy: now + 600 }),
    ),
    (e) => /DeadlineWindowTooShort|revert/i.test(e.message),
  );
  // Just short of the required window.
  await assert.rejects(
    s.open(
      await s.quote({
        payBy: now + 600,
        clearBy: now + 600 + MIN_CLEARING_WINDOW - 1,
      }),
    ),
    (e) => /DeadlineWindowTooShort|revert/i.test(e.message),
  );
});

test("a payment deadline in the past is refused", async (t) => {
  const s = await setup();
  t.after(s.close);
  await s.deposit(B * 2n);
  const now = await s.ctcNow();
  await assert.rejects(
    s.open(
      await s.quote({
        payBy: now - 1,
        clearBy: now - 1 + MIN_CLEARING_WINDOW * 2,
      }),
    ),
  );
});

test("the operator must send exactly R plus the premium", async (t) => {
  const s = await setup();
  t.after(s.close);
  await s.deposit(B * 2n);
  await assert.rejects(
    s.open(await s.quote(), { value: R + PREMIUM - 1n }),
    (e) => /WrongPayment|revert/i.test(e.message),
  );
  await assert.rejects(
    s.open(await s.quote(), { value: R + PREMIUM + 1n }),
    (e) => /WrongPayment|revert/i.test(e.message),
  );
});

test("only the goal owner can open a round on it", async (t) => {
  const s = await setup();
  t.after(s.close);
  await s.deposit(B * 2n);
  await assert.rejects(
    s.open(await s.quote(), { ownerIndex: 2 }),
    (e) => /Unauthorized|revert/i.test(e.message),
  );
});

test("a round quote cannot be opened without the guarantor's signature", async (t) => {
  const s = await setup();
  t.after(s.close);
  await s.deposit(B * 2n);
  const q = await s.quote();
  // Signed by someone who is not the named guarantor.
  const wrong = await s.signQuote(q, 2);
  await assert.rejects(
    s.escrow
      .connect(s.ctc.signers[1])
      .openRound(q, wrong, { value: q.principal + q.premium })
      .then((tx) => tx.wait()),
    (e) => /BadSignature|revert/i.test(e.message),
  );
});

test("a guarantor quote nonce cannot be reused", async (t) => {
  const s = await setup();
  t.after(s.close);
  await s.deposit(B * 4n);
  const q1 = await s.quote();
  await s.open(q1);

  await s.ctcTravel(700);
  const now = await s.ctcNow();
  const q2 = {
    ...q1,
    roundNumber: 2,
    payBy: now + 600,
    clearBy: now + 600 + MIN_CLEARING_WINDOW,
    acceptBefore: now + 300,
    // same guarantorNonce as q1
  };
  await assert.rejects(
    s.open(q2),
    (e) => /NonceUsed|revert/i.test(e.message),
  );
});

test("an expired quote is refused", async (t) => {
  const s = await setup();
  t.after(s.close);
  await s.deposit(B * 2n);
  const now = await s.ctcNow();
  await assert.rejects(
    s.open(
      await s.quote({
        payBy: now + 6000,
        clearBy: now + 6000 + MIN_CLEARING_WINDOW,
        acceptBefore: now - 1,
      }),
    ),
    (e) => /QuoteExpired|revert/i.test(e.message),
  );
});

test("round numbers must be consecutive and a replacement cannot open while the previous round is still live", async (t) => {
  const s = await setup();
  t.after(s.close);
  await s.deposit(B * 4n);

  const now0 = await s.ctcNow();
  await assert.rejects(
    s.open(await s.quote({ roundNumber: 2 })),
    (e) => /WrongRoundNumber|revert/i.test(e.message),
  );

  const q1 = await s.quote({ payBy: now0 + 600 });
  await s.open(q1);

  // Round 1 can still be filled on the source chain, so no replacement yet.
  const mid = await s.ctcNow();
  await assert.rejects(
    s.open(
      await s.quote({
        roundNumber: 2,
        payBy: mid + 600,
        clearBy: mid + 600 + MIN_CLEARING_WINDOW,
        acceptBefore: mid + 300,
      }),
    ),
    (e) => /PreviousRoundStillLive|revert/i.test(e.message),
  );

  // Past T1 the previous round can no longer be filled; relay is now allowed.
  await s.ctcTravel(700);
  const later = await s.ctcNow();
  await s.open(
    await s.quote({
      roundNumber: 2,
      payBy: later + 600,
      clearBy: later + 600 + MIN_CLEARING_WINDOW,
      acceptBefore: later + 300,
    }),
  );

  const goal = await s.escrow.getGoal(s.g.goalId);
  assert.equal(goal.roundCount, 2n);
  await s.assertInvariant();
});

test("the goal's round cap is enforced", async (t) => {
  const s = await setup();
  t.after(s.close);
  const single = await s.escrowGoal({
    businessRef: keccak256(toUtf8Bytes("invoice-cap-1")),
    maxRounds: 1,
  });
  await s.deposit(B * 4n);

  const now = await s.ctcNow();
  const base = {
    goalId: single.goalId,
    guarantor: s.guarantorAddress,
    principal: R,
    guarantee: B,
    premium: PREMIUM,
  };
  const q1 = {
    ...base,
    roundNumber: 1,
    payBy: now + 600,
    clearBy: now + 600 + MIN_CLEARING_WINDOW,
    acceptBefore: now + 300,
    guarantorNonce: 900,
  };
  await (
    await s.escrow
      .connect(s.ctc.signers[1])
      .openRound(q1, await s.signQuote(q1, GUARANTOR), {
        value: R + PREMIUM,
      })
  ).wait();

  await s.ctcTravel(700);
  const later = await s.ctcNow();
  const q2 = {
    ...base,
    roundNumber: 2,
    payBy: later + 600,
    clearBy: later + 600 + MIN_CLEARING_WINDOW,
    acceptBefore: later + 300,
    guarantorNonce: 901,
  };
  await assert.rejects(
    s.escrow
      .connect(s.ctc.signers[1])
      .openRound(q2, await s.signQuote(q2, GUARANTOR), {
        value: R + PREMIUM,
      })
      .then((tx) => tx.wait()),
    (e) => /TooManyRounds|revert/i.test(e.message),
  );
});

test("guarantee capital can be deposited and unlocked capital withdrawn", async (t) => {
  const s = await setup();
  t.after(s.close);
  await s.deposit(1000n);
  await s.assertInvariant();

  await (
    await s.escrow.connect(s.ctc.signers[GUARANTOR]).withdrawCapital(400n));
  assert.equal(await s.escrow.capitalAvailable(s.guarantorAddress), 600n);
  assert.equal(await s.escrow.credits(s.guarantorAddress), 400n);
  await s.assertInvariant();

  await (
    await s.escrow
      .connect(s.ctc.signers[GUARANTOR])
      .withdraw(s.guarantorAddress));
  assert.equal(await s.escrow.credits(s.guarantorAddress), 0n);
  const inv = await s.assertInvariant();
  assert.equal(inv.creditsTotal, 0n);
  assert.equal(inv.available, 600n);
});

test("a zero-value capital deposit and an empty withdrawal are refused", async (t) => {
  const s = await setup();
  t.after(s.close);
  await assert.rejects(
    s.escrow
      .connect(s.ctc.signers[GUARANTOR])
      .depositCapital({ value: 0 })
      .then((tx) => tx.wait()),
  );
  await assert.rejects(
    s.escrow
      .connect(s.ctc.signers[GUARANTOR])
      .withdraw(s.guarantorAddress)
      .then((tx) => tx.wait()),
  );
});
