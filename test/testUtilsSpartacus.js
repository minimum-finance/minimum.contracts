const { expect } = require("chai");
const { ethers } = require("hardhat");
const { addressBook } = require("blockchain-addressbook");
const {
  beforeEachHook,
  beforeHook,
  forceBondPositive,
  forceBondNegative,
  whaleBond,
} = require("../utils/testUtils.ts");
const {
  TEST_TIMEOUT,
  BOGUS_ADDR_1,
  BOGUS_ADDR_2,
  SPA_DAI_PAIR,
  SPA_STAKER,
  SPA_STAKE_MANAGER,
  SPA,
  STAKED_SPA,
  SPA_DAI_ROUTE,
  SPA_WFTM_ROUTE,
  DAI_BOND,
  WFTM_BOND,
  SPA_DAI_BOND,
  SPARTACUS_TEST_FLAG,
  SPA_DAI_BOND_CALCULATOR,
  SPA_WHALES,
  SPA_TREASURY,
} = require("../constants.js");
const devAddress = BOGUS_ADDR_2;
const { spookyswap } = addressBook.fantom.platforms;

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

describe(SPARTACUS_TEST_FLAG + " Util functions", function () {
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
    spaDaiBondDepository,
    stakeManager,
    stakingHelper,
    lpBondCalculator,
    dai;

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
      lpBondCalculator,
      daiLPBondDepository: spaDaiBondDepository,
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
    ({ vault, strategy, deployer, keeper, other } = await beforeEachHook({
      contractNames,
      vaultConfig,
      stratConfig,
      unirouter,
      rebaseToken: want,
      whale,
      stakedRebaseToken: stakedWant,
      fundStaked: false,
    }));
  });

  it("Can force dai bond discount positive", async function () {
    const rebasePrice = await strategy.rebaseTokenPriceInUSD(1e9);
    const targetPrice = rebasePrice.mul(90).div(100);
    await forceBondPositive(
      ethers.provider,
      daiBondDepository,
      strategy,
      lpBondCalculator,
      SPA_DAI_PAIR
    );
    const newUSDPrice = await daiBondDepository.bondPriceInUSD();

    // Allow leeway for rounding/oracle error
    expect(newUSDPrice).to.lte(targetPrice.mul(102).div(100));
    expect(newUSDPrice).to.gte(targetPrice.mul(98).div(100));
  }).timeout(TEST_TIMEOUT);

  it("Can force wftm bond discount positive", async function () {
    const rebasePrice = await strategy.rebaseTokenPriceInUSD(1e9);
    const targetPrice = rebasePrice.mul(90).div(100);
    await forceBondPositive(
      ethers.provider,
      wftmBondDepository,
      strategy,
      lpBondCalculator,
      SPA_DAI_PAIR
    );
    const newUSDPrice = await wftmBondDepository.bondPriceInUSD();

    // Allow leeway for rounding/oracle error
    expect(newUSDPrice).to.lte(targetPrice.mul(103).div(100));
    expect(newUSDPrice).to.gte(targetPrice.mul(97).div(100));
  }).timeout(TEST_TIMEOUT);

  it("Can force spa-dai LP bond discount positive", async function () {
    const rebasePrice = await strategy.rebaseTokenPriceInUSD(1e9);
    const targetPrice = rebasePrice.mul(90).div(100);
    await forceBondPositive(
      ethers.provider,
      spaDaiBondDepository,
      strategy,
      lpBondCalculator,
      SPA_DAI_PAIR
    );
    const newUSDPrice = await spaDaiBondDepository.bondPriceInUSD();

    // Allow leeway for rounding/oracle error
    expect(newUSDPrice).to.lte(targetPrice.mul(103).div(100));
    expect(newUSDPrice).to.gte(targetPrice.mul(97).div(100));
  }).timeout(TEST_TIMEOUT);

  it("Can force dai bond discount negative", async function () {
    const rebasePrice = await strategy.rebaseTokenPriceInUSD(1e9);
    const targetPrice = rebasePrice.mul(110).div(100);
    await forceBondNegative(
      ethers.provider,
      daiBondDepository,
      strategy,
      lpBondCalculator,
      SPA_DAI_PAIR
    );
    const newUSDPrice = await daiBondDepository.bondPriceInUSD();

    // Allow leeway for rounding/oracle error
    expect(newUSDPrice).to.lte(targetPrice.mul(102).div(100));
    expect(newUSDPrice).to.gte(targetPrice.mul(98).div(100));
  }).timeout(TEST_TIMEOUT);

  it("Can force wftm bond discount negative", async function () {
    const rebasePrice = await strategy.rebaseTokenPriceInUSD(1e9);
    const targetPrice = rebasePrice.mul(110).div(100);
    await forceBondNegative(
      ethers.provider,
      wftmBondDepository,
      strategy,
      lpBondCalculator,
      SPA_DAI_PAIR
    );
    const newUSDPrice = await wftmBondDepository.bondPriceInUSD();

    // Allow leeway for rounding/oracle error
    expect(newUSDPrice).to.lte(targetPrice.mul(103).div(100));
    expect(newUSDPrice).to.gte(targetPrice.mul(97).div(100));
  }).timeout(TEST_TIMEOUT);

  it("Can force spa-dai LP bond discount negative", async function () {
    const rebasePrice = await strategy.rebaseTokenPriceInUSD(1e9);
    const targetPrice = rebasePrice.mul(110).div(100);
    await forceBondNegative(
      ethers.provider,
      spaDaiBondDepository,
      strategy,
      lpBondCalculator,
      SPA_DAI_PAIR
    );
    const newUSDPrice = await spaDaiBondDepository.bondPriceInUSD();

    // Allow leeway for rounding/oracle error
    expect(newUSDPrice).to.lte(targetPrice.mul(103).div(100));
    expect(newUSDPrice).to.gte(targetPrice.mul(97).div(100));
  }).timeout(TEST_TIMEOUT);

  it("Can force dai bond positive after whale bonds", async function () {
    await whaleBond(whale, daiBondDepository, SPA_DAI_ROUTE, unirouter);

    const rebasePrice = await strategy.rebaseTokenPriceInUSD(1e9);
    const targetPrice = rebasePrice.mul(90).div(100);
    await forceBondPositive(
      ethers.provider,
      daiBondDepository,
      strategy,
      lpBondCalculator,
      SPA_DAI_PAIR
    );
    const newUSDPrice = await daiBondDepository.bondPriceInUSD();

    // Allow leeway for rounding/oracle error
    expect(newUSDPrice).to.lte(targetPrice.mul(102).div(100));
    expect(newUSDPrice).to.gte(targetPrice.mul(98).div(100));
  }).timeout(TEST_TIMEOUT);

  it("Can force wftm bond positive after whale bonds", async function () {
    await whaleBond(whale, wftmBondDepository, SPA_WFTM_ROUTE, unirouter);

    const rebasePrice = await strategy.rebaseTokenPriceInUSD(1e9);
    const targetPrice = rebasePrice.mul(90).div(100);
    await forceBondPositive(
      ethers.provider,
      wftmBondDepository,
      strategy,
      lpBondCalculator,
      SPA_DAI_PAIR
    );
    const newUSDPrice = await wftmBondDepository.bondPriceInUSD();

    // Allow leeway for rounding/oracle error
    expect(newUSDPrice).to.lte(targetPrice.mul(103).div(100));
    expect(newUSDPrice).to.gte(targetPrice.mul(97).div(100));
  }).timeout(TEST_TIMEOUT);
});
