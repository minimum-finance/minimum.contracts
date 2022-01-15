const { expect } = require("chai");
const {
  beforeHook,
  beforeEachHook,
  timeTravelBlocks,
  swapNativeForToken,
  forceBondPositive,
} = require("../../../utils/testUtils.ts");
const { addressBook } = require("blockchain-addressbook");
const {
  SPA,
  SPA_STAKER,
  STAKED_SPA,
  SPA_STAKE_MANAGER,
  BOGUS_ADDR_1,
  BOGUS_ADDR_2,
  WFTM,
  DAI,
} = require("../../../constants.js");
const {
  DAI_BOND,
  SPA_DAI_ROUTE,
  TEST_TIMEOUT,
  SLOW_TEST_FLAG,
} = require("../../../constants");
const { ethers } = require("hardhat");

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

describe("Spartacus Strategy Control Functions", function () {
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
    daiWftmPair,
    rebaseTokenBalStart,
    daiValueInitial,
    unirouterData,
    dai;

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
      spaDaiBondDepository,
      daiWftmPair,
      stakeManager,
      dai,
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
    }));
  });

  it("Can pause so that users can only withdraw and then unpause", async function () {
    // Users can deposit before pausing
    await vault.deposit(rebaseTokenBalStart);
    const vaultBal = await vault.balanceOf(deployer.address);

    expect(vaultBal.div(10 ** 9)).to.equal(rebaseTokenBalStart);

    expect(await stakedSpa.balanceOf(strategy.address))
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

    expect(await spa.balanceOf(deployer.address))
      .to.equal(rebaseTokenBalStart.sub(await strategy.totalBalance()))
      .to.equal(rebaseTokenBalStart.sub(await vault.balance()))
      .to.equal(rebaseTokenBalStart.div(2).sub(withdrawalFeeAmount));

    expect(rebaseTokenBalStart).to.equal(
      (await strategy.stakedRebasing()).add(
        await spa.balanceOf(deployer.address)
      )
    );

    expect(
      rebaseTokenBalStart
        .sub(rebaseTokenBalStart.div(2))
        .add(withdrawalFeeAmount)
    )
      .to.equal(await stakedSpa.balanceOf(strategy.address))
      .to.equal(await strategy.totalBalance())
      .to.equal(await strategy.stakedRebasing())
      .to.equal(await vault.balance());

    withdrawalFeeAmount = (await strategy.stakedRebasing())
      .mul(withdrawalFee)
      .div(withdrawalFeeDenom);

    // Now pause the strategy, users can withdraw but not deposit
    await strategy.pause();
    await vault.reserveAll();

    expect(await spa.balanceOf(deployer.address)).to.equal(
      rebaseTokenBalStart.sub(withdrawalFeeAmount)
    );

    await expect(
      vault.deposit(await spa.balanceOf(deployer.address))
    ).to.be.revertedWith("Pausable: paused");

    await expect(vault.depositAll()).to.be.revertedWith("Pausable: paused");

    await strategy.unpause();

    // Can deposit after unpausing
    vault.depositAll();

    expect(await vault.balance())
      .to.equal(rebaseTokenBalStart)
      .to.equal(await strategy.totalBalance())
      .to.equal(await strategy.stakedRebasing())
      .to.equal(await stakedSpa.balanceOf(strategy.address));

    // Can withdraw after unpausing

    await vault.reserveAll();

    expect(await spa.balanceOf(deployer.address)).to.equal(
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
      await forceBondPositive(ethers.provider, daiBondDepository, strategy);
      await vault.depositAll();
      await strategy.addBond(DAI_BOND);
      await strategy.stakeToBondSingleAll(DAI_BOND, SPA_DAI_ROUTE);

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
      const stratSpaRedeemed = await strategy.stakedRebasing();
      const availablePayout = await daiBondDepository.pendingPayoutFor(
        strategy.address
      );

      await strategy.panic();

      expect(await strategy.stakedRebasing())
        .to.equal(0)
        .to.equal(await stakedSpa.balanceOf(strategy.address));
      expect(await strategy.unstakedRebasing())
        .to.equal(stratSpaRedeemed.add(availablePayout))
        .to.equal(await spa.balanceOf(strategy.address));

      const stratSpa = await strategy.unstakedRebasing();

      // totalBalance should equal strat spa + spa bonded at the beginning - spa redeemed
      expect(await strategy.totalBalance()).to.equal(
        stratSpa.add(rebaseTokenBalStart).sub(stratSpaRedeemed)
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
        rebaseTokenBalStart.sub(rebaseTokenBalStart.div(2)),
        rebaseTokenBalStart.div(2),
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
      .to.equal(await stakedSpa.balanceOf(strategy.address));

    expect(await strategy.paused()).to.be.false;

    await strategy.panic();

    expect(await strategy.paused()).to.be.true;
    expect(await vault.balance())
      .to.equal(await strategy.unstakedRebasing())
      .to.equal(await strategy.totalBalance())
      .to.equal(await spa.balanceOf(strategy.address));
  }).timeout(TEST_TIMEOUT);

  it("Panic is idempotent", async function () {
    await vault.depositAll();

    expect(await vault.balance())
      .to.equal(await strategy.stakedRebasing())
      .to.equal(rebaseTokenBalStart)
      .to.equal(await stakedSpa.balanceOf(strategy.address));

    expect(await strategy.paused()).to.be.false;

    await strategy.panic();

    expect(await strategy.paused()).to.be.true;
    expect(await vault.balance())
      .to.equal(await strategy.unstakedRebasing())
      .to.equal(await strategy.totalBalance())
      .to.equal(await spa.balanceOf(strategy.address));

    await strategy.panic();

    expect(await strategy.paused()).to.be.true;
    expect(await vault.balance())
      .to.equal(await strategy.unstakedRebasing())
      .to.equal(await strategy.totalBalance())
      .to.equal(await spa.balanceOf(strategy.address));
  }).timeout(TEST_TIMEOUT);

  it("Only Manager can panic", async function () {
    await expect(strategy.connect(keeper).panic()).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );
    strategy.panic();
  }).timeout(TEST_TIMEOUT);

  it("Manager can force unstake and stake", async function () {
    await vault.depositAll();

    expect(await stakedSpa.balanceOf(strategy.address))
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

    expect(await stakedSpa.balanceOf(strategy.address))
      .to.equal(await vault.balance())
      .to.equal(await strategy.stakedRebasing())
      .to.equal(rebaseTokenBalStart);

    // Expect stake to be idempotent
    await strategy.stake();

    expect(await stakedSpa.balanceOf(strategy.address))
      .to.equal(await vault.balance())
      .to.equal(await strategy.stakedRebasing())
      .to.equal(rebaseTokenBalStart);
  }).timeout(TEST_TIMEOUT);

  it("Manager can unstake a portion of funds", async function () {
    await vault.depositAll();

    expect(await stakedSpa.balanceOf(strategy.address))
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
    await expect(strategy.inCaseTokensGetStuck(SPA)).to.be.revertedWith(
      "!token"
    );
    await expect(strategy.inCaseTokensGetStuck(STAKED_SPA)).to.be.revertedWith(
      "!token"
    );

    await strategy.inCaseTokensGetStuck(DAI);

    expect(await dai.balanceOf(strategy.address)).to.equal(0);
    expect(await dai.balanceOf(deployer.address)).to.equal(daiBal);
  }).timeout(TEST_TIMEOUT);
});
