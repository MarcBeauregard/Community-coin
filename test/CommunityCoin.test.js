const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

const OPEN = 300; // 5 minute opening batch
const VOTE = 3 * 24 * 3600; // 3 day union vote
const SPIKE = 5000; // half of what a sale fetches above the reference price stays in the reserve
const REF_WINDOW = 3600;
const PROTOCOL = 20; // 0.2% of every trade to the protocol, out of the 1% fee
const ETH = ethers.ZeroAddress;
const eth = (n) => ethers.parseEther(String(n));

// The protocol's fee recipient: the last test account, which nothing else uses.
const treasury = async () => (await ethers.getSigners()).at(-1);
const deployHub = async (open, vest, spike, vote, protocol = PROTOCOL) =>
  ethers.deployContract("CommunityCoin", [open, vest, spike, vote, protocol, (await treasury()).address]);

// Quotes are evaluated at the latest block's timestamp: mine the next transaction at that same timestamp
// so that the reference price has not moved in between.
const sameTimestamp = async () => time.setNextBlockTimestamp(await time.latest());

async function deploy() {
  const signers = await ethers.getSigners();
  const hub = await deployHub(OPEN, 0, SPIKE, VOTE);

  async function launch(signer, symbol, parent = ETH, value = 0n) {
    await hub.connect(signer).launch(`${symbol} coin`, symbol, parent, { value });
    const addr = await hub.tokenOfKey(await hub.symbolKey(symbol));
    return ethers.getContractAt("MemeToken", addr);
  }

  // A root that is already trading, with holders.
  async function liveRoot(symbol, creator, buyers = [], creatorBuy = eth(0.1)) {
    const token = await launch(creator, symbol, ETH, creatorBuy);
    await time.increase(OPEN);
    await hub.connect(creator).claim(token);
    for (const [signer, value] of buyers) await hub.connect(signer).buyEth(token, 0, { value });
    return token;
  }

  return { hub, signers, launch, liveRoot };
}

