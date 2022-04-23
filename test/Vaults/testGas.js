const { expect } = require("chai");
const { ethers } = require("hardhat");
const { addressBook } = require("blockchain-addressbook");
const {
  beforeEachHook,
  beforeHook,
  forceBondPositive,
  getPawn,
  minimizeBondPeriod,
  timeTravelBlocks,
} = require("../../utils/testUtils.ts");
const {
  TEST_TIMEOUT,
  BOGUS_ADDR_1,
  BOGUS_ADDR_2,
  BOGUS_ADDR_3,
  SPA_DAI_PAIR,
  SPA_STAKER,
  SPA_STAKE_MANAGER,
  SPA,
  STAKED_SPA,
  DAI_BOND,
  SPA_DAI_ROUTE,
  SPA_DAI_BOND,
  WFTM_BOND,
  SPA_DAI_BOND_CALCULATOR,
  SPA_WHALES,
  SPA_TREASURY,
  VAULT_TEST_FLAG,
} = require("../../constants.js");

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
  wantCap: ethers.utils.parseUnits("1000", 9),
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

const newStratConfig = {
  rebaseStaker: SPA_STAKER,
  stakeManager: SPA_STAKE_MANAGER,
  keeper: devAddress,
  unirouter: spookyswap.router,
  serviceFeeRecipient: BOGUS_ADDR_3,
  minDeposit: 200,
  discordLink: "https://discord.gg/fS5ZUwDtVK",
};

describe.skip(VAULT_TEST_FLAG + " Gas", function () {
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
    dai,
    wantBalStart,
    daiBondDepository,
    spaDaiBondDepository,
    lpBondCalculator,
    stakeManager,
    stakingHelper;

  this.slow(20000);

  before(async () => {
    ({
      unirouter,
      rebaseToken: want,
      stakedRebaseToken: stakedWant,
      dai,
      unirouterData,
      whale,
      stakeManager,
      daiBondDepository,
      daiLPBondDepository: spaDaiBondDepository,
      lpBondCalculator,
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
      deployer,
      keeper,
      other,
      rebaseTokenBalStart: wantBalStart,
    } = await beforeEachHook({
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

  it("Deposit gas test", async function () {
    await vault.deposit(wantBalStart.div(2));
    await vault.depositAll();
    await vault.connect(whale).deposit(wantBalStart);
    await vault.connect(whale).deposit(wantBalStart);
    await vault.connect(whale).deposit(wantBalStart);
  }).timeout(TEST_TIMEOUT);

  it("Stake to bond single gas test", async function () {
    await vault.depositAll();
    await strategy.addBond(DAI_BOND);
    await forceBondPositive(ethers.provider, daiBondDepository, strategy);
    await strategy.stakeToBondSingleAll(DAI_BOND, SPA_DAI_ROUTE);
  }).timeout(TEST_TIMEOUT);

  it("Stake to bond LP gas test", async function () {
    await vault.depositAll();
    await strategy.addBond(SPA_DAI_BOND);
    await forceBondPositive(
      ethers.provider,
      spaDaiBondDepository,
      strategy,
      lpBondCalculator,
      SPA_DAI_PAIR
    );
    await strategy.stakeToBondLPAll(SPA_DAI_BOND, [SPA], SPA_DAI_ROUTE);
  }).timeout(TEST_TIMEOUT);

  // Notice that each additional withdrawer adds 31990 gas to the redeemAndStake tx
  // This looks to be viable up to about 500 withdrawers in a single redeemAndStake tx ($15 tx ~half of block gas limit)
  // This scales enough for V1 but the method should be reconsidered in future iterations.
  it("Avoids gas limit issues", async function () {
    await minimizeBondPeriod(ethers.provider, daiBondDepository);
    await forceBondPositive(ethers.provider, daiBondDepository, strategy);
    const pawns = [];
    const pawnNum = 1;
    const vaultAddr = vault.address;

    for (let i = 0; i < pawnNum; i++) {
      let pawn = await getPawn(
        ethers.provider,
        want,
        whale,
        deployer,
        ethers.utils.parseUnits("1", 9),
        vaultAddr
      );
      pawns.push(pawn);
      await vault.connect(pawn).depositAll();
    }

    expect(await vault.balance()).to.eq(
      ethers.utils.parseUnits(pawnNum + "", 9)
    );

    await strategy.addBond(DAI_BOND);
    await strategy.stakeToBondSingleAll(DAI_BOND, SPA_DAI_ROUTE);

    expect(await vault.balance()).to.eq(
      ethers.utils.parseUnits(pawnNum + "", 9)
    );

    for (let i = 0; i < pawns.length; i++) {
      await vault.connect(pawns[i]).reserveAll();
    }

    await timeTravelBlocks(ethers.provider, 10000);

    await strategy.redeemAndStake();
  }).timeout(TEST_TIMEOUT * 5);
});
