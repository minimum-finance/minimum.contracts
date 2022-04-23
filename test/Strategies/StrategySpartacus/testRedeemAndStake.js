const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  timeTravelBlocks,
  beforeHook,
  beforeEachHook,
  forceBondPositive,
  forceBondNegative,
  minimizeBondPeriod,
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
  SLOW_TEST_FLAG,
  SPA_DAI_ROUTE,
  SPARTACUS_TEST_FLAG,
  WFTM_BOND,
  SPA_DAI_BOND_CALCULATOR,
  SPA_WHALES,
  SPA_TREASURY,
  SPA_DAI_BOND,
} = require("../../../constants.js");

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

describe(SPARTACUS_TEST_FLAG + " Strategy redeemAndStake", function () {
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
    stakingHelper,
    daiWftmPair,
    rebaseTokenBalStart,
    daiValueInitial,
    unirouterData;

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
      daiLPBondDepository: spaDaiBondDepository,
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
      whales: SPA_WHALES,
      treasuryAddr: SPA_TREASURY,
      fundStaked: false,
      stakingHelperAddr: SPA_STAKER,
    }));
  });

  this.slow(20000);

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

  it(
    SLOW_TEST_FLAG +
      "Redeems and stakes with a redeem fee (Positive | DAI Bond)",
    async function () {
      await forceBondPositive(ethers.provider, daiBondDepository, strategy);
      const spaBalStart = await spa.balanceOf(deployer.address);
      const daiValueInitial = ethers.utils.formatEther(
        await strategy.rebaseTokenPriceInUSD(spaBalStart)
      );

      await vault.depositAll();

      await strategy.addBond(DAI_BOND);
      await strategy.stakeToBondSingleAll(DAI_BOND, SPA_DAI_ROUTE);

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
      // when swapping SPA for the bond
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

      const devBalInitial = await stakedSpa.balanceOf(devAddress);

      //Expect there to be no SPA or sSPA in strat before redeem
      expect(await strategy.totalRebasing()).to.equal(0);
      expect(await spa.balanceOf(strategy.address)).to.equal(0);
      expect(await stakedSpa.balanceOf(strategy.address)).to.equal(0);

      let pendingPayout = await daiBondDepository.pendingPayoutFor(
        strategy.address
      ); // Notice goes one more block when redeeming

      // Expect pending payout to be {payoutPerRebasePeriod}, notice inaccuracy due to division truncation
      expect(pendingPayout).to.lte(payoutPerRebasePeriod);
      expect(pendingPayout).to.gt(payoutPerRebasePeriod.mul(99).div(100));

      const redeemFee = await strategy.serviceFee();
      const redeemFeeDenom = await strategy.SERVICE_FEE_DIVISOR();
      const redeemFeeAmount = pendingPayout.mul(redeemFee).div(redeemFeeDenom);

      await expect(strategy.redeemAndStake())
        .to.emit(strategy, "Redeem")
        .withArgs(rebaseTokenBalStart, pendingPayout.sub(redeemFeeAmount));

      let devFees = pendingPayout.mul(feeRate).div(feeDivisor);
      let payoutReceived = pendingPayout.sub(devFees);

      let stakedSpaBal = await stakedSpa.balanceOf(strategy.address);

      // Expect all redeemed (- fee) to be staked
      expect(await strategy.totalRebasing()).to.equal(payoutReceived);
      expect(await spa.balanceOf(strategy.address)).to.equal(0);
      expect(stakedSpaBal).to.equal(payoutReceived);
      expect(stakedSpaBal).to.be.gt(0);

      let devBal = await stakedSpa.balanceOf(devAddress);

      // Expect dev address to receive fees
      expect(devBal.sub(devBalInitial)).to.equal(devFees);

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

      devBal = await stakedSpa.balanceOf(devAddress);

      let stratBalBeforeRedeem = await stakedSpa.balanceOf(strategy.address);

      await strategy.redeemAndStake();

      devFees = pendingPayout.mul(feeRate).div(feeDivisor);
      let devBalAfter = await stakedSpa.balanceOf(devAddress);
      let devFeesCollected = devBalAfter.sub(devBal);

      expect(devFees).to.equal(devFeesCollected);
      payoutReceived = pendingPayout.sub(devFees);

      expect(await strategy.totalRebasing()).to.equal(
        payoutReceived.add(stratBalBeforeRedeem)
      );
      expect(await spa.balanceOf(strategy.address)).to.equal(0);
      expect(await stakedSpa.balanceOf(strategy.address)).to.equal(
        payoutReceived.add(stratBalBeforeRedeem)
      );
    }
  ).timeout(TEST_TIMEOUT * 2);

  it(SLOW_TEST_FLAG + "Two bonds back to back test", async function () {
    await forceBondPositive(ethers.provider, daiBondDepository, strategy);
    await minimizeBondPeriod(ethers.provider, daiBondDepository);
    const whaleBalInitial = await spa.balanceOf(whale._address);

    await vault.depositAll();
    await vault.connect(whale).deposit(rebaseTokenBalStart);

    expect(await strategy.isBonding()).to.eq(
      await vault.isBonding()
    ).to.be.false;

    await strategy.addBond(DAI_BOND);
    await strategy
      .connect(keeper)
      .stakeToBondSingleAll(DAI_BOND, SPA_DAI_ROUTE);

    expect(await strategy.isBonding()).to.eq(
      await vault.isBonding()
    ).to.be.true;

    expect(await vault.balance()).to.eq(rebaseTokenBalStart.mul(2));
    const withdrawalFee = await strategy.withdrawalFee();
    const withdrawalFeeDenom = await strategy.WITHDRAWAL_FEE_DIVISOR();
    let withdrawalFeeAmount = rebaseTokenBalStart
      .div(2)
      .mul(withdrawalFee)
      .div(withdrawalFeeDenom);

    // Whale reserve half
    await vault
      .connect(whale)
      .reserve((await vault.balanceOf(whale._address)).div(2));

    expect((await strategy.claimOfReserves(whale._address)).amount)
      .to.eq(await strategy.reserves())
      .to.eq(rebaseTokenBalStart.div(2).sub(withdrawalFeeAmount));
    expect(await vault.balance()).to.eq(
      rebaseTokenBalStart
        .mul(2)
        .sub(rebaseTokenBalStart.div(2))
        .add(withdrawalFeeAmount)
    );

    await timeTravelBlocks(ethers.provider, 10000);

    expect(await strategy.reserves())
      .to.eq(rebaseTokenBalStart.div(2).sub(withdrawalFeeAmount))
      .to.eq((await strategy.claimOfReserves(whale._address)).amount);
    expect(
      (await strategy.claimOfReserves(whale._address)).fullyVested
    ).to.be.false;
    expect((await strategy.claimOfReserves(whale._address)).index).to.eq(1);

    await strategy.connect(keeper).redeemAndStake();

    expect(await strategy.reserves())
      .to.eq(rebaseTokenBalStart.div(2).sub(withdrawalFeeAmount))
      .to.eq((await strategy.claimOfReserves(whale._address)).amount);
    expect(
      (await strategy.claimOfReserves(whale._address)).fullyVested
    ).to.be.true;
    expect((await strategy.claimOfReserves(whale._address)).index).to.eq(1);

    await vault.connect(whale).claim();

    expect(await strategy.reserves())
      .to.eq(0)
      .to.eq((await strategy.claimOfReserves(whale._address)).amount);
    expect(
      (await strategy.claimOfReserves(whale._address)).fullyVested
    ).to.be.false;
    expect((await strategy.claimOfReserves(whale._address)).index).to.eq(0);

    // Whale 1/2 is paid out
    expect(await spa.balanceOf(whale._address)).to.lte(
      whaleBalInitial.sub(rebaseTokenBalStart.div(2)).sub(withdrawalFeeAmount) +
        1
    );
    expect(await spa.balanceOf(whale._address)).to.gte(
      whaleBalInitial.sub(rebaseTokenBalStart.div(2)).sub(withdrawalFeeAmount) -
        1
    );

    // Bond again
    await strategy.stakeToBondSingleAll(DAI_BOND, SPA_DAI_ROUTE);

    const vaultBal = await vault.balance();

    // Whale reserves rest
    await vault.connect(whale).reserveAll();

    withdrawalFeeAmount = vaultBal
      .div(3)
      .mul(withdrawalFee)
      .div(withdrawalFeeDenom);

    expect(await strategy.reserves())
      .to.eq(vaultBal.div(3).sub(withdrawalFeeAmount))
      .to.eq((await strategy.claimOfReserves(whale._address)).amount);
    expect(
      (await strategy.claimOfReserves(whale._address)).fullyVested
    ).to.be.false;
    expect((await strategy.claimOfReserves(whale._address)).index).to.eq(1);

    await timeTravelBlocks(ethers.provider, 10000);

    await strategy.redeemAndStake();

    expect(await strategy.reserves())
      .to.eq(vaultBal.div(3).sub(withdrawalFeeAmount))
      .to.eq((await strategy.claimOfReserves(whale._address)).amount);
    expect(
      (await strategy.claimOfReserves(whale._address)).fullyVested
    ).to.be.true;
    expect((await strategy.claimOfReserves(whale._address)).index).to.eq(1);

    await vault.connect(whale).claim();

    expect(await strategy.reserves())
      .to.eq(0)
      .to.eq((await strategy.claimOfReserves(whale._address)).amount);
    expect(
      (await strategy.claimOfReserves(whale._address)).fullyVested
    ).to.be.false;
    expect((await strategy.claimOfReserves(whale._address)).index).to.eq(0);

    const withdrawalAmountWhale = rebaseTokenBalStart
      .div(2)
      .add(vaultBal.div(3));
    withdrawalFeeAmount = withdrawalAmountWhale
      .mul(withdrawalFee)
      .div(withdrawalFeeDenom);
    const whaleBal = await spa.balanceOf(whale._address);

    // whale gets paid
    expect(whaleBal.sub(whaleBalInitial.sub(rebaseTokenBalStart))).to.lte(
      withdrawalAmountWhale.sub(withdrawalFeeAmount) + 1
    );
    expect(whaleBal.sub(whaleBalInitial.sub(rebaseTokenBalStart))).to.gte(
      withdrawalAmountWhale.sub(withdrawalFeeAmount) - 1
    );
    expect(whaleBal).to.gt(whaleBalInitial);

    const withdrawalAmountDeployer = await vault.balance();
    withdrawalFeeAmount = withdrawalAmountDeployer
      .mul(withdrawalFee)
      .div(withdrawalFeeDenom);

    expect(await strategy.reserves())
      .to.eq(0)
      .to.eq((await strategy.claimOfReserves(deployer.address)).amount);
    expect(
      (await strategy.claimOfReserves(deployer.address)).fullyVested
    ).to.be.false;
    expect((await strategy.claimOfReserves(deployer.address)).index).to.eq(0);

    await expect(vault.connect(whale).claim()).to.be.revertedWith(
      "!fullyVested"
    );
    await expect(vault.claim()).to.be.revertedWith("!fullyVested");

    await vault.reserveAll(); // Notice that reserves payout immediately when not bonding
    await expect(vault.reserveAll()).to.be.revertedWith("!shares > 0");

    expect(await strategy.reserves())
      .to.eq(0)
      .to.eq((await strategy.claimOfReserves(deployer.address)).amount);
    expect(
      (await strategy.claimOfReserves(deployer.address)).fullyVested
    ).to.be.false;
    expect((await strategy.claimOfReserves(deployer.address)).index).to.eq(0);

    const deployerBal = await spa.balanceOf(deployer.address);

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
      await forceBondPositive(ethers.provider, daiBondDepository, strategy);
      await minimizeBondPeriod(ethers.provider, daiBondDepository);
      const whaleBalInitial = await spa.balanceOf(whale._address);

      await vault.depositAll();
      await vault.connect(whale).deposit(rebaseTokenBalStart);

      expect(await strategy.isBonding()).to.eq(await vault.isBonding()).to.be
        .false;

      await strategy.addBond(DAI_BOND);
      await strategy
        .connect(keeper)
        .stakeToBondSingleAll(DAI_BOND, SPA_DAI_ROUTE);

      expect(await strategy.isBonding()).to.eq(await vault.isBonding()).to.be
        .true;

      expect(await vault.balance()).to.eq(rebaseTokenBalStart.mul(2));
      const withdrawalFee = await strategy.withdrawalFee();
      const withdrawalFeeDenom = await strategy.WITHDRAWAL_FEE_DIVISOR();
      let whaleWithdrawalFeeAmount = rebaseTokenBalStart
        .div(2)
        .mul(withdrawalFee)
        .div(withdrawalFeeDenom);

      // Whale reserve half
      await vault
        .connect(whale)
        .reserve((await vault.balanceOf(whale._address)).div(2));

      const whaleFirstClaim = await strategy.claimOfReserves(whale._address);

      expect(whaleFirstClaim.amount)
        .to.eq(await strategy.reserves())
        .to.eq(rebaseTokenBalStart.div(2).sub(whaleWithdrawalFeeAmount));
      expect(await vault.balance()).to.eq(
        rebaseTokenBalStart
          .mul(2)
          .sub(rebaseTokenBalStart.div(2))
          .add(whaleWithdrawalFeeAmount)
      );

      let vaultBal = await vault.balance();

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
        rebaseTokenBalStart
          .mul(2)
          .sub(rebaseTokenBalStart.div(2))
          .sub(deployerWithdrawAmount)
          .add(deployerWithdrawalFeeAmount)
          .add(whaleWithdrawalFeeAmount)
      );

      await timeTravelBlocks(ethers.provider, 10000);

      await strategy.connect(keeper).redeemAndStake();

      expect(await strategy.reserves())
        .to.eq(
          rebaseTokenBalStart
            .div(2)
            .add(deployerWithdrawAmount)
            .sub(deployerWithdrawalFeeAmount)
            .sub(whaleWithdrawalFeeAmount)
        )
        .to.eq(
          (await strategy.claimOfReserves(whale._address)).amount.add(
            (await strategy.claimOfReserves(deployer.address)).amount
          )
        );
      expect((await strategy.claimOfReserves(whale._address)).fullyVested).to.be
        .true;
      expect((await strategy.claimOfReserves(whale._address)).index).to.eq(1);
      expect((await strategy.claimOfReserves(deployer.address)).fullyVested).to
        .be.true;
      expect((await strategy.claimOfReserves(deployer.address)).index).to.eq(2);

      vaultBal = await vault.balance();

      // Deployer reserves instead of claiming, get's unreserved position, reserved position maintains
      await vault.reserveAll();

      const firstReserveBal = await spa.balanceOf(deployer.address);

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

      // Bond again
      await strategy.stakeToBondSingleAll(DAI_BOND, SPA_DAI_ROUTE);

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
      expect((await strategy.claimOfReserves(whale._address)).fullyVested).to.be
        .false;
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

      expect(whaleClaimAfter.amount).to.eq(
        whaleFirstClaim.amount.add(vaultBal.sub(whaleWithdrawalFeeAmount))
      );
      expect(whaleClaimAfter.fullyVested).to.be.true;
      expect(whaleClaimAfter.index).to.eq(1);
      expect(deployerClaimAfter.amount).to.eq(deployerFirstClaim.amount);
      expect(deployerClaimAfter.fullyVested).to.be.true;
      expect(deployerClaimAfter.index).to.eq(2);

      expect(await strategy.reserves()).to.eq(
        whaleSecondClaim.amount.add(deployerFirstClaim.amount)
      );

      await vault.connect(whale).claim();

      const finalWhaleClaim = await strategy.claimOfReserves(whale._address);

      const whaleBal = await spa.balanceOf(whale._address);

      expect(await strategy.reserves()).to.eq(deployerFirstClaim.amount);
      expect(finalWhaleClaim.amount).eq(0);
      expect(finalWhaleClaim.fullyVested).to.be.false;
      expect(finalWhaleClaim.index).to.eq(0);
      expect(whaleBal.sub(whaleBalInitial).add(rebaseTokenBalStart)).to.eq(
        whaleSecondClaim.amount
      );

      expect(whaleBal).to.gt(whaleBalInitial);

      await vault.claim();

      expect(await strategy.reserves())
        .to.eq(0)
        .to.eq((await strategy.claimOfReserves(deployer.address)).amount);
      expect((await strategy.claimOfReserves(deployer.address)).fullyVested).to
        .be.false;
      expect((await strategy.claimOfReserves(deployer.address)).index).to.eq(0);

      await expect(vault.connect(whale).claim()).to.be.revertedWith(
        "!fullyVested"
      );
      await expect(vault.claim()).to.be.revertedWith("!fullyVested");
      await expect(vault.reserveAll()).to.be.revertedWith("!shares > 0");

      const deployerBal = await spa.balanceOf(deployer.address);

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
      await forceBondNegative(ethers.provider, daiBondDepository, strategy);
      const spaBalStart = await spa.balanceOf(deployer.address);
      const daiValueInitial = ethers.utils.formatEther(
        await strategy.rebaseTokenPriceInUSD(spaBalStart)
      );

      await vault.depositAll();

      await strategy.addBond(DAI_BOND);
      await strategy.stakeToBondSingleAll(DAI_BOND, SPA_DAI_ROUTE);

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
      // when swapping SPA for the bond
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

      const devBalInitial = await stakedSpa.balanceOf(devAddress);

      //Expect there to be no SPA or sSPA in strat before redeem
      expect(await strategy.totalRebasing()).to.equal(0);
      expect(await spa.balanceOf(strategy.address)).to.equal(0);
      expect(await stakedSpa.balanceOf(strategy.address)).to.equal(0);

      let pendingPayout = await daiBondDepository.pendingPayoutFor(
        strategy.address
      );

      // Expect pending payout to be {payoutPerRebasePeriod}, notice inaccuracy due to division truncation
      expect(pendingPayout).to.lte(payoutPerRebasePeriod);
      expect(pendingPayout).to.gt(payoutPerRebasePeriod.mul(99).div(100));

      await strategy.redeemAndStake();

      let devFees = pendingPayout.mul(feeRate).div(feeDivisor);
      let payoutReceived = pendingPayout.sub(devFees);

      let stakedSpaBal = await stakedSpa.balanceOf(strategy.address);

      // Expect all redeemed (- fee) to be staked
      expect(await strategy.totalRebasing()).to.equal(payoutReceived);
      expect(await spa.balanceOf(strategy.address)).to.equal(0);
      expect(stakedSpaBal).to.equal(payoutReceived);
      expect(stakedSpaBal).to.be.gt(0);

      let devBal = await stakedSpa.balanceOf(devAddress);

      // Expect dev address to receive fees
      expect(devBal.sub(devBalInitial)).to.equal(devFees);

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

      devBal = await stakedSpa.balanceOf(devAddress);

      let stratBalBeforeRedeem = await stakedSpa.balanceOf(strategy.address);

      await strategy.redeemAndStake();

      devFees = pendingPayout.mul(feeRate).div(feeDivisor);
      let devBalAfter = await stakedSpa.balanceOf(devAddress);
      let devFeesCollected = devBalAfter.sub(devBal);

      expect(devFees).to.equal(devFeesCollected);
      payoutReceived = pendingPayout.sub(devFees);

      expect(await strategy.totalRebasing()).to.equal(
        payoutReceived.add(stratBalBeforeRedeem)
      );
      expect(await spa.balanceOf(strategy.address)).to.equal(0);
      expect(await stakedSpa.balanceOf(strategy.address)).to.equal(
        payoutReceived.add(stratBalBeforeRedeem)
      );
    }
  ).timeout(TEST_TIMEOUT * 2);

  it("Can change redeem fees", async function () {
    let newFee = 300;
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
