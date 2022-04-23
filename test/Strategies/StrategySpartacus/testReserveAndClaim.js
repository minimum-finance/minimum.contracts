const { expect } = require("chai");
const {
  beforeHook,
  beforeEachHook,
  forceBondPositive,
  minimizeBondPeriod,
  timeTravelBlocks,
} = require("../../../utils/testUtils.ts");
const { addressBook } = require("blockchain-addressbook");
const {
  SPA,
  SPA_STAKER,
  STAKED_SPA,
  SPA_STAKE_MANAGER,
  BOGUS_ADDR_1,
  BOGUS_ADDR_2,
  TEST_TIMEOUT,
  DAI_BOND,
  SPA_DAI_ROUTE,
  SPA_DAI_PAIR,
  SPA_DAI_BOND,
  SPARTACUS_TEST_FLAG,
  WFTM_BOND,
  SPA_DAI_BOND_CALCULATOR,
  SPA_TREASURY,
} = require("../../../constants.js");
const { ethers } = require("hardhat");
const { SPA_WHALES } = require("../../../constants");
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
  spaCap: ethers.utils.parseUnits("6000", 9),
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

describe(SPARTACUS_TEST_FLAG + " Strategy Reserve/Claim", function () {
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
      rebaseToken: spa,
      stakedRebaseToken: stakedSpa,
      unirouter,
      unirouterData,
      whale,
      daiBondDepository,
      wftmBondDepository,
      daiLPBondDepository: spaDaiBondDepository,
      lpBondCalculator,
      daiWftmPair,
      stakeManager,
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
      treasuryAddr: SPA_TREASURY,
      whales: SPA_WHALES,
      fundStaked: false,
      stakingHelperAddr: SPA_STAKER,
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
      stakedRebaseToken: stakedSpa,
      fundStaked: false,
    }));
  });

  this.slow(20000);

  it("Can reserve and instantly receive entire deposit from staking", async function () {
    await vault.depositAll(); // Goes straight to staking

    const spaStaked = await stakedSpa.balanceOf(strategy.address);
    expect(spaStaked).to.equal(rebaseTokenBalStart); // Confirmed the SPA is staked
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
    const deployerBalAfter = await spa.balanceOf(deployer.address);
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

    const spaStaked = await stakedSpa.balanceOf(strategy.address);
    expect(spaStaked).to.equal(rebaseTokenBalStart); // Confirmed the SPA is staked
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
    const deployerBalAfter = await spa.balanceOf(deployer.address);
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

    const spaStaked = await stakedSpa.balanceOf(strategy.address);
    expect(spaStaked).to.equal(rebaseTokenBalStart); // Confirmed the SPA is staked
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
    const deployerBalAfter = await spa.balanceOf(deployer.address);
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

    const spaStaked = await stakedSpa.balanceOf(strategy.address);
    expect(spaStaked).to.equal(rebaseTokenBalStart); // Confirmed the SPA is staked
    // Confirm not bonding currently
    expect(await strategy.isBonding()).to.be.false;
    // Reserves are 0 before
    expect(await strategy.reserves()).to.eq(0);
    expect((await strategy.claimOfReserves(deployer.address)).amount).to.eq(0);

    await spa.connect(whale).transfer(strategy.address, rebaseTokenBalStart);

    const withdrawalFee = await strategy.withdrawalFee();
    const withdrawalFeeDenom = await strategy.WITHDRAWAL_FEE_DIVISOR();
    const withdrawalFeeAmount = (await vault.balance())
      .mul(withdrawalFee)
      .div(withdrawalFeeDenom);

    await vault.reserveAll();
    // When staking reserve should immediately send funds
    const deployerBalAfter = await spa.balanceOf(deployer.address);
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

    const spaStaked = await stakedSpa.balanceOf(strategy.address);
    expect(spaStaked).to.equal(rebaseTokenBalStart); // Confirmed the SPA is staked
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
    const deployerBalAfter = await spa.balanceOf(deployer.address);
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

    const spaStaked = await stakedSpa.balanceOf(strategy.address);
    expect(spaStaked).to.equal(rebaseTokenBalStart); // Confirmed the SPA is staked
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
    const deployerBalAfter = await spa.balanceOf(deployer.address);
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
    await forceBondPositive(ethers.provider, daiBondDepository, strategy);
    await vault.depositAll(); // Goes straight to staking

    expect(await strategy.stakedRebasing()).to.equal(rebaseTokenBalStart); // Confirmed the SPA is staked
    // Confirm not bonding currently
    expect(await strategy.isBonding()).to.be.false;
    // Confirm reserves empty
    expect(await strategy.reserves())
      .to.equal((await strategy.claimOfReserves(deployer.address)).amount)
      .to.equal(0);

    await strategy.addBond(DAI_BOND);
    await strategy.stakeToBondSingleAll(DAI_BOND, SPA_DAI_ROUTE);

    // Confirm bonding currently
    expect(await strategy.isBonding()).to.be.true;

    const vaultBalBefore = await vault.balance();

    await vault.reserveAll();

    const withdrawalFee = await strategy.withdrawalFee();
    const withdrawalFeeDenom = await strategy.WITHDRAWAL_FEE_DIVISOR();
    const withdrawalFeeAmount = vaultBalBefore
      .mul(withdrawalFee)
      .div(withdrawalFeeDenom);

    // Deployer should not be considered fullyVested as we are bonding
    expect(await strategy.isBonding()).to.be.true;
    expect(await strategy.reserveUsers(0)).to.eq(deployer.address);
    expect((await strategy.claimOfReserves(deployer.address)).amount).to.eq(
      rebaseTokenBalStart.sub(withdrawalFeeAmount)
    );
    // Reserves are immediately updated
    expect(await strategy.reserves()).to.eq(
      rebaseTokenBalStart.sub(withdrawalFeeAmount)
    );
    expect(await vault.balance()).to.eq(withdrawalFeeAmount);

    // Ensure deployer balance is 0 before bond is over
    expect(await spa.balanceOf(deployer.address)).to.equal(0);
  }).timeout(TEST_TIMEOUT);

  it("Over one bond withdraw 1/3, 1/3, then receive ~2/3 on final redemption", async function () {
    await minimizeBondPeriod(ethers.provider, daiBondDepository, strategy);
    await forceBondPositive(
      ethers.provider,
      daiBondDepository,
      strategy,
      lpBondCalculator,
      SPA_DAI_PAIR
    );

    await vault.deposit(rebaseTokenBalStart); // takes care of the transfer.
    const deployerVaultToken = await vault.balanceOf(deployer.address);

    await strategy.addBond(DAI_BOND);
    await strategy.stakeToBondSingleAll(DAI_BOND, SPA_DAI_ROUTE);
    expect(await strategy.currentBond()).to.eq(DAI_BOND);
    expect(await strategy.unstakedRebasing()).to.eq(0);
    expect(await strategy.stakedRebasing()).to.eq(0);
    expect(await strategy.rebaseBonded()).to.eq(rebaseTokenBalStart);

    await timeTravelBlocks(ethers.provider, 5000);
    await stakeManager.rebase();

    const withdrawalFee = await strategy.withdrawalFee();
    const withdrawalFeeDenom = await strategy.WITHDRAWAL_FEE_DIVISOR();

    await strategy.redeemAndStake();
    expect(await vault.balance()).to.eq(rebaseTokenBalStart);
    await vault.reserve(deployerVaultToken.div(3)); // Reserve 1/3

    let withdrawalAmount = rebaseTokenBalStart.div(3);
    let withdrawalFeeAmount = withdrawalAmount
      .mul(withdrawalFee)
      .div(withdrawalFeeDenom);
    expect((await strategy.claimOfReserves(deployer.address)).amount).to.eq(
      withdrawalAmount.sub(withdrawalFeeAmount)
    );

    await timeTravelBlocks(ethers.provider, 2000);
    const stakedBefore = await strategy.stakedRebasing();
    await stakeManager.rebase();
    const rebaseRewards = (await strategy.stakedRebasing()).sub(stakedBefore);
    await strategy.redeemAndStake();
    expect((await vault.balance()).add(await strategy.reserves())).to.eq(
      rebaseTokenBalStart.add(rebaseRewards)
    );
    expect(await vault.balance()).to.eq(
      rebaseTokenBalStart
        .sub(withdrawalAmount)
        .add(withdrawalFeeAmount)
        .add(rebaseRewards)
    );
    await vault.reserve(deployerVaultToken.div(3)); // Reserve another 1/3
    withdrawalAmount = withdrawalAmount.add(
      rebaseTokenBalStart
        .sub(withdrawalAmount)
        .add(withdrawalFeeAmount)
        .add(rebaseRewards)
        .div(2)
    );
    withdrawalFeeAmount = withdrawalAmount
      .mul(withdrawalFee)
      .div(withdrawalFeeDenom);

    const claimOfReserves = await strategy.claimOfReserves(deployer.address);

    // Notice error from division
    expect(claimOfReserves.amount).to.lte(
      withdrawalAmount.sub(withdrawalFeeAmount) + 1
    );
    expect(claimOfReserves.amount).to.gte(
      withdrawalAmount.sub(withdrawalFeeAmount) - 1
    );

    await timeTravelBlocks(ethers.provider, 3000);
    await stakeManager.rebase();
    await strategy.redeemAndStake(); // Final redemption
    expect(await strategy.isBonding()).to.be.false;

    await vault.claim();

    const deployerBalAfter = await spa.balanceOf(deployer.address);

    // Notice error from division
    expect(deployerBalAfter).to.lte(
      withdrawalAmount.sub(withdrawalFeeAmount) + 1
    );
    expect(deployerBalAfter).to.gte(
      withdrawalAmount.sub(withdrawalFeeAmount) - 1
    );

    const vaultBalance = await vault.balance();
    expect(await strategy.stakedRebasing()).to.gt(0);
    expect(await strategy.unstakedRebasing()).to.eq(0);
    expect(deployerBalAfter.add(vaultBalance)).to.gt(rebaseTokenBalStart);
  }).timeout(TEST_TIMEOUT * 2);

  it("Over one bond withdraw 1/3, another bond withdraw 1/3, then receive ~2/3 at final redemption", async function () {
    await minimizeBondPeriod(ethers.provider, daiBondDepository, strategy);
    await forceBondPositive(
      ethers.provider,
      daiBondDepository,
      strategy,
      lpBondCalculator,
      SPA_DAI_PAIR
    );
    await vault.deposit(rebaseTokenBalStart); // takes care of the transfer.
    const deployerVaultToken = await vault.balanceOf(deployer.address);

    await strategy.addBond(DAI_BOND);
    await strategy.stakeToBondSingleAll(DAI_BOND, SPA_DAI_ROUTE);
    expect(await strategy.currentBond()).to.eq(DAI_BOND);
    expect(await strategy.unstakedRebasing()).to.eq(0);
    expect(await strategy.stakedRebasing()).to.eq(0);
    expect(await strategy.rebaseBonded()).to.eq(rebaseTokenBalStart);

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

    await strategy.stakeToBondSingleAll(DAI_BOND, SPA_DAI_ROUTE);

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

    const deployerBalAfter = await spa.balanceOf(deployer.address);
    expect(deployerBalAfter).to.lte(
      withdrawalAmount.sub(withdrawalFeeAmount) + 1
    );
    expect(deployerBalAfter).to.gte(
      withdrawalAmount.sub(withdrawalFeeAmount) - 1
    );
  }).timeout(TEST_TIMEOUT * 2);
});
