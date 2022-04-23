const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  beforeHook,
  beforeEachHook,
  minimizeBondPeriod,
  timeTravelBlocks,
  forceFHMBondMinimumPositive,
  forceFHMBondNegative,
  forceHighMaxDebt,
} = require("../../../utils/testUtils.ts");
const { addressBook } = require("blockchain-addressbook");
const {
  FHM,
  FHM_STAKER,
  STAKED_FHM,
  FHM_STAKE_MANAGER,
  FHM_DAI_PAIR,
  BOGUS_ADDR_1,
  BOGUS_ADDR_2,
  TEST_TIMEOUT,
  FHM_DAI_BOND,
  FHM_DAI_ROUTE,
  FHM_WFTM_BOND,
  FHM_WFTM_ROUTE,
  FHM_DAI_LP_BOND,
  SLOW_TEST_FLAG,
  FANTOHM_TEST_FLAG,
  FHM_BOND_CALCULATOR,
  FHM_WHALES,
  FHM_TREASURY,
} = require("../../../constants.js");

const { spookyswap } = addressBook.fantom.platforms;
const devAddress = BOGUS_ADDR_2;

const contractNames = {
  vault: "MinimumVault",
  strategy: "StrategyFantOHM",
};

const vaultConfig = {
  name: "Minimum FantOHM",
  symbol: "minFHM",
  stratApprovalDelay: 21600,
  wantCap: ethers.utils.parseUnits("6000", 9),
};

const stratConfig = {
  rebaseStaker: FHM_STAKER,
  stakeManager: FHM_STAKE_MANAGER,
  keeper: BOGUS_ADDR_1,
  unirouter: spookyswap.router,
  serviceFeeRecipient: devAddress,
  minDeposit: 100,
  discordLink: "https://discord.gg/fS5ZUwDtVK",
};

