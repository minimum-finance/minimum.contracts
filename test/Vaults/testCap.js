const { expect } = require("chai");
const { ethers } = require("hardhat");
const { addressBook } = require("blockchain-addressbook");
const {
  beforeEachHook,
  beforeHook,
  timeTravelBlocks,
  forceBondPositive,
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
  REBASE_PERIOD_BLOCKS,
  DAI_BOND,
  SPA_DAI_ROUTE,
  SLOW_TEST_FLAG,
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

describe("Minimum Vault Want Cap", function () {
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
    stakeManager;

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
    }));
  });

  it("Cannot deposit any amount that would overflow the cap", async function () {
    const cap = await vault.wantCap();
    expect(await want.balanceOf(deployer.address)).to.be.lt(cap);
    expect(await vault.capRoom()).to.eq(vaultConfig.wantCap);

    // deposit lower than cap goes through
    await vault.depositAll();

    expect(await vault.balance()).to.be.lt(cap);
    expect(await vault.capRoom()).to.eq(vaultConfig.wantCap.sub(wantBalStart));

    // deposit that would put the vault balance over cap gets reverted
    await expect(
      vault.connect(whale).deposit(vaultConfig.wantCap - wantBalStart + 1)
    ).to.be.revertedWith("> wantCap!");
  }).timeout(TEST_TIMEOUT);

  it("Can deposit again once the want balance becomes less than the cap", async function () {
    // set withdrawal fees and minDeposit to 0 to simplify the test
    await strategy.setWithdrawalFee(0);
    await strategy.setMinDeposit(0);
    expect(await vault.capRoom()).to.eq(vaultConfig.wantCap);

    const cap = await vault.wantCap();
    expect(await want.balanceOf(deployer.address)).to.be.lt(cap);

    // deposit lower than cap goes through
    await vault.depositAll();

    expect(await vault.balance()).to.be.lt(cap);
    expect(await vault.capRoom()).to.eq(vaultConfig.wantCap.sub(wantBalStart));

    // deposit that would put the vault balance over cap gets reverted
    await expect(
      vault.connect(whale).deposit(vaultConfig.wantCap - wantBalStart + 1)
    ).to.be.revertedWith("> wantCap!");

    await vault.reserveAll();

    expect(await vault.balance()).to.equal(0);
    expect((await vault.balance()).add(vaultConfig.wantCap - 1)).to.lt(
      vaultConfig.wantCap
    );
    expect(await vault.capRoom()).to.eq(vaultConfig.wantCap);

    // Now large deposit can occur
    await vault.connect(whale).deposit(vaultConfig.wantCap - 1);

    expect(await vault.balance()).to.equal(vaultConfig.wantCap - 1);
    expect(await vault.capRoom()).to.eq(1);

    // Can hit cap
    await vault.deposit(1);
    expect(await vault.capRoom()).to.eq(0);

    expect(await vault.balance()).to.equal(vaultConfig.wantCap);

    // Cannot go over cap
    await expect(vault.deposit(1)).to.be.revertedWith("> wantCap!");
  }).timeout(TEST_TIMEOUT);

  it(
    SLOW_TEST_FLAG + "want balance in the strategy can grow past the cap",
    async function () {
      expect(await vault.capRoom()).to.eq(vaultConfig.wantCap);
      await vault.connect(whale).deposit(vaultConfig.wantCap);
      expect(await vault.capRoom()).to.eq(0);

      expect(await vault.balance())
        .to.equal(vaultConfig.wantCap)
        .to.equal(await strategy.totalBalance())
        .to.equal(await strategy.stakedRebasing())
        .to.equal(await stakedWant.balanceOf(strategy.address));

      // Now one rebase will put the vault balance over the cap
      await timeTravelBlocks(ethers.provider, REBASE_PERIOD_BLOCKS);

      await stakeManager.rebase();
      expect(await vault.balance()).to.gt(vaultConfig.wantCap);
      expect(await vault.capRoom()).to.eq(0);

      // Depositing is not allowed over cap
      await expect(vault.depositAll()).to.be.revertedWith("> wantCap!");
    }
  ).timeout(TEST_TIMEOUT * 2);

  it("Manager can set cap", async function () {
    await strategy.setMinDeposit(1);
    await expect(vault.connect(whale).setCap(0)).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );

    await vault.setCap(0);

    await expect(vault.deposit(1)).to.be.revertedWith("> wantCap!");

    expect(await vault.wantCap()).to.equal(0);

    const newVaultCap = ethers.utils.parseUnits("10000", 9);

    await expect(vault.setCap(newVaultCap))
      .to.emit(vault, "NewWantCap")
      .withArgs(newVaultCap);

    expect(await vault.wantCap()).to.equal(newVaultCap);

    await vault.depositAll();

    // Can deposit up to the new cap
    await vault.connect(whale).deposit(newVaultCap.sub(wantBalStart));

    await expect(vault.connect(whale).deposit(1)).to.be.revertedWith(
      "> wantCap!"
    );
  }).timeout(TEST_TIMEOUT);

  it("Bonding doesn't affect cap", async function () {
    await strategy.setMinDeposit(0);
    await forceBondPositive(ethers.provider, daiBondDepository, strategy);
    await vault.connect(whale).deposit(vaultConfig.wantCap);

    expect(await vault.balance())
      .to.equal(await strategy.totalBalance())
      .to.equal(await strategy.stakedRebasing())
      .to.equal(await stakedWant.balanceOf(strategy.address))
      .to.equal(await vault.wantCap());

    await strategy.addBond(DAI_BOND);
    await strategy.stakeToBondSingleAll(DAI_BOND, SPA_DAI_ROUTE);

    expect(await vault.balance())
      .to.equal(await strategy.totalBalance())
      .to.equal(await strategy.rebaseBonded())
      .to.equal(await vault.wantCap())
      .to.equal(vaultConfig.wantCap);

    await expect(vault.deposit(1)).to.be.revertedWith("> wantCap!");
  }).timeout(TEST_TIMEOUT);

  it("Cannot deposit smaller than minDeposit", async function () {
    const minDeposit = await vault.minDeposit();
    expect(minDeposit).to.eq(stratConfig.minDeposit);

    await expect(vault.deposit(minDeposit.div(2))).to.be.revertedWith(
      "< minDeposit!"
    );
    await expect(vault.deposit(minDeposit.sub(1))).to.be.revertedWith(
      "< minDeposit!"
    );

    await vault.deposit(minDeposit);

    expect(await vault.balance())
      .to.eq(await strategy.stakedRebasing())
      .to.eq(minDeposit);
  }).timeout(TEST_TIMEOUT);

  it("Can get price per full share", async function () {
    expect(await vault.getPricePerFullShare()).to.eq(
      ethers.utils.parseUnits("1", 9)
    );

    await vault.depositAll();
    expect(await vault.getPricePerFullShare()).to.eq(
      ethers.utils.parseUnits("1", 9)
    );

    await want.connect(whale).transfer(strategy.address, wantBalStart);
    expect(await vault.getPricePerFullShare()).to.eq(
      ethers.utils.parseUnits("2", 9)
    );
  }).timeout(TEST_TIMEOUT);
});
