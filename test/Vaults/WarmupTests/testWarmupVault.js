const { expect } = require("chai");
const { ethers } = require("hardhat");
const { addressBook } = require("blockchain-addressbook");
const {
  swapNativeForToken,
  beforeEachHook,
  beforeHook,
  forceHighMaxDebt,
} = require("../../../utils/testUtils.ts");
const {
  TEST_TIMEOUT,
  BOGUS_ADDR_1,
  BOGUS_ADDR_2,
  FHM_STAKER,
  FHM_STAKE_MANAGER,
  FHM,
  STAKED_FHM,
  WFTM,
  DAI,
  FHM_DAI_ROUTE,
  FHM_WHALES,
  FHM_TREASURY,
  FHM_DAI_BOND,
  VAULT_TEST_FLAG,
  FHM_WFTM_BOND,
  FHM_DAI_LP_BOND,
  FHM_BOND_CALCULATOR,
  WARMUP_TEST_FLAG,
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

describe(WARMUP_TEST_FLAG + VAULT_TEST_FLAG + " General", function () {
  let vault,
    strategy,
    unirouter,
    unirouterData,
    want,
    stakedWant,
    wantBalStart,
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
    fhmTreasury,
    dai;

  this.slow(20000);

  before(async () => {
    ({
      unirouter,
      rebaseToken: want,
      stakedRebaseToken: stakedWant,
      dai,
      unirouterData,
      whale,
      daiBondDepository,
      stakeManager,
      wftmBondDepository,
      daiLPBondDepository: fhmDaiBondDepository,
      lpBondCalculator,
      fhmTreasury,
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
      warmup: 3,
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

  it("Can withdraw a fraction of position while staking", async function () {
    await forceHighMaxDebt(ethers.provider, daiBondDepository);
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

    await strategy.addBond(FHM_DAI_BOND);
    await strategy.stakeToBondSingle(wantBalStart, FHM_DAI_BOND, FHM_DAI_ROUTE);

    expect(await strategy.currentBond()).to.eq(FHM_DAI_BOND);

    // Ensure we still have half the IOU tokens from our initial deposit
    expect(await vault.balanceOf(deployer.address)).to.equal(
      deployerVaultToken.div(2)
    );
  }).timeout(TEST_TIMEOUT);

  it("Multiple person withdraw from staking", async function () {
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
      wantBalStart.sub(withdrawalFeeAmountWhale)
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
      wantBalStart.sub(withdrawalFeeAmountWhale)
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
      wantBalStart.sub(withdrawalFeeAmountWhale)
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
});
