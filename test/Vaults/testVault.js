const { expect } = require("chai");
const { ethers } = require("hardhat");
const { addressBook } = require("blockchain-addressbook");
const {
  swapNativeForToken,
  beforeEachHook,
  beforeHook,
  minimizeBondPeriod,
  timeTravelBlocks,
  forceBondPositive,
  forceBondNegative,
  adjustBondPeriod,
} = require("../../utils/testUtils.ts");
const {
  TEST_TIMEOUT,
  BOGUS_ADDR_1,
  BOGUS_ADDR_2,
  SPA_DAI_PAIR,
  SPA_STAKER,
  SPA_STAKE_MANAGER,
  SPA,
  STAKED_SPA,
  WFTM,
  DAI,
  DAI_BOND,
  SPA_DAI_ROUTE,
  SLOW_TEST_FLAG,
} = require("../../constants.js");
const { REBASE_PERIOD_BLOCKS, ZERO_ADDR } = require("../../constants");

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

describe("MinimumVault", function () {
  let vault,
    strategy,
    unirouter,
    unirouterData,
    want,
    wantBalStart,
    deployer,
    keeper,
    other,
    whale,
    daiBondDepository,
    wftmBondDepository,
    spaDaiBondDepository,
    spaDaiBondCalculator,
    stakeManager,
    spaTreasury,
    dai;

  this.slow(20000);

  before(async () => {
    ({
      unirouter,
      rebaseToken: want,
      dai,
      unirouterData,
      whale,
      daiBondDepository,
      stakeManager,
      wftmBondDepository,
      spaDaiBondDepository,
      spaDaiBondCalculator,
      spaTreasury,
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

  it("Users can deposit to the vault", async function () {
    await expect(vault.depositAll())
      .to.emit(strategy, "Deposit")
      .withArgs(wantBalStart); // takes care of the transfer.

    const vaultWant = await want.balanceOf(vault.address);
    const stratWant = await strategy.totalBalance();

    // Funds immediately go to the strategy
    expect(vaultWant).to.equal(0);
    expect(stratWant).to.be.lte(wantBalStart);
    expect(stratWant).to.be.gt(wantBalStart.mul(99).div(100));
  }).timeout(TEST_TIMEOUT);

  it("Users can reserve from the vault", async function () {
    await vault.depositAll(); // takes care of the transfer.

    let deployerVaultToken = await vault.balanceOf(deployer.address);

    // Expect reserves to be 0
    expect(await strategy.reserves()).to.eq(0);

    await vault.reserve(deployerVaultToken.div(2)); // Reserve half the tokens
    const withdrawalFee = await strategy.withdrawalFee();
    const withdrawalFeeDenom = await strategy.WITHDRAWAL_FEE_DIVISOR();
    let withdrawalFeeAmount = wantBalStart
      .div(2)
      .mul(withdrawalFee)
      .div(withdrawalFeeDenom);

    // Balance should be updated immediately, since we are not bonding
    expect(await want.balanceOf(deployer.address)).to.equal(
      wantBalStart.div(2).sub(withdrawalFeeAmount)
    );

    // Expect reserves to remain 0
    expect(await strategy.reserves()).to.eq(0);

    const stratBal = await strategy.totalBalance();

    // Reserve the other half
    await vault.reserveAll();

    withdrawalFeeAmount = stratBal.mul(withdrawalFee).div(withdrawalFeeDenom);

    // Expect reserves to remain 0
    expect(await strategy.reserves()).to.eq(0);

    // Deployer address no longer has any vault IOU tokens after reserving.
    expect(await vault.balanceOf(deployer.address)).to.equal(0);

    // Deployer address balance should be fully paid out
    expect(await want.balanceOf(deployer.address)).to.equal(
      wantBalStart.sub(withdrawalFeeAmount)
    );
  }).timeout(TEST_TIMEOUT);

  it("Users can reserve from the vault (with unstaked)", async function () {
    await vault.depositAll(); // takes care of the transfer.

    let deployerVaultToken = await vault.balanceOf(deployer.address);

    // Expect reserves to be 0
    expect(await strategy.reserves()).to.eq(0);

    await strategy.unstake(wantBalStart.div(4));

    await vault.reserve(deployerVaultToken.div(2)); // Reserve half the tokens
    const withdrawalFee = await strategy.withdrawalFee();
    const withdrawalFeeDenom = await strategy.WITHDRAWAL_FEE_DIVISOR();
    let withdrawalFeeAmount = wantBalStart
      .div(2)
      .mul(withdrawalFee)
      .div(withdrawalFeeDenom);

    // Balance should be updated immediately, since we are not bonding
    expect(await want.balanceOf(deployer.address)).to.equal(
      wantBalStart.div(2).sub(withdrawalFeeAmount)
    );

    // Expect reserves to remain 0
    expect(await strategy.reserves()).to.eq(0);

    const stratBal = await strategy.totalBalance();

    await strategy.unstake(wantBalStart.div(4));

    // Reserve the other half
    await vault.reserveAll();

    withdrawalFeeAmount = stratBal.mul(withdrawalFee).div(withdrawalFeeDenom);

    // Expect reserves to remain 0
    expect(await strategy.reserves()).to.eq(0);

    // Deployer address no longer has any vault IOU tokens after reserving.
    expect(await vault.balanceOf(deployer.address)).to.equal(0);

    // Deployer address balance should be fully paid out
    expect(await want.balanceOf(deployer.address)).to.equal(
      wantBalStart.sub(withdrawalFeeAmount)
    );
  }).timeout(TEST_TIMEOUT);

  it("Stuck funds can be rescued from the vault", async function () {
    expect(await dai.balanceOf(vault.address)).to.equal(0);

    await swapNativeForToken({
      unirouter,
      amount: ethers.utils.parseEther("200"),
      nativeTokenAddr: WFTM,
      token: dai,
      recipient: deployer.address,
      swapSignature: unirouterData.swapSignature,
    });

    const daiBal = await dai.balanceOf(deployer.address);
    expect(await dai.balanceOf(vault.address)).to.equal(0);
    expect(daiBal).to.gt(0);

    await dai.transfer(vault.address, daiBal);

    expect(await dai.balanceOf(vault.address)).to.equal(daiBal);

    await expect(
      vault.connect(other).inCaseTokensGetStuck(DAI)
    ).to.be.revertedWith("Ownable: caller is not the owner");

    // Cannot rescue want
    await expect(vault.inCaseTokensGetStuck(want.address)).to.be.revertedWith(
      "!token"
    );
    await vault.inCaseTokensGetStuck(DAI);

    expect(await dai.balanceOf(vault.address)).to.equal(0);
    expect(await dai.balanceOf(deployer.address)).to.equal(daiBal);
  }).timeout(TEST_TIMEOUT);

  it("Reserving after already reserved all fails", async function () {
    await vault.deposit(wantBalStart); // takes care of the transfer.
    let deployerVaultToken = await vault.balanceOf(deployer.address);

    // All vault tokens still available
    expect(await vault.balanceOf(deployer.address)).to.equal(
      deployerVaultToken
    );

    const withdrawalFee = await strategy.withdrawalFee();
    const WITHDRAWAL_FEE_DIVISOR = await strategy.WITHDRAWAL_FEE_DIVISOR();
    let withdrawalFeeAmount = (await vault.balance())
      .mul(withdrawalFee)
      .div(WITHDRAWAL_FEE_DIVISOR);

    await vault.reserveAll();

    // User gets funds immediately when not bonding
    expect(await want.balanceOf(deployer.address)).to.equal(
      wantBalStart.sub(withdrawalFeeAmount)
    );
    expect(await vault.balanceOf(deployer.address)).to.equal(0);

    // No vault tokens left; already reserved
    await expect(vault.reserve(deployerVaultToken)).to.be.revertedWith(
      "SafeMath: division by zero"
    );
  }).timeout(TEST_TIMEOUT);

  it.skip(
    SLOW_TEST_FLAG +
      "Two users deposit and then (negative) bond, one reserves during bond",
    async function () {
      await minimizeBondPeriod(ethers.provider, daiBondDepository);
      // Notice: Forces 10% bond premium
      await forceBondNegative(ethers.provider, daiBondDepository, strategy);

      await vault.depositAll();
      await vault.connect(whale).deposit(wantBalStart);

      // Twice wantBalStart is in vault
      expect(await vault.balance())
        .to.equal(await strategy.stakedRebasing())
        .to.equal(wantBalStart.mul(2));

      await strategy.addBond(DAI_BOND);
      await strategy.stakeToBondSingleAll(DAI_BOND, SPA_DAI_ROUTE);
      expect(await strategy.currentBond()).to.equal(DAI_BOND);
      expect(await vault.balance())
        .to.equal(wantBalStart.mul(2))
        .to.equal(await strategy.rebaseBonded());

      const bondDetails = await daiBondDepository.bondInfo(strategy.address);

      // Expect payout to be roughly 100/110th due to bond premium (notice inaccuracy for slippage)
      expect(bondDetails.payout).to.lte(wantBalStart.mul(200).div(110));
      expect(bondDetails.payout).to.be.gte(
        wantBalStart.mul(200).mul(99).div(110).div(100)
      );

      const withdrawalFee = await strategy.withdrawalFee();
      const withdrawalFeeDenom = await strategy.WITHDRAWAL_FEE_DIVISOR();
      let withdrawalFeeAmount = wantBalStart
        .mul(withdrawalFee)
        .div(withdrawalFeeDenom);

      await vault.reserveAll();

      expect(await strategy.totalBalance())
        .to.equal(wantBalStart.add(withdrawalFeeAmount))
        .to.equal(await vault.balance());

      // Funds are not paid out immediately, but reserved
      expect(await want.balanceOf(deployer.address)).to.equal(0);
      expect(await strategy.reserves())
        .to.equal(await strategy.claimOfReserves(deployer.address))
        .to.equal(wantBalStart.sub(withdrawalFeeAmount));

      // Travel to the end of the bond
      await timeTravelBlocks(ethers.provider, 10000);
      await stakeManager.rebase();

      const bondPendingPayout = await daiBondDepository.pendingPayoutFor(
        strategy.address
      );

      // Bond is fully vested
      expect(bondPendingPayout).to.equal(bondDetails.payout);

      // No staked rebasing so no corroboration due to rebasing
      expect(await strategy.stakedRebasing()).to.equal(0);

      // Reserves have not changed
      expect(await want.balanceOf(deployer.address)).to.equal(0);
      expect(await strategy.reserves())
        .to.equal(await strategy.claimOfReserves(deployer.address))
        .to.equal(wantBalStart.sub(withdrawalFeeAmount));

      const redeemFee = await strategy.serviceFee();
      const redeemFeeDenom = await strategy.SERVICE_FEE_DIVISOR();
      const redeemFeeAmount = bondPendingPayout
        .mul(redeemFee)
        .div(redeemFeeDenom);

      await strategy.redeemAndStake();

      // User 1 is paid out and reserves are set to 0
      expect(await want.balanceOf(deployer.address)).to.equal(
        wantBalStart.sub(withdrawalFeeAmount)
      );
      expect(await strategy.reserves())
        .to.equal(await strategy.claimOfReserves(deployer.address))
        .to.equal(0);

      const estimatedVaultBal = wantBalStart
        .mul(200)
        .div(110)
        .sub(wantBalStart)
        .add(withdrawalFeeAmount)
        .sub(redeemFeeAmount);

      // Vault realizes losses and gains the withdrawal fee (notice inaccuracy due to slippage)
      expect(await vault.balance()).to.lte(estimatedVaultBal);
      expect(await vault.balance()).to.gte(estimatedVaultBal.mul(99).div(100));

      const vaultBalBeforeWithdraw = await vault.balance();
      withdrawalFeeAmount = vaultBalBeforeWithdraw
        .mul(withdrawalFee)
        .div(withdrawalFeeDenom);

      const whaleBalBefore = await want.balanceOf(whale._address);

      // User 2 reserves and immediately realizes losses + withdrawal fee (notice inaccuracy due to slippage)
      await vault.connect(whale).reserveAll();
      const whaleBalReserved = (await want.balanceOf(whale._address)).sub(
        whaleBalBefore
      );

      expect(whaleBalReserved)
        .to.equal(vaultBalBeforeWithdraw.sub(withdrawalFeeAmount))
        .to.lte(estimatedVaultBal.sub(withdrawalFeeAmount));
      expect(whaleBalReserved)
        .to.equal(vaultBalBeforeWithdraw.sub(withdrawalFeeAmount))
        .to.gte(estimatedVaultBal.mul(99).div(100).sub(withdrawalFeeAmount));
    }
  ).timeout(TEST_TIMEOUT);

  it.skip(
    SLOW_TEST_FLAG +
      "Two users deposit and then (negative) bond, one reserves during bond (with unstaked)",
    async function () {
      await minimizeBondPeriod(ethers.provider, daiBondDepository);
      // Notice: Forces 10% bond premium
      await forceBondNegative(ethers.provider, daiBondDepository, strategy);

      await vault.depositAll();
      await vault.connect(whale).deposit(wantBalStart);

      // Twice wantBalStart is in vault
      expect(await vault.balance())
        .to.equal(await strategy.stakedRebasing())
        .to.equal(wantBalStart.mul(2));

      await strategy.unstakeAll();

      await strategy.addBond(DAI_BOND);
      await strategy.stakeToBondSingleAll(DAI_BOND, SPA_DAI_ROUTE);
      expect(await strategy.currentBond()).to.equal(DAI_BOND);
      expect(await vault.balance())
        .to.equal(wantBalStart.mul(2))
        .to.equal(await strategy.rebaseBonded());

      const bondDetails = await daiBondDepository.bondInfo(strategy.address);

      // Expect payout to be roughly 100/110th due to bond premium (notice inaccuracy for slippage)
      expect(bondDetails.payout).to.lte(wantBalStart.mul(200).div(110));
      expect(bondDetails.payout).to.be.gte(
        wantBalStart.mul(200).mul(99).div(110).div(100)
      );

      const withdrawalFee = await strategy.withdrawalFee();
      const withdrawalFeeDenom = await strategy.WITHDRAWAL_FEE_DIVISOR();
      let withdrawalFeeAmount = wantBalStart
        .mul(withdrawalFee)
        .div(withdrawalFeeDenom);

      await vault.reserveAll();

      expect(await strategy.totalBalance())
        .to.equal(wantBalStart.add(withdrawalFeeAmount))
        .to.equal(await vault.balance());

      // Funds are not paid out immediately, but reserved
      expect(await want.balanceOf(deployer.address)).to.equal(0);
      expect(await strategy.reserves())
        .to.equal(await strategy.claimOfReserves(deployer.address))
        .to.equal(wantBalStart.sub(withdrawalFeeAmount));

      // Travel to the end of the bond
      await timeTravelBlocks(ethers.provider, 10000);
      await stakeManager.rebase();

      const bondPendingPayout = await daiBondDepository.pendingPayoutFor(
        strategy.address
      );

      // Bond is fully vested
      expect(bondPendingPayout).to.equal(bondDetails.payout);

      // No staked rebasing so no corroboration due to rebasing
      expect(await strategy.stakedRebasing()).to.equal(0);

      // Reserves have not changed
      expect(await want.balanceOf(deployer.address)).to.equal(0);
      expect(await strategy.reserves())
        .to.equal(await strategy.claimOfReserves(deployer.address))
        .to.equal(wantBalStart.sub(withdrawalFeeAmount));

      const redeemFee = await strategy.serviceFee();
      const redeemFeeDenom = await strategy.SERVICE_FEE_DIVISOR();
      const redeemFeeAmount = bondPendingPayout
        .mul(redeemFee)
        .div(redeemFeeDenom);

      await strategy.redeemAndStake();
      await strategy.unstake(wantBalStart);

      // User 1 is paid out and reserves are set to 0
      expect(await want.balanceOf(deployer.address)).to.equal(
        wantBalStart.sub(withdrawalFeeAmount)
      );
      expect(await strategy.reserves())
        .to.equal(await strategy.claimOfReserves(deployer.address))
        .to.equal(0);

      const estimatedVaultBal = wantBalStart
        .mul(200)
        .div(110)
        .sub(wantBalStart)
        .add(withdrawalFeeAmount)
        .sub(redeemFeeAmount);

      // Vault realizes losses and gains the withdrawal fee (notice inaccuracy due to slippage)
      expect(await vault.balance()).to.lte(estimatedVaultBal);
      expect(await vault.balance()).to.gte(estimatedVaultBal.mul(99).div(100));

      const vaultBalBeforeWithdraw = await vault.balance();
      withdrawalFeeAmount = vaultBalBeforeWithdraw
        .mul(withdrawalFee)
        .div(withdrawalFeeDenom);

      const whaleBalBefore = await want.balanceOf(whale._address);

      // User 2 reserves and immediately realizes losses + withdrawal fee (notice inaccuracy due to slippage)
      await vault.connect(whale).reserveAll();
      const whaleBalReserved = (await want.balanceOf(whale._address)).sub(
        whaleBalBefore
      );

      expect(whaleBalReserved)
        .to.equal(vaultBalBeforeWithdraw.sub(withdrawalFeeAmount))
        .to.lte(estimatedVaultBal.sub(withdrawalFeeAmount));
      expect(whaleBalReserved)
        .to.equal(vaultBalBeforeWithdraw.sub(withdrawalFeeAmount))
        .to.gte(estimatedVaultBal.mul(99).div(100).sub(withdrawalFeeAmount));
    }
  ).timeout(TEST_TIMEOUT);

  it("Can withdraw a fraction of position while staking", async function () {
    await vault.deposit(wantBalStart); // takes care of the transfer.
    let deployerVaultToken = await vault.balanceOf(deployer.address);

    // All vault tokens still available
    expect(await vault.balanceOf(deployer.address)).to.equal(
      deployerVaultToken
    );

    await vault.reserve(deployerVaultToken.div(2));

    expect(await vault.balanceOf(deployer.address)).to.equal(
      deployerVaultToken.div(2)
    );

    const withdrawalFee = await strategy.withdrawalFee();
    const WITHDRAWAL_FEE_DIVISOR = await strategy.WITHDRAWAL_FEE_DIVISOR();
    // Calculate withdrawal fee
    const withdrawalFeeAmount = wantBalStart
      .div(2)
      .mul(withdrawalFee)
      .div(WITHDRAWAL_FEE_DIVISOR);

    // User should get back initial deposit minus fee
    expect(await want.balanceOf(deployer.address)).to.eq(
      wantBalStart.div(2).sub(withdrawalFeeAmount)
    );
  }).timeout(TEST_TIMEOUT);

  it("Can withdraw a fraction of position before bonding", async function () {
    await forceBondPositive(ethers.provider, daiBondDepository, strategy);
    await vault.deposit(wantBalStart); // takes care of the transfer.
    let deployerVaultToken = await vault.balanceOf(deployer.address);

    // Reserve before bonding begins
    await vault.reserve(deployerVaultToken.div(2));

    const withdrawalFee = await strategy.withdrawalFee();
    const WITHDRAWAL_FEE_DIVISOR = await strategy.WITHDRAWAL_FEE_DIVISOR();
    // Calculate withdrawal fee
    const withdrawalFeeAmount = wantBalStart
      .div(2)
      .mul(withdrawalFee)
      .div(WITHDRAWAL_FEE_DIVISOR);

    // User should get back initial deposit minus fee
    expect(await want.balanceOf(deployer.address)).to.eq(
      wantBalStart.div(2).sub(withdrawalFeeAmount)
    );

    await strategy.addBond(DAI_BOND);
    await strategy.stakeToBondSingle(wantBalStart, DAI_BOND, SPA_DAI_ROUTE);

    expect(await strategy.currentBond()).to.eq(DAI_BOND);

    // Ensure we still have half the IOU tokens from our initial deposit
    expect(await vault.balanceOf(deployer.address)).to.equal(
      deployerVaultToken.div(2)
    );
  }).timeout(TEST_TIMEOUT);

  it("Multiple person withdraw from staking", async function () {
    const whaleInitialbalance = await want.balanceOf(whale._address);
    await vault.deposit(wantBalStart); // takes care of the transfer.
    await vault.connect(whale).deposit(wantBalStart);
    let deployerVaultToken = await vault.balanceOf(deployer.address);
    let whaleVaultToken = await vault.balanceOf(whale._address);

    await vault.connect(whale).reserve(whaleVaultToken);

    const withdrawalFee = await strategy.withdrawalFee();
    const WITHDRAWAL_FEE_DIVISOR = await strategy.WITHDRAWAL_FEE_DIVISOR();
    // Calculate withdrawal fee
    const withdrawalFeeAmountWhale = wantBalStart
      .mul(withdrawalFee)
      .div(WITHDRAWAL_FEE_DIVISOR);

    expect(await want.balanceOf(whale._address)).to.eq(
      whaleInitialbalance.sub(withdrawalFeeAmountWhale)
    );

    const withdrawalFeeAmountUser = (await vault.balance())
      .mul(withdrawalFee)
      .div(WITHDRAWAL_FEE_DIVISOR);

    await vault.reserve(deployerVaultToken);

    // User should get back initial deposit minus fee
    expect(await want.balanceOf(deployer.address)).to.eq(
      wantBalStart.add(withdrawalFeeAmountWhale).sub(withdrawalFeeAmountUser)
    );

    expect(await vault.balanceOf(deployer.address)).to.equal(0);
    expect(await vault.balanceOf(whale._address)).to.equal(0);
    expect((await strategy.claimOfReserves(deployer.address)).amount).to.eq(0);
    expect((await strategy.claimOfReserves(whale._address)).amount).to.eq(0);
    expect(await strategy.reserves()).to.eq(0);
  }).timeout(TEST_TIMEOUT);

  it("Multiple person withdraw from staking (with all unstaked)", async function () {
    const whaleInitialbalance = await want.balanceOf(whale._address);
    await vault.deposit(wantBalStart); // takes care of the transfer.
    await vault.connect(whale).deposit(wantBalStart);
    let deployerVaultToken = await vault.balanceOf(deployer.address);
    let whaleVaultToken = await vault.balanceOf(whale._address);

    await strategy.unstakeAll();

    await vault.connect(whale).reserve(whaleVaultToken);

    const withdrawalFee = await strategy.withdrawalFee();
    const WITHDRAWAL_FEE_DIVISOR = await strategy.WITHDRAWAL_FEE_DIVISOR();
    // Calculate withdrawal fee
    const withdrawalFeeAmountWhale = wantBalStart
      .mul(withdrawalFee)
      .div(WITHDRAWAL_FEE_DIVISOR);

    expect(await want.balanceOf(whale._address)).to.eq(
      whaleInitialbalance.sub(withdrawalFeeAmountWhale)
    );

    const withdrawalFeeAmountUser = (await vault.balance())
      .mul(withdrawalFee)
      .div(WITHDRAWAL_FEE_DIVISOR);

    await vault.reserve(deployerVaultToken);

    // User should get back initial deposit minus fee
    expect(await want.balanceOf(deployer.address)).to.eq(
      wantBalStart.add(withdrawalFeeAmountWhale).sub(withdrawalFeeAmountUser)
    );

    expect(await vault.balanceOf(deployer.address)).to.equal(0);
    expect(await vault.balanceOf(whale._address)).to.equal(0);
    expect((await strategy.claimOfReserves(deployer.address)).amount).to.eq(0);
    expect((await strategy.claimOfReserves(whale._address)).amount).to.eq(0);
    expect(await strategy.reserves()).to.eq(0);
  }).timeout(TEST_TIMEOUT);

  it("Multiple person withdraw from staking (with 1/2 unstaked)", async function () {
    const whaleInitialbalance = await want.balanceOf(whale._address);
    await vault.deposit(wantBalStart); // takes care of the transfer.
    await vault.connect(whale).deposit(wantBalStart);
    let deployerVaultToken = await vault.balanceOf(deployer.address);
    let whaleVaultToken = await vault.balanceOf(whale._address);

    await strategy.unstake(wantBalStart);

    await vault.connect(whale).reserve(whaleVaultToken);

    const withdrawalFee = await strategy.withdrawalFee();
    const WITHDRAWAL_FEE_DIVISOR = await strategy.WITHDRAWAL_FEE_DIVISOR();
    // Calculate withdrawal fee
    const withdrawalFeeAmountWhale = wantBalStart
      .mul(withdrawalFee)
      .div(WITHDRAWAL_FEE_DIVISOR);

    expect(await want.balanceOf(whale._address)).to.eq(
      whaleInitialbalance.sub(withdrawalFeeAmountWhale)
    );

    const withdrawalFeeAmountUser = (await vault.balance())
      .mul(withdrawalFee)
      .div(WITHDRAWAL_FEE_DIVISOR);

    await vault.reserve(deployerVaultToken);

    // User should get back initial deposit minus fee
    expect(await want.balanceOf(deployer.address)).to.eq(
      wantBalStart.add(withdrawalFeeAmountWhale).sub(withdrawalFeeAmountUser)
    );

    expect(await vault.balanceOf(deployer.address)).to.equal(0);
    expect(await vault.balanceOf(whale._address)).to.equal(0);
    expect((await strategy.claimOfReserves(deployer.address)).amount).to.eq(0);
    expect((await strategy.claimOfReserves(whale._address)).amount).to.eq(0);
    expect(await strategy.reserves()).to.eq(0);
  }).timeout(TEST_TIMEOUT);

  it("User can't reserve/claim if user hasn't deposited", async function () {
    let deployerVaultToken = await vault.balanceOf(deployer.address);
    expect(deployerVaultToken).to.equal(0);
    // Total supply is zero
    await expect(vault.reserve(deployerVaultToken)).to.be.revertedWith(
      "!shares > 0"
    );

    await vault.connect(whale).deposit(wantBalStart);
    expect(await vault.balanceOf(whale._address)).to.be.gt(0);
    expect(await vault.totalSupply()).to.be.gt(0);

    await expect(vault.reserveAll()).to.be.revertedWith("!shares > 0");
    await vault.connect(whale).reserveAll();
  }).timeout(TEST_TIMEOUT);

  it(
    SLOW_TEST_FLAG +
      "(Pos. and Dai bond) During bonding reserve 1/3, then reserve the rest before bond finishes",
    async function () {
      await minimizeBondPeriod(ethers.provider, daiBondDepository);
      await forceBondPositive(ethers.provider, daiBondDepository, strategy);
      await vault.deposit(wantBalStart); // takes care of the transfer.
      let deployerVaultToken = await vault.balanceOf(deployer.address);

      await strategy.addBond(DAI_BOND);
      await strategy.stakeToBondSingleAll(DAI_BOND, SPA_DAI_ROUTE);
      expect(await strategy.currentBond()).to.eq(DAI_BOND);

      const bondDetails = await daiBondDepository.bondInfo(strategy.address);

      const withdrawalFee = await strategy.withdrawalFee();
      const withdrawalFeeDenom = await strategy.WITHDRAWAL_FEE_DIVISOR();
      let withdrawalFeeAmount = wantBalStart
        .div(3)
        .mul(withdrawalFee)
        .div(withdrawalFeeDenom);

      // Reserve 1/3
      await vault.reserve(deployerVaultToken.div(3));

      expect(await strategy.rebaseBonded()).to.eq(wantBalStart);
      expect(await strategy.totalRebasing()).to.eq(0);
      expect(await strategy.reserves()).to.eq(
        wantBalStart.div(3).sub(withdrawalFeeAmount)
      );
      expect(
        (await strategy.claimOfReserves(deployer.address)).amount
      ).to.equal(wantBalStart.div(3).sub(withdrawalFeeAmount));

      await timeTravelBlocks(ethers.provider, 5000);

      const redeemFee = await strategy.serviceFee();
      const redeemFeeDenom = await strategy.SERVICE_FEE_DIVISOR();
      let pendingPayout = (
        await daiBondDepository.pendingPayoutFor(strategy.address)
      ).add(bondDetails.payout.div(10000)); // Notice will actually go one more block

      let redeemFeeAmount = pendingPayout.mul(redeemFee).div(redeemFeeDenom);

      await expect(strategy.redeemAndStake()).to.emit(strategy, "Redeem");

      expect(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.gte(pendingPayout.sub(redeemFeeAmount).mul(999).div(1000));
      expect(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.lte(pendingPayout.sub(redeemFeeAmount).mul(1001).div(1000));

      withdrawalFeeAmount = (await vault.balance())
        .mul(withdrawalFee)
        .div(withdrawalFeeDenom);

      const reserved = (await vault.balance())
        .sub(withdrawalFeeAmount)
        .add(await strategy.reserves());
      await vault.reserveAll(); // reserve rest of funds

      expect(await vault.balance()).to.eq(withdrawalFeeAmount);

      expect(await strategy.rebaseBonded()).to.eq(
        wantBalStart.sub(await strategy.stakedRebasing())
      );
      expect(await strategy.reserves())
        .to.eq(wantBalStart.sub(withdrawalFeeAmount))
        .to.equal(reserved);
      expect((await strategy.claimOfReserves(deployer.address)).amount)
        .to.equal(wantBalStart.sub(withdrawalFeeAmount))
        .to.equal(reserved);

      await timeTravelBlocks(ethers.provider, 5000); // travel the rest of the vesting period
      await stakeManager.rebase();

      pendingPayout = await daiBondDepository.pendingPayoutFor(
        strategy.address
      );
      redeemFeeAmount = pendingPayout.mul(redeemFee).div(redeemFeeDenom);

      await expect(strategy.redeemAndStake()).to.emit(strategy, "RedeemFinal"); // final redemption

      await vault.claim();

      expect(await strategy.currentBond()).to.equal(ZERO_ADDR);
      expect(await strategy.reserves()).to.eq(0);
      expect(await strategy.rebaseBonded()).to.eq(0);

      // User should get back less than initial deposit because they redeemed before the bond gains were realized
      expect(await want.balanceOf(deployer.address))
        .to.equal(reserved)
        .to.lt(wantBalStart);

      // Reserves should be 0
      expect(await strategy.reserves())
        .to.equal((await strategy.claimOfReserves(deployer.address)).amount)
        .to.equal(0);

      // Remaining SPA should be staked
      expect(await vault.balance())
        .to.equal(await strategy.stakedRebasing())
        .to.gt(0);
    }
  ).timeout(TEST_TIMEOUT * 2);

  it(
    SLOW_TEST_FLAG +
      "(Pos. and Dai bond) During bonding reserve 1/3, then reserve the rest before bond finishes (with all unstaked)",
    async function () {
      await minimizeBondPeriod(ethers.provider, daiBondDepository);
      await forceBondPositive(ethers.provider, daiBondDepository, strategy);
      await vault.deposit(wantBalStart); // takes care of the transfer.
      let deployerVaultToken = await vault.balanceOf(deployer.address);

      await strategy.unstake(wantBalStart.div(2));

      await strategy.addBond(DAI_BOND);
      await strategy.stakeToBondSingleAll(DAI_BOND, SPA_DAI_ROUTE);
      expect(await strategy.currentBond()).to.eq(DAI_BOND);

      const bondDetails = await daiBondDepository.bondInfo(strategy.address);

      const withdrawalFee = await strategy.withdrawalFee();
      const withdrawalFeeDenom = await strategy.WITHDRAWAL_FEE_DIVISOR();
      let withdrawalFeeAmount = wantBalStart
        .div(3)
        .mul(withdrawalFee)
        .div(withdrawalFeeDenom);

      // Reserve 1/3
      await vault.reserve(deployerVaultToken.div(3));

      expect(await strategy.rebaseBonded()).to.eq(wantBalStart);
      expect(await strategy.totalRebasing()).to.eq(0);
      expect(await strategy.reserves()).to.eq(
        wantBalStart.div(3).sub(withdrawalFeeAmount)
      );
      expect(
        (await strategy.claimOfReserves(deployer.address)).amount
      ).to.equal(wantBalStart.div(3).sub(withdrawalFeeAmount));
      expect(await vault.balance()).to.eq(
        wantBalStart.sub(wantBalStart.div(3)).add(withdrawalFeeAmount)
      );

      await timeTravelBlocks(ethers.provider, 5000);

      const redeemFee = await strategy.serviceFee();
      const redeemFeeDenom = await strategy.SERVICE_FEE_DIVISOR();
      let pendingPayout = (
        await daiBondDepository.pendingPayoutFor(strategy.address)
      ).add(bondDetails.payout.div(10000)); // Notice will actually go one more block

      let redeemFeeAmount = pendingPayout.mul(redeemFee).div(redeemFeeDenom);

      await strategy.redeemAndStake();

      expect(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.gte(pendingPayout.sub(redeemFeeAmount).mul(999).div(1000));
      expect(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.lte(pendingPayout.sub(redeemFeeAmount).mul(1001).div(1000));

      const vaultBal = await vault.balance();

      await strategy.unstake((await strategy.stakedRebasing()).div(2));

      withdrawalFeeAmount = vaultBal.mul(withdrawalFee).div(withdrawalFeeDenom);

      const reserved = vaultBal
        .sub(withdrawalFeeAmount)
        .add(await strategy.reserves());
      await vault.reserveAll(); // reserve rest of funds

      expect(await vault.balance()).to.eq(withdrawalFeeAmount);

      expect(await strategy.rebaseBonded()).to.eq(
        wantBalStart.sub(await strategy.totalRebasing())
      );
      expect(await strategy.reserves())
        .to.eq(wantBalStart.sub(withdrawalFeeAmount))
        .to.equal(reserved);
      expect((await strategy.claimOfReserves(deployer.address)).amount)
        .to.equal(wantBalStart.sub(withdrawalFeeAmount))
        .to.equal(reserved);

      await timeTravelBlocks(ethers.provider, 5000); // travel the rest of the vesting period
      await stakeManager.rebase();

      await strategy.unstakeAll();

      await strategy.redeemAndStake(); // final redemption

      await vault.claim();

      expect(await strategy.currentBond()).to.equal(ZERO_ADDR);
      expect(await strategy.reserves()).to.eq(0);
      expect(await strategy.rebaseBonded()).to.eq(0);

      // User should get back less than initial deposit because they redeemed before the bond gains were realized
      expect(await want.balanceOf(deployer.address))
        .to.equal(reserved)
        .to.lt(wantBalStart);

      // Reserves should be 0
      expect(await strategy.reserves())
        .to.equal((await strategy.claimOfReserves(deployer.address)).amount)
        .to.equal(0);

      // Remaining SPA should be staked
      expect(await vault.balance())
        .to.equal(await strategy.stakedRebasing())
        .to.gt(0);
    }
  ).timeout(TEST_TIMEOUT * 2);

  it(
    SLOW_TEST_FLAG +
      "(Pos. and Dai bond) During bonding reserve 1/3, then reserve the rest before bond finishes (with some unstaked)",
    async function () {
      await minimizeBondPeriod(ethers.provider, daiBondDepository);
      await forceBondPositive(ethers.provider, daiBondDepository, strategy);
      await vault.deposit(wantBalStart); // takes care of the transfer.
      let deployerVaultToken = await vault.balanceOf(deployer.address);

      await strategy.unstake(wantBalStart.div(2));

      await strategy.addBond(DAI_BOND);
      await strategy.stakeToBondSingleAll(DAI_BOND, SPA_DAI_ROUTE);
      expect(await strategy.currentBond()).to.eq(DAI_BOND);

      const bondDetails = await daiBondDepository.bondInfo(strategy.address);

      const withdrawalFee = await strategy.withdrawalFee();
      const withdrawalFeeDenom = await strategy.WITHDRAWAL_FEE_DIVISOR();
      let withdrawalFeeAmount = wantBalStart
        .div(3)
        .mul(withdrawalFee)
        .div(withdrawalFeeDenom);

      // Reserve 1/3
      await vault.reserve(deployerVaultToken.div(3));

      expect(await strategy.rebaseBonded()).to.eq(wantBalStart);
      expect(await strategy.totalRebasing()).to.eq(0);
      expect(await strategy.reserves()).to.eq(
        wantBalStart.div(3).sub(withdrawalFeeAmount)
      );
      expect(
        (await strategy.claimOfReserves(deployer.address)).amount
      ).to.equal(wantBalStart.div(3).sub(withdrawalFeeAmount));
      expect(await vault.balance()).to.eq(
        wantBalStart.sub(wantBalStart.div(3)).add(withdrawalFeeAmount)
      );

      await timeTravelBlocks(ethers.provider, 5000);

      const redeemFee = await strategy.serviceFee();
      const redeemFeeDenom = await strategy.SERVICE_FEE_DIVISOR();
      let pendingPayout = (
        await daiBondDepository.pendingPayoutFor(strategy.address)
      ).add(bondDetails.payout.div(10000)); // Notice will actually go one more block

      let redeemFeeAmount = pendingPayout.mul(redeemFee).div(redeemFeeDenom);

      await strategy.redeemAndStake();

      expect(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.gte(pendingPayout.sub(redeemFeeAmount).mul(999).div(1000));
      expect(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.lte(pendingPayout.sub(redeemFeeAmount).mul(1001).div(1000));

      const vaultBal = await vault.balance();

      await strategy.unstake((await strategy.stakedRebasing()).div(2));

      withdrawalFeeAmount = vaultBal.mul(withdrawalFee).div(withdrawalFeeDenom);

      const reserved = vaultBal
        .sub(withdrawalFeeAmount)
        .add(await strategy.reserves());
      await vault.reserveAll(); // reserve rest of funds

      expect(await vault.balance()).to.eq(withdrawalFeeAmount);

      expect(await strategy.rebaseBonded()).to.eq(
        wantBalStart.sub(await strategy.totalRebasing())
      );
      expect(await strategy.reserves())
        .to.eq(wantBalStart.sub(withdrawalFeeAmount))
        .to.equal(reserved);
      expect((await strategy.claimOfReserves(deployer.address)).amount)
        .to.equal(wantBalStart.sub(withdrawalFeeAmount))
        .to.equal(reserved);

      await timeTravelBlocks(ethers.provider, 5000); // travel the rest of the vesting period
      await stakeManager.rebase();

      await strategy.redeemAndStake(); // final redemption

      await vault.claim();

      expect(await strategy.currentBond()).to.equal(ZERO_ADDR);
      expect(await strategy.reserves()).to.eq(0);
      expect(await strategy.rebaseBonded()).to.eq(0);

      // User should get back less than initial deposit because they redeemed before the bond gains were realized
      expect(await want.balanceOf(deployer.address))
        .to.equal(reserved)
        .to.lt(wantBalStart);

      // Reserves should be 0
      expect(await strategy.reserves())
        .to.equal((await strategy.claimOfReserves(deployer.address)).amount)
        .to.equal(0);

      // Remaining SPA should be staked
      expect(await vault.balance())
        .to.equal(await strategy.stakedRebasing())
        .to.gt(0);
    }
  ).timeout(TEST_TIMEOUT * 2);

  it.skip(
    SLOW_TEST_FLAG +
      "(Neg. and Dai bond) During bonding reserve 1/3, then reserve the rest before bond finishes",
    async function () {
      await minimizeBondPeriod(ethers.provider, daiBondDepository);
      await forceBondNegative(ethers.provider, daiBondDepository, strategy);
      await vault.deposit(wantBalStart); // takes care of the transfer.
      let deployerVaultToken = await vault.balanceOf(deployer.address);

      await strategy.addBond(DAI_BOND);
      await strategy.stakeToBondSingleAll(DAI_BOND, SPA_DAI_ROUTE);
      expect(await strategy.currentBond()).to.eq(DAI_BOND);

      const bondDetails = await daiBondDepository.bondInfo(strategy.address);

      const withdrawalFee = await strategy.withdrawalFee();
      const withdrawalFeeDenom = await strategy.WITHDRAWAL_FEE_DIVISOR();
      let withdrawalFeeAmount = wantBalStart
        .div(3)
        .mul(withdrawalFee)
        .div(withdrawalFeeDenom);

      // Reserve 1/3
      await vault.reserve(deployerVaultToken.div(3));

      expect(await strategy.rebaseBonded()).to.eq(wantBalStart);
      expect(await strategy.totalRebasing()).to.eq(0);
      expect(await strategy.reserves()).to.eq(
        wantBalStart.div(3).sub(withdrawalFeeAmount)
      );
      expect(
        (await strategy.claimOfReserves(deployer.address)).amount
      ).to.equal(wantBalStart.div(3).sub(withdrawalFeeAmount));

      await timeTravelBlocks(ethers.provider, 5000);

      const redeemFee = await strategy.serviceFee();
      const redeemFeeDenom = await strategy.SERVICE_FEE_DIVISOR();
      let pendingPayout = (
        await daiBondDepository.pendingPayoutFor(strategy.address)
      ).add(bondDetails.payout.div(10000)); // Notice will actually go one more block

      let redeemFeeAmount = pendingPayout.mul(redeemFee).div(redeemFeeDenom);

      await strategy.redeemAndStake();

      expect(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.gte(pendingPayout.sub(redeemFeeAmount).mul(999).div(1000));
      expect(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.lte(pendingPayout.sub(redeemFeeAmount).mul(1001).div(1000));

      withdrawalFeeAmount = (await vault.balance())
        .mul(withdrawalFee)
        .div(withdrawalFeeDenom);

      const reserved = (await vault.balance())
        .sub(withdrawalFeeAmount)
        .add(await strategy.reserves());
      await vault.reserveAll(); // reserve rest of funds

      expect(await vault.balance()).to.eq(withdrawalFeeAmount);

      expect(await strategy.rebaseBonded()).to.eq(
        wantBalStart.sub(await strategy.stakedRebasing())
      );
      expect(await strategy.reserves())
        .to.eq(wantBalStart.sub(withdrawalFeeAmount))
        .to.equal(reserved);
      expect((await strategy.claimOfReserves(deployer.address)).amount)
        .to.equal(wantBalStart.sub(withdrawalFeeAmount))
        .to.equal(reserved);

      await timeTravelBlocks(ethers.provider, 5000); // travel the rest of the vesting period
      await stakeManager.rebase();

      pendingPayout = await daiBondDepository.pendingPayoutFor(
        strategy.address
      );
      redeemFeeAmount = pendingPayout.mul(redeemFee).div(redeemFeeDenom);

      const claimAmount = (await strategy.totalRebasing())
        .add(pendingPayout)
        .sub(redeemFeeAmount);

      const deployerClaim = (await strategy.claimOfReserves(deployer.address))
        .amount;
      expect(deployerClaim).to.eq(await strategy.reserves());

      await strategy.redeemAndStake(); // final redemption

      const totalRebasing = await strategy.totalRebasing();
      const reserves = await strategy.reserves();

      await vault.claim();

      expect(await strategy.currentBond()).to.equal(ZERO_ADDR);
      expect(await strategy.reserves()).to.eq(
        deployerClaim.sub(deployerClaim.mul(totalRebasing).div(reserves))
      );
      expect(await strategy.rebaseBonded()).to.eq(0);

      // User should get back less than initial deposit because they redeemed before the bond gains were realized
      expect(await want.balanceOf(deployer.address))
        .to.lte(claimAmount.add(2))
        .to.lt(wantBalStart);
      expect(await want.balanceOf(deployer.address))
        .to.gte(claimAmount.sub(2))
        .to.lt(wantBalStart);

      // Vault balance is 0 because reserves > totalRebasing
      expect(await vault.balance()).to.lte(3);

      // Nearly 0 SPA should be remaining due to division inaccuracy
      expect(await strategy.unstakedRebasing()).to.lt(3);
    }
  ).timeout(TEST_TIMEOUT);

  it(
    SLOW_TEST_FLAG +
      "(Pos. and Dai bond) During bonding reserve 1/3, then reserve the rest after bond finishes",
    async function () {
      await minimizeBondPeriod(ethers.provider, daiBondDepository);
      await forceBondPositive(ethers.provider, daiBondDepository, strategy);
      await vault.deposit(wantBalStart); // takes care of the transfer.
      let deployerVaultToken = await vault.balanceOf(deployer.address);

      await strategy.addBond(DAI_BOND);
      await strategy.stakeToBondSingleAll(DAI_BOND, SPA_DAI_ROUTE);
      expect(await strategy.currentBond()).to.eq(DAI_BOND);

      const bondDetails = await daiBondDepository.bondInfo(strategy.address);

      const withdrawalFee = await strategy.withdrawalFee();
      const withdrawalFeeDenom = await strategy.WITHDRAWAL_FEE_DIVISOR();
      let withdrawalFeeAmount = wantBalStart
        .div(3)
        .mul(withdrawalFee)
        .div(withdrawalFeeDenom);

      // Reserve 1/3
      await vault.reserve(deployerVaultToken.div(3));

      expect(await strategy.rebaseBonded()).to.eq(wantBalStart);
      expect(await strategy.totalRebasing()).to.eq(0);
      expect(await strategy.reserves()).to.eq(
        wantBalStart.div(3).sub(withdrawalFeeAmount)
      );
      expect(
        (await strategy.claimOfReserves(deployer.address)).amount
      ).to.equal(wantBalStart.div(3).sub(withdrawalFeeAmount));

      await timeTravelBlocks(ethers.provider, 5000);

      const redeemFee = await strategy.serviceFee();
      const redeemFeeDenom = await strategy.SERVICE_FEE_DIVISOR();
      let pendingPayout = (
        await daiBondDepository.pendingPayoutFor(strategy.address)
      ).add(bondDetails.payout.div(10000)); // Notice will actually go one more block

      let redeemFeeAmount = pendingPayout.mul(redeemFee).div(redeemFeeDenom);

      await strategy.redeemAndStake();

      expect(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.gte(pendingPayout.sub(redeemFeeAmount).mul(999).div(1000));
      expect(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.lte(pendingPayout.sub(redeemFeeAmount).mul(1001).div(1000));

      const reserved = await strategy.reserves();

      expect(await vault.balance()).to.eq(wantBalStart.sub(reserved));

      expect(await strategy.rebaseBonded()).to.eq(
        wantBalStart.sub(await strategy.stakedRebasing())
      );
      expect((await strategy.claimOfReserves(deployer.address)).amount)
        .to.equal(wantBalStart.div(3).sub(withdrawalFeeAmount))
        .to.equal(reserved);

      await timeTravelBlocks(ethers.provider, 5000); // travel the rest of the vesting period
      await stakeManager.rebase();

      await strategy.redeemAndStake(); // final redemption

      await vault.claim();

      expect(await strategy.currentBond()).to.equal(ZERO_ADDR);
      expect(await strategy.reserves()).to.eq(0);
      expect(await strategy.rebaseBonded()).to.eq(0);

      const vaultBalBefore = await vault.balance();
      withdrawalFeeAmount = vaultBalBefore
        .mul(withdrawalFee)
        .div(withdrawalFeeDenom);
      await vault.reserveAll(); // reserve rest of funds

      // User should get back more than initial deposit because they redeemed before the bond gains were realized
      expect(await want.balanceOf(deployer.address))
        .to.equal(reserved.add(vaultBalBefore).sub(withdrawalFeeAmount))
        .to.gt(wantBalStart);

      // Reserves should be 0
      expect(await strategy.reserves())
        .to.equal((await strategy.claimOfReserves(deployer.address)).amount)
        .to.equal(0);

      // Remaining SPA should be staked
      expect(await vault.balance()).to.equal(await strategy.stakedRebasing());
    }
  ).timeout(TEST_TIMEOUT * 2);

  it.skip(
    SLOW_TEST_FLAG +
      "(Neg. and Dai bond) During bonding reserve 1/3, then reserve the rest after bond finishes",
    async function () {
      await minimizeBondPeriod(ethers.provider, daiBondDepository);
      await forceBondNegative(ethers.provider, daiBondDepository, strategy);
      await vault.deposit(wantBalStart); // takes care of the transfer.
      let deployerVaultToken = await vault.balanceOf(deployer.address);

      await strategy.addBond(DAI_BOND);
      await strategy.stakeToBondSingleAll(DAI_BOND, SPA_DAI_ROUTE);
      expect(await strategy.currentBond()).to.eq(DAI_BOND);

      const bondDetails = await daiBondDepository.bondInfo(strategy.address);

      const withdrawalFee = await strategy.withdrawalFee();
      const withdrawalFeeDenom = await strategy.WITHDRAWAL_FEE_DIVISOR();
      let withdrawalFeeAmount = wantBalStart
        .div(3)
        .mul(withdrawalFee)
        .div(withdrawalFeeDenom);

      // Reserve 1/3
      await vault.reserve(deployerVaultToken.div(3));

      expect(await strategy.rebaseBonded()).to.eq(wantBalStart);
      expect(await strategy.totalRebasing()).to.eq(0);
      expect(await strategy.reserves()).to.eq(
        wantBalStart.div(3).sub(withdrawalFeeAmount)
      );
      expect(
        (await strategy.claimOfReserves(deployer.address)).amount
      ).to.equal(wantBalStart.div(3).sub(withdrawalFeeAmount));

      await timeTravelBlocks(ethers.provider, 5000);

      const redeemFee = await strategy.serviceFee();
      const redeemFeeDenom = await strategy.SERVICE_FEE_DIVISOR();
      let pendingPayout = (
        await daiBondDepository.pendingPayoutFor(strategy.address)
      ).add(bondDetails.payout.div(10000)); // Notice will actually go one more block

      let redeemFeeAmount = pendingPayout.mul(redeemFee).div(redeemFeeDenom);

      await strategy.redeemAndStake();

      expect(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.gte(pendingPayout.sub(redeemFeeAmount).mul(999).div(1000));
      expect(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.lte(pendingPayout.sub(redeemFeeAmount).mul(1001).div(1000));

      const reserved = await strategy.reserves();

      expect(await vault.balance()).to.eq(wantBalStart.sub(reserved));

      expect(await strategy.rebaseBonded()).to.eq(
        wantBalStart.sub(await strategy.stakedRebasing())
      );
      expect((await strategy.claimOfReserves(deployer.address)).amount)
        .to.equal(wantBalStart.div(3).sub(withdrawalFeeAmount))
        .to.equal(reserved);

      await timeTravelBlocks(ethers.provider, 5000); // travel the rest of the vesting period
      await stakeManager.rebase();

      await strategy.redeemAndStake(); // final redemption

      await vault.claim();

      expect(await strategy.currentBond()).to.equal(ZERO_ADDR);
      expect(await strategy.reserves()).to.eq(0);
      expect(await strategy.rebaseBonded()).to.eq(0);

      const vaultBalBefore = await vault.balance();
      withdrawalFeeAmount = vaultBalBefore
        .mul(withdrawalFee)
        .div(withdrawalFeeDenom);
      await vault.reserveAll(); // reserve rest of funds

      // User should get back less than initial deposit because they redeemed after the bond losses were realized
      expect(await want.balanceOf(deployer.address))
        .to.equal(reserved.add(vaultBalBefore).sub(withdrawalFeeAmount))
        .to.lt(wantBalStart);

      // Remaining SPA should be staked
      expect(await vault.balance())
        .to.equal(await strategy.stakedRebasing())
        .to.equal(withdrawalFeeAmount);
    }
  ).timeout(TEST_TIMEOUT * 2);

  it(
    SLOW_TEST_FLAG +
      "(With more than one depositor) SPA received back should be increased as expected after several rebases",
    async function () {
      const whaleInitialBal = await want.balanceOf(whale._address);
      await vault.deposit(wantBalStart); // takes care of the transfer.
      await vault.connect(whale).deposit(wantBalStart);

      for (let i = 0; i < 2; i++) {
        await timeTravelBlocks(ethers.provider, REBASE_PERIOD_BLOCKS);
        await stakeManager.rebase();
      }

      const vaultBalAfterRebase = await vault.balance();

      const withdrawalFee = await strategy.withdrawalFee();
      const withdrawalFeeDenom = await strategy.WITHDRAWAL_FEE_DIVISOR();
      let withdrawalFeeAmount = vaultBalAfterRebase
        .div(2)
        .mul(withdrawalFee)
        .div(withdrawalFeeDenom);

      // Users should get back more than initial deposit
      await vault.reserveAll();

      expect(await want.balanceOf(deployer.address)).to.gt(wantBalStart);
      expect(await want.balanceOf(deployer.address)).to.eq(
        vaultBalAfterRebase.div(2).sub(withdrawalFeeAmount)
      );

      const vaultBalAfterRedeem = await vault.balance();

      withdrawalFeeAmount = vaultBalAfterRedeem
        .mul(withdrawalFee)
        .div(withdrawalFeeDenom);
      const whaleBalBeforeRedeem = await want.balanceOf(whale._address);
      await vault.connect(whale).reserveAll();

      expect(await want.balanceOf(whale._address)).to.gt(whaleInitialBal);
      expect(await want.balanceOf(whale._address)).to.eq(
        whaleBalBeforeRedeem.add(vaultBalAfterRedeem).sub(withdrawalFeeAmount)
      );
    }
  ).timeout(TEST_TIMEOUT * 2);

  it(
    SLOW_TEST_FLAG +
      "(With more than one depositor | +DAI bond) SPA received back should be increased as expected after several bond rebases",
    async function () {
      await adjustBondPeriod(
        ethers.provider,
        REBASE_PERIOD_BLOCKS * 2,
        daiBondDepository
      );
      await forceBondPositive(
        ethers.provider,
        daiBondDepository,
        strategy,
        spaDaiBondCalculator,
        SPA_DAI_PAIR
      );
      const whaleInitialBal = await want.balanceOf(whale._address);
      await vault.deposit(wantBalStart); // takes care of the transfer.
      await vault.connect(whale).deposit(wantBalStart);

      await strategy.addBond(DAI_BOND);
      await strategy.stakeToBondSingleAll(DAI_BOND, SPA_DAI_ROUTE);
      expect(await strategy.currentBond()).to.eq(DAI_BOND);
      expect(await strategy.unstakedRebasing()).to.eq(0);
      expect(await strategy.stakedRebasing()).to.eq(0);
      expect(await strategy.rebaseBonded()).to.eq(wantBalStart.mul(2));

      await timeTravelBlocks(ethers.provider, REBASE_PERIOD_BLOCKS);
      await stakeManager.rebase();

      expect(await strategy.stakedRebasing()).to.eq(0);

      await strategy.redeemAndStake();

      const vaultBalAfterFirstRedeem = await vault.balance();

      expect(await strategy.stakedRebasing())
        .to.gt(0)
        .to.eq(vaultBalAfterFirstRedeem.sub(await strategy.rebaseBonded()));
      expect(await strategy.unstakedRebasing()).to.eq(0);
      expect(await strategy.stakedRebasing()).to.gt(
        await strategy.rebaseBonded()
      );

      await timeTravelBlocks(ethers.provider, REBASE_PERIOD_BLOCKS); // travel the rest of the vesting period
      await stakeManager.rebase();

      const vaultBalAfterRebase = await vault.balance();

      // Expect vault balance to increase after rebase
      expect(vaultBalAfterRebase)
        .to.eq(
          (await strategy.stakedRebasing()).add(await strategy.rebaseBonded())
        )
        .to.gt(vaultBalAfterFirstRedeem);

      await strategy.redeemAndStake(); // final redemption

      const vaultBalFinal = await vault.balance();

      // Realize bond gains after redeem
      expect(vaultBalAfterRebase).to.lt(vaultBalFinal);
      expect(vaultBalFinal).to.eq(await strategy.stakedRebasing());
      expect(await strategy.rebaseBonded()).to.eq(0);

      // Users should get back more than initial deposit
      await vault.reserveAll();

      expect(await strategy.reserves()).to.eq(0);

      const withdrawalFee = await strategy.withdrawalFee();
      const withdrawalFeeDenom = await strategy.WITHDRAWAL_FEE_DIVISOR();
      let withdrawalFeeAmount = vaultBalFinal
        .div(2)
        .mul(withdrawalFee)
        .div(withdrawalFeeDenom);

      const deployerBal = await want.balanceOf(deployer.address);

      expect(deployerBal)
        .to.eq(vaultBalFinal.div(2).sub(withdrawalFeeAmount))
        .to.gt(wantBalStart);

      const deployerGain = deployerBal.sub(wantBalStart);

      const vaultBalBeforeWhaleReserve = await vault.balance();
      withdrawalFeeAmount = vaultBalBeforeWhaleReserve
        .mul(withdrawalFee)
        .div(withdrawalFeeDenom);

      await vault.connect(whale).reserveAll();

      const whaleBal = await want.balanceOf(whale._address);
      const whaleGain = whaleBal.sub(whaleInitialBal);

      expect(await strategy.reserves()).to.eq(0);
      expect(await vault.balance()).to.eq(withdrawalFeeAmount);

      expect(whaleBal).to.be.gt(whaleInitialBal);
      expect(whaleBal).to.eq(
        whaleInitialBal
          .sub(wantBalStart)
          .add(vaultBalBeforeWhaleReserve)
          .sub(withdrawalFeeAmount)
      );

      // Notice those who withdraw later benefit more
      expect(deployerGain).to.lt(whaleGain);
    }
  ).timeout(TEST_TIMEOUT * 2);

  it(
    SLOW_TEST_FLAG +
      "(With more than one depositor | +DAI bond) SPA received back should be increased as expected after several bond rebases, with unstaked",
    async function () {
      await adjustBondPeriod(
        ethers.provider,
        REBASE_PERIOD_BLOCKS * 2,
        daiBondDepository
      );
      await forceBondPositive(
        ethers.provider,
        daiBondDepository,
        strategy,
        spaDaiBondCalculator,
        SPA_DAI_PAIR
      );
      const whaleInitialBal = await want.balanceOf(whale._address);
      await vault.deposit(wantBalStart); // takes care of the transfer.
      await vault.connect(whale).deposit(wantBalStart);

      await strategy.unstake(wantBalStart);

      await strategy.addBond(DAI_BOND);
      await strategy.stakeToBondSingleAll(DAI_BOND, SPA_DAI_ROUTE);
      expect(await strategy.currentBond()).to.eq(DAI_BOND);
      expect(await strategy.unstakedRebasing()).to.eq(0);
      expect(await strategy.stakedRebasing()).to.eq(0);
      expect(await strategy.rebaseBonded()).to.eq(wantBalStart.mul(2));

      await timeTravelBlocks(ethers.provider, REBASE_PERIOD_BLOCKS);
      await stakeManager.rebase();

      expect(await strategy.stakedRebasing()).to.eq(0);

      await strategy.redeemAndStake();

      await strategy.unstake(wantBalStart);

      const vaultBalAfterFirstRedeem = await vault.balance();

      expect(await strategy.totalRebasing())
        .to.gt(0)
        .to.eq(vaultBalAfterFirstRedeem.sub(await strategy.rebaseBonded()));
      expect(await strategy.totalRebasing()).to.gt(
        await strategy.rebaseBonded()
      );

      await timeTravelBlocks(ethers.provider, REBASE_PERIOD_BLOCKS); // travel the rest of the vesting period
      await stakeManager.rebase();

      const vaultBalAfterRebase = await vault.balance();

      // Expect vault balance to increase after rebase
      expect(vaultBalAfterRebase)
        .to.eq(
          (await strategy.totalRebasing()).add(await strategy.rebaseBonded())
        )
        .to.gt(vaultBalAfterFirstRedeem);

      await strategy.redeemAndStake(); // final redemption

      expect(await vault.balance()).to.eq(await strategy.stakedRebasing());

      await strategy.unstake(wantBalStart);

      const vaultBalFinal = await vault.balance();

      // Realize bond gains after redeem
      expect(vaultBalAfterRebase).to.lt(vaultBalFinal);
      expect(vaultBalFinal).to.eq(
        (await strategy.stakedRebasing()).add(wantBalStart)
      );
      expect(await strategy.rebaseBonded()).to.eq(0);

      // Users should get back more than initial deposit
      await vault.reserveAll();

      await strategy.unstake(wantBalStart.div(2));

      expect(await strategy.reserves()).to.eq(0);

      const withdrawalFee = await strategy.withdrawalFee();
      const withdrawalFeeDenom = await strategy.WITHDRAWAL_FEE_DIVISOR();
      let withdrawalFeeAmount = vaultBalFinal
        .div(2)
        .mul(withdrawalFee)
        .div(withdrawalFeeDenom);

      const deployerBal = await want.balanceOf(deployer.address);

      expect(deployerBal)
        .to.eq(vaultBalFinal.div(2).sub(withdrawalFeeAmount))
        .to.gt(wantBalStart);

      const deployerGain = deployerBal.sub(wantBalStart);

      const vaultBalBeforeWhaleReserve = await vault.balance();
      withdrawalFeeAmount = vaultBalBeforeWhaleReserve
        .mul(withdrawalFee)
        .div(withdrawalFeeDenom);

      await vault.connect(whale).reserveAll();

      const whaleBal = await want.balanceOf(whale._address);
      const whaleGain = whaleBal.sub(whaleInitialBal);

      expect(await strategy.reserves()).to.eq(0);
      expect(await vault.balance()).to.eq(withdrawalFeeAmount);

      expect(whaleBal).to.be.gt(whaleInitialBal);
      expect(whaleBal).to.eq(
        whaleInitialBal
          .sub(wantBalStart)
          .add(vaultBalBeforeWhaleReserve)
          .sub(withdrawalFeeAmount)
      );

      // Notice those who withdraw later benefit more
      expect(deployerGain).to.lt(whaleGain);
    }
  ).timeout(TEST_TIMEOUT * 3);
});
