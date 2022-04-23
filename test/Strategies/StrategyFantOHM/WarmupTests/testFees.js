const { expect } = require("chai");
const {
  beforeHook,
  beforeEachHook,
  truncateToFixed,
  forceHighMaxDebt,
  forceFHMBondPositive,
} = require("../../../../utils/testUtils.ts");
const { addressBook } = require("blockchain-addressbook");
const {
  FHM,
  FHM_STAKER,
  STAKED_FHM,
  FHM_STAKE_MANAGER,
  BOGUS_ADDR_1,
  BOGUS_ADDR_2,
  FHM_DAI_BOND,
  FHM_DAI_ROUTE,
  TEST_TIMEOUT,
  FANTOHM_TEST_FLAG,
  FHM_WFTM_BOND,
  FHM_DAI_LP_BOND,
  FHM_BOND_CALCULATOR,
  FHM_WHALES,
  FHM_TREASURY,
  WARMUP_TEST_FLAG,
  FHM_WFTM_ROUTE,
  FHM_CIRCULATING_SUPPLY,
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

describe(FANTOHM_TEST_FLAG + WARMUP_TEST_FLAG + " Fees", function () {
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
    stakeManager,
    stakingHelper,
    daiWftmPair,
    rebaseTokenBalStart,
    daiValueInitial,
    unirouterData,
    dai,
    fhmCirculatingSupply;

  this.slow(20000);

  beforeEach(async () => {
    ({
      rebaseToken: fhm,
      stakedRebaseToken: stakedFhm,
      stakingHelper,
      unirouter,
      unirouterData,
      whale,
      daiBondDepository,
      wftmBondDepository,
      daiLPBondDepository: fhmDaiBondDepository,
      daiWftmPair,
      stakeManager,
      dai,
      circulatingSupply: fhmCirculatingSupply,
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
      circulatingSupplyAddr: FHM_CIRCULATING_SUPPLY,
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

  it("Charges fees in stakeToBond (Positive | DAI Bond)", async function () {
    await forceHighMaxDebt(ethers.provider, daiBondDepository);
    await forceFHMBondPositive(
      ethers.provider,
      daiBondDepository,
      fhmCirculatingSupply
    );
    await vault.depositAll();

    const bondPrice = await daiBondDepository.bondPriceInUSD();
    const parsedBondPrice = parseFloat(ethers.utils.formatEther(bondPrice));
    const rebaseTokenPrice = await strategy.rebaseTokenPriceInUSD(1e9);
    const parsedTokenPrice = parseFloat(
      ethers.utils.formatEther(rebaseTokenPrice)
    );

    const parsedRatio = truncateToFixed(
      (parsedTokenPrice / parsedBondPrice) * 1e9,
      0
    );
    const bondDiscountMultiplier = ethers.utils.parseUnits(parsedRatio + "", 9);

    const devWarmupInfoInitial = await stakeManager.warmupInfo(
      stratConfig.serviceFeeRecipient
    );

    expect(devWarmupInfoInitial.deposit).to.eq(0);

    const vaultBalInitial = await vault.balance();
    const serviceFee = await strategy.serviceFee();
    const serviceFeeDenom = await strategy.SERVICE_FEE_DIVISOR();
    const serviceFeeAmount = vaultBalInitial
      .mul(serviceFee)
      .div(serviceFeeDenom);

    await strategy.addBond(FHM_DAI_BOND);
    await strategy.stakeToBondSingleAll(FHM_DAI_BOND, FHM_DAI_ROUTE);

    const devWarmupInfoAfter = await stakeManager.warmupInfo(
      stratConfig.serviceFeeRecipient
    );
    const vaultBalAfter = await vault.balance();
    const vaultRebasingAfter = await strategy.totalRebasing();
    const warmupBalAfter = (await stakeManager.warmupInfo(strategy.address))
      .deposit;

    expect(vaultRebasingAfter).to.eq(0).to.eq(warmupBalAfter);
    expect(devWarmupInfoAfter.deposit).to.eq(serviceFeeAmount);

    // Still realize net gains from bonding
    expect(vaultBalAfter).to.gt(vaultBalInitial);

    // Allow error for price impact
    expect(vaultBalAfter).to.lt(
      vaultBalInitial
        .sub(serviceFeeAmount)
        .mul(bondDiscountMultiplier)
        .div(1e9)
        .div(1e9)
    );
    expect(vaultBalAfter).to.gte(
      vaultBalInitial
        .sub(serviceFeeAmount)
        .mul(bondDiscountMultiplier)
        .div(1e9)
        .div(1e9)
        .mul(995)
        .div(1000)
    );
  }).timeout(TEST_TIMEOUT);

  it("Charges fees in stakeToBond (Positive | WFTM Bond)", async function () {
    await forceHighMaxDebt(ethers.provider, wftmBondDepository);
    await forceFHMBondPositive(
      ethers.provider,
      wftmBondDepository,
      fhmCirculatingSupply,
      (isNonStable = true)
    );
    await vault.depositAll();

    const bondPrice = await wftmBondDepository.bondPriceInUSD();
    const parsedBondPrice = parseFloat(ethers.utils.formatEther(bondPrice));
    const rebaseTokenPrice = await strategy.rebaseTokenPriceInUSD(1e9);
    const parsedTokenPrice = parseFloat(
      ethers.utils.formatEther(rebaseTokenPrice)
    );

    const parsedRatio = truncateToFixed(
      (parsedTokenPrice / parsedBondPrice) * 1e9,
      0
    );
    const bondDiscountMultiplier = ethers.utils.parseUnits(parsedRatio + "", 9);

    const devWarmupInfoInitial = await stakeManager.warmupInfo(
      stratConfig.serviceFeeRecipient
    );

    expect(devWarmupInfoInitial.deposit).to.eq(0);

    const vaultBalInitial = await vault.balance();
    const serviceFee = await strategy.serviceFee();
    const serviceFeeDenom = await strategy.SERVICE_FEE_DIVISOR();
    const serviceFeeAmount = vaultBalInitial
      .mul(serviceFee)
      .div(serviceFeeDenom);

    await strategy.addBond(FHM_WFTM_BOND);
    await strategy.stakeToBondSingleAll(FHM_WFTM_BOND, FHM_WFTM_ROUTE);

    const devWarmupInfoAfter = await stakeManager.warmupInfo(
      stratConfig.serviceFeeRecipient
    );
    const vaultBalAfter = await vault.balance();
    const vaultRebasingAfter = await strategy.totalRebasing();
    const warmupBalAfter = (await stakeManager.warmupInfo(strategy.address))
      .deposit;

    expect(vaultRebasingAfter).to.eq(0).to.eq(warmupBalAfter);
    expect(devWarmupInfoAfter.deposit).to.eq(serviceFeeAmount);

    // Still realize net gains from bonding
    expect(vaultBalAfter).to.gt(vaultBalInitial);

    // Allow error for price impact
    expect(vaultBalAfter).to.lt(
      vaultBalInitial
        .sub(serviceFeeAmount)
        .mul(bondDiscountMultiplier)
        .div(1e9)
        .div(1e9)
    );
    expect(vaultBalAfter).to.gte(
      vaultBalInitial
        .sub(serviceFeeAmount)
        .mul(bondDiscountMultiplier)
        .div(1e9)
        .div(1e9)
        .mul(995)
        .div(1000)
    );
  }).timeout(TEST_TIMEOUT);

  it("Charges fees in stakeToBond (Positive | FHM-DAI LP Bond)", async function () {
    await forceHighMaxDebt(ethers.provider, fhmDaiBondDepository);
    await forceFHMBondPositive(
      ethers.provider,
      fhmDaiBondDepository,
      fhmCirculatingSupply
    );
    await vault.depositAll();

    const bondPrice = await fhmDaiBondDepository.bondPriceInUSD();
    const parsedBondPrice = parseFloat(ethers.utils.formatEther(bondPrice));
    const rebaseTokenPrice = await strategy.rebaseTokenPriceInUSD(1e9);
    const parsedTokenPrice = parseFloat(
      ethers.utils.formatEther(rebaseTokenPrice)
    );

    const parsedRatio = truncateToFixed(
      (parsedTokenPrice / parsedBondPrice) * 1e9,
      0
    );
    const bondDiscountMultiplier = ethers.utils.parseUnits(parsedRatio + "", 9);

    const devWarmupInfoInitial = await stakeManager.warmupInfo(
      stratConfig.serviceFeeRecipient
    );

    expect(devWarmupInfoInitial.deposit).to.eq(0);

    const vaultBalInitial = await vault.balance();
    const serviceFee = await strategy.serviceFee();
    const serviceFeeDenom = await strategy.SERVICE_FEE_DIVISOR();
    const serviceFeeAmount = vaultBalInitial
      .mul(serviceFee)
      .div(serviceFeeDenom);

    await strategy.addBond(FHM_DAI_LP_BOND);
    await strategy.stakeToBondLPAll(FHM_DAI_LP_BOND, FHM_DAI_ROUTE, [FHM]);

    const devWarmupInfoAfter = await stakeManager.warmupInfo(
      stratConfig.serviceFeeRecipient
    );
    const vaultBalAfter = await vault.balance();
    const vaultRebasingAfter = await strategy.totalRebasing();
    const warmupBalAfter = (await stakeManager.warmupInfo(strategy.address))
      .deposit;

    expect(vaultRebasingAfter).to.eq(0);
    // NOTICE: leftover dust from inefficient lp bonding
    expect(warmupBalAfter).to.gt(0);
    expect(devWarmupInfoAfter.deposit).to.eq(serviceFeeAmount);

    // Still realize net gains from bonding
    expect(vaultBalAfter).to.gt(vaultBalInitial);

    // Allow error for price impact
    expect(vaultBalAfter).to.lt(
      vaultBalInitial
        .sub(serviceFeeAmount)
        .mul(bondDiscountMultiplier)
        .div(1e9)
        .div(1e9)
    );
    expect(vaultBalAfter).to.gte(
      vaultBalInitial
        .sub(serviceFeeAmount)
        .mul(bondDiscountMultiplier)
        .div(1e9)
        .div(1e9)
        .mul(995)
        .div(1000)
    );
  }).timeout(TEST_TIMEOUT);
});
