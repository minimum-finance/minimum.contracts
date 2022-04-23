const { expect } = require("chai");
const { beforeHook, beforeEachHook } = require("../../../utils/testUtils.ts");
const { addressBook } = require("blockchain-addressbook");
const {
  FHM,
  FHM_STAKER,
  STAKED_FHM,
  FHM_STAKE_MANAGER,
  BOGUS_ADDR_1,
  BOGUS_ADDR_2,
  BOGUS_ADDR_3,
  TEST_TIMEOUT,
  FANTOHM_TEST_FLAG,
  FHM_DAI_BOND,
  WFTM_FHM_ROUTE,
  FHM_WFTM_BOND,
  FHM_DAI_LP_BOND,
  FHM_BOND_CALCULATOR,
  FHM_WHALES,
  FHM_TREASURY,
} = require("../../../constants.js");
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

describe(FANTOHM_TEST_FLAG + " Strategy Strat Manager", function () {
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
    dai;

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
      daiWftmPair,
      stakeManager,
      dai,
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
  });

  it("Manager can set keeper", async function () {
    expect((await strategy.keeper()).toUpperCase()).to.equal(
      stratConfig.keeper.toUpperCase()
    );
    await expect(
      strategy.connect(keeper).setKeeper(BOGUS_ADDR_3)
    ).to.be.revertedWith("Ownable: caller is not the owner");

    await expect(strategy.setKeeper(BOGUS_ADDR_3))
      .to.emit(strategy, "NewKeeper")
      .withArgs(ethers.utils.getAddress(BOGUS_ADDR_3));
    expect((await strategy.keeper()).toUpperCase()).to.equal(
      BOGUS_ADDR_3.toUpperCase()
    );
  }).timeout(TEST_TIMEOUT);

  it("Manager can set unirouter", async function () {
    expect((await strategy.unirouter()).toUpperCase()).to.equal(
      stratConfig.unirouter.toUpperCase()
    );
    await expect(
      strategy.connect(keeper).setUnirouter(BOGUS_ADDR_3)
    ).to.be.revertedWith("Ownable: caller is not the owner");

    await expect(strategy.setUnirouter(BOGUS_ADDR_3))
      .to.emit(strategy, "NewUnirouter")
      .withArgs(ethers.utils.getAddress(BOGUS_ADDR_3));
    expect((await strategy.unirouter()).toUpperCase()).to.equal(
      BOGUS_ADDR_3.toUpperCase()
    );
  }).timeout(TEST_TIMEOUT);

  it("Manager can set vault", async function () {
    expect(await strategy.vault()).to.equal(vault.address);
    await expect(
      strategy.connect(keeper).setVault(BOGUS_ADDR_3)
    ).to.be.revertedWith("Ownable: caller is not the owner");

    await expect(strategy.setVault(BOGUS_ADDR_3))
      .to.emit(strategy, "NewVault")
      .withArgs(ethers.utils.getAddress(BOGUS_ADDR_3));
    expect((await strategy.vault()).toUpperCase()).to.equal(
      BOGUS_ADDR_3.toUpperCase()
    );
  }).timeout(TEST_TIMEOUT);

  it("Manager can set serviceFeeRecipient", async function () {
    expect((await strategy.serviceFeeRecipient()).toUpperCase()).to.equal(
      stratConfig.serviceFeeRecipient.toUpperCase()
    );
    await expect(
      strategy.connect(keeper).setServiceFeeRecipient(BOGUS_ADDR_3)
    ).to.be.revertedWith("Ownable: caller is not the owner");

    await expect(strategy.setServiceFeeRecipient(BOGUS_ADDR_3))
      .to.emit(strategy, "NewServiceFeeRecipient")
      .withArgs(ethers.utils.getAddress(BOGUS_ADDR_3));
    expect((await strategy.serviceFeeRecipient()).toUpperCase()).to.equal(
      BOGUS_ADDR_3.toUpperCase()
    );
  }).timeout(TEST_TIMEOUT);

  it("Manager can set minDeposit", async function () {
    const newMinDeposit = ethers.utils.parseUnits("1", 9);
    expect(await strategy.minDeposit()).to.equal(stratConfig.minDeposit);
    await expect(
      strategy.connect(keeper).setMinDeposit(newMinDeposit)
    ).to.be.revertedWith("Ownable: caller is not the owner");

    await expect(strategy.setMinDeposit(newMinDeposit))
      .to.emit(strategy, "NewMinDeposit")
      .withArgs(newMinDeposit);
    expect(await strategy.minDeposit()).to.equal(newMinDeposit);
  }).timeout(TEST_TIMEOUT);
});
