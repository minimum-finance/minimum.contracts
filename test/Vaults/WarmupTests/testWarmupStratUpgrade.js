const { expect } = require("chai");
const { ethers } = require("hardhat");
const { addressBook } = require("blockchain-addressbook");
const {
  beforeEachHook,
  beforeHook,
  timeTravelBlockTime,
  timeTravelBlocks,
  forceFHMBondPositive,
  forceHighMaxDebt,
} = require("../../../utils/testUtils.ts");

const { deployStrategy } = require("../../../utils/deployUtils.ts");

const {
  TEST_TIMEOUT,
  BOGUS_ADDR_1,
  BOGUS_ADDR_2,
  BOGUS_ADDR_3,
  FHM_STAKER,
  FHM_STAKE_MANAGER,
  FHM,
  STAKED_FHM,
  ZERO_ADDR,
  FHM_DAI_ROUTE,
  REBASE_PERIOD_BLOCKS,
  FHM_WFTM_BOND,
  FHM_DAI_BOND,
  FHM_BOND_CALCULATOR,
  FHM_WHALES,
  FHM_TREASURY,
  VAULT_TEST_FLAG,
  FHM_DAI_LP_BOND,
  WARMUP_TEST_FLAG,
  FHM_CIRCULATING_SUPPLY,
} = require("../../../constants.js");

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

const newStratConfig = {
  rebaseStaker: FHM_STAKER,
  stakeManager: FHM_STAKE_MANAGER,
  keeper: devAddress,
  unirouter: spookyswap.router,
  serviceFeeRecipient: BOGUS_ADDR_3,
  minDeposit: 200,
  discordLink: "https://discord.gg/fS5ZUwDtVK",
};

