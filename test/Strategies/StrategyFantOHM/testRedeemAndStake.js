const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  timeTravelBlocks,
  beforeHook,
  beforeEachHook,
  forceHighMaxDebt,
  minimizeBondPeriod,
  forceFHMBondMinimumPositive,
  forceFHMBondNegative,
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
  SLOW_TEST_FLAG,
  FHM_DAI_ROUTE,
  FANTOHM_TEST_FLAG,
  FHM_WFTM_BOND,
  FHM_DAI_LP_BOND,
  FHM_BOND_CALCULATOR,
  FHM_WHALES,
  FHM_TREASURY,
} = require("../../../constants.js");

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

describe(FANTOHM_TEST_FLAG + " Strategy redeemAndStake", function () {
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
    unirouterData;

  this.slow(20000);

  beforeEach(async () => {
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

  it(
    SLOW_TEST_FLAG +
      "Redeems and stakes with a redeem fee (Positive | DAI Bond)",
    async function () {
      const fhmBalStart = await stakedFhm.balanceOf(deployer.address);
      const daiValueInitial = ethers.utils.formatEther(
        await strategy.rebaseTokenPriceInUSD(fhmBalStart)
      );

      await vault.depositAll();

      await strategy.addBond(FHM_DAI_BOND);
      await strategy.stakeToBondSingleAll(FHM_DAI_BOND, FHM_DAI_ROUTE);

      expect(await strategy.isBonding()).to.be.true;

      const feeRate = await strategy.serviceFee();
      const feeDivisor = await strategy.SERVICE_FEE_DIVISOR();

      const bondDetailsInitial = await daiBondDepository.bondInfo(
        strategy.address
      );
      const pricePaid = ethers.utils.formatUnits(
        bondDetailsInitial.pricePaid,
        18
      );
      const payoutInitial = bondDetailsInitial.payout;
      const payoutPerRebasePeriod = payoutInitial.div(15);
      const parsedPayoutInitial = parseFloat(
        ethers.utils.formatUnits(payoutInitial, 9)
      );
      const calculatedPayout = parseFloat(daiValueInitial / pricePaid);

      // Should expect calculated to be a bit more as fee takes away some value
      // when swapping FHM for the bond
      expect(parsedPayoutInitial).to.lte(calculatedPayout);
      expect(parsedPayoutInitial).to.gt(calculatedPayout * 0.99);

      // Expect pending payout to be 0
      expect(
        await daiBondDepository.pendingPayoutFor(strategy.address)
      ).to.equal(0);

      // Now let 1 rebase period go by
      await timeTravelBlocks(
        ethers.provider,
        parseInt(
          ethers.utils.formatUnits(bondDetailsInitial.vesting.div(15), 0)
        )
      );
      // Trigger rebase as to not corroborate our results.
      await stakeManager.rebase();

      const devBalInitial = await stakedFhm.balanceOf(devAddress);

      //Expect there to be no FHM or sFHM in strat before redeem
      expect(await strategy.totalRebasing()).to.equal(0);
      expect(await fhm.balanceOf(strategy.address)).to.equal(0);
      expect(await stakedFhm.balanceOf(strategy.address)).to.equal(0);

      let pendingPayout = await daiBondDepository.pendingPayoutFor(
        strategy.address
      ); // Notice goes one more block when redeeming

      // Expect pending payout to be {payoutPerRebasePeriod}, notice inaccuracy due to division truncation
      expect(pendingPayout).to.lte(payoutPerRebasePeriod);
      expect(pendingPayout).to.gt(payoutPerRebasePeriod.mul(99).div(100));

      const unstaked = await strategy.unstakedRebasing();
      const staked = (await strategy.stakedRebasing()).add(pendingPayout);
      const warmup = 0;
      const bonded = (await strategy.rebaseBonded()).sub(pendingPayout);
      const totalBalance = await vault.balance();

      await expect(strategy.redeemAndStake())
        .to.emit(strategy, "Redeem")
        .withArgs(unstaked, staked, warmup, bonded, totalBalance);

      let stakedFhmBal = await stakedFhm.balanceOf(strategy.address);

      // Expect all redeemed (- fee) to be staked
      expect(await strategy.totalRebasing()).to.equal(pendingPayout);
      expect(await fhm.balanceOf(strategy.address)).to.equal(0);
      expect(stakedFhmBal).to.equal(pendingPayout);
      expect(stakedFhmBal).to.be.gt(0);

      let devBal = (await stakeManager.warmupInfo(devAddress)).deposit;

      let bondDetails = await daiBondDepository.bondInfo(strategy.address);

      expect(bondDetails.payout).to.equal(payoutInitial.sub(pendingPayout));

      // Travel 2 more rebase periods
      await timeTravelBlocks(
        ethers.provider,
        parseInt(
          ethers.utils.formatUnits(bondDetailsInitial.vesting.mul(2).div(15), 0)
        )
      );
      // Trigger rebase as to not corroborate our results.
      await stakeManager.rebase();
      await stakeManager.rebase();

      pendingPayout = await daiBondDepository.pendingPayoutFor(
        strategy.address
      );

      // Expect pending payout to be 2x{payoutPerRebasePeriod}, notice innaccuracy due to division truncation
      expect(pendingPayout).to.lte(payoutPerRebasePeriod.mul(2));
      expect(pendingPayout).to.gt(payoutPerRebasePeriod.mul(198).div(100));

      let stratBalBeforeRedeem = await stakedFhm.balanceOf(strategy.address);

      await strategy.redeemAndStake();

      expect(await strategy.totalRebasing()).to.equal(
        pendingPayout.add(stratBalBeforeRedeem)
      );
      expect(await fhm.balanceOf(strategy.address)).to.equal(0);
      expect(await stakedFhm.balanceOf(strategy.address)).to.equal(
        pendingPayout.add(stratBalBeforeRedeem)
      );
    }
  ).timeout(TEST_TIMEOUT * 2);

  it(SLOW_TEST_FLAG + "Two bonds back to back test", async function () {
    await forceFHMBondMinimumPositive(
      ethers.provider,
      daiBondDepository,
      strategy
    );
    await minimizeBondPeriod(ethers.provider, daiBondDepository);
    const whaleBalInitial = await stakedFhm.balanceOf(whale._address);

    await vault.depositAll();
    await vault.connect(whale).deposit(rebaseTokenBalStart);

    expect(await strategy.isBonding()).to.eq(
      await vault.isBonding()
    ).to.be.false;

    await strategy.addBond(FHM_DAI_BOND);
    await strategy
      .connect(keeper)
      .stakeToBondSingleAll(FHM_DAI_BOND, FHM_DAI_ROUTE);

    expect(await strategy.isBonding()).to.eq(
      await vault.isBonding()
    ).to.be.true;

    let vaultBal = await vault.balance();
    expect(vaultBal).to.gt(rebaseTokenBalStart.mul(2));
    const withdrawalFee = await strategy.withdrawalFee();
    const withdrawalFeeDenom = await strategy.WITHDRAWAL_FEE_DIVISOR();
    let withdrawalFeeAmount = vaultBal
      .div(4)
      .mul(withdrawalFee)
      .div(withdrawalFeeDenom);

    const bonded = await strategy.rebaseBonded();

    expect(bonded).to.eq(vaultBal);

    const vaultBalAfter = vaultBal
      .sub(vaultBal.div(4))
      .add(withdrawalFeeAmount);
    const withdrawAmount = vaultBal.div(4).sub(withdrawalFeeAmount);

    // Whale reserve half
    await expect(
      vault
        .connect(whale)
        .reserve((await vault.balanceOf(whale._address)).div(2))
    )
      .to.emit(strategy, "Reserve")
      .withArgs(vaultBalAfter, withdrawAmount);

    expect((await strategy.claimOfReserves(whale._address)).amount)
      .to.eq(await strategy.reserves())
      .to.eq(withdrawAmount);
    expect(await vault.balance()).to.eq(vaultBalAfter);

    await timeTravelBlocks(ethers.provider, 10000);

    let whaleReservePeriodNumber = (
      await strategy.claimOfReserves(whale._address)
    ).reservePeriod;
    let whaleReservePeriod = await strategy.reservePeriods(
      whaleReservePeriodNumber
    );

    expect(whaleReservePeriodNumber).to.eq(1);
    expect(await strategy.reserves())
      .to.eq(withdrawAmount)
      .to.eq((await strategy.claimOfReserves(whale._address)).amount);
    expect(whaleReservePeriod.fullyVested).to.be.false;
    expect(whaleReservePeriod.warmupExpiry).to.eq(0);
    expect((await strategy.claimOfReserves(whale._address)).index).to.eq(1);

    await strategy.connect(keeper).redeemAndStake();

    whaleReservePeriodNumber = (await strategy.claimOfReserves(whale._address))
      .reservePeriod;
    whaleReservePeriod = await strategy.reservePeriods(
      whaleReservePeriodNumber
    );

    expect(whaleReservePeriodNumber).to.eq(1);
    expect(whaleReservePeriod.fullyVested).to.be.true;
    expect(whaleReservePeriod.warmupExpiry).to.eq(0);

    expect(await strategy.reserves())
      .to.eq(withdrawAmount)
      .to.eq((await strategy.claimOfReserves(whale._address)).amount);
    expect((await strategy.claimOfReserves(whale._address)).index).to.eq(1);

    await vault.connect(whale).claim();

    whaleReservePeriodNumber = (await strategy.claimOfReserves(whale._address))
      .reservePeriod;
    whaleReservePeriod = await strategy.reservePeriods(
      whaleReservePeriodNumber
    );

    expect(whaleReservePeriodNumber).to.eq(0);

    expect(await strategy.reserves())
      .to.eq(0)
      .to.eq((await strategy.claimOfReserves(whale._address)).amount);
    expect(whaleReservePeriod.fullyVested).to.be.false;
    expect(whaleReservePeriod.warmupExpiry).to.eq(0);
    expect((await strategy.claimOfReserves(whale._address)).index).to.eq(0);

    // Whale 1/2 is paid out
    expect(await fhm.balanceOf(whale._address)).to.lte(
      rebaseTokenBalStart.div(2).sub(withdrawalFeeAmount) + 1
    );
    expect(await fhm.balanceOf(whale._address)).to.gte(
      rebaseTokenBalStart.div(2).sub(withdrawalFeeAmount) - 1
    );

    await forceFHMBondMinimumPositive(
      ethers.provider,
      daiBondDepository,
      strategy
    );

    const currentReservePeriodNumber = await strategy.currentReservePeriod();
    const currentReservePeriod = await strategy.reservePeriods(
      currentReservePeriodNumber
    );

    expect(currentReservePeriodNumber).to.eq(1);
    expect(currentReservePeriod.fullyVested).to.be.true;
    expect(currentReservePeriod.warmupExpiry).to.eq(0);

    // Bond again
    await strategy.stakeToBondSingleAll(FHM_DAI_BOND, FHM_DAI_ROUTE);
    vaultBal = await vault.balance();

    // Whale reserves rest
    await vault.connect(whale).reserveAll();

    withdrawalFeeAmount = vaultBal
      .div(3)
      .mul(withdrawalFee)
      .div(withdrawalFeeDenom);

    whaleReservePeriodNumber = (await strategy.claimOfReserves(whale._address))
      .reservePeriod;
    whaleReservePeriod = await strategy.reservePeriods(
      whaleReservePeriodNumber
    );

    expect(whaleReservePeriodNumber).to.eq(2);

    expect(await strategy.reserves())
      .to.eq(vaultBal.div(3).sub(withdrawalFeeAmount))
      .to.eq((await strategy.claimOfReserves(whale._address)).amount);
    expect(whaleReservePeriod.fullyVested).to.be.false;
    expect((await strategy.claimOfReserves(whale._address)).index).to.eq(1);

    await timeTravelBlocks(ethers.provider, 10000);

    whaleReservePeriodNumber = (await strategy.claimOfReserves(whale._address))
      .reservePeriod;
    whaleReservePeriod = await strategy.reservePeriods(
      whaleReservePeriodNumber
    );

    expect(whaleReservePeriodNumber).to.eq(2);
    expect(whaleReservePeriod.fullyVested).to.be.false;
    expect(whaleReservePeriod.warmupExpiry).to.eq(0);

    await strategy.redeemAndStake();

    whaleReservePeriodNumber = (await strategy.claimOfReserves(whale._address))
      .reservePeriod;
    whaleReservePeriod = await strategy.reservePeriods(
      whaleReservePeriodNumber
    );

    expect(whaleReservePeriodNumber).to.eq(2);
    expect(whaleReservePeriod.fullyVested).to.be.true;
    expect(whaleReservePeriod.warmupExpiry).to.eq(0);

    expect(await strategy.reserves())
      .to.eq(vaultBal.div(3).sub(withdrawalFeeAmount))
      .to.eq((await strategy.claimOfReserves(whale._address)).amount);
    expect((await strategy.claimOfReserves(whale._address)).index).to.eq(1);

    await vault.connect(whale).claim();

    whaleReservePeriodNumber = (await strategy.claimOfReserves(whale._address))
      .reservePeriod;
    whaleReservePeriod = await strategy.reservePeriods(
      whaleReservePeriodNumber
    );

    expect(whaleReservePeriodNumber).to.eq(0);
    expect(whaleReservePeriod.fullyVested).to.be.false;
    expect(whaleReservePeriod.warmupExpiry).to.eq(0);

    expect(await strategy.reserves())
      .to.eq(0)
      .to.eq((await strategy.claimOfReserves(whale._address)).amount);
    expect((await strategy.claimOfReserves(whale._address)).index).to.eq(0);

    const withdrawalAmountWhale = rebaseTokenBalStart
      .div(2)
      .add(vaultBal.div(3));
    withdrawalFeeAmount = withdrawalAmountWhale
      .mul(withdrawalFee)
      .div(withdrawalFeeDenom);
    const whaleBal = await fhm.balanceOf(whale._address);

    // whale gets paid
    expect(whaleBal).to.lte(withdrawalAmountWhale.sub(withdrawalFeeAmount) + 1);
    expect(whaleBal).to.gte(withdrawalAmountWhale.sub(withdrawalFeeAmount) - 1);
    expect(whaleBal.add(await stakedFhm.balanceOf(whale._address))).to.gt(
      whaleBalInitial
    );

    const withdrawalAmountDeployer = await vault.balance();
    withdrawalFeeAmount = withdrawalAmountDeployer
      .mul(withdrawalFee)
      .div(withdrawalFeeDenom);

    let deployerReservePeriodNumber = (
      await strategy.claimOfReserves(deployer.address)
    ).reservePeriod;
    let deployerReservePeriod = await strategy.reservePeriods(
      deployerReservePeriodNumber
    );

    expect(deployerReservePeriodNumber).to.eq(0);
    expect(deployerReservePeriod.fullyVested).to.be.false;
    expect(deployerReservePeriod.warmupExpiry).to.eq(0);

    expect(await strategy.reserves())
      .to.eq(0)
      .to.eq((await strategy.claimOfReserves(deployer.address)).amount);
    expect((await strategy.claimOfReserves(deployer.address)).index).to.eq(0);

    await expect(vault.connect(whale).claim()).to.be.revertedWith(
      "!fullyVested"
    );
    await expect(vault.claim()).to.be.revertedWith("!fullyVested");

    await vault.reserveAll(); // Notice that reserves payout immediately when not bonding
    await expect(vault.reserveAll()).to.be.revertedWith("!shares > 0");

    deployerReservePeriodNumber = (
      await strategy.claimOfReserves(deployer.address)
    ).reservePeriod;
    deployerReservePeriod = await strategy.reservePeriods(
      deployerReservePeriodNumber
    );

    expect(deployerReservePeriodNumber).to.eq(0);
    expect(deployerReservePeriod.fullyVested).to.be.false;
    expect(deployerReservePeriod.warmupExpiry).to.eq(0);

    expect(await strategy.reserves())
      .to.eq(0)
      .to.eq((await strategy.claimOfReserves(deployer.address)).amount);
    expect((await strategy.claimOfReserves(deployer.address)).index).to.eq(0);

    const deployerBal = await fhm.balanceOf(deployer.address);

    // deployer gets paid
    expect(deployerBal).to.eq(
      withdrawalAmountDeployer.sub(withdrawalFeeAmount)
    );
    expect(deployerBal).to.gt(rebaseTokenBalStart);

    expect(await vault.balance())
      .to.eq(await strategy.stakedRebasing())
      .to.eq(withdrawalFeeAmount);
  }).timeout(TEST_TIMEOUT);

  it(
    SLOW_TEST_FLAG + "Two bonds back to back test, user doesn't claim",
    async function () {
      await forceFHMBondMinimumPositive(
        ethers.provider,
        daiBondDepository,
        strategy
      );
      await minimizeBondPeriod(ethers.provider, daiBondDepository);
      const whaleBalInitial = await fhm.balanceOf(whale._address);

      await vault.depositAll();
      await vault.connect(whale).deposit(rebaseTokenBalStart);

      expect(await strategy.isBonding()).to.eq(await vault.isBonding()).to.be
        .false;

      await strategy.addBond(FHM_DAI_BOND);
      await strategy
        .connect(keeper)
        .stakeToBondSingleAll(FHM_DAI_BOND, FHM_DAI_ROUTE);

      expect(await strategy.isBonding()).to.eq(await vault.isBonding()).to.be
        .true;

      let vaultBal = await vault.balance();
      const vaultBalStart = await vault.balance();
      expect(await vault.balance()).to.gt(rebaseTokenBalStart.mul(2));
      const withdrawalFee = await strategy.withdrawalFee();
      const withdrawalFeeDenom = await strategy.WITHDRAWAL_FEE_DIVISOR();
      let whaleWithdrawalFeeAmount = vaultBal
        .div(4)
        .mul(withdrawalFee)
        .div(withdrawalFeeDenom);

      const withdrawAmount = vaultBal.div(4).sub(whaleWithdrawalFeeAmount);
      const vaultBalLeft = vaultBal
        .sub(vaultBal.div(4))
        .add(whaleWithdrawalFeeAmount);

      // Whale reserve half
      await vault
        .connect(whale)
        .reserve((await vault.balanceOf(whale._address)).div(2));

      const whaleFirstClaim = await strategy.claimOfReserves(whale._address);

      expect(whaleFirstClaim.amount)
        .to.eq(await strategy.reserves())
        .to.eq(withdrawAmount);
      expect(await vault.balance()).to.eq(vaultBalLeft);

      vaultBal = await vault.balance();

      // Deployer reserve half
      await vault.reserve((await vault.balanceOf(deployer.address)).div(2));

      const deployerFirstClaim = await strategy.claimOfReserves(
        deployer.address
      );

      let deployerWithdrawAmount = vaultBal.mul(1).div(3);
      let deployerWithdrawalFeeAmount = deployerWithdrawAmount
        .mul(withdrawalFee)
        .div(withdrawalFeeDenom);

      expect(deployerFirstClaim.amount.add(whaleFirstClaim.amount)).to.eq(
        await strategy.reserves()
      );
      expect(deployerFirstClaim.amount).to.eq(
        deployerWithdrawAmount.sub(deployerWithdrawalFeeAmount)
      );
      expect(await vault.balance()).to.eq(
        vaultBal.sub(vaultBal.div(3)).add(deployerWithdrawalFeeAmount)
      );

      await timeTravelBlocks(ethers.provider, 10000);

      await strategy.connect(keeper).redeemAndStake();

      let whaleReservePeriodNumber = (
        await strategy.claimOfReserves(whale._address)
      ).reservePeriod;
      let whaleReservePeriod = await strategy.reservePeriods(
        whaleReservePeriodNumber
      );

      expect(whaleReservePeriodNumber).to.eq(1);
      expect(whaleReservePeriod.fullyVested).to.be.true;
      expect(whaleReservePeriod.warmupExpiry).to.eq(0);

      expect(await strategy.reserves())
        .to.eq(
          withdrawAmount.add(
            deployerWithdrawAmount.sub(deployerWithdrawalFeeAmount)
          )
        )
        .to.eq(
          (await strategy.claimOfReserves(whale._address)).amount.add(
            (await strategy.claimOfReserves(deployer.address)).amount
          )
        );
      expect((await strategy.claimOfReserves(whale._address)).index).to.eq(1);
      expect((await strategy.claimOfReserves(deployer.address)).index).to.eq(2);

      vaultBal = await vault.balance();
      expect(vaultBal).to.eq(
        vaultBalStart
          .sub(withdrawAmount)
          .sub(deployerWithdrawAmount.sub(deployerWithdrawalFeeAmount))
      );

      // Deployer reserves instead of claiming, get's unreserved position, reserved position maintains
      await vault.reserveAll();

      const firstReserveBal = await fhm.balanceOf(deployer.address);

      expect(firstReserveBal)
        .to.eq(
          vaultBal
            .div(2)
            .sub(vaultBal.mul(withdrawalFee).div(2).div(withdrawalFeeDenom))
        )
        .to.gt(rebaseTokenBalStart.div(2));
      expect((await strategy.claimOfReserves(deployer.address)).amount).to.eq(
        deployerWithdrawAmount.sub(deployerWithdrawalFeeAmount)
      );

      await forceFHMBondMinimumPositive(
        ethers.provider,
        daiBondDepository,
        strategy
      );

      // Bond again
      await strategy.stakeToBondSingleAll(FHM_DAI_BOND, FHM_DAI_ROUTE);

      whaleReservePeriodNumber = (
        await strategy.claimOfReserves(whale._address)
      ).reservePeriod;
      whaleReservePeriod = await strategy.reservePeriods(
        whaleReservePeriodNumber
      );

      expect(whaleReservePeriodNumber).to.eq(1);
      expect(whaleReservePeriod.fullyVested).to.be.true;
      expect(whaleReservePeriod.warmupExpiry).to.eq(0);

      vaultBal = await vault.balance();

      // Whale reserves rest
      await vault.connect(whale).reserveAll();

      whaleWithdrawalFeeAmount = vaultBal
        .mul(withdrawalFee)
        .div(withdrawalFeeDenom);

      const whaleSecondClaim = await strategy.claimOfReserves(whale._address);

      expect(whaleSecondClaim.amount).to.eq(
        whaleFirstClaim.amount.add(vaultBal.sub(whaleWithdrawalFeeAmount))
      );
      expect((await strategy.claimOfReserves(whale._address)).index).to.eq(1);

      expect(await strategy.reserves()).to.eq(
        whaleSecondClaim.amount.add(deployerFirstClaim.amount)
      );

      await timeTravelBlocks(ethers.provider, 10000);

      await strategy.redeemAndStake();

      const whaleClaimAfter = await strategy.claimOfReserves(whale._address);
      const deployerClaimAfter = await strategy.claimOfReserves(
        deployer.address
      );

      whaleReservePeriodNumber = (
        await strategy.claimOfReserves(whale._address)
      ).reservePeriod;
      whaleReservePeriod = await strategy.reservePeriods(
        whaleReservePeriodNumber
      );

      expect(whaleReservePeriodNumber).to.eq(2);
      expect(whaleReservePeriod.fullyVested).to.be.true;
      expect(whaleReservePeriod.warmupExpiry).to.eq(0);

      let deployerReservePeriodNumber = (
        await strategy.claimOfReserves(deployer.address)
      ).reservePeriod;
      let deployerReservePeriod = await strategy.reservePeriods(
        deployerReservePeriodNumber
      );

      expect(deployerReservePeriodNumber).to.eq(1);
      expect(deployerReservePeriod.fullyVested).to.be.true;
      expect(deployerReservePeriod.warmupExpiry).to.eq(0);

      expect(whaleClaimAfter.amount).to.eq(
        whaleFirstClaim.amount.add(vaultBal.sub(whaleWithdrawalFeeAmount))
      );
      expect(whaleClaimAfter.index).to.eq(1);
      expect(deployerClaimAfter.amount).to.eq(deployerFirstClaim.amount);
      expect(deployerClaimAfter.index).to.eq(2);

      expect(await strategy.reserves()).to.eq(
        whaleSecondClaim.amount.add(deployerFirstClaim.amount)
      );

      await vault.connect(whale).claim();

      const finalWhaleClaim = await strategy.claimOfReserves(whale._address);

      const whaleBal = await fhm.balanceOf(whale._address);

      whaleReservePeriodNumber = (
        await strategy.claimOfReserves(whale._address)
      ).reservePeriod;
      whaleReservePeriod = await strategy.reservePeriods(
        whaleReservePeriodNumber
      );

      expect(whaleReservePeriodNumber).to.eq(0);
      expect(whaleReservePeriod.fullyVested).to.be.false;
      expect(whaleReservePeriod.warmupExpiry).to.eq(0);

      expect(await strategy.reserves()).to.eq(deployerFirstClaim.amount);
      expect(finalWhaleClaim.amount).eq(0);
      expect(finalWhaleClaim.index).to.eq(0);
      expect(whaleBal).to.eq(whaleSecondClaim.amount);

      expect(whaleBal).to.gt(whaleBalInitial);

      await vault.claim();

      deployerReservePeriodNumber = (
        await strategy.claimOfReserves(deployer.address)
      ).reservePeriod;
      deployerReservePeriod = await strategy.reservePeriods(
        deployerReservePeriodNumber
      );

      expect(deployerReservePeriodNumber).to.eq(0);
      expect(deployerReservePeriod.fullyVested).to.be.false;
      expect(deployerReservePeriod.warmupExpiry).to.eq(0);

      expect(await strategy.reserves())
        .to.eq(0)
        .to.eq((await strategy.claimOfReserves(deployer.address)).amount);
      expect((await strategy.claimOfReserves(deployer.address)).index).to.eq(0);

      await expect(vault.connect(whale).claim()).to.be.revertedWith(
        "!fullyVested"
      );
      await expect(vault.claim()).to.be.revertedWith("!fullyVested");
      await expect(vault.reserveAll()).to.be.revertedWith("!shares > 0");

      const deployerBal = await fhm.balanceOf(deployer.address);

      // deployer gets paid
      expect(deployerBal).to.eq(firstReserveBal.add(deployerFirstClaim.amount));
      expect(deployerBal).to.gt(rebaseTokenBalStart);

      // Vault still has withdrawal fees
      expect(await vault.balance())
        .to.eq(await strategy.stakedRebasing())
        .to.gt(0);
    }
  ).timeout(TEST_TIMEOUT);

  it.skip(
    SLOW_TEST_FLAG +
      "Redeems and stakes with a redeem fee (Negative | DAI Bond)",
    async function () {
      await forceFHMBondNegative(ethers.provider, daiBondDepository, strategy);
      const fhmBalStart = await stakedFhm.balanceOf(deployer.address);
      const daiValueInitial = ethers.utils.formatEther(
        await strategy.rebaseTokenPriceInUSD(fhmBalStart)
      );

      await vault.depositAll();

      await strategy.addBond(FHM_DAI_BOND);
      await strategy.stakeToBondSingleAll(FHM_DAI_BOND, FHM_DAI_ROUTE);

      expect(await strategy.isBonding()).to.be.true;

      const bondDetailsInitial = await daiBondDepository.bondInfo(
        strategy.address
      );
      const pricePaid = ethers.utils.formatUnits(
        bondDetailsInitial.pricePaid,
        18
      );
      const payoutInitial = bondDetailsInitial.payout;
      const payoutPerRebasePeriod = payoutInitial.div(15);
      const parsedPayoutInitial = parseFloat(
        ethers.utils.formatUnits(payoutInitial, 9)
      );
      const calculatedPayout = parseFloat(daiValueInitial / pricePaid);

      // Should expect calculated to be a bit more as fee takes away some value
      // when swapping FHM for the bond
      expect(parsedPayoutInitial).to.lte(calculatedPayout);
      expect(parsedPayoutInitial).to.gt(calculatedPayout * 0.99);

      // Expect pending payout to be 0
      expect(
        await daiBondDepository.pendingPayoutFor(strategy.address)
      ).to.equal(0);

      // Now let 1 rebase period go by
      await timeTravelBlocks(
        ethers.provider,
        parseInt(
          ethers.utils.formatUnits(bondDetailsInitial.vesting.div(15), 0)
        )
      );
      // Trigger rebase as to not corroborate our results.
      await stakeManager.rebase();

      //Expect there to be no FHM or sFHM in strat before redeem
      expect(await strategy.totalRebasing()).to.equal(0);
      expect(await fhm.balanceOf(strategy.address)).to.equal(0);
      expect(await stakedFhm.balanceOf(strategy.address)).to.equal(0);
      expect(await strategy.warmupBalance()).to.eq(0);

      let pendingPayout = await daiBondDepository.pendingPayoutFor(
        strategy.address
      );

      // Expect pending payout to be {payoutPerRebasePeriod}, notice inaccuracy due to division truncation
      expect(pendingPayout).to.lte(payoutPerRebasePeriod);
      expect(pendingPayout).to.gt(payoutPerRebasePeriod.mul(99).div(100));

      await strategy.redeemAndStake();

      let stakedFhmBal = await stakedFhm.balanceOf(strategy.address);

      // Expect all redeemed (- fee) to be staked
      expect(await strategy.totalRebasing()).to.equal(pendingPayout);
      expect(await fhm.balanceOf(strategy.address)).to.equal(0);
      expect(stakedFhmBal).to.equal(pendingPayout);
      expect(stakedFhmBal).to.be.gt(0);

      let bondDetails = await daiBondDepository.bondInfo(strategy.address);

      expect(bondDetails.payout).to.equal(payoutInitial.sub(pendingPayout));

      // Travel 2 more rebase periods
      await timeTravelBlocks(
        ethers.provider,
        parseInt(
          ethers.utils.formatUnits(bondDetailsInitial.vesting.mul(2).div(15), 0)
        )
      );
      // Trigger rebase as to not corroborate our results.
      await stakeManager.rebase();
      await stakeManager.rebase();

      pendingPayout = await daiBondDepository.pendingPayoutFor(
        strategy.address
      );

      // Expect pending payout to be 2x{payoutPerRebasePeriod}, notice innaccuracy due to division truncation
      expect(pendingPayout).to.lte(payoutPerRebasePeriod.mul(2));
      expect(pendingPayout).to.gt(payoutPerRebasePeriod.mul(198).div(100));

      let stratBalBeforeRedeem = await stakedFhm.balanceOf(strategy.address);

      await strategy.redeemAndStake();

      expect(await strategy.totalRebasing()).to.equal(
        pendingPayout.add(stratBalBeforeRedeem)
      );
      expect(await fhm.balanceOf(strategy.address)).to.equal(0);
      expect(await stakedFhm.balanceOf(strategy.address)).to.equal(
        pendingPayout.add(stratBalBeforeRedeem)
      );
    }
  ).timeout(TEST_TIMEOUT * 2);

  it("Can change redeem fees", async function () {
    let newFee = 100;
    await strategy.setServiceFee(newFee);
    expect(await strategy.serviceFee()).to.equal(newFee);

    await expect(
      strategy.connect(whale).setServiceFee(newFee)
    ).to.be.revertedWith("!manager");

    newFee = 10;
    await strategy.setServiceFee(newFee);
    expect(await strategy.serviceFee()).to.equal(newFee);

    newFee = 0;
    await strategy.setServiceFee(newFee);
    expect(await strategy.serviceFee()).to.equal(newFee);

    newFee = 350;
    await expect(strategy.setServiceFee(newFee)).to.be.revertedWith("!cap");
  }).timeout(TEST_TIMEOUT);
});