describe(FANTOHM_TEST_FLAG + " Strategy rebaseBonded", function () {
  let vault,
    strategy,
    unirouter,
    fhm,
    stakedFhm,
    deployer,
    keeper,
    other,
    whale,
    daiBondDepository,
    wftmBondDepository,
    fhmDaiBondDepository,
    lpBondCalculator,
    stakeManager,
    stakingHelper,
    daiWftmPair,
    rebaseTokenBalStart,
    daiValueInitial,
    treasury,
    unirouterData;

  this.slow(20000);

  before(async () => {
    ({
      rebaseToken: fhm,
      stakedRebaseToken: stakedFhm,
      unirouter,
      unirouterData,
      whale,
      daiBondDepository,
      wftmBondDepository,
      daiLPBondDepository: fhmDaiBondDepository,
      lpBondCalculator,
      daiWftmPair,
      stakeManager,
      treasury,
      stakingHelper,
    } = await beforeHook({
      provider: ethers.provider,
      stratConfig,
      rebaseTokenAddr: FHM,
      stakedRebaseTokenAddr: STAKED_FHM,
      daiBondAddr: FHM_DAI_BOND,
      wftmBondAddr: FHM_WFTM_BOND,
      daiLPBondAddr: FHM_DAI_LP_BOND,
      lpBondCalculatorAddr: FHM_BOND_CALCULATOR,
      stakeManagerAddr: FHM_STAKE_MANAGER,
      whales: FHM_WHALES,
      whaleToken: STAKED_FHM,
      treasuryAddr: FHM_TREASURY,
      fundStaked: true,
      stakingHelperAddr: FHM_STAKER,
    }));
  });

  beforeEach(async () => {
    ({
      vault,
      strategy,
      rebaseTokenBalStart,
      daiValueInitial,
      deployer,
      keeper,
      other,
    } = await beforeEachHook({
      contractNames,
      vaultConfig,
      stratConfig,
      unirouter,
      rebaseToken: fhm,
      whale,
      stakedRebaseToken: stakedFhm,
      fundStaked: true,
    }));
    await forceHighMaxDebt(ethers.provider, daiBondDepository);
    await forceHighMaxDebt(ethers.provider, wftmBondDepository);
    await forceHighMaxDebt(ethers.provider, fhmDaiBondDepository);
  });

  it("When just staking, rebaseBonded should be 0", async function () {
    await vault.depositAll();
    expect(await strategy.isBonding()).to.equal(await vault.isBonding()).to.be
      .false;

    expect(await stakedFhm.balanceOf(strategy.address))
      .to.equal(await strategy.totalBalance())
      .to.equal(await strategy.stakedRebasing())
      .to.equal(await vault.balance());

    expect(await strategy.rebaseBonded()).to.equal(0);
  }).timeout(TEST_TIMEOUT);

  it("When just bonded all, rebaseBonded should be totalBalance (includes bond gains)", async function () {
    await vault.depositAll();
    expect(await strategy.isBonding()).to.equal(await vault.isBonding()).to.be
      .false;

    expect(await stakedFhm.balanceOf(strategy.address))
      .to.equal(await strategy.totalBalance())
      .to.equal(await strategy.stakedRebasing())
      .to.equal(await vault.balance());

    await strategy.addBond(FHM_DAI_BOND);
    await strategy.stakeToBondSingleAll(FHM_DAI_BOND, FHM_DAI_ROUTE);

    expect(await stakedFhm.balanceOf(strategy.address))
      .to.equal(await strategy.stakedRebasing())
      .to.equal(await strategy.totalRebasing())
      .to.equal(0);
    expect(await vault.balance())
      .to.equal(await strategy.totalBalance())
      .to.equal(await strategy.rebaseBonded());

    // gains immediately realized
    expect(await vault.balance()).to.gt(rebaseTokenBalStart);
  }).timeout(TEST_TIMEOUT);

  it("Just bonded all add unstaked, rebaseBonded should be totalBalance - unstaked", async function () {
    await vault.depositAll();
    expect(await strategy.isBonding()).to.equal(await vault.isBonding()).to.be
      .false;

    expect(await stakedFhm.balanceOf(strategy.address))
      .to.equal(await strategy.totalBalance())
      .to.equal(await strategy.stakedRebasing())
      .to.equal(await vault.balance());

    await strategy.addBond(FHM_DAI_BOND);
    await strategy.stakeToBondSingleAll(FHM_DAI_BOND, FHM_DAI_ROUTE);

    const bondDetails = await daiBondDepository.bondInfo(strategy.address);

    expect(await stakedFhm.balanceOf(strategy.address))
      .to.equal(await strategy.stakedRebasing())
      .to.equal(await strategy.totalRebasing())
      .to.equal(0);
    expect(await vault.balance())
      .to.equal(await strategy.totalBalance())
      .to.equal(await strategy.rebaseBonded());

    await vault.connect(whale).deposit(rebaseTokenBalStart);
    await strategy.unstakeAll();

    expect(await vault.balance())
      .to.eq(
        (await strategy.unstakedRebasing()).add(await strategy.rebaseBonded())
      )
      .to.eq(rebaseTokenBalStart.add(bondDetails.payout));
    expect(await strategy.rebaseBonded()).to.eq(bondDetails.payout);
    expect(await strategy.unstakedRebasing()).to.eq(rebaseTokenBalStart);
  }).timeout(TEST_TIMEOUT);

  it("Before bonding add unstaked, rebaseBonded should be totalBalance (DAI bond)", async function () {
    await vault.depositAll();
    expect(await strategy.isBonding()).to.equal(await vault.isBonding()).to.be
      .false;

    expect(await stakedFhm.balanceOf(strategy.address))
      .to.equal(await strategy.totalBalance())
      .to.equal(await strategy.stakedRebasing())
      .to.equal(await vault.balance());

    await strategy.unstake(rebaseTokenBalStart.div(2));

    await strategy.addBond(FHM_DAI_BOND);
    await strategy.stakeToBondSingleAll(FHM_DAI_BOND, FHM_DAI_ROUTE);

    expect(await stakedFhm.balanceOf(strategy.address))
      .to.equal(await strategy.stakedRebasing())
      .to.equal(await strategy.totalRebasing())
      .to.equal(0);
    expect(await vault.balance())
      .to.equal(await strategy.totalBalance())
      .to.equal(await strategy.rebaseBonded());
  }).timeout(TEST_TIMEOUT);

  it("Before bonding add unstaked, rebaseBonded should be totalBalance with some staked scraps (FHM-DAI LP bond)", async function () {
    await vault.depositAll();
    expect(await strategy.isBonding()).to.equal(await vault.isBonding()).to.be
      .false;

    expect(await stakedFhm.balanceOf(strategy.address))
      .to.equal(await strategy.totalBalance())
      .to.equal(await strategy.stakedRebasing())
      .to.equal(await vault.balance());

    await strategy.unstake(rebaseTokenBalStart.div(2));

    await strategy.addBond(FHM_DAI_LP_BOND);
    await strategy
      .connect(keeper)
      .stakeToBondLPAll(FHM_DAI_LP_BOND, FHM_DAI_ROUTE, [FHM]);

    const bondDetails = await fhmDaiBondDepository.bondInfo(strategy.address);

    expect(await stakedFhm.balanceOf(strategy.address))
      .to.equal(await strategy.stakedRebasing())
      .to.equal(await strategy.totalRebasing())
      .to.gt(0);
    expect(await strategy.stakedRebasing()).to.lt(
      rebaseTokenBalStart.mul(2).div(100)
    );
    expect(await vault.balance())
      .to.equal(await strategy.totalBalance())
      .to.equal(
        (await strategy.rebaseBonded()).add(await strategy.stakedRebasing())
      );

    expect(await strategy.rebaseBonded()).to.eq(bondDetails.payout);
  }).timeout(TEST_TIMEOUT);

  it("When just bonded x amount of rebasing balance, rebaseBonded should be x", async function () {
    await vault.depositAll();
    expect(await strategy.isBonding()).to.equal(await vault.isBonding()).to.be
      .false;

    expect(await stakedFhm.balanceOf(strategy.address))
      .to.equal(await strategy.totalBalance())
      .to.equal(await strategy.stakedRebasing())
      .to.equal(await vault.balance());

    await strategy.addBond(FHM_DAI_BOND);
    await strategy.stakeToBondSingle(
      rebaseTokenBalStart.div(2),
      FHM_DAI_BOND,
      FHM_DAI_ROUTE
    );
    const bondDetails = await daiBondDepository.bondInfo(strategy.address);

    expect(await strategy.totalBalance())
      .to.equal(
        (await strategy.rebaseBonded()).add(await strategy.stakedRebasing())
      )
      .to.gt(rebaseTokenBalStart);
    expect(await strategy.rebaseBonded()).to.equal(bondDetails.payout);
  }).timeout(TEST_TIMEOUT);

  it(
    SLOW_TEST_FLAG +
      "Bond lifecycle rebaseBonded test (positive bond | DAI Bond)",
    async function () {
      await minimizeBondPeriod(ethers.provider, daiBondDepository);

      await vault.depositAll();

      expect(await vault.balance())
        .to.equal(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.equal(rebaseTokenBalStart);

      await strategy.addBond(FHM_DAI_BOND);
      await strategy.stakeToBondSingleAll(FHM_DAI_BOND, FHM_DAI_ROUTE);

      let bondDetails = await daiBondDepository.bondInfo(strategy.address);

      expect(await strategy.rebaseBonded())
        .to.equal(await vault.balance())
        .to.equal(bondDetails.payout);

      // Travel to ~ halfway into the bond
      await timeTravelBlocks(ethers.provider, 5000);
      let balBefore = await strategy.stakedRebasing();
      await stakeManager.rebase();
      let rebaseAmount = (await strategy.stakedRebasing()).sub(balBefore);

      let bondPayout = (
        await daiBondDepository.pendingPayoutFor(strategy.address)
      ).add(bondDetails.payout.div(10000)); // Notice the actual payout will be one block more

      await strategy.redeemAndStake();

      const rebaseBonded = await strategy.rebaseBonded();
      const redeemFee = await strategy.serviceFee();
      const redeemFeeDenom = await strategy.SERVICE_FEE_DIVISOR();
      const redeemFeeAmount = bondPayout.mul(redeemFee).div(redeemFeeDenom);

      expect(await vault.balance()).to.equal(
        bondDetails.payout.add(rebaseAmount)
      );
      expect(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.gt(rebaseTokenBalStart.div(2));
      expect(rebaseBonded).to.lt(bondDetails.payout.div(2));
      expect(await strategy.totalRebasing()).to.equal(
        bondDetails.payout.sub(rebaseBonded)
      );

      // Allow some error from division
      expect(rebaseBonded).to.lte(bondDetails.payout.sub(bondPayout).add(1));
      expect(rebaseBonded).to.gte(bondDetails.payout.sub(bondPayout).sub(1));

      // Travel near the end of the bond
      await timeTravelBlocks(ethers.provider, 4990);
      await stakeManager.rebase();
      await strategy.redeemAndStake();

      bondDetails = await daiBondDepository.bondInfo(strategy.address);

      expect(bondDetails.payout)
        .to.eq(await strategy.rebaseBonded())
        .to.gt(0);

      expect((await strategy.stakedRebasing()).add(bondDetails.payout))
        .to.equal(await vault.balance())
        .to.gt(rebaseTokenBalStart);

      // Travel to the end of the bond
      await timeTravelBlocks(ethers.provider, 5);
      await stakeManager.rebase();

      await strategy.redeemAndStake();

      expect(await strategy.stakedRebasing())
        .to.equal(await vault.balance())
        .to.gt(rebaseTokenBalStart);
      expect(await strategy.rebaseBonded()).to.equal(0);
    }
  ).timeout(TEST_TIMEOUT * 2);

  it(
    SLOW_TEST_FLAG +
      "Bond lifecycle rebaseBonded test (positive bond | WFTM Bond)",
    async function () {
      await minimizeBondPeriod(ethers.provider, wftmBondDepository);
      await forceFHMBondMinimumPositive(
        ethers.provider,
        wftmBondDepository,
        strategy
      );

      await vault.depositAll();

      expect(await vault.balance())
        .to.equal(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.equal(rebaseTokenBalStart);

      expect(await strategy.availableRebaseToken())
        .to.eq(await strategy.stakedRebasing())
        .to.lt(await strategy.maxBondSize(wftmBondDepository.address));

      await strategy.addBond(FHM_WFTM_BOND);
      await strategy.stakeToBondSingleAll(FHM_WFTM_BOND, FHM_WFTM_ROUTE);

      let bondDetails = await wftmBondDepository.bondInfo(strategy.address);
      expect(await strategy.rebaseBonded())
        .to.equal(await vault.balance())
        .to.equal(bondDetails.payout);

      // Travel to ~ halfway into the bond
      await timeTravelBlocks(ethers.provider, 5000);
      let balBefore = await strategy.stakedRebasing();
      await stakeManager.rebase();
      let rebaseAmount = (await strategy.stakedRebasing()).sub(balBefore);

      let bondPayout = (
        await wftmBondDepository.pendingPayoutFor(strategy.address)
      ).add(bondDetails.payout.div(10000)); // Notice the actual payout will be one block more

      await strategy.redeemAndStake();

      const rebaseBonded = await strategy.rebaseBonded();

      expect(await vault.balance()).to.equal(
        bondDetails.payout.add(rebaseAmount)
      );
      expect(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.gt(rebaseTokenBalStart.div(2));
      expect(rebaseBonded).to.gt(rebaseTokenBalStart.div(2));
      expect(rebaseBonded).to.lt(bondDetails.payout.mul(1001).div(2000));
      expect(rebaseBonded).to.gt(bondDetails.payout.mul(999).div(2000));
      expect(await strategy.totalRebasing()).to.equal(
        bondDetails.payout.sub(rebaseBonded)
      );

      // Travel near the end of the bond
      await timeTravelBlocks(ethers.provider, 4990);
      await stakeManager.rebase();
      await strategy.redeemAndStake();

      bondDetails = await wftmBondDepository.bondInfo(strategy.address);

      expect((await strategy.stakedRebasing()).add(bondDetails.payout))
        .to.equal(await vault.balance())
        .to.gt(rebaseTokenBalStart);
      expect(await strategy.rebaseBonded()).to.gt(0);

      // Travel to the end of the bond
      await timeTravelBlocks(ethers.provider, 5);
      await stakeManager.rebase();
      await strategy.redeemAndStake();

      expect(await strategy.stakedRebasing())
        .to.equal(await vault.balance())
        .to.gt(rebaseTokenBalStart);
      expect(await strategy.rebaseBonded()).to.equal(0);
    }
  ).timeout(TEST_TIMEOUT * 2);

  it(
    SLOW_TEST_FLAG +
      "Bond lifecycle (with unstaked) rebaseBonded test (positive bond | WFTM Bond)",
    async function () {
      await minimizeBondPeriod(ethers.provider, wftmBondDepository);

      await vault.depositAll();

      expect(await vault.balance())
        .to.equal(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.equal(rebaseTokenBalStart);

      await strategy.addBond(FHM_WFTM_BOND);
      await strategy.stakeToBondSingleAll(FHM_WFTM_BOND, FHM_WFTM_ROUTE);

      let bondDetails = await wftmBondDepository.bondInfo(strategy.address);
      expect(await strategy.rebaseBonded())
        .to.equal(await vault.balance())
        .to.equal(bondDetails.payout);

      // Travel to ~ halfway into the bond
      await timeTravelBlocks(ethers.provider, 5000);
      let balBefore = await strategy.stakedRebasing();
      await stakeManager.rebase();
      let rebaseAmount = (await strategy.stakedRebasing()).sub(balBefore);

      let bondPayout = (
        await wftmBondDepository.pendingPayoutFor(strategy.address)
      ).add(bondDetails.payout.div(10000)); // Notice the actual payout will be one block more

      await vault.connect(whale).deposit(rebaseTokenBalStart);
      await strategy.unstakeAll();

      expect(await strategy.totalRebasing())
        .to.eq(await strategy.unstakedRebasing())
        .to.eq(rebaseTokenBalStart);

      await strategy.redeemAndStake();

      const rebaseBonded = await strategy.rebaseBonded();

      expect(await vault.balance()).to.equal(
        bondDetails.payout.add(rebaseTokenBalStart).add(rebaseAmount)
      );
      expect(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.gt(rebaseTokenBalStart.div(2).add(rebaseTokenBalStart));
      expect(rebaseBonded).to.gt(rebaseTokenBalStart.div(2));
      expect(rebaseBonded).to.lt(bondDetails.payout.mul(1001).div(2000));
      expect(rebaseBonded).to.gt(bondDetails.payout.mul(999).div(2000));
      expect(await strategy.totalRebasing()).to.equal(
        bondDetails.payout.sub(rebaseBonded).add(rebaseTokenBalStart)
      );

      expect(await strategy.totalRebasing()).to.equal(
        rebaseTokenBalStart.add(bondDetails.payout).sub(rebaseBonded)
      );

      // Travel near the end of the bond
      await timeTravelBlocks(ethers.provider, 4990);
      await stakeManager.rebase();

      await strategy.unstake(rebaseTokenBalStart);
      expect(await strategy.unstakedRebasing()).to.eq(rebaseTokenBalStart);

      await strategy.redeemAndStake();

      bondDetails = await wftmBondDepository.bondInfo(strategy.address);

      expect((await strategy.stakedRebasing()).add(bondDetails.payout))
        .to.equal(await vault.balance())
        .to.gt(rebaseTokenBalStart.mul(2));
      expect(await strategy.rebaseBonded()).to.gt(0);

      // Travel to the end of the bond
      await timeTravelBlocks(ethers.provider, 5);
      await stakeManager.rebase();

      await strategy.unstake(rebaseTokenBalStart);
      expect(await strategy.unstakedRebasing()).to.eq(rebaseTokenBalStart);

      await strategy.redeemAndStake();

      expect(await strategy.stakedRebasing())
        .to.equal(await vault.balance())
        .to.gt(rebaseTokenBalStart.mul(2));
      expect(await strategy.rebaseBonded())
        .to.equal(0)
        .to.eq(await strategy.unstakedRebasing());
    }
  ).timeout(TEST_TIMEOUT * 2);

  // Notice we should optimize our LP bonds so that there are no leftover scraps, this test catches that
  it(
    SLOW_TEST_FLAG +
      "Bond lifecycle rebaseBonded test (positive bond | FHM-DAI LP Bond)",
    async function () {
      await minimizeBondPeriod(ethers.provider, fhmDaiBondDepository);
      await forceFHMBondMinimumPositive(
        ethers.provider,
        fhmDaiBondDepository,
        strategy,
        lpBondCalculator,
        FHM_DAI_PAIR
      );

      await vault.depositAll();

      expect(await vault.balance())
        .to.equal(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.equal(rebaseTokenBalStart);

      await strategy.addBond(FHM_DAI_LP_BOND);
      await strategy.stakeToBondLPAll(FHM_DAI_LP_BOND, FHM_DAI_ROUTE, [FHM]);

      const leftovers = await strategy.stakedRebasing();

      let bondDetails = await fhmDaiBondDepository.bondInfo(strategy.address);
      expect(await vault.balance())
        .to.equal(bondDetails.payout.add(await strategy.stakedRebasing()))
        .to.equal(
          (await strategy.rebaseBonded()).add(await strategy.stakedRebasing())
        );

      // Travel to ~ halfway into the bond
      await timeTravelBlocks(ethers.provider, 5000);
      let balBefore = await strategy.stakedRebasing();
      await stakeManager.rebase();
      let rebaseAmount = (await strategy.stakedRebasing()).sub(balBefore);

      let bondPayout = (
        await fhmDaiBondDepository.pendingPayoutFor(strategy.address)
      ).add(bondDetails.payout.div(10000)); // Notice the actual payout will be one block more

      await strategy.redeemAndStake();

      const rebaseBonded = await strategy.rebaseBonded();

      expect(await vault.balance()).to.lte(
        bondDetails.payout
          .add(rebaseAmount)
          .sub(bondPayout)
          .add(await strategy.stakedRebasing())
          .add(1)
      );
      expect(await vault.balance()).to.gte(
        bondDetails.payout
          .add(rebaseAmount)
          .sub(bondPayout)
          .add(await strategy.stakedRebasing())
          .sub(1)
      );
      expect(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.gt(rebaseTokenBalStart.div(2));
      expect(rebaseBonded).to.gt(rebaseTokenBalStart.div(2));
      expect(rebaseBonded).to.lt(bondDetails.payout.mul(1001).div(2000));
      expect(rebaseBonded).to.gt(bondDetails.payout.mul(999).div(2000));

      expect(await strategy.totalRebasing()).to.equal(
        bondDetails.payout.sub(rebaseBonded).add(leftovers)
      );

      // Travel near the end of the bond
      await timeTravelBlocks(ethers.provider, 4990);
      await stakeManager.rebase();
      await strategy.redeemAndStake();

      expect(await strategy.stakedRebasing())
        .to.equal((await vault.balance()).sub(await strategy.rebaseBonded()))
        .to.gt(rebaseTokenBalStart);
      expect(await strategy.rebaseBonded()).to.gt(0);

      // Travel to the end of the bond
      await timeTravelBlocks(ethers.provider, 5);
      await stakeManager.rebase();

      await strategy.redeemAndStake();

      expect(await strategy.stakedRebasing())
        .to.equal(await vault.balance())
        .to.gt(rebaseTokenBalStart);
      expect(await strategy.rebaseBonded()).to.equal(0);
    }
  ).timeout(TEST_TIMEOUT * 2);

  it.skip(
    SLOW_TEST_FLAG +
      "Bond lifecycle rebaseBonded test (negative bond | DAI Bond)",
    async function () {
      await minimizeBondPeriod(ethers.provider, daiBondDepository);

      await forceFHMBondNegative(ethers.provider, daiBondDepository, strategy);

      await vault.depositAll();

      expect(await vault.balance())
        .to.equal(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.equal(rebaseTokenBalStart);

      await strategy.addBond(FHM_DAI_BOND);
      await strategy.stakeToBondSingleAll(FHM_DAI_BOND, FHM_DAI_ROUTE);

      let bondDetails = await daiBondDepository.bondInfo(strategy.address);
      expect(await strategy.rebaseBonded())
        .to.equal(await vault.balance())
        .to.equal(bondDetails.payout);

      // Travel to ~ halfway into the bond
      await timeTravelBlocks(ethers.provider, 5000);
      let balBefore = await strategy.stakedRebasing();
      await stakeManager.rebase();
      let rebaseAmount = (await strategy.stakedRebasing()).sub(balBefore);

      let bondPayout = (
        await daiBondDepository.pendingPayoutFor(strategy.address)
      ).add(bondDetails.payout.div(10000)); // Notice the actual payout will be one block more

      await strategy.redeemAndStake();

      const rebaseBonded = await strategy.rebaseBonded();

      expect(await vault.balance()).to.equal(
        bondDetails.payout.add(rebaseAmount)
      );
      expect(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.lt(rebaseTokenBalStart.div(2));
      expect(await strategy.totalRebasing()).to.equal(
        bondDetails.payout.sub(rebaseBonded)
      );
      expect(rebaseBonded).to.lt(bondDetails.payout.mul(1001).div(2000));
      expect(rebaseBonded).to.gt(bondDetails.payout.mul(999).div(2000));

      // Travel near the end of the bond
      await timeTravelBlocks(ethers.provider, 4990);
      balBefore = await strategy.stakedRebasing();
      await stakeManager.rebase();
      rebaseAmount += (await strategy.stakedRebasing()).sub(balBefore);
      await strategy.redeemAndStake();

      expect(await strategy.stakedRebasing()).to.lt(await vault.balance());
      expect(await vault.balance()).to.equal(
        bondDetails.payout.add(rebaseAmount)
      );
      expect(await strategy.rebaseBonded()).to.equal(
        (await vault.balance()).sub(await strategy.stakedRebasing())
      );

      // Travel to the end of the bond
      await timeTravelBlocks(ethers.provider, 5);
      await stakeManager.rebase();

      await strategy.redeemAndStake();

      expect(await strategy.stakedRebasing())
        .to.equal(await vault.balance())
        .to.lt(rebaseTokenBalStart);
      expect(await strategy.rebaseBonded()).to.equal(0);
    }
  ).timeout(TEST_TIMEOUT * 2);

  it.skip(
    SLOW_TEST_FLAG +
      "Bond lifecycle rebaseBonded test (negative bond | WFTM Bond)",
    async function () {
      await minimizeBondPeriod(ethers.provider, wftmBondDepository);

      await forceFHMBondNegative(ethers.provider, wftmBondDepository, strategy);

      await vault.depositAll();

      expect(await vault.balance())
        .to.equal(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.equal(rebaseTokenBalStart);

      await strategy.addBond(FHM_WFTM_BOND);
      await strategy.stakeToBondSingleAll(FHM_WFTM_BOND, FHM_WFTM_ROUTE);

      let bondDetails = await wftmBondDepository.bondInfo(strategy.address);
      expect(await strategy.rebaseBonded())
        .to.equal(await vault.balance())
        .to.equal(bondDetails.payout);

      // Travel to ~ halfway into the bond
      await timeTravelBlocks(ethers.provider, 5000);
      let balBefore = await strategy.stakedRebasing();
      await stakeManager.rebase();
      let rebaseAmount = (await strategy.stakedRebasing()).sub(balBefore);

      let bondPayout = (
        await wftmBondDepository.pendingPayoutFor(strategy.address)
      ).add(bondDetails.payout.div(10000)); // Notice the actual payout will be one block more

      await strategy.redeemAndStake();

      const rebaseBonded = await strategy.rebaseBonded();

      expect(await vault.balance()).to.equal(
        bondDetails.payout.add(rebaseAmount)
      );
      expect(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.lt(rebaseTokenBalStart.div(2));
      expect(rebaseBonded).to.lt(rebaseTokenBalStart.div(2));
      expect(await strategy.totalRebasing()).to.equal(
        bondDetails.payout.sub(rebaseBonded)
      );

      expect(rebaseBonded).to.lt(bondDetails.payout.mul(1001).div(2000));
      expect(rebaseBonded).to.gt(bondDetails.payout.mul(999).div(2000));

      // Travel near the end of the bond
      await timeTravelBlocks(ethers.provider, 4990);
      balBefore = await strategy.stakedRebasing();
      await stakeManager.rebase();
      rebaseAmount += (await strategy.stakedRebasing()).sub(balBefore);
      await strategy.redeemAndStake();

      expect(await strategy.stakedRebasing()).to.lt(await vault.balance());
      expect(await vault.balance()).to.equal(
        bondDetails.payout.add(rebaseAmount)
      );
      expect(await strategy.rebaseBonded()).to.equal(
        (await vault.balance()).sub(await strategy.stakedRebasing())
      );

      // Travel to the end of the bond
      await timeTravelBlocks(ethers.provider, 5);
      await stakeManager.rebase();

      await strategy.redeemAndStake();

      expect(await strategy.stakedRebasing())
        .to.equal(await vault.balance())
        .to.lt(rebaseTokenBalStart);
      expect(await strategy.rebaseBonded()).to.equal(0);
    }
  ).timeout(TEST_TIMEOUT * 2);

  it.skip(
    SLOW_TEST_FLAG +
      "Bond lifecycle (with unstaked) rebaseBonded test (negative bond | WFTM Bond)",
    async function () {
      await minimizeBondPeriod(ethers.provider, wftmBondDepository);
      await forceFHMBondNegative(ethers.provider, wftmBondDepository, strategy);

      await vault.depositAll();

      expect(await vault.balance())
        .to.equal(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.equal(rebaseTokenBalStart);

      await strategy.addBond(FHM_WFTM_BOND);
      await strategy.stakeToBondSingleAll(FHM_WFTM_BOND, FHM_WFTM_ROUTE);

      let bondDetails = await wftmBondDepository.bondInfo(strategy.address);
      expect(await strategy.rebaseBonded())
        .to.equal(await vault.balance())
        .to.equal(bondDetails.payout);

      // Travel to ~ halfway into the bond
      await timeTravelBlocks(ethers.provider, 5000);
      let balBefore = await strategy.stakedRebasing();
      await stakeManager.rebase();
      let rebaseAmount = (await strategy.stakedRebasing()).sub(balBefore);

      let bondPayout = (
        await wftmBondDepository.pendingPayoutFor(strategy.address)
      ).add(bondDetails.payout.div(10000)); // Notice the actual payout will be one block more

      await vault.connect(whale).deposit(rebaseTokenBalStart);
      await strategy.unstakeAll();

      expect(await strategy.totalRebasing())
        .to.eq(await strategy.unstakedRebasing())
        .to.eq(rebaseTokenBalStart);

      await strategy.redeemAndStake();

      const rebaseBonded = await strategy.rebaseBonded();
      const redeemFee = await strategy.serviceFee();
      const redeemFeeDenom = await strategy.SERVICE_FEE_DIVISOR();
      const redeemFeeAmount = bondPayout.mul(redeemFee).div(redeemFeeDenom);

      expect(await vault.balance()).to.equal(
        rebaseTokenBalStart.add(bondDetails.payout).add(rebaseAmount)
      );
      expect(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.lt(rebaseTokenBalStart.div(2).add(rebaseTokenBalStart));
      expect(rebaseBonded).to.lt(rebaseTokenBalStart.div(2));
      expect(await strategy.totalRebasing()).to.equal(
        rebaseTokenBalStart.add(bondDetails.payout).sub(rebaseBonded)
      );

      expect(rebaseBonded).to.lt(bondDetails.payout.mul(1001).div(2000));
      expect(rebaseBonded).to.gt(bondDetails.payout.mul(999).div(2000));

      // Travel near the end of the bond
      await timeTravelBlocks(ethers.provider, 4990);
      await stakeManager.rebase();

      await strategy.unstake(rebaseTokenBalStart);
      expect(await strategy.unstakedRebasing()).to.eq(rebaseTokenBalStart);

      await strategy.redeemAndStake();

      expect(await strategy.stakedRebasing())
        .to.equal((await vault.balance()).sub(await strategy.rebaseBonded()))
        .to.lt(rebaseTokenBalStart.mul(2));
      expect(await strategy.unstakedRebasing()).to.eq(0);
      expect(await strategy.rebaseBonded()).to.gt(0);

      // Travel to the end of the bond
      await timeTravelBlocks(ethers.provider, 5);
      await stakeManager.rebase();

      await strategy.unstake(rebaseTokenBalStart);
      expect(await strategy.unstakedRebasing()).to.eq(rebaseTokenBalStart);

      await strategy.redeemAndStake();

      // Losses are realized
      expect(await strategy.stakedRebasing())
        .to.equal(await vault.balance())
        .to.lt(rebaseTokenBalStart.mul(2));
      expect(await strategy.rebaseBonded())
        .to.equal(0)
        .to.eq(await strategy.unstakedRebasing());
    }
  ).timeout(TEST_TIMEOUT * 2);

  // Notice we should optimize our LP bonds so that there are no leftover scraps, this test catches that
  it.skip(
    SLOW_TEST_FLAG +
      "Bond lifecycle rebaseBonded test (negative bond | FHM-DAI LP Bond)",
    async function () {
      await minimizeBondPeriod(ethers.provider, fhmDaiBondDepository);
      await forceFHMBondNegative(
        ethers.provider,
        fhmDaiBondDepository,
        strategy,
        lpBondCalculator,
        FHM_DAI_PAIR
      );

      await vault.depositAll();

      expect(await vault.balance())
        .to.equal(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.equal(rebaseTokenBalStart);

      await strategy.addBond(FHM_DAI_LP_BOND);
      await strategy.stakeToBondLPAll(FHM_DAI_LP_BOND, FHM_DAI_ROUTE, [FHM]);
      let bondDetails = await fhmDaiBondDepository.bondInfo(strategy.address);
      const leftovers = await strategy.stakedRebasing();

      expect(await vault.balance())
        .to.equal(bondDetails.payout.add(leftovers))
        .to.equal(
          (await strategy.rebaseBonded()).add(await strategy.stakedRebasing())
        );

      // Travel to ~ halfway into the bond
      await timeTravelBlocks(ethers.provider, 5000);
      let balBefore = await strategy.stakedRebasing();
      await stakeManager.rebase();
      let rebaseAmount = (await strategy.stakedRebasing()).sub(balBefore);

      let bondPayout = (
        await fhmDaiBondDepository.pendingPayoutFor(strategy.address)
      ).add(bondDetails.payout.div(10000)); // Notice the actual payout will be one block more

      await strategy.redeemAndStake();

      const rebaseBonded = await strategy.rebaseBonded();
      const redeemFee = await strategy.serviceFee();
      const redeemFeeDenom = await strategy.SERVICE_FEE_DIVISOR();
      const redeemFeeAmount = bondPayout.mul(redeemFee).div(redeemFeeDenom);

      expect(await vault.balance()).to.equal(
        bondDetails.payout.add(rebaseAmount).add(leftovers)
      );
      expect(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.lt(rebaseTokenBalStart.div(2));
      expect(rebaseBonded).to.lt(rebaseTokenBalStart.div(2));
      expect(await strategy.totalRebasing()).to.equal(
        bondDetails.payout.sub(rebaseBonded).add(rebaseAmount).add(leftovers)
      );

      expect(rebaseBonded).to.lt(bondDetails.payout.mul(1001).div(2000));
      expect(rebaseBonded).to.gt(bondDetails.payout.mul(999).div(2000));

      // Travel near the end of the bond
      await timeTravelBlocks(ethers.provider, 4990);
      balBefore = await strategy.stakedRebasing();
      await stakeManager.rebase();
      rebaseAmount += (await strategy.stakedRebasing()).sub(balBefore);
      await strategy.redeemAndStake();

      expect(await strategy.stakedRebasing()).to.lt(await vault.balance());
      expect(await vault.balance()).to.equal(
        bondDetails.payout.add(rebaseAmount).add(leftovers)
      );
      expect(await strategy.rebaseBonded()).to.equal(
        (await vault.balance()).sub(await strategy.stakedRebasing())
      );

      // Travel to the end of the bond
      await timeTravelBlocks(ethers.provider, 5);
      await stakeManager.rebase();

      await strategy.redeemAndStake();

      expect(await strategy.stakedRebasing())
        .to.equal(await vault.balance())
        .to.lt(rebaseTokenBalStart);
      expect(await strategy.rebaseBonded()).to.equal(0);
    }
  ).timeout(TEST_TIMEOUT * 2);
});