describe(WARMUP_TEST_FLAG + VAULT_TEST_FLAG + " Upgrade Strategy", function () {
  let vault,
    strategy,
    unirouter,
    unirouterData,
    want,
    stakedWant,
    stakeManager,
    stakingHelper,
    deployer,
    keeper,
    other,
    whale,
    dai,
    daiBondDepository,
    wftmBondDepository,
    fhmDaiBondDepository,
    wantBalStart,
    circulatingSupply;

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
      wftmBondDepository,
      daiLPBondDepository: fhmDaiBondDepository,
      stakingHelper,
      circulatingSupply,
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
      warmup: 3,
      circulatingSupplyAddr: FHM_CIRCULATING_SUPPLY,
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

  it("Warmup is properly configured", async function () {
    expect(await stakeManager.warmupPeriod()).to.eq(3);
  }).timeout(TEST_TIMEOUT);

  it("Can propose a strategy", async function () {
    const nullCandidate = await vault.stratCandidate();
    expect(nullCandidate.implementation).to.equal(ZERO_ADDR);
    expect(nullCandidate.proposedTime).to.equal(0);

    const invalidStrat = await deployStrategy(
      contractNames,
      newStratConfig,
      BOGUS_ADDR_3
    );

    await expect(vault.proposeStrat(invalidStrat.address)).to.be.revertedWith(
      "Proposal not valid for this Vault"
    );

    const newStrat = await deployStrategy(
      contractNames,
      newStratConfig,
      vault.address
    );

    await expect(vault.proposeStrat(newStrat.address))
      .to.emit(vault, "NewStratCandidate")
      .withArgs(newStrat.address);
    const newCandidate = await vault.stratCandidate();
    const currentBlockNumber = await ethers.provider.getBlockNumber();
    const currentBlock = await ethers.provider.getBlock(currentBlockNumber);

    expect(newCandidate.implementation).to.equal(newStrat.address);
    expect(newCandidate.proposedTime).to.equal(currentBlock.timestamp);
  }).timeout(TEST_TIMEOUT);

  it("Can upgrade a proposed strategy", async function () {
    let nullCandidate = await vault.stratCandidate();
    expect(nullCandidate.implementation).to.equal(ZERO_ADDR);
    expect(nullCandidate.proposedTime).to.equal(0);

    // Without a candidate, the strat cannot be upgraded
    await expect(vault.upgradeStrat()).to.be.revertedWith(
      "There is no candidate"
    );

    const newStrat = await deployStrategy(
      contractNames,
      newStratConfig,
      vault.address
    );

    await vault.proposeStrat(newStrat.address);
    const newCandidate = await vault.stratCandidate();
    let currentBlockNumber = await ethers.provider.getBlockNumber();
    let currentBlock = await ethers.provider.getBlock(currentBlockNumber);
    const approvalTimestamp =
      currentBlock.timestamp + vaultConfig.stratApprovalDelay;

    expect(newCandidate.implementation).to.equal(newStrat.address);
    expect(newCandidate.proposedTime).to.equal(currentBlock.timestamp);

    // Immediately, the strategy cannot be upgraded
    await expect(vault.upgradeStrat()).to.be.revertedWith(
      "Delay has not passed"
    );

    await timeTravelBlockTime(
      ethers.provider,
      vaultConfig.stratApprovalDelay - 2
    );

    currentBlockNumber = await ethers.provider.getBlockNumber();
    currentBlock = await ethers.provider.getBlock(currentBlockNumber);

    expect(currentBlock.timestamp).to.equal(approvalTimestamp - 1);

    // The strategy cannot be upgraded 1 second before the approval delay
    await expect(vault.upgradeStrat()).to.be.revertedWith(
      "Delay has not passed"
    );

    await timeTravelBlockTime(ethers.provider, 1);

    // The strategy can be upgraded on the exact timestamp of the approval delay
    await expect(vault.upgradeStrat())
      .to.emit(vault, "UpgradeStrat")
      .withArgs(newStrat.address);

    expect(await vault.strategy()).to.equal(newStrat.address);
    expect(await newStrat.vault()).to.equal(vault.address);

    // New proposed strat is null with proposed time set many years into the future
    nullCandidate = await vault.stratCandidate();
    expect(nullCandidate.implementation).to.equal(ZERO_ADDR);
    expect(nullCandidate.proposedTime)
      .to.equal(5000000000)
      .to.gt(currentBlock.timestamp * 3);
  }).timeout(TEST_TIMEOUT);

  it("Unstakes and transfers strat funds to the new strategy upon upgrade", async function () {
    await vault.depositAll();
    const newStrat = await deployStrategy(
      contractNames,
      newStratConfig,
      vault.address
    );
    await vault.proposeStrat(newStrat.address);
    await timeTravelBlockTime(ethers.provider, vaultConfig.stratApprovalDelay);

    expect(await strategy.totalBalance())
      .to.equal(wantBalStart)
      .to.equal(await strategy.stakedRebasing())
      .to.equal(await vault.balance());

    await vault.upgradeStrat();

    expect(await strategy.totalBalance())
      .to.equal(0)
      .to.equal(await strategy.totalRebasing())
      .to.equal((await vault.balance()).sub(wantBalStart))
      .to.equal(await strategy.stakedRebasing())
      .to.equal(await strategy.unstakedRebasing())
      .to.equal(await want.balanceOf(strategy.address))
      .to.equal(await stakedWant.balanceOf(strategy.address));
    expect(await newStrat.totalBalance())
      .to.equal(wantBalStart)
      .to.equal(await newStrat.unstakedRebasing())
      .to.equal(await want.balanceOf(newStrat.address));
  }).timeout(TEST_TIMEOUT);

  it("Unstakes and transfers strat funds to the new strategy upon upgrade (1/2 unstaked)", async function () {
    await vault.depositAll();
    const newStrat = await deployStrategy(
      contractNames,
      newStratConfig,
      vault.address
    );
    await vault.proposeStrat(newStrat.address);
    await timeTravelBlockTime(ethers.provider, vaultConfig.stratApprovalDelay);

    expect(await strategy.totalBalance())
      .to.equal(wantBalStart)
      .to.equal(await strategy.stakedRebasing())
      .to.equal(await vault.balance());

    await strategy.unstake(wantBalStart.div(2));

    expect(await strategy.totalBalance())
      .to.equal(wantBalStart)
      .to.equal((await strategy.stakedRebasing()).add(wantBalStart.div(2)))
      .to.equal(await vault.balance());
    expect(await strategy.unstakedRebasing()).to.eq(wantBalStart.div(2));

    await vault.upgradeStrat();

    expect(await strategy.totalBalance())
      .to.equal(0)
      .to.equal(await strategy.totalRebasing())
      .to.equal((await vault.balance()).sub(wantBalStart))
      .to.equal(await strategy.stakedRebasing())
      .to.equal(await strategy.unstakedRebasing())
      .to.equal(await want.balanceOf(strategy.address))
      .to.equal(await stakedWant.balanceOf(strategy.address));
    expect(await newStrat.totalBalance())
      .to.equal(wantBalStart)
      .to.equal(await newStrat.unstakedRebasing())
      .to.equal(await want.balanceOf(newStrat.address));
  }).timeout(TEST_TIMEOUT);

  it("Unstakes and transfers strat funds to the new strategy upon upgrade (all unstaked)", async function () {
    await vault.depositAll();
    const newStrat = await deployStrategy(
      contractNames,
      newStratConfig,
      vault.address
    );
    await vault.proposeStrat(newStrat.address);
    await timeTravelBlockTime(ethers.provider, vaultConfig.stratApprovalDelay);

    expect(await strategy.totalBalance())
      .to.equal(wantBalStart)
      .to.equal(await strategy.stakedRebasing())
      .to.equal(await vault.balance());

    await strategy.unstakeAll();

    expect(await strategy.totalBalance())
      .to.equal(wantBalStart)
      .to.equal(await strategy.unstakedRebasing())
      .to.equal(await vault.balance());

    await vault.upgradeStrat();

    expect(await strategy.totalBalance())
      .to.equal(0)
      .to.equal(await strategy.totalRebasing())
      .to.equal((await vault.balance()).sub(wantBalStart))
      .to.equal(await strategy.stakedRebasing())
      .to.equal(await strategy.unstakedRebasing())
      .to.equal(await want.balanceOf(strategy.address))
      .to.equal(await stakedWant.balanceOf(strategy.address));
    expect(await newStrat.totalBalance())
      .to.equal(wantBalStart)
      .to.equal(await newStrat.unstakedRebasing())
      .to.equal(await want.balanceOf(newStrat.address));
  }).timeout(TEST_TIMEOUT);

  it("Only the vault can call retireStrat", async function () {
    await expect(strategy.retireStrat()).to.be.revertedWith("!vault");
  }).timeout(TEST_TIMEOUT);

  it("Cannot upgrade strategy when bonding", async function () {
    await forceFHMBondPositive(
      ethers.provider,
      daiBondDepository,
      circulatingSupply
    );
    await forceHighMaxDebt(ethers.provider, daiBondDepository);
    await vault.depositAll();
    const newStrat = await deployStrategy(
      contractNames,
      newStratConfig,
      vault.address
    );
    await vault.proposeStrat(newStrat.address);

    await strategy.addBond(FHM_DAI_BOND);
    await strategy.stakeToBondSingleAll(FHM_DAI_BOND, FHM_DAI_ROUTE);
    expect(await strategy.isBonding()).to.be.true;

    await timeTravelBlockTime(ethers.provider, vaultConfig.stratApprovalDelay);
    expect(await strategy.totalBalance())
      .to.gt(wantBalStart)
      .to.equal(await vault.balance());
    expect(await strategy.stakedRebasing())
      .to.equal(await strategy.unstakedRebasing())
      .to.equal(0);

    expect(await strategy.isBonding()).to.be.true;
    await expect(vault.upgradeStrat()).to.be.revertedWith(
      "Cannot retire while bonding!"
    );
  }).timeout(TEST_TIMEOUT);

  it("Pauses the strategy if not already paused", async function () {
    expect(await strategy.paused()).to.be.false;
    const newStrat = await deployStrategy(
      contractNames,
      newStratConfig,
      vault.address
    );
    await vault.proposeStrat(newStrat.address);
    await timeTravelBlockTime(ethers.provider, vaultConfig.stratApprovalDelay);

    expect(await strategy.paused()).to.be.false;

    await vault.upgradeStrat();
    expect(await vault.strategy()).to.equal(newStrat.address);
    expect(await newStrat.vault()).to.equal(vault.address);

    expect(await strategy.paused()).to.be.true;
  }).timeout(TEST_TIMEOUT);

  it("Leaves the strategy paused if it is already paused", async function () {
    expect(await strategy.paused()).to.be.false;
    const newStrat = await deployStrategy(
      contractNames,
      newStratConfig,
      vault.address
    );
    await vault.proposeStrat(newStrat.address);
    await timeTravelBlockTime(ethers.provider, vaultConfig.stratApprovalDelay);

    await strategy.pause();

    expect(await strategy.paused()).to.be.true;

    await vault.upgradeStrat();
    expect(await vault.strategy()).to.equal(newStrat.address);
    expect(await newStrat.vault()).to.equal(vault.address);

    expect(await strategy.paused()).to.be.true;
  }).timeout(TEST_TIMEOUT);

  it("Non vault-owners can't propose or upgrade a strategy", async function () {
    const newStrat = await deployStrategy(
      contractNames,
      newStratConfig,
      vault.address
    );

    await expect(
      vault.connect(whale).proposeStrat(newStrat.address)
    ).to.be.revertedWith("Ownable: caller is not the owner");

    await vault.proposeStrat(newStrat.address);
    await timeTravelBlockTime(ethers.provider, vaultConfig.stratApprovalDelay);

    await expect(vault.connect(whale).upgradeStrat()).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );
    await vault.upgradeStrat();
    expect(await vault.strategy()).to.equal(newStrat.address);
  }).timeout(TEST_TIMEOUT);

  it("Strategy upgrade before reserveAll", async function () {
    const newStrat = await deployStrategy(
      contractNames,
      newStratConfig,
      vault.address
    );

    await vault.depositAll();
    expect(await vault.balance()).to.eq(wantBalStart);

    await vault.proposeStrat(newStrat.address);

    // Travel 1 rebase period(s) or the strat upgrade lock, whichever is longer
    await timeTravelBlocks(
      ethers.provider,
      Math.max(REBASE_PERIOD_BLOCKS, vaultConfig.stratApprovalDelay)
    );
    await stakeManager.rebase();

    const oldStratBal = await strategy.totalBalance();
    expect(oldStratBal)
      .to.equal(await vault.balance())
      .to.equal(await strategy.stakedRebasing())
      .to.gt(wantBalStart);

    await vault.upgradeStrat(); // Then upgrade strat
    expect(await vault.strategy()).to.equal(newStrat.address);

    expect(await vault.balance())
      .to.equal(await newStrat.unstakedRebasing())
      .to.equal(oldStratBal);

    // Can claim entire position immediately from new strat
    await vault.reserveAll();

    const withdrawalFee = await strategy.withdrawalFee();
    const WITHDRAWAL_FEE_DIVISOR = await strategy.WITHDRAWAL_FEE_DIVISOR();
    // Calculate withdrawal fee
    const withdrawalFeeAmount = oldStratBal
      .mul(withdrawalFee)
      .div(WITHDRAWAL_FEE_DIVISOR);

    expect(await want.balanceOf(deployer.address)).to.eq(
      oldStratBal.sub(withdrawalFeeAmount)
    );
  }).timeout(TEST_TIMEOUT);
});
