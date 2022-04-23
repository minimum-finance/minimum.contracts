const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  truncateToFixed,
  beforeHook,
  beforeEachHook,
  forceBondNegative,
  forceFHMBondMinimumPositive,
  forceHighMaxDebt,
  resetForkedChain,
} = require("../../../../utils/testUtils.ts");
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
  FHM_WFTM_BOND,
  FHM_DAI_LP_BOND,
  FHM_DAI_ROUTE,
  FHM_WFTM_ROUTE,
  FANTOHM_TEST_FLAG,
  FHM_BOND_CALCULATOR,
  FHM_WHALES,
  FHM_TREASURY,
  WARMUP_TEST_FLAG,
} = require("../../../../constants.js");

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
  wantCap: ethers.utils.parseUnits("100000", 9),
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
  FANTOHM_TEST_FLAG + WARMUP_TEST_FLAG + " Strategy stakeToBond MAX",
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

    this.slow(20000);

    beforeEach(async () => {
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

    it("Won't bond more than the max amount for DAI bond", async function () {
      await forceHighMaxDebt(ethers.provider, daiBondDepository);
      await forceFHMBondMinimumPositive(
        ethers.provider,
        daiBondDepository,
        strategy
      );
      const maxFhmBondSize = await strategy.maxBondSize(FHM_DAI_BOND);

      await vault
        .connect(whale)
        .deposit(maxFhmBondSize.add(ethers.utils.parseUnits("10", 9)));
      const stratFhm = await stakedFhm.balanceOf(strategy.address);
      const maxPayout = await daiBondDepository.maxPayout();

      expect(stratFhm).to.be.gt(maxFhmBondSize);

      await strategy.addBond(FHM_DAI_BOND);
      await strategy.stakeToBondSingleAll(FHM_DAI_BOND, FHM_DAI_ROUTE);

      const stakedFhmAfterBond = await stakedFhm.balanceOf(strategy.address);

      expect(stakedFhmAfterBond).to.equal(stratFhm.sub(maxFhmBondSize));

      const bondDetails = await daiBondDepository.bondInfo(strategy.address);

      // NOTICE: We get slipped pretty bad here, should aim to keep vaults sub 500 FHM
      expect(bondDetails.payout).to.be.lte(maxPayout);
      expect(bondDetails.payout).to.be.gt(maxPayout.mul(65).div(100));
    }).timeout(TEST_TIMEOUT);

    it("Won't bond more than the max amount for WFTM bond", async function () {
      await forceHighMaxDebt(ethers.provider, wftmBondDepository);
      await forceFHMBondMinimumPositive(
        ethers.provider,
        wftmBondDepository,
        strategy
      );
      const maxFhmBondSize = await strategy.maxBondSize(FHM_WFTM_BOND);
      await vault
        .connect(whale)
        .deposit(maxFhmBondSize.add(ethers.utils.parseUnits("10", 9)));
      const stratFhm = await stakedFhm.balanceOf(strategy.address);
      const maxPayout = await wftmBondDepository.maxPayout();

      expect(stratFhm).to.be.gt(maxFhmBondSize);

      await strategy.addBond(FHM_WFTM_BOND);
      await strategy.stakeToBondSingleAll(FHM_WFTM_BOND, FHM_WFTM_ROUTE);

      expect(await strategy.rebaseBonded()).to.lt(maxFhmBondSize);

      const bondDetails = await wftmBondDepository.bondInfo(strategy.address);

      // NOTICE: We get slipped pretty bad here, should aim to keep vaults sub 500 FHM
      expect(bondDetails.payout).to.be.lte(maxPayout);
      expect(bondDetails.payout).to.be.gt(maxPayout.mul(65).div(100));
    }).timeout(TEST_TIMEOUT);

    it("Won't bond more than the max amount for DAI-FHM LP bond", async function () {
      await forceHighMaxDebt(ethers.provider, fhmDaiBondDepository);
      await forceFHMBondMinimumPositive(
        ethers.provider,
        fhmDaiBondDepository,
        strategy,
        lpBondCalculator,
        FHM_DAI_PAIR
      );
      const maxFhmBondSize = await strategy.maxBondSize(FHM_DAI_LP_BOND);
      await vault
        .connect(whale)
        .deposit(maxFhmBondSize.add(ethers.utils.parseUnits("1000", 9)));
      const stratFhm = await stakedFhm.balanceOf(strategy.address);
      const maxPayout = await fhmDaiBondDepository.maxPayout();

      expect(stratFhm).to.be.gt(maxFhmBondSize);

      await strategy.addBond(FHM_DAI_LP_BOND);
      await strategy.stakeToBondLPAll(FHM_DAI_LP_BOND, FHM_DAI_ROUTE, [FHM]);

      const stakedFhmAfterBond = await stakedFhm.balanceOf(strategy.address);

      expect(stakedFhmAfterBond).to.equal(stratFhm.sub(maxFhmBondSize));

      const bondDetails = await fhmDaiBondDepository.bondInfo(strategy.address);

      expect(bondDetails.payout).to.be.lte(maxPayout);
      expect(bondDetails.payout).to.be.gt(maxPayout.mul(70).div(100));
    }).timeout(TEST_TIMEOUT);
  }
);
