const { expect } = require("chai");
const { beforeHook, beforeEachHook } = require("../../../utils/testUtils.ts");
const { addressBook } = require("blockchain-addressbook");
const {
  SPA,
  SPA_STAKER,
  STAKED_SPA,
  SPA_STAKE_MANAGER,
  BOGUS_ADDR_1,
  BOGUS_ADDR_2,
  BOGUS_ADDR_3,
  TEST_TIMEOUT,
} = require("../../../constants.js");
const { ethers } = require("hardhat");

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

describe("Spartacus Strategy Strat Manager", function () {
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
    stakeManager,
    daiWftmPair,
    rebaseTokenBalStart,
    daiValueInitial,
    unirouterData,
    dai;

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
      spaDaiBondDepository,
      daiWftmPair,
      stakeManager,
      dai,
    } = await beforeHook({
      stratConfig,
      rebaseTokenAddr: SPA,
      stakedRebaseTokenAddr: STAKED_SPA,
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
