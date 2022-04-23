const { expect } = require("chai");
const { ethers } = require("hardhat");
const { addressBook } = require("blockchain-addressbook");
const {
  beforeEachHook,
  beforeHook,
  timeTravelBlocks,
  forceHighMaxDebt,
} = require("../../utils/testUtils.ts");
const {
  TEST_TIMEOUT,
  BOGUS_ADDR_1,
  BOGUS_ADDR_2,
  FHM_STAKER,
  FHM_STAKE_MANAGER,
  FHM,
  STAKED_FHM,
  REBASE_PERIOD_BLOCKS,
  DAI_BOND,
  FHM_DAI_ROUTE,
  SLOW_TEST_FLAG,
  FHM_DAI_BOND,
  FHM_BOND_CALCULATOR,
  FHM_WHALES,
  FHM_TREASURY,
  VAULT_TEST_FLAG,
  FHM_DAI_LP_BOND,
  FHM_WFTM_BOND,
} = require("../../constants.js");
const { WFTM_BOND, FHM_WFTM_ROUTE } = require("../../constants");

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
  wantCap: ethers.utils.parseUnits("1000", 9),
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

describe(VAULT_TEST_FLAG + " Want Cap", function () {
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
      treasuryAddr: FHM_TREASURY,
      fundStaked: true,
      stakingHelperAddr: FHM_STAKER,
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
      fundStaked: true,
    }));
  });

  it("Cannot deposit any amount that would overflow the cap", async function () {
    const cap = await vault.wantCap();
    expect(await stakedWant.balanceOf(deployer.address)).to.be.lt(cap);
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
    expect(await stakedWant.balanceOf(deployer.address)).to.be.lt(cap);

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
    await vault.connect(whale).deposit(1);
    expect(await vault.capRoom()).to.eq(0);

    expect(await vault.balance()).to.equal(vaultConfig.wantCap);

    // Cannot go over cap
    await expect(vault.connect(whale).deposit(1)).to.be.revertedWith(
      "> wantCap!"
    );
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

    const newVaultCap = ethers.utils.parseUnits("5000", 9);

    await expect(vault.setCap(newVaultCap))
      .to.emit(vault, "NewWantCap")
      .withArgs(newVaultCap);

    expect(await vault.wantCap()).to.equal(newVaultCap);

    await vault.depositAll();

    const whaleBal = await stakedWant.balanceOf(whale._address);

    expect(whaleBal).to.gt(newVaultCap);

    // Can deposit up to the new cap
    await vault.connect(whale).deposit(newVaultCap.sub(wantBalStart));

    await expect(vault.connect(whale).deposit(1)).to.be.revertedWith(
      "> wantCap!"
    );
  }).timeout(TEST_TIMEOUT);

  it("Bonding doesn't affect cap", async function () {
    await forceHighMaxDebt(ethers.provider, daiBondDepository);
    await strategy.setMinDeposit(0);
    await vault.connect(whale).deposit(vaultConfig.wantCap);

    expect(await vault.balance())
      .to.equal(await strategy.totalBalance())
      .to.equal(await strategy.stakedRebasing())
      .to.equal(await stakedWant.balanceOf(strategy.address))
      .to.equal(await vault.wantCap());

    await strategy.addBond(FHM_DAI_BOND);
    await strategy.stakeToBondSingleAll(FHM_DAI_BOND, FHM_DAI_ROUTE);

    expect(await vault.balance())
      .to.equal(await strategy.totalBalance())
      .to.equal(await strategy.rebaseBonded())
      .to.gt(await vault.wantCap())
      .to.gt(vaultConfig.wantCap);

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

    await stakedWant.connect(whale).transfer(strategy.address, wantBalStart);
    expect(await vault.getPricePerFullShare()).to.eq(
      ethers.utils.parseUnits("2", 9)
    );
  }).timeout(TEST_TIMEOUT);
});
