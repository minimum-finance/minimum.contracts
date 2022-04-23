const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  beforeHook,
  beforeEachHook,
  forceBondPositive,
  forceBondNegative,
  minimizeBondPeriod,
  timeTravelBlocks,
} = require("../../../utils/testUtils.ts");
const { addressBook } = require("blockchain-addressbook");
const {
  SPA,
  SPA_STAKER,
  STAKED_SPA,
  SPA_STAKE_MANAGER,
  SPA_DAI_PAIR,
  BOGUS_ADDR_1,
  BOGUS_ADDR_2,
  TEST_TIMEOUT,
  DAI_BOND,
  SPA_DAI_ROUTE,
  WFTM_BOND,
  SPA_WFTM_ROUTE,
  SPA_DAI_BOND,
  SLOW_TEST_FLAG,
  SPARTACUS_TEST_FLAG,
  SPA_DAI_BOND_CALCULATOR,
  SPA_WHALES,
  SPA_TREASURY,
} = require("../../../constants.js");

const { spookyswap } = addressBook.fantom.platforms;
const devAddress = BOGUS_ADDR_2;

const contractNames = {
  vault: "MinimumVault",
  strategy: "StrategySpartacus",
};

const vaultConfig = {
  name: "Minimum Spartacus",
  symbol: "minSPA",
  stratApprovalDelay: 21600,
  wantCap: ethers.utils.parseUnits("6000", 9),
};

const stratConfig = {
  rebaseStaker: SPA_STAKER,
  stakeManager: SPA_STAKE_MANAGER,
  keeper: BOGUS_ADDR_1,
  unirouter: spookyswap.router,
  serviceFeeRecipient: devAddress,
  minDeposit: 100,
  discordLink: "https://discord.gg/fS5ZUwDtVK",
};

