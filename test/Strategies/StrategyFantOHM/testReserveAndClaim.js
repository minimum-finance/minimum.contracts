const { expect } = require("chai");
const {
  beforeHook,
  beforeEachHook,
  minimizeBondPeriod,
  timeTravelBlocks,
  forceFHMBondMinimumPositive,
  forceHighMaxDebt,
} = require("../../../utils/testUtils.ts");
const { addressBook } = require("blockchain-addressbook");
const {
  FHM,
  FHM_STAKER,
  STAKED_FHM,
  FHM_STAKE_MANAGER,
  BOGUS_ADDR_1,
  BOGUS_ADDR_2,
  TEST_TIMEOUT,
  FHM_DAI_BOND,
  FHM_DAI_ROUTE,
  FANTOHM_TEST_FLAG,
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
  fhmCap: ethers.utils.parseUnits("6000", 9),
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

describe(FANTOHM_TEST_FLAG + " Strategy Reserve/Claim", function () {
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

  this.slow(30000);

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

    await forceHighMaxDebt(ethers.provider, daiBondDepository);
    await forceHighMaxDebt(ethers.provider, wftmBondDepository);
    await forceHighMaxDebt(ethers.provider, fhmDaiBondDepository);
  });

  it("Can reserve and instantly receive entire deposit from staking", async function () {
    await vault.depositAll(); // Goes straight to staking

    const fhmStaked = await stakedFhm.balanceOf(strategy.address);
    expect(fhmStaked).to.equal(rebaseTokenBalStart); // Confirmed the FHM is staked
    // Confirm not bonding currently
    expect(await strategy.isBonding()).to.be.false;

    // Reserves are 0 before
    expect(await strategy.reserves()).to.eq(0);
    expect((await strategy.claimOfReserves(deployer.address)).amount).to.eq(0);

    const withdrawalFee = await strategy.withdrawalFee();
    const withdrawalFeeDenom = await strategy.WITHDRAWAL_FEE_DIVISOR();
    const withdrawalFeeAmount = (await vault.balance())
      .mul(withdrawalFee)
      .div(withdrawalFeeDenom);

    await expect(vault.reserveAll())
      .to.emit(strategy, "Reserve")
      .withArgs(
        withdrawalFeeAmount,
        rebaseTokenBalStart.sub(withdrawalFeeAmount)
      );
    // When staking reserve should immediately send funds
    const deployerBalAfter = await fhm.balanceOf(deployer.address);
    // After claim, deployer balance is initial balance
    expect(deployerBalAfter).to.lte(rebaseTokenBalStart);
    expect(deployerBalAfter).to.gte(rebaseTokenBalStart.mul(99).div(100));
    expect(deployerBalAfter).to.eq(
      rebaseTokenBalStart.sub(withdrawalFeeAmount)
    );
    // Reserves should remain 0 after immediate redemption
    expect(await strategy.reserves()).to.eq(0);
    expect((await strategy.claimOfReserves(deployer.address)).amount).to.eq(0);
  }).timeout(TEST_TIMEOUT);

  it("Can reserve and instantly receive entire deposit from staking (with 1/2 unstaked)", async function () {
    await vault.depositAll(); // Goes straight to staking

    const fhmStaked = await stakedFhm.balanceOf(strategy.address);
    expect(fhmStaked).to.equal(rebaseTokenBalStart); // Confirmed the FHM is staked
    // Confirm not bonding currently
    expect(await strategy.isBonding()).to.be.false;

    // Reserves are 0 before
    expect(await strategy.reserves()).to.eq(0);
    expect((await strategy.claimOfReserves(deployer.address)).amount).to.eq(0);

    await strategy.unstake(rebaseTokenBalStart.div(2));

    const withdrawalFee = await strategy.withdrawalFee();
    const withdrawalFeeDenom = await strategy.WITHDRAWAL_FEE_DIVISOR();
    const withdrawalFeeAmount = (await vault.balance())
      .mul(withdrawalFee)
      .div(withdrawalFeeDenom);

    await vault.reserveAll();
    // When staking reserve should immediately send funds
    const deployerBalAfter = await fhm.balanceOf(deployer.address);
    // After claim, deployer balance is initial balance
    expect(deployerBalAfter).to.lte(rebaseTokenBalStart);
    expect(deployerBalAfter).to.gte(rebaseTokenBalStart.mul(99).div(100));
    expect(deployerBalAfter).to.eq(
      rebaseTokenBalStart.sub(withdrawalFeeAmount)
    );
    // Reserves should remain 0 after immediate redemption
    expect(await strategy.reserves()).to.eq(0);
    expect((await strategy.claimOfReserves(deployer.address)).amount).to.eq(0);
    expect(await strategy.totalBalance())
      .to.eq(await vault.balance())
      .to.eq(await strategy.stakedRebasing());
  }).timeout(TEST_TIMEOUT);

  it("Can reserve and instantly receive entire deposit from staking (with all unstaked)", async function () {
    await vault.depositAll(); // Goes straight to staking

    const fhmStaked = await stakedFhm.balanceOf(strategy.address);
    expect(fhmStaked).to.equal(rebaseTokenBalStart); // Confirmed the FHM is staked
    // Confirm not bonding currently
    expect(await strategy.isBonding()).to.be.false;

    // Reserves are 0 before
    expect(await strategy.reserves()).to.eq(0);
    expect((await strategy.claimOfReserves(deployer.address)).amount).to.eq(0);

    await strategy.unstakeAll();

    const withdrawalFee = await strategy.withdrawalFee();
    const withdrawalFeeDenom = await strategy.WITHDRAWAL_FEE_DIVISOR();
    const withdrawalFeeAmount = (await vault.balance())
      .mul(withdrawalFee)
      .div(withdrawalFeeDenom);

    await vault.reserveAll();
    // When staking reserve should immediately send funds
    const deployerBalAfter = await fhm.balanceOf(deployer.address);
    // After claim, deployer balance is initial balance
    expect(deployerBalAfter).to.lte(rebaseTokenBalStart);
    expect(deployerBalAfter).to.gte(rebaseTokenBalStart.mul(99).div(100));
    expect(deployerBalAfter).to.eq(
      rebaseTokenBalStart.sub(withdrawalFeeAmount)
    );
    // Reserves should remain 0 after immediate redemption
    expect(await strategy.reserves()).to.eq(0);
    expect((await strategy.claimOfReserves(deployer.address)).amount).to.eq(0);
    expect(await strategy.totalBalance())
      .to.eq(await vault.balance())
      .to.eq(await strategy.unstakedRebasing());
  }).timeout(TEST_TIMEOUT);

  it("Can reserve and instantly receive entire deposit from staking (with more unstaked)", async function () {
    await vault.depositAll(); // Goes straight to staking

    const fhmStaked = await stakedFhm.balanceOf(strategy.address);
    expect(fhmStaked).to.equal(rebaseTokenBalStart); // Confirmed the FHM is staked
    // Confirm not bonding currently
    expect(await strategy.isBonding()).to.be.false;
    // Reserves are 0 before
    expect(await strategy.reserves()).to.eq(0);
    expect((await strategy.claimOfReserves(deployer.address)).amount).to.eq(0);

    await stakeManager.connect(whale).unstake(rebaseTokenBalStart, false);
    await fhm.connect(whale).transfer(strategy.address, rebaseTokenBalStart);

    const withdrawalFee = await strategy.withdrawalFee();
    const withdrawalFeeDenom = await strategy.WITHDRAWAL_FEE_DIVISOR();
    const withdrawalFeeAmount = (await vault.balance())
      .mul(withdrawalFee)
      .div(withdrawalFeeDenom);

    await vault.reserveAll();
    // When staking reserve should immediately send funds
    const deployerBalAfter = await fhm.balanceOf(deployer.address);
    // After claim, deployer balance is initial balance
    expect(deployerBalAfter).to.lte(rebaseTokenBalStart.mul(2));
    expect(deployerBalAfter).to.gte(rebaseTokenBalStart.mul(198).div(100));
    expect(deployerBalAfter).to.eq(
      rebaseTokenBalStart.mul(2).sub(withdrawalFeeAmount)
    );
    // Reserves should remain 0 after immediate redemption
    expect(await strategy.reserves()).to.eq(0);
    expect((await strategy.claimOfReserves(deployer.address)).amount).to.eq(0);
    expect(await strategy.totalBalance())
      .to.eq(await vault.balance())
      .to.eq(await strategy.stakedRebasing());
  }).timeout(TEST_TIMEOUT);

  it("Can reserve and instantly receive entire deposit from staking (with more unstaked from second user)", async function () {
    await vault.depositAll(); // Goes straight to staking

    const fhmStaked = await stakedFhm.balanceOf(strategy.address);
    expect(fhmStaked).to.equal(rebaseTokenBalStart); // Confirmed the FHM is staked
    // Confirm not bonding currently
    expect(await strategy.isBonding()).to.be.false;

    // Reserves are 0 before
    expect(await strategy.reserves()).to.eq(0);
    expect((await strategy.claimOfReserves(deployer.address)).amount).to.eq(0);

    const withdrawalFee = await strategy.withdrawalFee();
    const withdrawalFeeDenom = await strategy.WITHDRAWAL_FEE_DIVISOR();
    const withdrawalFeeAmount = (await vault.balance())
      .mul(withdrawalFee)
      .div(withdrawalFeeDenom);

    await vault.connect(whale).deposit(rebaseTokenBalStart);
    await strategy.unstake(rebaseTokenBalStart.sub(withdrawalFeeAmount));

    await vault.reserveAll();
    // When staking reserve should immediately send funds
    const deployerBalAfter = await fhm.balanceOf(deployer.address);
    // After claim, deployer balance is initial balance
    expect(deployerBalAfter).to.lte(rebaseTokenBalStart);
    expect(deployerBalAfter).to.gte(rebaseTokenBalStart.mul(99).div(100));
    expect(deployerBalAfter).to.eq(
      rebaseTokenBalStart.sub(withdrawalFeeAmount)
    );
    // Reserves should remain 0 after immediate redemption
    expect(await strategy.reserves()).to.eq(0);
    expect((await strategy.claimOfReserves(deployer.address)).amount).to.eq(0);
    expect(await strategy.totalBalance())
      .to.eq(await vault.balance())
      .to.eq(await strategy.stakedRebasing());
    expect(await strategy.unstakedRebasing()).to.eq(0);
  }).timeout(TEST_TIMEOUT);

  it("Can reserve and instantly receive entire deposit from staking (all unstaked with second user)", async function () {
    await vault.depositAll(); // Goes straight to staking

    const fhmStaked = await stakedFhm.balanceOf(strategy.address);
    expect(fhmStaked).to.equal(rebaseTokenBalStart); // Confirmed the FHM is staked
    // Confirm not bonding currently
    expect(await strategy.isBonding()).to.be.false;

    // Reserves are 0 before
    expect(await strategy.reserves()).to.eq(0);
    expect((await strategy.claimOfReserves(deployer.address)).amount).to.eq(0);

    const withdrawalFee = await strategy.withdrawalFee();
    const withdrawalFeeDenom = await strategy.WITHDRAWAL_FEE_DIVISOR();
    const withdrawalFeeAmount = (await vault.balance())
      .mul(withdrawalFee)
      .div(withdrawalFeeDenom);

    await vault.connect(whale).deposit(rebaseTokenBalStart);
    await strategy.unstakeAll();

    await vault.reserveAll();
    // When staking reserve should immediately send funds
    const deployerBalAfter = await fhm.balanceOf(deployer.address);
    // After claim, deployer balance is initial balance
    expect(deployerBalAfter).to.lte(rebaseTokenBalStart);
    expect(deployerBalAfter).to.gte(rebaseTokenBalStart.mul(99).div(100));
    expect(deployerBalAfter).to.eq(
      rebaseTokenBalStart.sub(withdrawalFeeAmount)
    );
    // Reserves should remain 0 after immediate redemption
    expect(await strategy.reserves()).to.eq(0);
    expect((await strategy.claimOfReserves(deployer.address)).amount).to.eq(0);
    expect(await strategy.totalBalance())
      .to.eq(await vault.balance())
      .to.eq(await strategy.unstakedRebasing());
    expect(await strategy.stakedRebasing()).to.eq(0);
  }).timeout(TEST_TIMEOUT);

  it("Cannot reserve immediately while bonding", async function () {
    await vault.depositAll(); // Goes straight to staking

    expect(await strategy.stakedRebasing()).to.equal(rebaseTokenBalStart); // Confirmed the FHM is staked
    // Confirm not bonding currently
    expect(await strategy.isBonding()).to.be.false;
    // Confirm reserves empty
    expect(await strategy.reserves())
      .to.equal((await strategy.claimOfReserves(deployer.address)).amount)
      .to.equal(0);

    await strategy.addBond(FHM_DAI_BOND);
    await strategy.stakeToBondSingleAll(FHM_DAI_BOND, FHM_DAI_ROUTE);

    // Confirm bonding currently
    expect(await strategy.isBonding()).to.be.true;

    const vaultBalBefore = await vault.balance();

    await vault.reserveAll();

    const withdrawalFee = await strategy.withdrawalFee();
    const withdrawalFeeDenom = await strategy.WITHDRAWAL_FEE_DIVISOR();
    const withdrawalFeeAmount = vaultBalBefore
      .mul(withdrawalFee)
      .div(withdrawalFeeDenom);

    const vaultBal = await strategy.rebaseBonded();

    // Deployer should not be considered fullyVested as we are bonding
    expect(await strategy.isBonding()).to.be.true;
    expect((await strategy.claimOfReserves(deployer.address)).amount).to.eq(
      vaultBal.sub(withdrawalFeeAmount)
    );
    // Reserves are immediately updated
    expect(await strategy.reserves()).to.eq(vaultBal.sub(withdrawalFeeAmount));
    expect(await vault.balance()).to.eq(withdrawalFeeAmount);

    // Ensure deployer balance is 0 before bond is over
    expect(await fhm.balanceOf(deployer.address)).to.equal(0);
  }).timeout(TEST_TIMEOUT);

  it("Over one bond withdraw 1/3, 1/3, then receive ~2/3 on final redemption", async function () {
    await forceFHMBondMinimumPositive(
      ethers.provider,
      daiBondDepository,
      strategy
    );
    await minimizeBondPeriod(ethers.provider, daiBondDepository, strategy);

    await vault.deposit(rebaseTokenBalStart); // takes care of the transfer.
    const deployerVaultToken = await vault.balanceOf(deployer.address);

    await strategy.addBond(FHM_DAI_BOND);
    await strategy.stakeToBondSingleAll(FHM_DAI_BOND, FHM_DAI_ROUTE);
    expect(await strategy.currentBond()).to.eq(FHM_DAI_BOND);
    expect(await strategy.unstakedRebasing()).to.eq(0);
    expect(await strategy.stakedRebasing()).to.eq(0);
    expect(await strategy.rebaseBonded()).to.gt(rebaseTokenBalStart);
    expect(await strategy.rebaseBonded()).to.eq(await vault.balance());

    await timeTravelBlocks(ethers.provider, 5000);
    await stakeManager.rebase();

    const withdrawalFee = await strategy.withdrawalFee();
    const withdrawalFeeDenom = await strategy.WITHDRAWAL_FEE_DIVISOR();

    await strategy.redeemAndStake();
    expect(await vault.balance()).to.gt(rebaseTokenBalStart);

    let withdrawalAmount = (await vault.balance()).div(3);

    await vault.reserve(deployerVaultToken.div(3)); // Reserve 1/3

    let withdrawalFeeAmount = withdrawalAmount
      .mul(withdrawalFee)
      .div(withdrawalFeeDenom);
    expect((await strategy.claimOfReserves(deployer.address)).amount).to.lte(
      withdrawalAmount.sub(withdrawalFeeAmount).add(1)
    );
    expect((await strategy.claimOfReserves(deployer.address)).amount).to.gte(
      withdrawalAmount.sub(withdrawalFeeAmount).sub(1)
    );

    await timeTravelBlocks(ethers.provider, 2000);
    const stakedBefore = await strategy.stakedRebasing();
    await stakeManager.rebase();
    const rebaseRewards = (await strategy.stakedRebasing()).sub(stakedBefore);
    await strategy.redeemAndStake();
    expect((await vault.balance()).add(await strategy.reserves())).to.gt(
      rebaseTokenBalStart.add(rebaseRewards)
    );
    const vaultBal = await strategy.totalBalance();
    await vault.reserve(deployerVaultToken.div(3)); // Reserve another 1/3
    withdrawalAmount = withdrawalAmount.add(vaultBal.div(2));
    withdrawalFeeAmount = withdrawalAmount
      .mul(withdrawalFee)
      .div(withdrawalFeeDenom);

    const claimOfReserves = await strategy.claimOfReserves(deployer.address);

    // Notice error from division
    expect(claimOfReserves.amount).to.lte(
      withdrawalAmount.sub(withdrawalFeeAmount).add(5)
    );
    expect(claimOfReserves.amount).to.gte(
      withdrawalAmount.sub(withdrawalFeeAmount).sub(5)
    );

    await timeTravelBlocks(ethers.provider, 3000);
    await stakeManager.rebase();
    await strategy.redeemAndStake(); // Final redemption
    expect(await strategy.isBonding()).to.be.false;

    await vault.claim();

    const deployerBalAfter = await fhm.balanceOf(deployer.address);

    // Notice error from division
    expect(deployerBalAfter).to.lte(
      withdrawalAmount.sub(withdrawalFeeAmount).add(5)
    );
    expect(deployerBalAfter).to.gte(
      withdrawalAmount.sub(withdrawalFeeAmount).sub(5)
    );

    const vaultBalance = await vault.balance();
    expect(await strategy.stakedRebasing()).to.gt(0);
    expect(await strategy.unstakedRebasing()).to.eq(0);
    expect(deployerBalAfter.add(vaultBalance)).to.gt(rebaseTokenBalStart);
  }).timeout(TEST_TIMEOUT * 2);

  it("Over one bond withdraw 1/3, another bond withdraw 1/3, then receive ~2/3 at final redemption", async function () {
    await minimizeBondPeriod(ethers.provider, daiBondDepository, strategy);
    await forceFHMBondMinimumPositive(
      ethers.provider,
      daiBondDepository,
      strategy
    );

    await vault.deposit(rebaseTokenBalStart); // takes care of the transfer.
    const deployerVaultToken = await vault.balanceOf(deployer.address);

    await strategy.addBond(FHM_DAI_BOND);
    await strategy.stakeToBondSingleAll(FHM_DAI_BOND, FHM_DAI_ROUTE);
    expect(await strategy.currentBond()).to.eq(FHM_DAI_BOND);
    expect(await strategy.unstakedRebasing()).to.eq(0);
    expect(await strategy.stakedRebasing()).to.eq(0);
    expect(await strategy.rebaseBonded()).to.eq(await vault.balance());

    const withdrawalFee = await strategy.withdrawalFee();
    const withdrawalFeeDenom = await strategy.WITHDRAWAL_FEE_DIVISOR();

    await timeTravelBlocks(ethers.provider, 5000);
    await stakeManager.rebase();
    await strategy.redeemAndStake();
    await vault.reserve(deployerVaultToken.div(3)); // Reserve 1/3

    let withdrawalAmount = rebaseTokenBalStart.div(3);
    let withdrawalFeeAmount = withdrawalAmount
      .mul(withdrawalFee)
      .div(withdrawalFeeDenom);

    await timeTravelBlocks(ethers.provider, 5000);
    let stakedBefore = await strategy.stakedRebasing();
    await stakeManager.rebase();
    let rebaseRewards = (await strategy.stakedRebasing()).sub(stakedBefore);
    await strategy.redeemAndStake(); // Final redemption

    withdrawalAmount = withdrawalAmount.add(rebaseRewards);

    withdrawalFeeAmount = withdrawalAmount
      .mul(withdrawalFee)
      .div(withdrawalFeeDenom);

    await strategy.stakeToBondSingleAll(FHM_DAI_BOND, FHM_DAI_ROUTE);

    await timeTravelBlocks(ethers.provider, 5000);
    await stakeManager.rebase();
    await strategy.redeemAndStake();
    await vault.reserve(deployerVaultToken.div(3)); // Reserve 1/3

    withdrawalAmount = withdrawalAmount.add(rebaseTokenBalStart.div(3));
    withdrawalFeeAmount = withdrawalFeeAmount.add(
      rebaseTokenBalStart.div(3).mul(withdrawalFee).div(withdrawalFeeDenom)
    );

    await timeTravelBlocks(ethers.provider, 5000);
    stakedBefore = await strategy.stakedRebasing();
    await stakeManager.rebase();
    rebaseRewards = (await strategy.stakedRebasing()).sub(stakedBefore);
    await strategy.redeemAndStake(); // Final redemption

    await vault.claim();

    withdrawalAmount = withdrawalAmount.add(rebaseRewards);

    withdrawalFeeAmount = withdrawalAmount
      .mul(withdrawalFee)
      .div(withdrawalFeeDenom);

    const deployerBalAfter = await fhm.balanceOf(deployer.address);
    expect(deployerBalAfter).to.lte(
      withdrawalAmount.sub(withdrawalFeeAmount) + 1
    );
    expect(deployerBalAfter).to.gte(
      withdrawalAmount.sub(withdrawalFeeAmount) - 1
    );
  }).timeout(TEST_TIMEOUT * 2);
});
