const { expect } = require("chai");
const {
  beforeHook,
  beforeEachHook,
  timeTravelBlocks,
  swapNativeForToken,
  forceHighMaxDebt,
  forceFHMBondPositive,
} = require("../../../utils/testUtils.ts");
const { addressBook } = require("blockchain-addressbook");
const {
  FHM,
  FHM_STAKER,
  STAKED_FHM,
  FHM_STAKE_MANAGER,
  BOGUS_ADDR_1,
  BOGUS_ADDR_2,
  WFTM,
  DAI,
  FHM_DAI_BOND,
  FHM_DAI_ROUTE,
  TEST_TIMEOUT,
  SLOW_TEST_FLAG,
  FANTOHM_TEST_FLAG,
  FHM_WFTM_BOND,
  FHM_DAI_LP_BOND,
  FHM_BOND_CALCULATOR,
  FHM_WHALES,
  FHM_TREASURY,
  REBASE_PERIOD_BLOCKS,
  FHM_CIRCULATING_SUPPLY,
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

describe(FANTOHM_TEST_FLAG + " Strategy Control Functions", function () {
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
    dai,
    fhmCirculatingSupply;

  this.slow(20000);

  beforeEach(async () => {
    ({
      rebaseToken: fhm,
      stakedRebaseToken: stakedFhm,
      stakingHelper,
      unirouter,
      unirouterData,
      whale,
      daiBondDepository,
      wftmBondDepository,
      daiLPBondDepository: fhmDaiBondDepository,
      daiWftmPair,
      stakeManager,
      dai,
      circulatingSupply: fhmCirculatingSupply,
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
      circulatingSupplyAddr: FHM_CIRCULATING_SUPPLY,
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
  });

  it("Can pause so that users can only withdraw and then unpause", async function () {
    // Users can deposit before pausing
    await vault.deposit(rebaseTokenBalStart);
    const vaultBal = await vault.balanceOf(deployer.address);

    expect(vaultBal.div(10 ** 9)).to.equal(rebaseTokenBalStart);

    expect(await stakedFhm.balanceOf(strategy.address))
      .to.equal(rebaseTokenBalStart)
      .to.equal(await vault.balance())
      .to.equal(await strategy.stakedRebasing())
      .to.equal(await strategy.totalBalance());

    // Can reserve and withdraw immediately before pausing
    await vault.reserve(vaultBal.div(2));
    const withdrawalFee = await strategy.withdrawalFee();
    const withdrawalFeeDenom = await strategy.WITHDRAWAL_FEE_DIVISOR();
    let withdrawalFeeAmount = rebaseTokenBalStart
      .mul(withdrawalFee)
      .div(withdrawalFeeDenom.mul(2));

    expect(await fhm.balanceOf(deployer.address))
      .to.equal(rebaseTokenBalStart.sub(await strategy.totalBalance()))
      .to.equal(rebaseTokenBalStart.sub(await vault.balance()))
      .to.equal(rebaseTokenBalStart.div(2).sub(withdrawalFeeAmount));

    expect(rebaseTokenBalStart).to.equal(
      (await strategy.stakedRebasing()).add(
        await fhm.balanceOf(deployer.address)
      )
    );

    expect(
      rebaseTokenBalStart
        .sub(rebaseTokenBalStart.div(2))
        .add(withdrawalFeeAmount)
    )
      .to.equal(await stakedFhm.balanceOf(strategy.address))
      .to.equal(await strategy.totalBalance())
      .to.equal(await strategy.stakedRebasing())
      .to.equal(await vault.balance());

    withdrawalFeeAmount = (await strategy.stakedRebasing())
      .mul(withdrawalFee)
      .div(withdrawalFeeDenom);

    // Now pause the strategy, users can withdraw but not deposit
    await strategy.pause();
    await vault.reserveAll();

    expect(await fhm.balanceOf(deployer.address)).to.equal(
      rebaseTokenBalStart.sub(withdrawalFeeAmount)
    );

    const rebaseBal = await fhm.balanceOf(deployer.address);

    await fhm.approve(stakingHelper.address, rebaseBal);
    await stakingHelper.stake(rebaseBal);

    await expect(vault.deposit(rebaseBal)).to.be.revertedWith(
      "Pausable: paused"
    );

    await expect(vault.depositAll()).to.be.revertedWith("Pausable: paused");

    await strategy.unpause();

    // Can deposit after unpausing
    vault.depositAll();

    expect(await vault.balance())
      .to.equal(rebaseTokenBalStart)
      .to.equal(await strategy.totalBalance())
      .to.equal(await strategy.stakedRebasing())
      .to.equal(await stakedFhm.balanceOf(strategy.address));

    // Can withdraw after unpausing

    await vault.reserveAll();

    expect(await fhm.balanceOf(deployer.address)).to.equal(
      rebaseTokenBalStart.sub(
        rebaseTokenBalStart.mul(withdrawalFee).div(withdrawalFeeDenom)
      )
    );
  }).timeout(TEST_TIMEOUT);

  it("Only strategy managers can pause and unpause the strategy", async function () {
    expect(await strategy.paused()).to.be.false;
    await expect(strategy.connect(whale).pause()).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );
    await strategy.pause();
    expect(await strategy.paused()).to.be.true;
    await expect(strategy.connect(keeper).unpause()).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );
    await strategy.unpause();
    expect(await strategy.paused()).to.be.false;
  }).timeout(TEST_TIMEOUT);

  it("Can't pause when paused and unpause when unpaused", async function () {
    expect(await strategy.paused()).to.be.false;
    await expect(strategy.unpause()).to.be.revertedWith("Pausable: not paused");
    expect(await strategy.paused()).to.be.false;
    await strategy.pause();
    expect(await strategy.paused()).to.be.true;
    await expect(strategy.pause()).to.be.revertedWith("Pausable: paused");
    expect(await strategy.paused()).to.be.true;
  }).timeout(TEST_TIMEOUT);

  it(
    SLOW_TEST_FLAG + "Panic during bonding pauses, claims and unstakes all",
    async function () {
      await forceHighMaxDebt(ethers.provider, daiBondDepository);
      await vault.depositAll();
      await strategy.addBond(FHM_DAI_BOND);
      await strategy.stakeToBondSingleAll(FHM_DAI_BOND, FHM_DAI_ROUTE);

      const bondDetails = await daiBondDepository.bondInfo(strategy.address);

      // Travel one rebase period
      await timeTravelBlocks(
        ethers.provider,
        parseInt(ethers.utils.formatUnits(bondDetails.vesting.div(15), 0))
      );

      await strategy.redeemAndStake();

      // Travel another rebase period
      await timeTravelBlocks(
        parseInt(ethers.utils.formatUnits(bondDetails.vesting.div(15), 0))
      );

      // Trigger rebase as to not corroborate our results.
      await stakeManager.rebase();

      // Now strategy will have some funds staked and
      // some funds bonded, with some ready to claim.
      const stratfhmRedeemed = await strategy.stakedRebasing();
      const availablePayout = await daiBondDepository.pendingPayoutFor(
        strategy.address
      );

      await strategy.panic();

      expect(await strategy.stakedRebasing())
        .to.equal(0)
        .to.equal(await stakedFhm.balanceOf(strategy.address));
      expect(await strategy.unstakedRebasing())
        .to.equal(stratfhmRedeemed.add(availablePayout))
        .to.equal(await fhm.balanceOf(strategy.address));

      const stratfhm = await strategy.unstakedRebasing();

      // totalBalance should be gt strat fhm + fhm bonded at the beginning - fhm redeemed
      expect(await strategy.totalBalance()).to.gt(
        stratfhm.add(rebaseTokenBalStart).sub(stratfhmRedeemed)
      );
    }
  ).timeout(TEST_TIMEOUT * 2);

  it("Panic with unstaked rebaseToken unstakes the staked tokens", async function () {
    await vault.depositAll();

    // Notice all funds are staked
    expect(await strategy.stakedRebasing())
      .to.equal(await vault.balance())
      .to.equal(rebaseTokenBalStart);

    await expect(strategy.unstake(rebaseTokenBalStart.div(2)))
      .to.emit(strategy, "Unstake")
      .withArgs(
        rebaseTokenBalStart.div(2),
        rebaseTokenBalStart.sub(rebaseTokenBalStart.div(2)),
        0,
        0
      );

    expect(await strategy.unstakedRebasing())
      .to.lte(rebaseTokenBalStart.div(2).add(1))
      .to.lte((await strategy.stakedRebasing()).add(1))
      .to.lte((await vault.balance()).div(2).add(1));
    expect(await strategy.unstakedRebasing())
      .to.gte(rebaseTokenBalStart.div(2).sub(1))
      .to.gte((await strategy.stakedRebasing()).sub(1))
      .to.gte((await vault.balance()).div(2).sub(1));

    await strategy.panic();

    expect(await strategy.stakedRebasing()).to.eq(0);
    expect(await strategy.unstakedRebasing())
      .to.eq(await vault.balance())
      .to.eq(rebaseTokenBalStart);
  }).timeout(TEST_TIMEOUT);

  it("Panic during staking pauses and unstakes all", async function () {
    await vault.depositAll();

    expect(await vault.balance())
      .to.equal(await strategy.stakedRebasing())
      .to.equal(rebaseTokenBalStart)
      .to.equal(await stakedFhm.balanceOf(strategy.address));

    expect(await strategy.paused()).to.be.false;

    await strategy.panic();

    expect(await strategy.paused()).to.be.true;
    expect(await vault.balance())
      .to.equal(await strategy.unstakedRebasing())
      .to.equal(await strategy.totalBalance())
      .to.equal(await fhm.balanceOf(strategy.address));
  }).timeout(TEST_TIMEOUT);

  it("Panic is idempotent", async function () {
    await vault.depositAll();

    expect(await vault.balance())
      .to.equal(await strategy.stakedRebasing())
      .to.equal(rebaseTokenBalStart)
      .to.equal(await stakedFhm.balanceOf(strategy.address));

    expect(await strategy.paused()).to.be.false;

    await strategy.panic();

    expect(await strategy.paused()).to.be.true;
    expect(await vault.balance())
      .to.equal(await strategy.unstakedRebasing())
      .to.equal(await strategy.totalBalance())
      .to.equal(await fhm.balanceOf(strategy.address));

    await strategy.panic();

    expect(await strategy.paused()).to.be.true;
    expect(await vault.balance())
      .to.equal(await strategy.unstakedRebasing())
      .to.equal(await strategy.totalBalance())
      .to.equal(await fhm.balanceOf(strategy.address));
  }).timeout(TEST_TIMEOUT);

  it("Only Manager can panic", async function () {
    await expect(strategy.connect(keeper).panic()).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );
    strategy.panic();
  }).timeout(TEST_TIMEOUT);

  it("Manager can force unstake and stake", async function () {
    await vault.depositAll();

    expect(await stakedFhm.balanceOf(strategy.address))
      .to.equal(await vault.balance())
      .to.equal(await strategy.stakedRebasing())
      .to.equal(rebaseTokenBalStart);

    await expect(strategy.connect(keeper).unstakeAll()).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );
    await strategy.unstakeAll();

    expect(await strategy.unstakedRebasing())
      .to.equal(await strategy.totalBalance())
      .to.equal(rebaseTokenBalStart)
      .to.equal(await vault.balance());

    // Expect calling unstake twice to be idempotent
    await strategy.unstakeAll();

    expect(await strategy.unstakedRebasing())
      .to.equal(await strategy.totalBalance())
      .to.equal(rebaseTokenBalStart)
      .to.equal(await vault.balance());

    // Staking stakes all again
    await expect(strategy.connect(keeper).stake()).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );
    await strategy.stake();

    expect(await stakedFhm.balanceOf(strategy.address))
      .to.equal(await vault.balance())
      .to.equal(await strategy.stakedRebasing())
      .to.equal(rebaseTokenBalStart);

    // Expect stake to be idempotent
    await strategy.stake();

    expect(await stakedFhm.balanceOf(strategy.address))
      .to.equal(await vault.balance())
      .to.equal(await strategy.stakedRebasing())
      .to.equal(rebaseTokenBalStart);
  }).timeout(TEST_TIMEOUT);

  it("Manager can unstake a portion of funds", async function () {
    await vault.depositAll();

    expect(await stakedFhm.balanceOf(strategy.address))
      .to.equal(await vault.balance())
      .to.equal(await strategy.stakedRebasing())
      .to.equal(rebaseTokenBalStart);

    await expect(
      strategy.connect(keeper).unstake(rebaseTokenBalStart.div(2))
    ).to.be.revertedWith("Ownable: caller is not the owner");
    await strategy.unstake(rebaseTokenBalStart.div(2));

    expect(await strategy.unstakedRebasing())
      .to.equal((await strategy.totalBalance()).div(2))
      .to.equal(rebaseTokenBalStart.div(2))
      .to.equal((await vault.balance()).div(2));

    // Can unstake the rest
    await strategy.unstakeAll();

    expect(await strategy.unstakedRebasing())
      .to.equal(await strategy.totalBalance())
      .to.equal(rebaseTokenBalStart)
      .to.equal(await vault.balance());
  }).timeout(TEST_TIMEOUT);

  it("Can retrieve bespoke tokens, but not want or stakedWant", async function () {
    expect(await dai.balanceOf(strategy.address)).to.equal(0);

    await swapNativeForToken({
      unirouter,
      amount: ethers.utils.parseEther("200"),
      nativeTokenAddr: WFTM,
      token: dai,
      recipient: deployer.address,
      swapSignature: unirouterData.swapSignature,
    });

    const daiBal = await dai.balanceOf(deployer.address);
    expect(await dai.balanceOf(strategy.address)).to.equal(0);
    expect(daiBal).to.gt(0);

    await dai.approve(strategy.address, daiBal);
    await dai.transfer(strategy.address, daiBal);

    expect(await dai.balanceOf(strategy.address)).to.equal(daiBal);

    await expect(
      strategy.connect(keeper).inCaseTokensGetStuck(DAI)
    ).to.be.revertedWith("Ownable: caller is not the owner");

    // Cannot rescue want or staked want
    await expect(strategy.inCaseTokensGetStuck(FHM)).to.be.revertedWith(
      "!token"
    );
    await expect(strategy.inCaseTokensGetStuck(STAKED_FHM)).to.be.revertedWith(
      "!token"
    );

    await strategy.inCaseTokensGetStuck(DAI);

    expect(await dai.balanceOf(strategy.address)).to.equal(0);
    expect(await dai.balanceOf(deployer.address)).to.equal(daiBal);
  }).timeout(TEST_TIMEOUT);

  it("Staking when a reserve period is finished, begins a new reserve period with just warmup", async function () {
    await vault.depositAll();
    const totalRebasing = await strategy.totalRebasing();
    const vaultBal = await vault.balance();
    expect(totalRebasing)
      .to.eq(vaultBal)
      .to.eq(await strategy.stakedRebasing())
      .to.eq(rebaseTokenBalStart);
    expect(await strategy.unstakedRebasing()).to.eq(0);

    await strategy.unstakeAll();

    expect(totalRebasing)
      .to.eq(vaultBal)
      .to.eq(await strategy.unstakedRebasing())
      .to.eq(rebaseTokenBalStart);
    expect(await strategy.stakedRebasing()).to.eq(0);

    const currentReservePeriod = await strategy.currentReservePeriod();

    expect(currentReservePeriod).to.eq(0);
    expect(await strategy.reservePeriodFinished(currentReservePeriod)).to.be
      .true;

    const warmupPeriod = await stakeManager.warmupPeriod();

    await strategy.stake();

    const warmupBal = (await stakeManager.warmupInfo(strategy.address)).deposit;

    expect(await strategy.totalRebasing())
      .to.eq(rebaseTokenBalStart)
      .to.eq(await vault.balance());
    expect(warmupBal).to.eq(0);

    const newReservePeriod = await strategy.currentReservePeriod();
    const reservePeriod = await strategy.reservePeriods(newReservePeriod);
    const currentEpoch = await strategy.currentEpochNumber();
    const currentEpochByStakeManager = (await stakeManager.epoch()).number;

    expect(currentEpochByStakeManager).to.eq(currentEpoch);

    expect(newReservePeriod).to.eq(1);
    expect(reservePeriod.warmupExpiry).to.eq(currentEpoch.add(warmupPeriod));
    expect(reservePeriod.fullyVested).to.be.true;
    expect(await strategy.reservePeriodFinished(newReservePeriod)).to.be.true;
  }).timeout(TEST_TIMEOUT);

  it("Staking when a reserve period isn't finished (still bonding) simply adds warmup", async function () {
    await forceHighMaxDebt(ethers.provider, daiBondDepository);
    await forceFHMBondPositive(
      ethers.provider,
      daiBondDepository,
      fhmCirculatingSupply
    );
    await vault.depositAll();

    await strategy.addBond(FHM_DAI_BOND);
    await strategy.stakeToBondSingleAll(FHM_DAI_BOND, FHM_DAI_ROUTE);

    const currentReservePeriod = await strategy.currentReservePeriod();
    let reservePeriod = await strategy.reservePeriods(currentReservePeriod);

    expect(currentReservePeriod).to.eq(1);
    expect(await strategy.reservePeriodFinished(currentReservePeriod)).to.be
      .false;
    expect(reservePeriod.fullyVested).to.be.false;
    expect(reservePeriod.warmupExpiry).to.eq(0);

    await strategy.stake();

    reservePeriod = await strategy.reservePeriods(currentReservePeriod);
    const currentEpoch = await strategy.currentEpochNumber();
    const warmupPeriod = await stakeManager.warmupPeriod();
    const predictedWarmupExpiry = await strategy.newWarmupExpiry();

    expect(await strategy.currentReservePeriod()).to.eq(currentReservePeriod);
    expect(reservePeriod.fullyVested).to.be.false;
    expect(await strategy.reservePeriodFinished(currentReservePeriod)).to.be
      .false;
    expect(reservePeriod.warmupExpiry)
      .to.eq(currentEpoch.add(warmupPeriod))
      .to.eq(predictedWarmupExpiry);
  }).timeout(TEST_TIMEOUT);

  it(
    SLOW_TEST_FLAG +
      "Staking when a reserve period isn't finished (still warmup) simply extends warmup",
    async function () {
      await vault.deposit(rebaseTokenBalStart.div(2));

      await strategy.unstakeAll();
      await strategy.stake();

      const currentReservePeriod = await strategy.currentReservePeriod();
      let reservePeriod = await strategy.reservePeriods(currentReservePeriod);
      let currentEpoch = await strategy.currentEpochNumber();
      const warmupPeriod = await stakeManager.warmupPeriod();
      let predictedWarmupExpiry = await strategy.newWarmupExpiry();

      expect(warmupPeriod).to.eq(0);

      expect(reservePeriod.warmupExpiry)
        .to.eq(currentEpoch)
        .to.eq(predictedWarmupExpiry);
      expect(reservePeriod.fullyVested).to.be.true;
      expect(await strategy.reservePeriodFinished(currentReservePeriod)).to.be
        .true;

      await timeTravelBlocks(ethers.provider, REBASE_PERIOD_BLOCKS);
      currentEpoch = await strategy.currentEpochNumber();

      expect(currentEpoch).to.eq((await stakeManager.epoch()).number);
      await stakeManager.rebase();
      expect(currentEpoch.add(1)).to.eq((await stakeManager.epoch()).number);
      currentEpoch = await strategy.currentEpochNumber();

      expect(reservePeriod.warmupExpiry)
        .to.eq(currentEpoch.sub(1))
        .to.eq(predictedWarmupExpiry);
      expect(reservePeriod.fullyVested).to.be.true;
      expect(await strategy.reservePeriodFinished(currentReservePeriod)).to.be
        .true;

      await strategy.stake();

      const newReservePeriod = await strategy.currentReservePeriod();
      // Notice new reserve period started because there is no warmup
      expect(newReservePeriod).to.eq(currentReservePeriod.add(1)).to.eq(2);
      predictedWarmupExpiry = await strategy.newWarmupExpiry();
      reservePeriod = await strategy.reservePeriods(newReservePeriod);

      expect(reservePeriod.warmupExpiry)
        .to.eq(currentEpoch)
        .to.eq(predictedWarmupExpiry);
      expect(reservePeriod.fullyVested).to.be.true;
      expect(await strategy.reservePeriodFinished(currentReservePeriod)).to.be
        .true;
    }
  ).timeout(TEST_TIMEOUT);
});
