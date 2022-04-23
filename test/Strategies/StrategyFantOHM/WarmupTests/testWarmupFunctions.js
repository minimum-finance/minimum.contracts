const { expect } = require("chai");
const {
  beforeHook,
  beforeEachHook,
  forceWarmupPeriod,
  timeTravelBlocks,
} = require("../../../../utils/testUtils.ts");
const { addressBook } = require("blockchain-addressbook");
const {
  TEST_TIMEOUT,
  FHM,
  FHM_STAKER,
  STAKED_FHM,
  FHM_STAKE_MANAGER,
  BOGUS_ADDR_1,
  BOGUS_ADDR_2,
  FHM_DAI_BOND,
  FANTOHM_TEST_FLAG,
  FHM_WFTM_BOND,
  FHM_DAI_LP_BOND,
  FHM_BOND_CALCULATOR,
  FHM_WHALES,
  FHM_TREASURY,
  WARMUP_TEST_FLAG,
  REBASE_PERIOD_BLOCKS,
  FHM_DAI_ROUTE,
} = require("../../../../constants.js");
const { ethers } = require("hardhat");

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
  fhmCap: ethers.utils.parseUnits("6000", 9),
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

describe(
  FANTOHM_TEST_FLAG + WARMUP_TEST_FLAG + " Strategy Warmup functions",
  function () {
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
      unirouterData;

    this.slow(30000);

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
        warmup: 3,
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
    });

    it("Can claim warmed up funds with a control function", async function () {
      // Set warmup period to 1 epoch because we'll have to wait it out for this test
      await forceWarmupPeriod(ethers.provider, stakeManager, 1);

      await stakedFhm.approve(stakeManager.address, rebaseTokenBalStart);
      await stakeManager.unstake(rebaseTokenBalStart, false);
      await fhm.transfer(strategy.address, rebaseTokenBalStart);

      await strategy.stake();

      expect(await strategy.totalRebasing()).to.eq(0);

      await strategy.claimStake();

      expect(await strategy.totalRebasing()).to.eq(0);

      await timeTravelBlocks(ethers.provider, REBASE_PERIOD_BLOCKS);
      await stakeManager.rebase();

      const warmingBalance = (await stakeManager.warmupInfo(strategy.address))
        .deposit;

      await strategy.claimStake();

      // Notice we accumulate rebase rewards
      expect(warmingBalance).to.lt(await strategy.stakedRebasing());
    }).timeout(TEST_TIMEOUT);

    it("Can tell whether the strategy is warmed up or not", async function () {
      // Set warmup period to 1 epoch because we'll have to wait it out for this test
      await forceWarmupPeriod(ethers.provider, stakeManager, 1);

      await stakedFhm.approve(stakeManager.address, rebaseTokenBalStart);
      await stakeManager.unstake(rebaseTokenBalStart, false);
      await fhm.transfer(strategy.address, rebaseTokenBalStart);

      let warmupInfo = await stakeManager.warmupInfo(strategy.address);
      let warmupExpiry = warmupInfo.expiry;

      expect(warmupExpiry).to.eq(0);
      expect(await strategy.warmedUp()).to.be.true;

      await strategy.stake();

      warmupInfo = await stakeManager.warmupInfo(strategy.address);
      warmupExpiry = warmupInfo.expiry;
      let currentEpoch = (await stakeManager.epoch()).number;

      expect(warmupExpiry).to.gt(currentEpoch);
      expect(await strategy.warmedUp()).to.be.false;

      expect(await strategy.totalRebasing()).to.eq(0);

      await strategy.claimStake();

      expect(await strategy.totalRebasing()).to.eq(0);

      warmupInfo = await stakeManager.warmupInfo(strategy.address);
      warmupExpiry = warmupInfo.expiry;
      currentEpoch = (await stakeManager.epoch()).number;

      expect(warmupExpiry).to.gt(currentEpoch);
      expect(await strategy.warmedUp()).to.be.false;

      await timeTravelBlocks(ethers.provider, REBASE_PERIOD_BLOCKS);
      await stakeManager.rebase();

      warmupInfo = await stakeManager.warmupInfo(strategy.address);
      warmupExpiry = warmupInfo.expiry;
      currentEpoch = (await stakeManager.epoch()).number;

      expect(warmupExpiry).to.eq(currentEpoch);
      expect(await strategy.warmedUp()).to.be.true;

      const warmingBalance = (await stakeManager.warmupInfo(strategy.address))
        .deposit;

      await strategy.claimStake();

      warmupInfo = await stakeManager.warmupInfo(strategy.address);
      warmupExpiry = warmupInfo.expiry;

      expect(warmupExpiry).to.eq(0);
      expect(await strategy.warmedUp()).to.be.true;

      // Notice we accumulate rebase rewards
      expect(warmingBalance).to.lt(await strategy.stakedRebasing());
    }).timeout(TEST_TIMEOUT * 2);

    it("Can tell whether it is safe to stake", async function () {
      // Set warmup period to 1 epoch because we'll have to wait it out for this test
      await forceWarmupPeriod(ethers.provider, stakeManager, 2);

      await stakedFhm.approve(stakeManager.address, rebaseTokenBalStart);
      await stakeManager.unstake(rebaseTokenBalStart, false);
      await fhm.transfer(strategy.address, rebaseTokenBalStart);

      expect(await strategy.safeToStake()).to.be.true;

      await strategy.stake();

      expect(await strategy.safeToStake()).to.be.true;

      expect(await strategy.totalRebasing()).to.eq(0);

      await strategy.claimStake();

      expect(await strategy.totalRebasing()).to.eq(0);

      await timeTravelBlocks(ethers.provider, REBASE_PERIOD_BLOCKS);
      await stakeManager.rebase();

      expect(await strategy.safeToStake()).to.be.false;

      await timeTravelBlocks(ethers.provider, REBASE_PERIOD_BLOCKS);
      await stakeManager.rebase();

      expect(await strategy.safeToStake()).to.be.false;

      const warmingBalance = (await stakeManager.warmupInfo(strategy.address))
        .deposit;

      await strategy.claimStake();

      expect(await strategy.safeToStake()).to.be.true;

      // Notice we accumulate rebase rewards
      expect(warmingBalance).to.lt(await strategy.stakedRebasing());
    }).timeout(TEST_TIMEOUT);

    it("Can compute the prospective warmupExpiry if we were to stake", async function () {
      const currentEpoch = (await stakeManager.epoch()).number;
      const warmupPeriod = await stakeManager.warmupPeriod();

      expect(await strategy.newWarmupExpiry()).to.eq(
        currentEpoch.add(warmupPeriod)
      );
    }).timeout(TEST_TIMEOUT);

    it("Cannot stakeToBond if not warmed up", async function () {
      await vault.depositAll();

      await fhm
        .connect(whale)
        .approve(stakeManager.address, rebaseTokenBalStart);
      await stakeManager.connect(whale).unstake(rebaseTokenBalStart, false);
      await fhm.connect(whale).transfer(strategy.address, rebaseTokenBalStart);

      expect(await strategy.warmedUp()).to.be.true;
      await strategy.stake();
      expect(await strategy.warmedUp()).to.be.false;

      await strategy.addBond(FHM_DAI_BOND);
      await expect(
        strategy.stakeToBondSingleAll(FHM_DAI_BOND, FHM_DAI_ROUTE)
      ).to.be.revertedWith("!warmedUp");

      await strategy.addBond(FHM_DAI_LP_BOND);
      await expect(
        strategy.stakeToBondLPAll(FHM_DAI_LP_BOND, FHM_DAI_ROUTE, [FHM])
      ).to.be.revertedWith("!warmedUp");
    }).timeout(TEST_TIMEOUT);

    it("Can compute the current epoch", async function () {
      const currentEpoch = (await stakeManager.epoch()).number;

      const stratComputedEpoch = await strategy.currentEpochNumber();

      expect(currentEpoch).to.eq(stratComputedEpoch);
    }).timeout(TEST_TIMEOUT);
  }
);