describe(SPARTACUS_TEST_FLAG + " Strategy rebaseBonded", function () {
  let vault,
    strategy,
    unirouter,
    spa,
    stakedSpa,
    deployer,
    keeper,
    other,
    whale,
    daiBondDepository,
    wftmBondDepository,
    spaDaiBondDepository,
    lpBondCalculator,
    stakeManager,
    stakingHelper,
    daiWftmPair,
    rebaseTokenBalStart,
    daiValueInitial,
    unirouterData;

  this.slow(20000);

  before(async () => {
    ({
      rebaseToken: spa,
      stakedRebaseToken: stakedSpa,
      unirouter,
      unirouterData,
      whale,
      daiBondDepository,
      wftmBondDepository,
      daiLPBondDepository: spaDaiBondDepository,
      lpBondCalculator,
      daiWftmPair,
      stakeManager,
      stakingHelper,
    } = await beforeHook({
      provider: ethers.provider,
      stratConfig,
      rebaseTokenAddr: SPA,
      stakedRebaseTokenAddr: STAKED_SPA,
      daiBondAddr: DAI_BOND,
      wftmBondAddr: WFTM_BOND,
      daiLPBondAddr: SPA_DAI_BOND,
      lpBondCalculatorAddr: SPA_DAI_BOND_CALCULATOR,
      stakeManagerAddr: SPA_STAKE_MANAGER,
      whales: SPA_WHALES,
      treasuryAddr: SPA_TREASURY,
      fundStaked: false,
      stakingHelperAddr: SPA_STAKER,
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
      rebaseToken: spa,
      whale,
      stakedRebaseToken: stakedSpa,
      fundStaked: false,
    }));
  });

  it("When just staking, rebaseBonded should be 0", async function () {
    await vault.depositAll();
    expect(await strategy.isBonding()).to.equal(await vault.isBonding()).to.be
      .false;

    expect(await stakedSpa.balanceOf(strategy.address))
      .to.equal(await strategy.totalBalance())
      .to.equal(await strategy.stakedRebasing())
      .to.equal(await vault.balance());

    expect(await strategy.rebaseBonded()).to.equal(0);
  }).timeout(TEST_TIMEOUT);

  it("When just bonded all, rebaseBonded should be totalBalance", async function () {
    await forceBondPositive(ethers.provider, daiBondDepository, strategy);

    await vault.depositAll();
    expect(await strategy.isBonding()).to.equal(await vault.isBonding()).to.be
      .false;

    expect(await stakedSpa.balanceOf(strategy.address))
      .to.equal(await strategy.totalBalance())
      .to.equal(await strategy.stakedRebasing())
      .to.equal(await vault.balance());

    await strategy.addBond(DAI_BOND);
    await strategy.stakeToBondSingleAll(DAI_BOND, SPA_DAI_ROUTE);

    expect(await stakedSpa.balanceOf(strategy.address))
      .to.equal(await strategy.stakedRebasing())
      .to.equal(await strategy.totalRebasing())
      .to.equal(0);
    expect(await vault.balance())
      .to.equal(await strategy.totalBalance())
      .to.equal(await strategy.rebaseBonded());
  }).timeout(TEST_TIMEOUT);

  it("Just bonded all add unstaked, rebaseBonded should be totalBalance - unstaked", async function () {
    await forceBondPositive(ethers.provider, daiBondDepository, strategy);

    await vault.depositAll();
    expect(await strategy.isBonding()).to.equal(await vault.isBonding()).to.be
      .false;

    expect(await stakedSpa.balanceOf(strategy.address))
      .to.equal(await strategy.totalBalance())
      .to.equal(await strategy.stakedRebasing())
      .to.equal(await vault.balance());

    await strategy.addBond(DAI_BOND);
    await strategy.stakeToBondSingleAll(DAI_BOND, SPA_DAI_ROUTE);

    expect(await stakedSpa.balanceOf(strategy.address))
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
      .to.eq(rebaseTokenBalStart.mul(2));
    expect(await strategy.rebaseBonded()).to.eq(rebaseTokenBalStart);
    expect(await strategy.unstakedRebasing()).to.eq(rebaseTokenBalStart);
  }).timeout(TEST_TIMEOUT);

  it("Before bonding add unstaked, rebaseBonded should be totalBalance (DAI bond)", async function () {
    await forceBondPositive(ethers.provider, daiBondDepository, strategy);
    await vault.depositAll();
    expect(await strategy.isBonding()).to.equal(await vault.isBonding()).to.be
      .false;

    expect(await stakedSpa.balanceOf(strategy.address))
      .to.equal(await strategy.totalBalance())
      .to.equal(await strategy.stakedRebasing())
      .to.equal(await vault.balance());

    await strategy.unstake(rebaseTokenBalStart.div(2));

    await strategy.addBond(DAI_BOND);
    await strategy.stakeToBondSingleAll(DAI_BOND, SPA_DAI_ROUTE);

    expect(await stakedSpa.balanceOf(strategy.address))
      .to.equal(await strategy.stakedRebasing())
      .to.equal(await strategy.totalRebasing())
      .to.equal(0);
    expect(await vault.balance())
      .to.equal(await strategy.totalBalance())
      .to.equal(await strategy.rebaseBonded());
  }).timeout(TEST_TIMEOUT);

  it("Before bonding add unstaked, rebaseBonded should be totalBalance with some staked scraps (SPA-DAI LP bond)", async function () {
    await forceBondPositive(
      ethers.provider,
      spaDaiBondDepository,
      strategy,
      lpBondCalculator,
      SPA_DAI_PAIR
    );
    await vault.depositAll();
    expect(await strategy.isBonding()).to.equal(await vault.isBonding()).to.be
      .false;

    expect(await stakedSpa.balanceOf(strategy.address))
      .to.equal(await strategy.totalBalance())
      .to.equal(await strategy.stakedRebasing())
      .to.equal(await vault.balance());

    await strategy.unstake(rebaseTokenBalStart.div(2));

    await strategy.addBond(SPA_DAI_BOND);
    await strategy
      .connect(keeper)
      .stakeToBondLPAll(SPA_DAI_BOND, [SPA], SPA_DAI_ROUTE);

    expect(await stakedSpa.balanceOf(strategy.address))
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

    expect(await strategy.rebaseBonded()).to.lt(rebaseTokenBalStart);
    expect(await strategy.rebaseBonded()).to.gt(
      rebaseTokenBalStart.mul(98).div(100)
    );
  }).timeout(TEST_TIMEOUT);

  it("When just bonded x amount of rebasing balance, rebaseBonded should be x", async function () {
    await forceBondPositive(ethers.provider, daiBondDepository, strategy);
    await vault.depositAll();
    expect(await strategy.isBonding()).to.equal(await vault.isBonding()).to.be
      .false;

    expect(await stakedSpa.balanceOf(strategy.address))
      .to.equal(await strategy.totalBalance())
      .to.equal(await strategy.stakedRebasing())
      .to.equal(await vault.balance());

    await strategy.addBond(DAI_BOND);
    await strategy.stakeToBondSingle(
      rebaseTokenBalStart.div(2),
      DAI_BOND,
      SPA_DAI_ROUTE
    );

    expect(await strategy.totalBalance())
      .to.equal(
        (await strategy.rebaseBonded()).add(await strategy.stakedRebasing())
      )
      .to.equal(rebaseTokenBalStart);
    expect(await strategy.rebaseBonded()).to.equal(rebaseTokenBalStart.div(2));
  }).timeout(TEST_TIMEOUT);

  it(
    SLOW_TEST_FLAG +
      "Bond lifecycle rebaseBonded test (positive bond | DAI Bond)",
    async function () {
      await minimizeBondPeriod(ethers.provider, daiBondDepository);

      await forceBondPositive(
        ethers.provider,
        daiBondDepository,
        strategy,
        lpBondCalculator,
        SPA_DAI_PAIR
      );

      await vault.depositAll();

      expect(await vault.balance())
        .to.equal(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.equal(rebaseTokenBalStart);

      await strategy.addBond(DAI_BOND);
      await strategy.stakeToBondSingleAll(DAI_BOND, SPA_DAI_ROUTE);

      expect(await strategy.rebaseBonded())
        .to.equal(await vault.balance())
        .to.equal(rebaseTokenBalStart);

      // Travel to ~ halfway into the bond
      await timeTravelBlocks(ethers.provider, 5000);
      let balBefore = await strategy.stakedRebasing();
      await stakeManager.rebase();
      let rebaseAmount = (await strategy.stakedRebasing()).sub(balBefore);

      let bondDetails = await daiBondDepository.bondInfo(strategy.address);
      let bondPayout = (
        await daiBondDepository.pendingPayoutFor(strategy.address)
      ).add(bondDetails.payout.div(10000)); // Notice the actual payout will be one block more

      await strategy.redeemAndStake();

      const rebaseBonded = await strategy.rebaseBonded();
      const redeemFee = await strategy.serviceFee();
      const redeemFeeDenom = await strategy.SERVICE_FEE_DIVISOR();
      const redeemFeeAmount = bondPayout.mul(redeemFee).div(redeemFeeDenom);

      expect(await vault.balance()).to.equal(
        rebaseTokenBalStart.add(rebaseAmount)
      );
      expect(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.gt(rebaseTokenBalStart.div(2));
      expect(rebaseBonded).to.lt(rebaseTokenBalStart.div(2));
      expect(await strategy.totalRebasing()).to.equal(
        rebaseTokenBalStart.sub(rebaseBonded)
      );

      // Allow some error from division
      expect(rebaseBonded).to.lt(
        rebaseTokenBalStart
          .sub(bondPayout.sub(redeemFeeAmount))
          .mul(101)
          .div(100)
      );
      expect(rebaseBonded).to.gt(
        rebaseTokenBalStart
          .sub(bondPayout.sub(redeemFeeAmount))
          .mul(99)
          .div(100)
      );

      // Travel near the end of the bond
      await timeTravelBlocks(ethers.provider, 4990);
      await stakeManager.rebase();
      await strategy.redeemAndStake();

      expect(await strategy.stakedRebasing())
        .to.equal(await vault.balance())
        .to.gt(rebaseTokenBalStart);
      expect(await strategy.rebaseBonded()).to.equal(0);

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

      await forceBondPositive(
        ethers.provider,
        wftmBondDepository,
        strategy,
        lpBondCalculator,
        SPA_DAI_PAIR
      );

      await vault.depositAll();

      expect(await vault.balance())
        .to.equal(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.equal(rebaseTokenBalStart);

      await strategy.addBond(WFTM_BOND);
      await strategy.stakeToBondSingleAll(WFTM_BOND, SPA_WFTM_ROUTE);

      expect(await strategy.rebaseBonded())
        .to.equal(await vault.balance())
        .to.equal(rebaseTokenBalStart);

      // Travel to ~ halfway into the bond
      await timeTravelBlocks(ethers.provider, 5000);
      let balBefore = await strategy.stakedRebasing();
      await stakeManager.rebase();
      let rebaseAmount = (await strategy.stakedRebasing()).sub(balBefore);

      let bondDetails = await wftmBondDepository.bondInfo(strategy.address);
      let bondPayout = (
        await wftmBondDepository.pendingPayoutFor(strategy.address)
      ).add(bondDetails.payout.div(10000)); // Notice the actual payout will be one block more

      await strategy.redeemAndStake();

      const rebaseBonded = await strategy.rebaseBonded();
      const redeemFee = await strategy.serviceFee();
      const redeemFeeDenom = await strategy.SERVICE_FEE_DIVISOR();
      const redeemFeeAmount = bondPayout.mul(redeemFee).div(redeemFeeDenom);

      expect(await vault.balance()).to.equal(
        rebaseTokenBalStart.add(rebaseAmount)
      );
      expect(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.gt(rebaseTokenBalStart.div(2));
      expect(rebaseBonded).to.lt(rebaseTokenBalStart.div(2));
      expect(await strategy.totalRebasing()).to.equal(
        rebaseTokenBalStart.sub(rebaseBonded)
      );

      // Allow some error from division
      expect(rebaseBonded).to.lt(
        rebaseTokenBalStart
          .sub(bondPayout.sub(redeemFeeAmount))
          .mul(101)
          .div(100)
      );
      expect(rebaseBonded).to.gt(
        rebaseTokenBalStart
          .sub(bondPayout.sub(redeemFeeAmount))
          .mul(99)
          .div(100)
      );

      // Travel near the end of the bond
      await timeTravelBlocks(ethers.provider, 4990);
      await stakeManager.rebase();
      await strategy.redeemAndStake();

      expect(await strategy.stakedRebasing())
        .to.equal(await vault.balance())
        .to.gt(rebaseTokenBalStart);
      expect(await strategy.rebaseBonded()).to.equal(0);

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

      await forceBondPositive(
        ethers.provider,
        wftmBondDepository,
        strategy,
        lpBondCalculator,
        SPA_DAI_PAIR
      );

      await vault.depositAll();

      expect(await vault.balance())
        .to.equal(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.equal(rebaseTokenBalStart);

      await strategy.addBond(WFTM_BOND);
      await strategy.stakeToBondSingleAll(WFTM_BOND, SPA_WFTM_ROUTE);

      expect(await strategy.rebaseBonded())
        .to.equal(await vault.balance())
        .to.equal(rebaseTokenBalStart);

      // Travel to ~ halfway into the bond
      await timeTravelBlocks(ethers.provider, 5000);
      let balBefore = await strategy.stakedRebasing();
      await stakeManager.rebase();
      let rebaseAmount = (await strategy.stakedRebasing()).sub(balBefore);

      let bondDetails = await wftmBondDepository.bondInfo(strategy.address);
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
        rebaseTokenBalStart.mul(2).add(rebaseAmount)
      );
      expect(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.gt(rebaseTokenBalStart.div(2).add(rebaseTokenBalStart));
      expect(rebaseBonded).to.lt(rebaseTokenBalStart.div(2));
      expect(await strategy.totalRebasing()).to.equal(
        rebaseTokenBalStart.mul(2).sub(rebaseBonded)
      );

      // Allow some error from division
      expect(rebaseBonded).to.lt(
        rebaseTokenBalStart
          .sub(bondPayout.sub(redeemFeeAmount))
          .mul(1001)
          .div(1000)
      );
      expect(rebaseBonded).to.gt(
        rebaseTokenBalStart
          .sub(bondPayout.sub(redeemFeeAmount))
          .mul(999)
          .div(1000)
      );

      // Travel near the end of the bond
      await timeTravelBlocks(ethers.provider, 4990);
      await stakeManager.rebase();

      await strategy.unstake(rebaseTokenBalStart);
      expect(await strategy.unstakedRebasing()).to.eq(rebaseTokenBalStart);

      await strategy.redeemAndStake();

      expect(await strategy.stakedRebasing())
        .to.equal(await vault.balance())
        .to.gt(rebaseTokenBalStart.mul(2));
      expect(await strategy.unstakedRebasing()).to.eq(0);
      expect(await strategy.rebaseBonded()).to.equal(0);

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
      "Bond lifecycle rebaseBonded test (positive bond | SPA-DAI LP Bond)",
    async function () {
      await minimizeBondPeriod(ethers.provider, spaDaiBondDepository);

      await forceBondPositive(
        ethers.provider,
        spaDaiBondDepository,
        strategy,
        lpBondCalculator,
        SPA_DAI_PAIR
      );

      await vault.depositAll();

      expect(await vault.balance())
        .to.equal(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.equal(rebaseTokenBalStart);

      await strategy.addBond(SPA_DAI_BOND);
      await strategy.stakeToBondLPAll(SPA_DAI_BOND, [SPA], SPA_DAI_ROUTE);

      expect(await vault.balance())
        .to.equal(rebaseTokenBalStart)
        .to.equal(
          (await strategy.rebaseBonded()).add(await strategy.stakedRebasing())
        );

      // Travel to ~ halfway into the bond
      await timeTravelBlocks(ethers.provider, 5000);
      let balBefore = await strategy.stakedRebasing();
      await stakeManager.rebase();
      let rebaseAmount = (await strategy.stakedRebasing()).sub(balBefore);

      let bondDetails = await spaDaiBondDepository.bondInfo(strategy.address);
      let bondPayout = (
        await spaDaiBondDepository.pendingPayoutFor(strategy.address)
      ).add(bondDetails.payout.div(10000)); // Notice the actual payout will be one block more

      await strategy.redeemAndStake();

      const rebaseBonded = await strategy.rebaseBonded();
      const redeemFee = await strategy.serviceFee();
      const redeemFeeDenom = await strategy.SERVICE_FEE_DIVISOR();
      const redeemFeeAmount = bondPayout.mul(redeemFee).div(redeemFeeDenom);

      expect(await vault.balance()).to.equal(
        rebaseTokenBalStart.add(rebaseAmount)
      );
      expect(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.gt(rebaseTokenBalStart.div(2));
      expect(rebaseBonded).to.lt(rebaseTokenBalStart.div(2));
      expect(await strategy.totalRebasing()).to.equal(
        rebaseTokenBalStart.sub(rebaseBonded)
      );

      // Allow some error from division
      expect(rebaseBonded).to.lt(
        rebaseTokenBalStart
          .sub(bondPayout.sub(redeemFeeAmount))
          .mul(101)
          .div(100)
      );
      expect(rebaseBonded).to.gt(
        rebaseTokenBalStart
          .sub(bondPayout.sub(redeemFeeAmount))
          .mul(99)
          .div(100)
      );

      // Travel near the end of the bond
      await timeTravelBlocks(ethers.provider, 4990);
      await stakeManager.rebase();
      await strategy.redeemAndStake();

      expect(await strategy.stakedRebasing())
        .to.equal(await vault.balance())
        .to.gt(rebaseTokenBalStart);
      expect(await strategy.rebaseBonded()).to.equal(0);

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

      await forceBondNegative(
        ethers.provider,
        daiBondDepository,
        strategy,
        lpBondCalculator,
        SPA_DAI_PAIR
      );

      await vault.depositAll();

      expect(await vault.balance())
        .to.equal(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.equal(rebaseTokenBalStart);

      await strategy.addBond(DAI_BOND);
      await strategy.stakeToBondSingleAll(DAI_BOND, SPA_DAI_ROUTE);

      expect(await strategy.rebaseBonded())
        .to.equal(await vault.balance())
        .to.equal(rebaseTokenBalStart);

      // Travel to ~ halfway into the bond
      await timeTravelBlocks(ethers.provider, 5000);
      let balBefore = await strategy.stakedRebasing();
      await stakeManager.rebase();
      let rebaseAmount = (await strategy.stakedRebasing()).sub(balBefore);

      let bondDetails = await daiBondDepository.bondInfo(strategy.address);
      let bondPayout = (
        await daiBondDepository.pendingPayoutFor(strategy.address)
      ).add(bondDetails.payout.div(10000)); // Notice the actual payout will be one block more

      await strategy.redeemAndStake();

      const rebaseBonded = await strategy.rebaseBonded();
      const redeemFee = await strategy.serviceFee();
      const redeemFeeDenom = await strategy.SERVICE_FEE_DIVISOR();
      const redeemFeeAmount = bondPayout.mul(redeemFee).div(redeemFeeDenom);

      expect(await vault.balance()).to.equal(
        rebaseTokenBalStart.add(rebaseAmount)
      );
      expect(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.lt(rebaseTokenBalStart.div(2));
      expect(rebaseBonded).to.gt(rebaseTokenBalStart.div(2));
      expect(await strategy.totalRebasing()).to.equal(
        rebaseTokenBalStart.sub(rebaseBonded)
      );

      // Allow some error from division
      expect(rebaseBonded).to.lt(
        rebaseTokenBalStart
          .sub(bondPayout.sub(redeemFeeAmount))
          .mul(101)
          .div(100)
      );
      expect(rebaseBonded).to.gt(
        rebaseTokenBalStart
          .sub(bondPayout.sub(redeemFeeAmount))
          .mul(99)
          .div(100)
      );

      // Travel near the end of the bond
      await timeTravelBlocks(ethers.provider, 4990);
      balBefore = await strategy.stakedRebasing();
      await stakeManager.rebase();
      rebaseAmount += (await strategy.stakedRebasing()).sub(balBefore);
      await strategy.redeemAndStake();

      expect(await strategy.stakedRebasing()).to.lt(await vault.balance());
      expect(await vault.balance()).to.equal(
        rebaseTokenBalStart.add(rebaseAmount)
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

      await forceBondNegative(
        ethers.provider,
        wftmBondDepository,
        strategy,
        lpBondCalculator,
        SPA_DAI_PAIR
      );

      await vault.depositAll();

      expect(await vault.balance())
        .to.equal(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.equal(rebaseTokenBalStart);

      await strategy.addBond(WFTM_BOND);
      await strategy.stakeToBondSingleAll(WFTM_BOND, SPA_WFTM_ROUTE);

      expect(await strategy.rebaseBonded())
        .to.equal(await vault.balance())
        .to.equal(rebaseTokenBalStart);

      // Travel to ~ halfway into the bond
      await timeTravelBlocks(ethers.provider, 5000);
      let balBefore = await strategy.stakedRebasing();
      await stakeManager.rebase();
      let rebaseAmount = (await strategy.stakedRebasing()).sub(balBefore);

      let bondDetails = await wftmBondDepository.bondInfo(strategy.address);
      let bondPayout = (
        await wftmBondDepository.pendingPayoutFor(strategy.address)
      ).add(bondDetails.payout.div(10000)); // Notice the actual payout will be one block more

      await strategy.redeemAndStake();

      const rebaseBonded = await strategy.rebaseBonded();
      const redeemFee = await strategy.serviceFee();
      const redeemFeeDenom = await strategy.SERVICE_FEE_DIVISOR();
      const redeemFeeAmount = bondPayout.mul(redeemFee).div(redeemFeeDenom);

      expect(await vault.balance()).to.equal(
        rebaseTokenBalStart.add(rebaseAmount)
      );
      expect(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.lt(rebaseTokenBalStart.div(2));
      expect(rebaseBonded).to.gt(rebaseTokenBalStart.div(2));
      expect(await strategy.totalRebasing()).to.equal(
        rebaseTokenBalStart.sub(rebaseBonded)
      );

      // Allow some error from division
      expect(rebaseBonded).to.lt(
        rebaseTokenBalStart
          .sub(bondPayout.sub(redeemFeeAmount))
          .mul(101)
          .div(100)
      );
      expect(rebaseBonded).to.gt(
        rebaseTokenBalStart
          .sub(bondPayout.sub(redeemFeeAmount))
          .mul(99)
          .div(100)
      );

      // Travel near the end of the bond
      await timeTravelBlocks(ethers.provider, 4990);
      balBefore = await strategy.stakedRebasing();
      await stakeManager.rebase();
      rebaseAmount += (await strategy.stakedRebasing()).sub(balBefore);
      await strategy.redeemAndStake();

      expect(await strategy.stakedRebasing()).to.lt(await vault.balance());
      expect(await vault.balance()).to.equal(
        rebaseTokenBalStart.add(rebaseAmount)
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

      await forceBondNegative(
        ethers.provider,
        wftmBondDepository,
        strategy,
        lpBondCalculator,
        SPA_DAI_PAIR
      );

      await vault.depositAll();

      expect(await vault.balance())
        .to.equal(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.equal(rebaseTokenBalStart);

      await strategy.addBond(WFTM_BOND);
      await strategy.stakeToBondSingleAll(WFTM_BOND, SPA_WFTM_ROUTE);

      expect(await strategy.rebaseBonded())
        .to.equal(await vault.balance())
        .to.equal(rebaseTokenBalStart);

      // Travel to ~ halfway into the bond
      await timeTravelBlocks(ethers.provider, 5000);
      let balBefore = await strategy.stakedRebasing();
      await stakeManager.rebase();
      let rebaseAmount = (await strategy.stakedRebasing()).sub(balBefore);

      let bondDetails = await wftmBondDepository.bondInfo(strategy.address);
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
        rebaseTokenBalStart.mul(2).add(rebaseAmount)
      );
      expect(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.lt(rebaseTokenBalStart.div(2).add(rebaseTokenBalStart));
      expect(rebaseBonded).to.gt(rebaseTokenBalStart.div(2));
      expect(await strategy.totalRebasing()).to.equal(
        rebaseTokenBalStart.mul(2).sub(rebaseBonded)
      );

      // Allow some error from division
      expect(rebaseBonded).to.lt(
        rebaseTokenBalStart
          .sub(bondPayout.sub(redeemFeeAmount))
          .mul(1001)
          .div(1000)
      );
      expect(rebaseBonded).to.gt(
        rebaseTokenBalStart
          .sub(bondPayout.sub(redeemFeeAmount))
          .mul(999)
          .div(1000)
      );

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
      "Bond lifecycle rebaseBonded test (negative bond | SPA-DAI LP Bond)",
    async function () {
      await minimizeBondPeriod(ethers.provider, spaDaiBondDepository);

      await forceBondNegative(
        ethers.provider,
        spaDaiBondDepository,
        strategy,
        lpBondCalculator,
        SPA_DAI_PAIR
      );

      await vault.depositAll();

      expect(await vault.balance())
        .to.equal(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.equal(rebaseTokenBalStart);

      await strategy.addBond(SPA_DAI_BOND);
      await strategy.stakeToBondLPAll(SPA_DAI_BOND, [SPA], SPA_DAI_ROUTE);

      expect(await vault.balance())
        .to.equal(rebaseTokenBalStart)
        .to.equal(
          (await strategy.rebaseBonded()).add(await strategy.stakedRebasing())
        );

      // Travel to ~ halfway into the bond
      await timeTravelBlocks(ethers.provider, 5000);
      let balBefore = await strategy.stakedRebasing();
      await stakeManager.rebase();
      let rebaseAmount = (await strategy.stakedRebasing()).sub(balBefore);

      let bondDetails = await spaDaiBondDepository.bondInfo(strategy.address);
      let bondPayout = (
        await spaDaiBondDepository.pendingPayoutFor(strategy.address)
      ).add(bondDetails.payout.div(10000)); // Notice the actual payout will be one block more

      await strategy.redeemAndStake();

      const rebaseBonded = await strategy.rebaseBonded();
      const redeemFee = await strategy.serviceFee();
      const redeemFeeDenom = await strategy.SERVICE_FEE_DIVISOR();
      const redeemFeeAmount = bondPayout.mul(redeemFee).div(redeemFeeDenom);

      expect(await vault.balance()).to.equal(
        rebaseTokenBalStart.add(rebaseAmount)
      );
      expect(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.lt(rebaseTokenBalStart.div(2));
      expect(rebaseBonded).to.gt(rebaseTokenBalStart.div(2));
      expect(await strategy.totalRebasing()).to.equal(
        rebaseTokenBalStart.sub(rebaseBonded).add(rebaseAmount)
      );

      // Allow some error from division
      expect(rebaseBonded).to.lt(
        rebaseTokenBalStart
          .sub(bondPayout.sub(redeemFeeAmount))
          .mul(101)
          .div(100)
      );
      expect(rebaseBonded).to.gt(
        rebaseTokenBalStart
          .sub(bondPayout.sub(redeemFeeAmount))
          .mul(99)
          .div(100)
      );

      // Travel near the end of the bond
      await timeTravelBlocks(ethers.provider, 4990);
      balBefore = await strategy.stakedRebasing();
      await stakeManager.rebase();
      rebaseAmount += (await strategy.stakedRebasing()).sub(balBefore);
      await strategy.redeemAndStake();

      expect(await strategy.stakedRebasing()).to.lt(await vault.balance());
      expect(await vault.balance()).to.equal(
        rebaseTokenBalStart.add(rebaseAmount)
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