describe("CommunityCoin", function () {
  describe("one meme, one ticker", function () {
    it("refuses any spelling of a ticker that already exists", async function () {
      const { hub, signers, launch } = await loadFixture(deploy);
      const pnut = await launch(signers[0], "PNUT");
      for (const copy of ["pnut", "$PNUT", "P.N.U.T", "PNU7", "p-n-u-t", "PNUT 🥜"]) {
        await expect(hub.launch("copy", copy, ETH))
          .to.be.revertedWithCustomError(hub, "MemeExists")
          .withArgs(await pnut.getAddress());
      }
    });

    it("folds leetspeak and still lets distinct memes launch", async function () {
      const { hub, signers, launch } = await loadFixture(deploy);
      await launch(signers[0], "PEPE");
      await expect(hub.launch("x", "P3P3", ETH)).to.be.revertedWithCustomError(hub, "MemeExists");
      await expect(hub.launch("x", "PEPE2", ETH)).not.to.be.reverted;
      await expect(hub.launch("x", "🥜", ETH)).to.be.revertedWithCustomError(hub, "InvalidSymbol");
      await expect(hub.launch("x", "ABCDEFGHIJKLMNOPQ", ETH)).to.be.revertedWithCustomError(hub, "InvalidSymbol");
    });
  });

  describe("fair opening", function () {
    it("gives every committer of the opening the same price", async function () {
      const { hub, signers, launch } = await loadFixture(deploy);
      const [dev, sniper, alice] = signers;
      const token = await launch(dev, "FAIR", ETH, eth(1));
      // The sniper lands in the very next block with a big bag, alice minutes later.
      await hub.connect(sniper).commit(token, eth(3), { value: eth(3) });
      await time.increase(200);
      await hub.connect(alice).commitEth(token, 0, { value: eth(0.5) });

      await expect(hub.connect(sniper).buyEth(token, 0, { value: eth(1) })).to.be.revertedWithCustomError(
        hub,
        "StillOpening",
      );
      await time.increase(OPEN);
      await expect(hub.connect(alice).commitEth(token, 0, { value: eth(1) })).to.be.revertedWithCustomError(
        hub,
        "OpeningClosed",
      );

      for (const s of [dev, sniper, alice]) await hub.connect(s).claim(token);
      const perEth = async (s, spent) => ((await token.balanceOf(s)) * eth(1)) / spent;
      const devRate = await perEth(dev, eth(1));
      expect(await perEth(sniper, eth(3))).to.be.closeTo(devRate, 10n);
      expect(await perEth(alice, eth(0.5))).to.be.closeTo(devRate, 10n);
    });

    it("leaves nothing to front-run: buying first after the batch is no better than the batch", async function () {
      const { hub, signers, launch } = await loadFixture(deploy);
      const [dev, alice, sniper] = signers;
      const token = await launch(dev, "SNIPE", ETH, eth(1));
      await hub.connect(alice).commit(token, eth(1), { value: eth(1) });
      await time.increase(OPEN);
      await hub.connect(sniper).buyEth(token, 0, { value: eth(1) });
      await hub.connect(alice).claim(token);
      expect(await token.balanceOf(sniper)).to.be.lt(await token.balanceOf(alice));
    });
  });

  describe("vesting of the opening batch", function () {
    const VEST = 3600;

    it("unlocks the launch price linearly, so it cannot be dumped on the first wave", async function () {
      const [dev, sniper] = await ethers.getSigners();
      const hub = await deployHub(OPEN, VEST, SPIKE, VOTE);
      await hub.connect(dev).launch("Vest", "VEST", ETH, { value: eth(1) });
      const token = await ethers.getContractAt("MemeToken", await hub.tokenOfKey(await hub.symbolKey("VEST")));
      await hub.connect(sniper).commit(token, eth(3), { value: eth(3) });
      await time.increase(OPEN);
      await hub.settle(token);
      const { batchTokens } = await hub.memes(token);
      const sniperShare = (batchTokens * 3n) / 4n;

      await time.increase(VEST / 4 - 1); // a quarter of the way
      await hub.connect(sniper).claim(token);
      expect(await token.balanceOf(sniper)).to.be.closeTo(sniperShare / 4n, sniperShare / 100n);
      await time.increase(60);
      await expect(hub.connect(sniper).claim(token)).not.to.be.reverted; // another minute has vested

      await time.increase(VEST);
      expect(await hub.claimable(token, sniper)).to.be.gt(0n);
      await hub.connect(sniper).claim(token);
      await hub.connect(dev).claim(token);
      expect(await token.balanceOf(sniper)).to.be.closeTo(sniperShare, 1n);
      await expect(hub.connect(sniper).claim(token)).to.be.revertedWithCustomError(hub, "NothingToClaim");
      expect(await token.totalSupply()).to.be.closeTo(batchTokens, 2n);
    });
  });

  describe("lineage: copies feed the original", function () {
    it("routes every buy of a variant through the original", async function () {
      const { hub, signers, launch, liveRoot } = await loadFixture(deploy);
      const [dev, holder, vamp, degen] = signers;
      const pnut = await liveRoot("PNUT", dev, [[holder, eth(2)]]);

      const priceBefore = await hub.priceInEth(pnut);
      const reserveBefore = await hub.realReserve(pnut);
      const holderValueBefore = await hub.quoteSellToEth(pnut, await pnut.balanceOf(holder));

      const variant = await launch(vamp, "PNUTWIFHAT", await pnut.getAddress(), eth(0.5));
      await time.increase(OPEN);
      await hub.connect(vamp).claim(variant);
      await hub.connect(degen).buyEth(variant, 0, { value: eth(3) });

      expect(await hub.priceInEth(pnut)).to.be.gt(priceBefore);
      expect((await hub.realReserve(pnut)) - reserveBefore).to.be.gt(eth(3.4)); // 3.5 ETH in, minus fees
      expect(await hub.quoteSellToEth(pnut, await pnut.balanceOf(holder))).to.be.gt(holderValueBefore);
      // The variant's reserve is PNUT held by the hub, not ETH.
      expect(await pnut.balanceOf(hub)).to.be.gte(await hub.realReserve(variant));
      expect([...(await hub.lineageOf(variant))]).to.deep.equal([await pnut.getAddress(), await variant.getAddress()]);
    });

    it("keeps money leaving a variant inside the family", async function () {
      const { hub, signers, launch, liveRoot } = await loadFixture(deploy);
      const [dev, vamp, degen] = signers;
      const pnut = await liveRoot("PNUT", dev);
      const variant = await launch(vamp, "PNUT2", await pnut.getAddress());
      await time.increase(OPEN);
      await hub.connect(degen).buyEth(variant, 0, { value: eth(1) });

      // Selling the variant pays out in PNUT, not ETH.
      const bag = await variant.balanceOf(degen);
      await hub.connect(degen).sell(variant, bag, 0);
      expect(await variant.balanceOf(degen)).to.equal(0n);
      expect(await pnut.balanceOf(degen)).to.be.gt(0n);

      // And PNUT can buy the next variant directly, no approval needed.
      const next = await launch(vamp, "PNUT3", await pnut.getAddress());
      await time.increase(OPEN);
      const pnutBag = await pnut.balanceOf(degen);
      const quotedNext = await hub.quoteBuy(next, pnutBag);
      await hub.connect(degen).buy(next, pnutBag, quotedNext);
      expect(await next.balanceOf(degen)).to.equal(quotedNext);

      // Single-step sells are quoted exactly too.
      const half = quotedNext / 2n;
      const quotedPnut = await hub.quoteSell(next, half);
      await sameTimestamp();
      await hub.connect(degen).sell(next, half, quotedPnut);
      expect(await pnut.balanceOf(degen)).to.equal(quotedPnut);
    });

    it("quotes routed trades exactly", async function () {
      const { hub, signers, launch, liveRoot } = await loadFixture(deploy);
      const [dev, vamp, degen] = signers;
      const pnut = await liveRoot("PNUT", dev);
      const child = await launch(vamp, "CHILD", await pnut.getAddress());
      const grandchild = await launch(vamp, "GRANDCHILD", await child.getAddress());
      await time.increase(OPEN);

      const expectedOut = await hub.quoteBuyEth(grandchild, eth(2));
      await hub.connect(degen).buyEth(grandchild, expectedOut, { value: eth(2) });
      expect(await grandchild.balanceOf(degen)).to.equal(expectedOut);

      await time.increase(REF_WINDOW);
      const expectedEth = await hub.quoteSellToEth(grandchild, expectedOut);
      await sameTimestamp();
      await expect(hub.connect(degen).sellToEth(grandchild, expectedOut, expectedEth)).to.changeEtherBalances(
        [degen, hub],
        [expectedEth, -expectedEth],
      );
      // A patient round trip through three curves costs six 1% fees, partly offset by selling back only the
      // top of each convex curve. No spike share: the reference price had caught up.
      expect(expectedEth).to.be.lt(eth(2)).and.gt((eth(2) * 94n) / 100n);
    });

    it("lets variants commit to their opening with ETH or with parent tokens", async function () {
      const { hub, signers, launch, liveRoot } = await loadFixture(deploy);
      const [dev, vamp, a, b] = signers;
      const pnut = await liveRoot("PNUT", dev, [[b, eth(1)]]);
      const variant = await launch(vamp, "PNUTX", await pnut.getAddress());

      await hub.connect(a).commitEth(variant, 0, { value: eth(1) }); // ETH routed through PNUT
      await hub.connect(b).commit(variant, await pnut.balanceOf(b)); // PNUT directly
      await expect(hub.connect(b).commit(variant, 1n, { value: 1n })).to.be.revertedWithCustomError(
        hub,
        "WrongValue",
      );
      const committedA = await hub.committed(variant, a);
      const committedB = await hub.committed(variant, b);
      await time.increase(OPEN);
      for (const s of [a, b]) await hub.connect(s).claim(variant);

      expect(await hub.realReserve(variant)).to.equal(committedA + committedB);
      const rate = async (s, c) => ((await variant.balanceOf(s)) * eth(1)) / c;
      expect(await rate(a, committedA)).to.be.closeTo(await rate(b, committedB), 10n);
    });

    it("caps the lineage depth", async function () {
      const { hub, signers, launch } = await loadFixture(deploy);
      let parent = await launch(signers[0], "D0");
      for (let d = 1; d <= 6; d++) parent = await launch(signers[0], `D${"ABCDEF"[d - 1]}`, await parent.getAddress());
      await expect(hub.launch("x", "TOODEEP", await parent.getAddress())).to.be.revertedWithCustomError(
        hub,
        "TooDeep",
      );
    });
  });

  describe("spike share: the wave's sellers pay the wave's buyers", function () {
    // The same story on two hubs, with and without the spike share: a batch buyer, a wave of buyers,
    // then the batch buyer dumps on the wave.
    async function dumpOnTheWave(spikeShare, dumpAfter) {
      const [dev, flipper, ...wave] = await ethers.getSigners();
      const hub = await deployHub(OPEN, 0, spikeShare, VOTE);
      await hub.connect(dev).launch("Wave", "WAVE", ETH);
      const token = await ethers.getContractAt("MemeToken", await hub.tokenOfKey(await hub.symbolKey("WAVE")));
      await hub.connect(flipper).commit(token, eth(1), { value: eth(1) });
      await time.increase(OPEN);
      await hub.connect(flipper).claim(token);
      for (const buyer of wave.slice(0, 5)) await hub.connect(buyer).buyEth(token, 0, { value: eth(2) });
      await time.increase(dumpAfter);
      const flipped = await hub.quoteSellToEth(token, await token.balanceOf(flipper));
      await hub.connect(flipper).sellToEth(token, await token.balanceOf(flipper), 0);
      // Later, the wave leaves too.
      await time.increase(REF_WINDOW);
      let stayers = 0n;
      for (const b of wave.slice(0, 5)) {
        const bag = await token.balanceOf(b);
        stayers += await hub.quoteSellToEth(token, bag);
        await sameTimestamp();
        await hub.connect(b).sellToEth(token, bag, 0);
      }
      return { hub, flipped, stayers };
    }

    it("takes half of what an instant flip makes above the reference price and gives it to the holders", async function () {
      const without = await dumpOnTheWave(0, 0);
      const withSpike = await dumpOnTheWave(SPIKE, 0);
      const taken = without.flipped - withSpike.flipped;
      expect(taken).to.be.gt(without.flipped / 5n); // dumping on the wave got a lot less attractive
      // The wave's buyers, who stayed, got it back (minus their own 1% exit fee).
      expect(withSpike.stayers - without.stayers).to.be.closeTo((taken * 99n) / 100n, taken / 1000n);
    });

    it("charges a full dump only on the part of it executed above the reference price", async function () {
      const [dev, bot, ...wave] = await ethers.getSigners();
      const hub = await deployHub(OPEN, 0, SPIKE, VOTE);
      await hub.connect(dev).launch("Dump", "DUMP", ETH, { value: eth(0.3) });
      const token = await ethers.getContractAt("MemeToken", await hub.tokenOfKey(await hub.symbolKey("DUMP")));
      await hub.connect(bot).commit(token, eth(2), { value: eth(2) });
      for (const w of wave.slice(0, 12)) await hub.connect(w).commitEth(token, 0, { value: eth(0.8) });
      await time.increase(OPEN);
      await hub.settle(token);
      for (const w of wave.slice(12, 24)) await hub.connect(w).buyEth(token, 0, { value: eth(0.8) });
      await time.increase(600);
      await hub.connect(bot).claim(token);

      const bag = await token.balanceOf(bot);
      const ref = await hub.referencePrice(token);
      const { vQuote, vToken } = await hub.memes(token);
      const WAD = 10n ** 18n;
      const sqrt = (n) => {
        let x = n, y = (x + 1n) / 2n;
        while (y < x) [x, y] = [y, (y + n / y) / 2n];
        return x;
      };
      const sellOut = (q) => vQuote - (vQuote * vToken + vToken + q - 1n) / (vToken + q);
      const spot = (vQuote * WAD) / vToken;
      const aboveRef = (vToken * sqrt((spot * WAD * WAD) / ref)) / WAD - vToken;
      const excess = sellOut(aboveRef) - (aboveRef * ref) / WAD;

      expect(aboveRef).to.be.lt(bag);
      expect((sellOut(bag) * WAD) / bag).to.be.lt(ref); // on average the dump sells below the reference...
      expect(excess).to.be.gt(0n); // ...but its first slice does not
      await sameTimestamp();
      await expect(hub.connect(bot).sellToEth(token, bag, 0))
        .to.emit(hub, "Trade")
        .withArgs(token, bot.address, false, sellOut(bag), bag, anyValue, (excess * BigInt(SPIKE)) / 10_000n);
    });

    it("costs nothing to a patient seller", async function () {
      const without = await dumpOnTheWave(0, REF_WINDOW);
      const withSpike = await dumpOnTheWave(SPIKE, REF_WINDOW);
      expect(withSpike.flipped).to.equal(without.flipped);
    });

    it("costs nothing in a falling market", async function () {
      const { hub, signers, liveRoot } = await loadFixture(deploy);
      const [dev, a, b] = signers;
      const token = await liveRoot("FALL", dev, [
        [a, eth(2)],
        [b, eth(2)],
      ]);
      await time.increase(REF_WINDOW);
      await hub.connect(a).sellToEth(token, await token.balanceOf(a), 0); // price drops below the reference
      await expect(hub.connect(b).sellToEth(token, await token.balanceOf(b), 0))
        .to.emit(hub, "Trade")
        .withArgs(await token.getAddress(), b.address, false, (x) => x > 0n, (x) => x > 0n, (x) => x > 0n, 0n);
    });

    it("tracks the spot price over an hour", async function () {
      const { hub, signers, liveRoot } = await loadFixture(deploy);
      const [dev, whale] = signers;
      const token = await liveRoot("REF", dev);
      const before = await hub.referencePrice(token);
      await hub.connect(whale).buyEth(token, 0, { value: eth(5) });
      const spot = await hub.priceOf(token);
      expect(await hub.referencePrice(token)).to.equal(before);
      await time.increase(REF_WINDOW / 2);
      expect(await hub.referencePrice(token)).to.be.closeTo((before + spot) / 2n, (spot - before) / 1000n);
      await time.increase(REF_WINDOW);
      expect(await hub.referencePrice(token)).to.equal(spot);
    });

    it("refuses a spike share that could exceed the proceeds", async function () {
      const factory = await ethers.getContractFactory("CommunityCoin");
      await expect(factory.deploy(OPEN, 0, 9901, VOTE, PROTOCOL, (await treasury()).address)).to.be.revertedWithCustomError(factory, "InvalidConfig");
    });
  });

  describe("creator and protocol fees", function () {
    it("pays creators in the asset their meme is quoted in, minus the protocol's cut", async function () {
      const { hub, signers, launch, liveRoot } = await loadFixture(deploy);
      const [dev, vamp, degen] = signers;
      const protocol = await treasury();
      const pnut = await liveRoot("PNUT", dev);
      const variant = await launch(vamp, "PNUTY", await pnut.getAddress());
      await time.increase(OPEN);
      const tx = await hub.connect(degen).buyEth(variant, 0, { value: eth(1) });

      // The first hop pays 1% of the ETH: 0.8% to PNUT's creator, 0.2% to the protocol.
      const devFee = await hub.feesOf(dev, ETH);
      expect(devFee).to.equal(eth(0.008));
      expect(await hub.feesOf(protocol, ETH)).to.equal(eth(0.002));
      // The second hop pays 1% of the PNUT it spends, split the same way, in PNUT.
      const hops = (await tx.wait()).logs.map((l) => { try { return hub.interface.parseLog(l); } catch { return null; } }).filter((e) => e?.name === "Trade");
      const pnutIn = hops[1].args.quoteAmount;
      const vampFee = await hub.feesOf(vamp, await pnut.getAddress());
      const protocolPnut = await hub.feesOf(protocol, await pnut.getAddress());
      expect(protocolPnut).to.equal((pnutIn * 20n) / 10_000n);
      expect(vampFee + protocolPnut).to.equal(hops[1].args.fee);
      expect(hops[1].args.fee).to.equal((pnutIn * 100n) / 10_000n);

      await expect(hub.connect(dev).claimFees(ETH)).to.changeEtherBalance(dev, devFee);
      await hub.connect(vamp).claimFees(pnut);
      expect(await pnut.balanceOf(vamp)).to.equal(vampFee);
      await expect(hub.connect(vamp).claimFees(pnut)).to.be.revertedWithCustomError(hub, "NothingToClaim");
      await expect(hub.connect(protocol).claimFees(ETH)).to.changeEtherBalance(protocol, eth(0.002));
      await hub.connect(protocol).claimFees(pnut);
      expect(await pnut.balanceOf(protocol)).to.equal(protocolPnut);
    });

    it("never charges traders more than 1%: the protocol's cut comes out of the creator's fee", async function () {
      const withCut = await deployHub(OPEN, 0, SPIKE, VOTE, PROTOCOL);
      const without = await deployHub(OPEN, 0, SPIKE, VOTE, 0);
      const [dev] = await ethers.getSigners();
      for (const hub of [withCut, without]) {
        await hub.connect(dev).launch("PNUT coin", "PNUT", ETH, { value: eth(0.1) });
      }
      await time.increase(OPEN);
      const quote = async (hub) => hub.quoteBuyEth(await hub.tokenOfKey(await hub.symbolKey("PNUT")), eth(1));
      expect(await quote(withCut)).to.equal(await quote(without));
    });

    it("caps the protocol's cut at half the fee and needs somewhere to send it", async function () {
      const factory = await ethers.getContractFactory("CommunityCoin");
      const to = (await treasury()).address;
      await expect(factory.deploy(OPEN, 0, SPIKE, VOTE, 51, to)).to.be.revertedWithCustomError(factory, "InvalidConfig");
      await expect(factory.deploy(OPEN, 0, SPIKE, VOTE, PROTOCOL, ETH)).to.be.revertedWithCustomError(factory, "InvalidConfig");
      const hub = await factory.deploy(OPEN, 0, SPIKE, VOTE, 50, to);
      expect(await hub.protocolFeeBps()).to.equal(50n);
      expect(await hub.feeRecipient()).to.equal(to);
    });
  });

  describe("union: rival memes merge instead of fighting", function () {
    async function rivals() {
      const f = await deploy();
      const [devA, devB, alice, bob, carol] = f.signers;
      const pnut = await f.liveRoot("PNUT", devA, [[carol, eth(5)]]);
      const peanut = await f.liveRoot("PEANUT", devB, [
        [alice, eth(3)],
        [bob, eth(1)],
      ]);
      return { ...f, pnut, peanut, devA, devB, alice, bob, carol };
    }

    it("moves a rival root and its reserve into the target family", async function () {
      const { hub, pnut, peanut, alice, bob } = await loadFixture(rivals);
      const supply = await peanut.totalSupply();
      const aliceBag = await peanut.balanceOf(alice);
      expect(aliceBag * 2n).to.be.gt(supply);

      await hub.connect(bob).proposeUnion(peanut, pnut);
      await hub.connect(alice).lockUnion(0, aliceBag);
      await expect(hub.executeUnion(0, 0)).to.be.revertedWithCustomError(hub, "VotingOpen");
      await time.increase(VOTE + 1);

      const ethReserve = await hub.realReserve(peanut);
      const pnutReserveBefore = await hub.realReserve(pnut);
      const priceBefore = await hub.priceInEth(peanut);
      const bobBag = await peanut.balanceOf(bob);

      await expect(hub.executeUnion(0, 0)).to.emit(hub, "UnionExecuted");

      const [parent] = await hub.memes(peanut);
      expect(parent).to.equal(await pnut.getAddress());
      expect(await hub.realReserve(pnut)).to.equal(pnutReserveBefore + ethReserve);
      expect(await hub.realReserve(peanut)).to.equal(await pnut.balanceOf(hub));
      expect(await peanut.balanceOf(bob)).to.equal(bobBag); // balances untouched
      expect(await hub.priceInEth(peanut)).to.be.gte(priceBefore); // bulk buy pushed PNUT up
      expect([...(await hub.childrenOf(pnut))]).to.deep.equal([await peanut.getAddress()]);

      // Voters get their tokens back; a non-voter exits through the new family.
      await hub.connect(alice).unlockUnion(0);
      expect(await peanut.balanceOf(alice)).to.equal(aliceBag);
      const quoted = await hub.quoteSellToEth(peanut, bobBag);
      await sameTimestamp();
      await expect(hub.connect(bob).sellToEth(peanut, bobBag, quoted)).to.changeEtherBalance(bob, quoted);
    });

    it("needs a majority of the supply and lets everyone change their mind", async function () {
      const { hub, pnut, peanut, alice, bob } = await loadFixture(rivals);
      await hub.connect(alice).proposeUnion(peanut, pnut);
      await hub.connect(bob).lockUnion(0, await peanut.balanceOf(bob));
      await hub.connect(alice).lockUnion(0, await peanut.balanceOf(alice));
      await hub.connect(alice).unlockUnion(0);
      await time.increase(VOTE + 1);
      await expect(hub.executeUnion(0, 0)).to.be.revertedWithCustomError(hub, "QuorumNotReached");
      await expect(hub.connect(bob).lockUnion(0, 1n)).to.be.revertedWithCustomError(hub, "VotingClosed");
      await hub.connect(bob).unlockUnion(0);
      expect(await peanut.balanceOf(hub)).to.equal(0n);
    });

    it("lets dissenters leave on the curve during the vote", async function () {
      const { hub, pnut, peanut, alice, bob } = await loadFixture(rivals);
      await hub.connect(alice).proposeUnion(peanut, pnut);
      await hub.connect(alice).lockUnion(0, await peanut.balanceOf(alice));
      const bag = await peanut.balanceOf(bob);
      const quoted = await hub.quoteSellToEth(peanut, bag);
      await sameTimestamp();
      await expect(hub.connect(bob).sellToEth(peanut, bag, 0)).to.changeEtherBalance(bob, quoted);
      await time.increase(VOTE + 1);
      await hub.executeUnion(0, 0);
    });

    it("brings the rival's own variants along", async function () {
      const { hub, launch, pnut, peanut, devB, alice } = await loadFixture(rivals);
      const kid = await launch(devB, "PEANUTJR", await peanut.getAddress());
      await time.increase(OPEN);
      await hub.connect(alice).buyEth(kid, 0, { value: eth(1) });
      await hub.connect(alice).proposeUnion(peanut, pnut);
      await hub.connect(alice).lockUnion(0, await peanut.balanceOf(alice));
      await time.increase(VOTE + 1);
      await hub.executeUnion(0, 0);
      expect(await hub.rootOf(kid)).to.equal(await pnut.getAddress());
      expect(await hub.depthOf(kid)).to.equal(2n);
      const [, , , height] = await hub.memes(pnut);
      expect(height).to.equal(2n);
      await hub.connect(alice).sellToEth(kid, await kid.balanceOf(alice), 1n);
    });

    it("refuses cycles, non-roots and unknown proposals", async function () {
      const { hub, launch, pnut, peanut, devA } = await loadFixture(rivals);
      const kid = await launch(devA, "PNUTKID", await pnut.getAddress());
      await expect(hub.proposeUnion(pnut, kid)).to.be.revertedWithCustomError(hub, "CycleDetected");
      await expect(hub.proposeUnion(pnut, pnut)).to.be.revertedWithCustomError(hub, "CycleDetected");
      await expect(hub.proposeUnion(kid, peanut)).to.be.revertedWithCustomError(hub, "NotRoot");
      await expect(hub.lockUnion(7, 1n)).to.be.revertedWithCustomError(hub, "UnknownUnion");
    });
  });

  describe("solvency", function () {
    // Deterministic pseudo-random walk over every action, checking the hub's books at each step.
    function rng(seed) {
      let s = seed >>> 0;
      return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 2 ** 32;
      };
    }

    async function checkBooks(hub, tokens, creators, voters) {
      const all = await Promise.all(tokens.map(async (t) => ({ t, addr: await t.getAddress() })));
      const owed = new Map([[ETH, 0n]]);
      for (const { addr } of all) owed.set(addr, 0n);
      for (const { addr } of all) {
        const m = await hub.memes(addr);
        const parent = m.parent;
        const pending = m.settled ? 0n : m.batchQuote;
        owed.set(parent, owed.get(parent) + (m.vQuote - m.floor) + pending);
      }
      for (const c of creators)
        for (const asset of owed.keys()) owed.set(asset, owed.get(asset) + (await hub.feesOf(c, asset)));
      const unions = Number(await hub.unionCount());
      for (let id = 0; id < unions; id++) {
        const u = await hub.unions(id);
        for (const v of voters) owed.set(u.meme, owed.get(u.meme) + (await hub.lockedOf(id, v)));
      }
      expect(await ethers.provider.getBalance(hub)).to.equal(owed.get(ETH));
      for (const { t, addr } of all) expect(await t.balanceOf(hub)).to.equal(owed.get(addr));
    }

    for (const seed of [1, 42, 1337, 2026]) it(`can always buy back every token, whatever the trades and unions (seed ${seed})`, async function () {
      const { hub, signers, launch } = await loadFixture(deploy);
      const rand = rng(seed);
      const pick = (arr) => arr[Math.floor(rand() * arr.length)];
      const creators = signers.slice(0, 3);
      const traders = signers.slice(3, 9);
      const earners = [...creators, await treasury()]; // everyone fees are owed to

      const a = await launch(creators[0], "AAA", ETH, eth(1));
      const b = await launch(creators[1], "BBB", ETH, eth(0.5));
      const a1 = await launch(creators[2], "AAA1", await a.getAddress());
      const b1 = await launch(creators[1], "BBB1", await b.getAddress());
      const tokens = [a, b, a1, b1];
      await hub.connect(traders[0]).commit(a, eth(0.3), { value: eth(0.3) });
      await time.increase(OPEN);
      await hub.connect(creators[0]).claim(a);
      await hub.connect(creators[1]).claim(b);
      await hub.connect(traders[0]).claim(a);
      const a2 = await launch(creators[2], "AAA2", await a1.getAddress(), eth(0.2));
      tokens.push(a2);

      for (let step = 0; step < 60; step++) {
        const who = pick(traders);
        const t = pick(tokens);
        const bal = await t.balanceOf(who);
        const r = rand();
        try {
          if (r < 0.45 || bal === 0n) {
            await hub.connect(who).buyEth(t, 0, { value: eth((0.05 + rand() * 2).toFixed(3)) });
          } else if (r < 0.75) {
            await hub.connect(who).sellToEth(t, (bal * BigInt(1 + Math.floor(rand() * 100))) / 100n, 0);
          } else {
            await hub.connect(who).sell(t, (bal * BigInt(1 + Math.floor(rand() * 100))) / 100n, 0);
          }
        } catch (e) {
          if (!/StillOpening|ZeroAmount/.test(e.message)) throw e;
        }
        if (step === 20) {
          await time.increase(OPEN);
          await hub.connect(creators[2]).claim(a2);
          await hub.connect(traders[1]).buyEth(b, 0, { value: eth(4) });
          await hub.connect(traders[1]).proposeUnion(b, a1);
          await hub.connect(traders[1]).lockUnion(0, await b.balanceOf(traders[1]));
        }
        if (step === 40) {
          // Every holder votes for the union, then everyone takes their tokens back.
          const holders = signers.slice(0, 9);
          for (const h of holders) {
            const bal = await b.balanceOf(h);
            if (bal > 0n) await hub.connect(h).lockUnion(0, bal);
          }
          await time.increase(VOTE + 1);
          await hub.executeUnion(0, 0);
          for (const h of holders) if ((await hub.lockedOf(0, h)) > 0n) await hub.connect(h).unlockUnion(0);
        }
        if (step % 10 === 0) await checkBooks(hub, tokens, earners, signers.slice(0, 9));
      }
      await checkBooks(hub, tokens, earners, signers.slice(0, 9));

      // Everybody exits, deepest memes first, creators cashing out their fees as they go.
      // Every sale must succeed and the whole system must unwind to nothing.
      const depths = new Map();
      for (const t of tokens) depths.set(t, await hub.depthOf(t));
      const byDepth = [...tokens].sort((x, y) => Number(depths.get(y) - depths.get(x)));
      const everyone = [...signers.slice(0, 9), await treasury()];
      for (let round = 0; round < 8; round++) {
        for (const c of earners)
          for (const asset of [ETH, ...(await Promise.all(tokens.map((t) => t.getAddress())))])
            if ((await hub.feesOf(c, asset)) > 0n) await hub.connect(c).claimFees(asset);
        for (const t of byDepth)
          for (const s of everyone) {
            const bal = await t.balanceOf(s);
            if (bal > 0n) await hub.connect(s).sellToEth(t, bal, 0);
          }
      }
      await checkBooks(hub, tokens, earners, signers.slice(0, 9));
      // Nobody holds anything any more. What is left is rounding dust, which always favours the reserve:
      // wei of parent tokens in the reserves of sold-out variants (scaled up by a union's exchange rate),
      // and the few wei of ETH backing them.
      for (const t of tokens) {
        expect(await t.totalSupply()).to.equal(await t.balanceOf(hub));
        expect(await t.totalSupply()).to.be.lt(1_000_000n);
      }
      expect(await ethers.provider.getBalance(hub)).to.be.lt(1000n);
    });
  });
});
