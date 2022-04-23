const { expect } = require("chai");
const { ethers } = require("hardhat");
const { addressBook } = require("blockchain-addressbook");
const {
  beforeEachHook,
  beforeHook,
  minimizeBondPeriod,
  timeTravelBlocks,
  forceFHMBondNegative,
  adjustBondPeriod,
  truncateToFixed,
  forceHighMaxDebt,
  forceFHMBondPositive,
} = require("../../utils/testUtils.ts");
const {
  TEST_TIMEOUT,
  BOGUS_ADDR_1,
  BOGUS_ADDR_2,
  FHM_STAKER,
  FHM_STAKE_MANAGER,
  FHM,
  STAKED_FHM,
  FHM_DAI_ROUTE,
  SLOW_TEST_FLAG,
  REBASE_PERIOD_BLOCKS,
  ZERO_ADDR,
  FHM_WHALES,
  FHM_TREASURY,
  FHM_DAI_BOND,
  VAULT_TEST_FLAG,
  FHM_WFTM_BOND,
  FHM_DAI_LP_BOND,
  FHM_BOND_CALCULATOR,
  FHM_CIRCULATING_SUPPLY,
} = require("../../constants.js");

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

describe(VAULT_TEST_FLAG + " Lifecycle", function () {
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
    dai,
    circulatingSupply;

  this.slow(20000);

  beforeEach(async () => {
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
      circulatingSupplyAddr: FHM_CIRCULATING_SUPPLY,
    }));
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

    await forceHighMaxDebt(ethers.provider, daiBondDepository);
    await forceHighMaxDebt(ethers.provider, wftmBondDepository);
    await forceHighMaxDebt(ethers.provider, fhmDaiBondDepository);

    await forceFHMBondPositive(
      ethers.provider,
      daiBondDepository,
      circulatingSupply
    );
    await forceFHMBondPositive(
      ethers.provider,
      wftmBondDepository,
      circulatingSupply,
      (isNonStable = true)
    );
    await forceFHMBondPositive(
      ethers.provider,
      fhmDaiBondDepository,
      circulatingSupply
    );
  });

  it.skip(
    SLOW_TEST_FLAG +
      "Two users deposit and then (negative) bond, one reserves during bond",
    async function () {
      await minimizeBondPeriod(ethers.provider, daiBondDepository);
      // Notice: Forces 10% bond premium
      await forceFHMBondNegative(ethers.provider, daiBondDepository, strategy);

      await vault.depositAll();
      await vault.connect(whale).deposit(wantBalStart);

      // Twice wantBalStart is in vault
      expect(await vault.balance())
        .to.equal(await strategy.stakedRebasing())
        .to.equal(wantBalStart.mul(2));

      const bondPrice = await daiBondDepository.bondPriceInUSD();
      const parsedBondPrice = parseFloat(ethers.utils.formatEther(bondPrice));
      const rebaseTokenPrice = await strategy.rebaseTokenPriceInUSD(1e9);
      const parsedTokenPrice = parseFloat(
        ethers.utils.formatEther(rebaseTokenPrice)
      );

      const parsedRatio = truncateToFixed(
        (parsedTokenPrice / parsedBondPrice) * 1e9,
        0
      );
      const bondDiscountMultiplier = ethers.utils.parseUnits(
        parsedRatio + "",
        9
      );

      await strategy.addBond(FHM_DAI_BOND);
      await strategy.stakeToBondSingleAll(FHM_DAI_BOND, FHM_DAI_ROUTE);
      expect(await strategy.currentBond()).to.equal(FHM_DAI_BOND);
      expect(await vault.balance())
        .to.lte(
          wantBalStart
            .mul(2)
            .mul(bondDiscountMultiplier)
            .mul(101)
            .div(100)
            .div(1e9)
            .div(1e9)
        )
        .to.eq(await strategy.rebaseBonded());
      expect(await vault.balance()).to.gte(
        wantBalStart
          .mul(2)
          .mul(bondDiscountMultiplier)
          .mul(99)
          .div(100)
          .div(1e9)
          .div(1e9)
      );

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
        .to.lt(wantBalStart.add(withdrawalFeeAmount))
        .to.equal(await vault.balance());

      // Funds are not paid out immediately, but reserved
      expect(await want.balanceOf(deployer.address)).to.equal(0);
      expect(await strategy.reserves())
        .to.equal((await strategy.claimOfReserves(deployer.address)).amount)
        .to.lte(
          wantBalStart
            .sub(withdrawalFeeAmount)
            .mul(bondDiscountMultiplier)
            .mul(101)
            .div(100)
            .div(1e9)
            .div(1e9)
        )
        .to.gte(
          wantBalStart
            .sub(withdrawalFeeAmount)
            .mul(bondDiscountMultiplier)
            .mul(99)
            .div(100)
            .div(1e9)
            .div(1e9)
        );

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
        .to.equal((await strategy.claimOfReserves(deployer.address)).amount)
        .to.lte(
          wantBalStart
            .sub(withdrawalFeeAmount)
            .mul(bondDiscountMultiplier)
            .mul(101)
            .div(100)
            .div(1e9)
            .div(1e9)
        )
        .to.gte(
          wantBalStart
            .sub(withdrawalFeeAmount)
            .mul(bondDiscountMultiplier)
            .mul(99)
            .div(100)
            .div(1e9)
            .div(1e9)
        );

      await strategy.redeemAndStake();

      await vault.claim();

      // User 1 is paid out and reserves are set to 0
      expect(await want.balanceOf(deployer.address))
        .to.lte(
          wantBalStart
            .sub(withdrawalFeeAmount)
            .mul(bondDiscountMultiplier)
            .mul(101)
            .div(100)
            .div(1e9)
            .div(1e9)
        )
        .to.gte(
          wantBalStart
            .sub(withdrawalFeeAmount)
            .mul(bondDiscountMultiplier)
            .mul(99)
            .div(100)
            .div(1e9)
            .div(1e9)
        );

      expect(await strategy.reserves())
        .to.equal((await strategy.claimOfReserves(deployer.address)).amount)
        .to.equal(0);

      const estimatedVaultBal = wantBalStart
        .mul(bondDiscountMultiplier)
        .add(withdrawalFeeAmount)
        .div(1e9)
        .div(1e9);

      // Vault realizes losses and gains the withdrawal fee (notice inaccuracy due to slippage)
      expect(await vault.balance()).to.lte(estimatedVaultBal.mul(101).div(100));
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
      await forceFHMBondNegative(ethers.provider, daiBondDepository, strategy);

      await vault.depositAll();
      await vault.connect(whale).deposit(wantBalStart);

      // Twice wantBalStart is in vault
      expect(await vault.balance())
        .to.equal(await strategy.stakedRebasing())
        .to.equal(wantBalStart.mul(2));

      await strategy.unstakeAll();

      await strategy.addBond(FHM_DAI_BOND);
      await strategy.stakeToBondSingleAll(FHM_DAI_BOND, FHM_DAI_ROUTE);
      expect(await strategy.currentBond()).to.equal(FHM_DAI_BOND);
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
        .to.equal((await strategy.claimOfReserves(deployer.address)).amount)
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
        .to.equal((await strategy.claimOfReserves(deployer.address)).amount)
        .to.equal(wantBalStart.sub(withdrawalFeeAmount));

      const redeemFee = await strategy.serviceFee();
      const redeemFeeDenom = await strategy.SERVICE_FEE_DIVISOR();
      const redeemFeeAmount = bondPendingPayout
        .mul(redeemFee)
        .div(redeemFeeDenom);

      await strategy.redeemAndStake();
      await strategy.unstake(wantBalStart);

      // User 1 is paid out and reserves are set to 0
      expect((await strategy.claimOfReserves(deployer.address)).amount).to.eq(
        wantBalStart.sub(withdrawalFeeAmount)
      );
      expect(await strategy.reserves()).to.gt(0);

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

  it(
    SLOW_TEST_FLAG +
      "(Pos. and Dai bond) During bonding reserve 1/3, then reserve the rest before bond finishes",
    async function () {
      await minimizeBondPeriod(ethers.provider, daiBondDepository);
      await vault.deposit(wantBalStart); // takes care of the transfer.
      let deployerVaultToken = await vault.balanceOf(deployer.address);

      await strategy.addBond(FHM_DAI_BOND);
      await strategy.stakeToBondSingleAll(FHM_DAI_BOND, FHM_DAI_ROUTE);
      expect(await strategy.currentBond()).to.eq(FHM_DAI_BOND);

      const bondDetails = await daiBondDepository.bondInfo(strategy.address);

      const withdrawalFee = await strategy.withdrawalFee();
      const withdrawalFeeDenom = await strategy.WITHDRAWAL_FEE_DIVISOR();

      const vaultBal = await vault.balance();
      let withdrawalFeeAmount = vaultBal
        .div(3)
        .mul(withdrawalFee)
        .div(withdrawalFeeDenom);
      const firstWithdrawal = vaultBal.div(3).sub(withdrawalFeeAmount);

      // Reserve 1/3
      await vault.reserve(deployerVaultToken.div(3));

      expect(await strategy.rebaseBonded()).to.gt(wantBalStart);
      expect(await strategy.totalRebasing()).to.eq(0);
      expect(await strategy.reserves())
        .to.eq((await strategy.claimOfReserves(deployer.address)).amount)
        .to.lte(vaultBal.div(3).sub(withdrawalFeeAmount).add(1));
      expect(await strategy.reserves())
        .to.eq((await strategy.claimOfReserves(deployer.address)).amount)
        .to.gte(vaultBal.div(3).sub(withdrawalFeeAmount).sub(1));

      await timeTravelBlocks(ethers.provider, 5000);

      let pendingPayout = (
        await daiBondDepository.pendingPayoutFor(strategy.address)
      ).add(bondDetails.payout.div(10000)); // Notice will actually go one more block

      await expect(strategy.redeemAndStake()).to.emit(strategy, "Redeem");

      expect(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.gte(pendingPayout.mul(999).div(1000));
      expect(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.lte(pendingPayout.mul(1001).div(1000));

      const secondWithdrawalAmount = await vault.balance();
      withdrawalFeeAmount = secondWithdrawalAmount
        .mul(withdrawalFee)
        .div(withdrawalFeeDenom);

      const reserved = (await vault.balance())
        .sub(withdrawalFeeAmount)
        .add(await strategy.reserves());
      await vault.reserveAll(); // reserve rest of funds

      expect(await vault.balance()).to.eq(withdrawalFeeAmount);

      expect(await strategy.rebaseBonded()).to.eq(
        vaultBal.sub(await strategy.stakedRebasing())
      );
      expect(await strategy.reserves()).to.lte(
        firstWithdrawal
          .add(secondWithdrawalAmount)
          .sub(withdrawalFeeAmount)
          .add(1)
      );
      expect(await strategy.reserves()).to.lte(reserved.add(1));
      expect(await strategy.reserves()).to.gte(
        firstWithdrawal
          .add(secondWithdrawalAmount)
          .sub(withdrawalFeeAmount)
          .sub(1)
      );
      expect(await strategy.reserves()).to.gte(reserved.sub(1));
      expect((await strategy.claimOfReserves(deployer.address)).amount)
        .to.lte(
          firstWithdrawal
            .add(secondWithdrawalAmount)
            .sub(withdrawalFeeAmount)
            .add(1)
        )
        .to.lte(reserved.add(1));
      expect((await strategy.claimOfReserves(deployer.address)).amount)
        .to.gte(
          firstWithdrawal
            .add(secondWithdrawalAmount)
            .sub(withdrawalFeeAmount)
            .sub(1)
        )
        .to.gte(reserved.sub(1));

      await timeTravelBlocks(ethers.provider, 5000); // travel the rest of the vesting period
      await stakeManager.rebase();

      await expect(strategy.redeemAndStake()).to.emit(strategy, "RedeemFinal"); // final redemption

      await vault.claim();

      expect(await strategy.currentBond()).to.equal(ZERO_ADDR);
      expect(await strategy.reserves()).to.eq(0);
      expect(await strategy.rebaseBonded()).to.eq(0);

      // User should get back less than initial deposit because they redeemed before the bond gains were realized
      expect(await want.balanceOf(deployer.address))
        .to.equal(reserved)
        .to.gt(wantBalStart);

      // Reserves should be 0
      expect(await strategy.reserves())
        .to.equal((await strategy.claimOfReserves(deployer.address)).amount)
        .to.equal(0);

      // Remaining FHM should be staked
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
      await vault.deposit(wantBalStart); // takes care of the transfer.
      let deployerVaultToken = await vault.balanceOf(deployer.address);

      await strategy.unstake(wantBalStart.div(2));

      const totalBal = await strategy.totalBalance();
      const serviceFee = await strategy.serviceFee();
      const serviceFeeDenom = await strategy.SERVICE_FEE_DIVISOR();
      const serviceFeeAmount = totalBal.mul(serviceFee).div(serviceFeeDenom);

      await strategy.addBond(FHM_DAI_BOND);
      await expect(strategy.stakeToBondSingleAll(FHM_DAI_BOND, FHM_DAI_ROUTE))
        .to.emit(strategy, "ChargeFees")
        .withArgs(serviceFeeAmount);
      expect(await strategy.currentBond()).to.eq(FHM_DAI_BOND);

      const bondDetails = await daiBondDepository.bondInfo(strategy.address);

      const withdrawalFee = await strategy.withdrawalFee();
      const withdrawalFeeDenom = await strategy.WITHDRAWAL_FEE_DIVISOR();
      let withdrawalFeeAmount = bondDetails.payout
        .div(3)
        .mul(withdrawalFee)
        .div(withdrawalFeeDenom);

      const vaultBalInitial = await vault.balance();

      // Reserve 1/3
      await vault.reserve(deployerVaultToken.div(3));
      const initialRebaseBonded = await strategy.rebaseBonded();

      const firstClaimAmount = bondDetails.payout
        .div(3)
        .sub(withdrawalFeeAmount);

      expect(initialRebaseBonded).to.gt(wantBalStart);
      expect(await strategy.totalRebasing()).to.eq(0);
      expect(await strategy.reserves()).to.eq(firstClaimAmount);
      expect(
        (await strategy.claimOfReserves(deployer.address)).amount
      ).to.equal(firstClaimAmount);
      expect(await vault.balance()).to.eq(
        bondDetails.payout.sub(firstClaimAmount)
      );

      await timeTravelBlocks(ethers.provider, 5000);

      let pendingPayout = (
        await daiBondDepository.pendingPayoutFor(strategy.address)
      ).add(bondDetails.payout.div(10000)); // Notice will actually go one more block

      await strategy.redeemAndStake();

      expect(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.gte(pendingPayout.mul(999).div(1000));
      expect(await strategy.totalRebasing()).to.lte(
        pendingPayout.mul(1001).div(1000)
      );

      const vaultBal = await vault.balance();

      await strategy.unstake((await strategy.stakedRebasing()).div(2));

      withdrawalFeeAmount = vaultBal.mul(withdrawalFee).div(withdrawalFeeDenom);

      const reserved = vaultBal
        .sub(withdrawalFeeAmount)
        .add(await strategy.reserves());
      await vault.reserveAll(); // reserve rest of funds

      expect(await vault.balance()).to.eq(withdrawalFeeAmount);

      expect(await strategy.rebaseBonded()).to.gt(
        wantBalStart.sub(await strategy.totalRebasing())
      );
      expect(await strategy.rebaseBonded()).to.lt(initialRebaseBonded);
      expect(await strategy.reserves())
        .to.eq(vaultBalInitial.sub(withdrawalFeeAmount))
        .to.eq(reserved)
        .to.eq((await strategy.claimOfReserves(deployer.address)).amount);

      await timeTravelBlocks(ethers.provider, 5000); // travel the rest of the vesting period
      await stakeManager.rebase();

      await strategy.unstakeAll();

      await strategy.redeemAndStake(); // final redemption

      await vault.claim();

      expect(await strategy.currentBond()).to.equal(ZERO_ADDR);
      expect(await strategy.reserves()).to.eq(0);
      expect(await strategy.rebaseBonded()).to.eq(0);

      // User should get back more than initial deposit because they reserved after the bond gains were realized
      expect(await want.balanceOf(deployer.address))
        .to.equal(reserved)
        .to.gt(wantBalStart);

      // Reserves should be 0
      expect(await strategy.reserves())
        .to.equal((await strategy.claimOfReserves(deployer.address)).amount)
        .to.equal(0);

      // Remaining FHM should be staked
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
      await vault.deposit(wantBalStart); // takes care of the transfer.
      let deployerVaultToken = await vault.balanceOf(deployer.address);

      await strategy.unstake(wantBalStart.div(2));

      await strategy.addBond(FHM_DAI_BOND);
      await strategy.stakeToBondSingleAll(FHM_DAI_BOND, FHM_DAI_ROUTE);
      expect(await strategy.currentBond()).to.eq(FHM_DAI_BOND);

      const bondDetails = await daiBondDepository.bondInfo(strategy.address);

      const withdrawalFee = await strategy.withdrawalFee();
      const withdrawalFeeDenom = await strategy.WITHDRAWAL_FEE_DIVISOR();

      let vaultBal = await vault.balance();
      let withdrawalFeeAmount = vaultBal
        .div(3)
        .mul(withdrawalFee)
        .div(withdrawalFeeDenom);
      const vaultBalInitial = vaultBal;

      // Reserve 1/3
      await vault.reserve(deployerVaultToken.div(3));

      expect(await strategy.rebaseBonded()).to.gt(wantBalStart);
      expect(await strategy.totalRebasing()).to.eq(0);
      expect(await strategy.reserves()).to.eq(
        vaultBal.div(3).sub(withdrawalFeeAmount)
      );
      expect(
        (await strategy.claimOfReserves(deployer.address)).amount
      ).to.equal(vaultBal.div(3).sub(withdrawalFeeAmount));
      expect(await vault.balance()).to.eq(
        vaultBal.sub(vaultBal.div(3)).add(withdrawalFeeAmount)
      );

      await timeTravelBlocks(ethers.provider, 5000);

      let pendingPayout = (
        await daiBondDepository.pendingPayoutFor(strategy.address)
      ).add(bondDetails.payout.div(10000)); // Notice will actually go one more block

      await strategy.redeemAndStake();

      expect(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.gte(pendingPayout.mul(999).div(1000));
      expect(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.lte(pendingPayout.mul(1001).div(1000));

      vaultBal = await vault.balance();

      await strategy.unstake((await strategy.stakedRebasing()).div(2));

      withdrawalFeeAmount = vaultBal.mul(withdrawalFee).div(withdrawalFeeDenom);

      const reserved = vaultBal
        .sub(withdrawalFeeAmount)
        .add(await strategy.reserves());
      await vault.reserveAll(); // reserve rest of funds

      expect(await vault.balance()).to.eq(withdrawalFeeAmount);

      expect(await strategy.rebaseBonded()).to.eq(
        vaultBalInitial.sub(await strategy.totalRebasing())
      );
      expect(await strategy.reserves())
        .to.eq(vaultBalInitial.sub(withdrawalFeeAmount))
        .to.equal(reserved);
      expect((await strategy.claimOfReserves(deployer.address)).amount)
        .to.equal(vaultBalInitial.sub(withdrawalFeeAmount))
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
        .to.gt(wantBalStart);

      // Reserves should be 0
      expect(await strategy.reserves())
        .to.equal((await strategy.claimOfReserves(deployer.address)).amount)
        .to.equal(0);

      // Remaining FHM should be staked
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
      await forceFHMBondNegative(ethers.provider, daiBondDepository, strategy);
      await vault.deposit(wantBalStart); // takes care of the transfer.
      let deployerVaultToken = await vault.balanceOf(deployer.address);

      await strategy.addBond(FHM_DAI_BOND);
      await strategy.stakeToBondSingleAll(FHM_DAI_BOND, FHM_DAI_ROUTE);
      expect(await strategy.currentBond()).to.eq(FHM_DAI_BOND);

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

      // Nearly 0 FHM should be remaining due to division inaccuracy
      expect(await strategy.unstakedRebasing()).to.lt(3);
    }
  ).timeout(TEST_TIMEOUT);

  it(
    SLOW_TEST_FLAG +
      "(Pos. and Dai bond) During bonding reserve 1/3, then reserve the rest after bond finishes",
    async function () {
      await minimizeBondPeriod(ethers.provider, daiBondDepository);
      await vault.deposit(wantBalStart); // takes care of the transfer.
      let deployerVaultToken = await vault.balanceOf(deployer.address);

      await strategy.addBond(FHM_DAI_BOND);
      await strategy.stakeToBondSingleAll(FHM_DAI_BOND, FHM_DAI_ROUTE);
      expect(await strategy.currentBond()).to.eq(FHM_DAI_BOND);

      const bondDetails = await daiBondDepository.bondInfo(strategy.address);

      const withdrawalFee = await strategy.withdrawalFee();
      const withdrawalFeeDenom = await strategy.WITHDRAWAL_FEE_DIVISOR();

      const vaultBalInitial = await vault.balance();
      let withdrawalFeeAmount = vaultBalInitial
        .div(3)
        .mul(withdrawalFee)
        .div(withdrawalFeeDenom);

      // Reserve 1/3
      await vault.reserve(deployerVaultToken.div(3));

      expect(await strategy.rebaseBonded()).to.gt(wantBalStart);
      expect(await strategy.totalRebasing()).to.eq(0);
      expect(await strategy.reserves())
        .to.eq((await strategy.claimOfReserves(deployer.address)).amount)
        .to.lte(vaultBalInitial.div(3).sub(withdrawalFeeAmount).add(1));
      expect(await strategy.reserves())
        .to.eq((await strategy.claimOfReserves(deployer.address)).amount)
        .to.gte(vaultBalInitial.div(3).sub(withdrawalFeeAmount).sub(1));
      await timeTravelBlocks(ethers.provider, 5000);

      let pendingPayout = (
        await daiBondDepository.pendingPayoutFor(strategy.address)
      ).add(bondDetails.payout.div(10000)); // Notice will actually go one more block

      await strategy.redeemAndStake();

      expect(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.gte(pendingPayout.mul(999).div(1000));
      expect(await strategy.totalRebasing())
        .to.equal(await strategy.stakedRebasing())
        .to.lte(pendingPayout.mul(1001).div(1000));

      const reserved = await strategy.reserves();

      expect(await vault.balance()).to.eq(vaultBalInitial.sub(reserved));

      expect(await strategy.rebaseBonded()).to.eq(
        vaultBalInitial.sub(await strategy.stakedRebasing())
      );
      expect((await strategy.claimOfReserves(deployer.address)).amount)
        .to.lte(vaultBalInitial.div(3).sub(withdrawalFeeAmount).add(1))
        .to.lte(reserved.add(1));
      expect((await strategy.claimOfReserves(deployer.address)).amount)
        .to.gte(vaultBalInitial.div(3).sub(withdrawalFeeAmount).sub(1))
        .to.gte(reserved.sub(1));

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

      // Remaining FHM should be staked
      expect(await vault.balance()).to.equal(await strategy.stakedRebasing());
    }
  ).timeout(TEST_TIMEOUT * 2);

  it.skip(
    SLOW_TEST_FLAG +
      "(Neg. and Dai bond) During bonding reserve 1/3, then reserve the rest after bond finishes",
    async function () {
      await minimizeBondPeriod(ethers.provider, daiBondDepository);
      await forceFHMBondNegative(ethers.provider, daiBondDepository, strategy);
      await vault.deposit(wantBalStart); // takes care of the transfer.
      let deployerVaultToken = await vault.balanceOf(deployer.address);

      await strategy.addBond(FHM_DAI_BOND);
      await strategy.stakeToBondSingleAll(FHM_DAI_BOND, FHM_DAI_ROUTE);
      expect(await strategy.currentBond()).to.eq(FHM_DAI_BOND);

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

      // Remaining FHM should be staked
      expect(await vault.balance())
        .to.equal(await strategy.stakedRebasing())
        .to.equal(withdrawalFeeAmount);
    }
  ).timeout(TEST_TIMEOUT * 2);

  it(
    SLOW_TEST_FLAG +
      "(With more than one depositor) FHM received back should be increased as expected after several rebases",
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
      "(With more than one depositor | +DAI bond) FHM received back should be increased as expected after several bond rebases",
    async function () {
      await adjustBondPeriod(
        ethers.provider,
        REBASE_PERIOD_BLOCKS * 2,
        daiBondDepository
      );
      const whaleInitialBal = await want.balanceOf(whale._address);
      await vault.deposit(wantBalStart); // takes care of the transfer.
      await vault.connect(whale).deposit(wantBalStart);

      await strategy.addBond(FHM_DAI_BOND);
      await strategy.stakeToBondSingleAll(FHM_DAI_BOND, FHM_DAI_ROUTE);
      expect(await strategy.currentBond()).to.eq(FHM_DAI_BOND);
      expect(await strategy.unstakedRebasing()).to.eq(0);
      expect(await strategy.stakedRebasing()).to.eq(0);
      expect(await strategy.rebaseBonded()).to.gt(wantBalStart.mul(2));

      await timeTravelBlocks(ethers.provider, REBASE_PERIOD_BLOCKS);
      await stakeManager.rebase();

      expect(await strategy.stakedRebasing()).to.eq(0);

      await strategy.redeemAndStake();

      const vaultBalAfterFirstRedeem = await vault.balance();

      expect(await strategy.stakedRebasing())
        .to.gt(0)
        .to.eq(vaultBalAfterFirstRedeem.sub(await strategy.rebaseBonded()));
      expect(await strategy.unstakedRebasing()).to.eq(0);
      expect(await strategy.stakedRebasing()).to.lte(
        (await strategy.rebaseBonded()).add(1)
      );
      expect(await strategy.stakedRebasing()).to.gte(
        (await strategy.rebaseBonded()).sub(1)
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
      expect(vaultBalAfterRebase).to.eq(vaultBalFinal);
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
        wantBalStart
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
      "(With more than one depositor | +DAI bond) FHM received back should be increased as expected after several bond rebases, with unstaked",
    async function () {
      await adjustBondPeriod(
        ethers.provider,
        REBASE_PERIOD_BLOCKS * 2,
        daiBondDepository
      );
      const whaleInitialBal = await want.balanceOf(whale._address);
      await vault.deposit(wantBalStart); // takes care of the transfer.
      await vault.connect(whale).deposit(wantBalStart);

      await strategy.unstake(wantBalStart);

      await strategy.addBond(FHM_DAI_BOND);
      await strategy.stakeToBondSingleAll(FHM_DAI_BOND, FHM_DAI_ROUTE);

      const vaultBal = await vault.balance();

      expect(await strategy.currentBond()).to.eq(FHM_DAI_BOND);
      expect(await strategy.unstakedRebasing()).to.eq(0);
      expect(await strategy.stakedRebasing()).to.eq(0);
      expect(await strategy.rebaseBonded())
        .to.eq(vaultBal)
        .to.gt(wantBalStart.mul(2));

      await timeTravelBlocks(ethers.provider, REBASE_PERIOD_BLOCKS);
      await stakeManager.rebase();

      expect(await strategy.stakedRebasing()).to.eq(0);

      await strategy.redeemAndStake();

      await strategy.unstake(wantBalStart);

      const vaultBalAfterFirstRedeem = await vault.balance();

      expect(await strategy.totalRebasing())
        .to.gt(0)
        .to.eq(vaultBalAfterFirstRedeem.sub(await strategy.rebaseBonded()));
      expect(await strategy.totalRebasing()).to.lte(
        (await strategy.rebaseBonded()).add(1)
      );
      expect(await strategy.totalRebasing()).to.gte(
        (await strategy.rebaseBonded()).sub(1)
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
      expect(vaultBalAfterRebase).to.eq(vaultBalFinal);
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
        wantBalStart
          .sub(wantBalStart)
          .add(vaultBalBeforeWhaleReserve)
          .sub(withdrawalFeeAmount)
      );

      // Notice those who withdraw later benefit more
      expect(deployerGain).to.lt(whaleGain);
    }
  ).timeout(TEST_TIMEOUT * 3);
});
