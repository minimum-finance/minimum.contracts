const { expect } = require("chai");
const { ethers } = require("hardhat");
const { addressBook } = require("blockchain-addressbook");
const {
  beforeEachHook,
  beforeHook,
  forceFHMBondNegative,
  forceFHMBondPositive,
} = require("../utils/testUtils.ts");
const {
  TEST_TIMEOUT,
  BOGUS_ADDR_1,
  BOGUS_ADDR_2,
  SPA,
  STAKED_SPA,
  FHM_DAI_BOND,
  FHM_WFTM_BOND,
  FHM_DAI_LP_BOND,
  FHM_STAKER,
  FHM_STAKE_MANAGER,
  FANTOHM_TEST_FLAG,
  FHM_BOND_CALCULATOR,
  FHM_DAI_PAIR,
  FHM_WHALES,
  SPA_TREASURY,
  FHM_CIRCULATING_SUPPLY,
} = require("../constants.js");
const devAddress = BOGUS_ADDR_2;
const { spookyswap } = addressBook.fantom.platforms;

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

describe(FANTOHM_TEST_FLAG + " Util functions", function () {
  let vault,
    strategy,
    unirouter,
    unirouterData,
    want,
    stakedWant,
    deployer,
    keeper,
    other,
    whale,
    daiBondDepository,
    wftmBondDepository,
    fhmDaiBondDepository,
    stakeManager,
    stakingHelper,
    lpBondCalculator,
    dai,
    fhmCirculatingSupply;

  this.slow(20000);

  before(async () => {
    ({
      unirouter,
      rebaseToken: want,
      stakedRebaseToken: stakedWant,
      dai,
      unirouterData,
      whale,
      daiBondDepository,
      stakeManager,
      wftmBondDepository,
      daiLPBondDepository: fhmDaiBondDepository,
      lpBondCalculator,
      stakingHelper,
      circulatingSupply: fhmCirculatingSupply,
    } = await beforeHook({
      provider: ethers.provider,
      stratConfig,
      rebaseTokenAddr: SPA,
      stakedRebaseTokenAddr: STAKED_SPA,
      daiBondAddr: FHM_DAI_BOND,
      wftmBondAddr: FHM_WFTM_BOND,
      daiLPBondAddr: FHM_DAI_LP_BOND,
      lpBondCalculatorAddr: FHM_BOND_CALCULATOR,
      stakeManagerAddr: FHM_STAKE_MANAGER,
      whales: FHM_WHALES,
      treasuryAddr: SPA_TREASURY,
      fundStaked: true,
      stakingHelperAddr: FHM_STAKER,
      circulatingSupplyAddr: FHM_CIRCULATING_SUPPLY,
    }));
  });

  beforeEach(async () => {
    ({ vault, strategy, deployer, keeper, other } = await beforeEachHook({
      contractNames,
      vaultConfig,
      stratConfig,
      unirouter,
      rebaseToken: want,
      whale,
      stakedRebaseToken: stakedWant,
      fundStaked: true,
    }));
  });

  it("Can force dai bond discount positive", async function () {
    const rebasePrice = await strategy.rebaseTokenPriceInUSD(1e9);
    const targetPrice = rebasePrice.mul(90).div(100);
    await forceFHMBondPositive(
      ethers.provider,
      daiBondDepository,
      fhmCirculatingSupply
    );
    const newUSDPrice = await daiBondDepository.bondPriceInUSD();

    // Allow leeway for rounding/oracle error
    expect(newUSDPrice).to.lte(targetPrice.mul(102).div(100));
    expect(newUSDPrice).to.gte(targetPrice.mul(98).div(100));
  }).timeout(TEST_TIMEOUT);

  it("Can force wftm bond discount positive", async function () {
    const rebasePrice = await strategy.rebaseTokenPriceInUSD(1e9);
    const targetPrice = rebasePrice.mul(90).div(100);

    await forceFHMBondPositive(
      ethers.provider,
      wftmBondDepository,
      fhmCirculatingSupply,
      (isNonStable = true)
    );
    const newUSDPrice = await wftmBondDepository.bondPriceInUSD();

    // Allow leeway for rounding/oracle error
    expect(newUSDPrice).to.lte(targetPrice.mul(102).div(100));
    expect(newUSDPrice).to.gte(targetPrice.mul(98).div(100));
  }).timeout(TEST_TIMEOUT);

  it("Can force fhm-dai LP bond discount positive", async function () {
    const rebasePrice = await strategy.rebaseTokenPriceInUSD(1e9);
    const targetPrice = rebasePrice.mul(90).div(100);

    await forceFHMBondPositive(
      ethers.provider,
      fhmDaiBondDepository,
      fhmCirculatingSupply
    );
    const newUSDPrice = await fhmDaiBondDepository.bondPriceInUSD();

    // Allow leeway for rounding/oracle error
    expect(newUSDPrice).to.lte(targetPrice.mul(102).div(100));
    expect(newUSDPrice).to.gte(targetPrice.mul(98).div(100));
  }).timeout(TEST_TIMEOUT);

  it("Can force dai bond discount negative", async function () {
    const rebasePrice = await strategy.rebaseTokenPriceInUSD(1e9);
    const targetPrice = rebasePrice.mul(110).div(100);

    await forceFHMBondNegative(ethers.provider, daiBondDepository, strategy);
    const newUSDPrice = await daiBondDepository.bondPriceInUSD();

    // Allow leeway for rounding/oracle error
    expect(newUSDPrice).to.lte(targetPrice.mul(102).div(100));
    expect(newUSDPrice).to.gte(targetPrice.mul(98).div(100));
  }).timeout(TEST_TIMEOUT);

  it("Can force wftm bond discount negative", async function () {
    const rebasePrice = await strategy.rebaseTokenPriceInUSD(1e9);
    const targetPrice = rebasePrice.mul(110).div(100);
    await forceFHMBondNegative(ethers.provider, wftmBondDepository, strategy);
    const newUSDPrice = await wftmBondDepository.bondPriceInUSD();

    // Allow leeway for rounding/oracle error
    expect(newUSDPrice).to.lte(targetPrice.mul(103).div(100));
    expect(newUSDPrice).to.gte(targetPrice.mul(97).div(100));
  }).timeout(TEST_TIMEOUT);

  it("Can force spa-dai LP bond discount negative", async function () {
    const rebasePrice = await strategy.rebaseTokenPriceInUSD(1e9);
    const targetPrice = rebasePrice.mul(110).div(100);
    await forceFHMBondNegative(
      ethers.provider,
      fhmDaiBondDepository,
      strategy,
      lpBondCalculator,
      FHM_DAI_PAIR
    );
    const newUSDPrice = await fhmDaiBondDepository.bondPriceInUSD();

    // Allow leeway for rounding/oracle error
    expect(newUSDPrice).to.lte(targetPrice.mul(103).div(100));
    expect(newUSDPrice).to.gte(targetPrice.mul(97).div(100));
  }).timeout(TEST_TIMEOUT);
});
