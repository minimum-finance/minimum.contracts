const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  truncateToFixed,
  beforeHook,
  beforeEachHook,
  forceFHMBondNegative,
  forceFHMBondMinimumPositive,
  forceHighMaxDebt,
  forceFHMBondPositive,
} = require("../../../../utils/testUtils.ts");
const { addressBook } = require("blockchain-addressbook");
const {
  FHM,
  FHM_STAKER,
  STAKED_FHM,
  FHM_STAKE_MANAGER,
  FHM_DAI_PAIR,
  BOGUS_ADDR_1,
  BOGUS_ADDR_2,
  TEST_TIMEOUT,
  FHM_DAI_BOND,
  FHM_WFTM_BOND,
  FHM_DAI_LP_BOND,
  FHM_DAI_ROUTE,
  FHM_WFTM_ROUTE,
  WFTM_FHM_ROUTE,
  DAI_FHM_ROUTE,
  FANTOHM_TEST_FLAG,
  FHM_BOND_CALCULATOR,
  FHM_WHALES,
  FHM_TREASURY,
  WARMUP_TEST_FLAG,
  FHM_CIRCULATING_SUPPLY,
} = require("../../../../constants.js");

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
  wantCap: ethers.utils.parseUnits("100000", 9),
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

describe(
  FANTOHM_TEST_FLAG + WARMUP_TEST_FLAG + " Strategy stakeToBond",
  function () {
    let vault,
      strategy,
      unirouter,
      fhm,
      stakedFhm,
      deployer,
      keeper,
      other,
      whale,
      stakeManager,
      daiBondDepository,
      wftmBondDepository,
      fhmDaiBondDepository,
      lpBondCalculator,
      daiWftmPair,
      rebaseTokenBalStart,
      daiValueInitial,
      unirouterData,
      fhmCirculatingSupply;

    this.slow(20000);

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
        warmup: 3,
        circulatingSupplyAddr: FHM_CIRCULATING_SUPPLY,
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
        nativeToRebaseRoute: WFTM_FHM_ROUTE,
        stakedRebaseToken: stakedFhm,
        fundStaked: true,
      }));
    });

    it("Can add a bond", async function () {
      // Initially empty
      expect(await strategy.numBonds()).to.equal(0);

      await expect(strategy.addBond(FHM_DAI_BOND))
        .to.emit(strategy, "BondAdded")
        .withArgs([ethers.utils.getAddress(FHM_DAI_BOND)]);
      expect(await strategy.bonds(0)).to.equal(FHM_DAI_BOND);
      expect(await strategy.numBonds()).to.equal(1);

      await expect(strategy.addBond(FHM_WFTM_BOND))
        .to.emit(strategy, "BondAdded")
        .withArgs([
          ethers.utils.getAddress(FHM_DAI_BOND),
          ethers.utils.getAddress(FHM_WFTM_BOND),
        ]);
      expect(await strategy.bonds(1)).to.equal(
        ethers.utils.getAddress(FHM_WFTM_BOND)
      );
      expect(await strategy.numBonds()).to.equal(2);

      // Make sure can't add same bond again. Length stays the same
      await expect(strategy.addBond(FHM_WFTM_BOND)).to.be.revertedWith(
        "!invalid bond"
      );
      expect(await strategy.bonds(1)).to.equal(FHM_WFTM_BOND);
      expect(await strategy.numBonds()).to.equal(2);

      await expect(strategy.addBond(FHM_DAI_LP_BOND))
        .to.emit(strategy, "BondAdded")
        .withArgs([
          ethers.utils.getAddress(FHM_DAI_BOND),
          ethers.utils.getAddress(FHM_WFTM_BOND),
          ethers.utils.getAddress(FHM_DAI_LP_BOND),
        ]);
      expect(await strategy.bonds(2)).to.equal(FHM_DAI_LP_BOND);
      expect(await strategy.numBonds()).to.equal(3);

      // Can't add bond if not manager
      await expect(
        strategy.connect(keeper).addBond(FHM_DAI_LP_BOND)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    }).timeout(TEST_TIMEOUT);

    it("Can remove a bond", async function () {
      // Initially empty
      expect(await strategy.numBonds()).to.equal(0);

      await strategy.addBond(FHM_DAI_BOND);
      expect(await strategy.bonds(0)).to.equal(FHM_DAI_BOND);
      expect(await strategy.numBonds()).to.equal(1);

      await strategy.addBond(FHM_WFTM_BOND);
      expect(await strategy.bonds(1)).to.equal(
        ethers.utils.getAddress(FHM_WFTM_BOND)
      );
      expect(await strategy.numBonds()).to.equal(2);

      await strategy.addBond(FHM_DAI_LP_BOND);
      expect(await strategy.bonds(2)).to.equal(FHM_DAI_LP_BOND);
      expect(await strategy.numBonds()).to.equal(3);

      await expect(strategy.removeBond(FHM_WFTM_BOND))
        .to.emit(strategy, "BondRemoved")
        .withArgs([
          ethers.utils.getAddress(FHM_DAI_BOND),
          ethers.utils.getAddress(FHM_DAI_LP_BOND),
        ]);
      expect(await strategy.bonds(1)).to.equal(FHM_DAI_LP_BOND);
      expect(await strategy.numBonds()).to.equal(2);

      await expect(strategy.removeBond(FHM_DAI_BOND))
        .to.emit(strategy, "BondRemoved")
        .withArgs([ethers.utils.getAddress(FHM_DAI_LP_BOND)]);
      expect(await strategy.bonds(0)).to.equal(FHM_DAI_LP_BOND);
      expect(await strategy.numBonds()).to.equal(1);

      // Make sure we can add again
      await expect(strategy.addBond(FHM_WFTM_BOND))
        .to.emit(strategy, "BondAdded")
        .withArgs([
          ethers.utils.getAddress(FHM_DAI_LP_BOND),
          ethers.utils.getAddress(FHM_WFTM_BOND),
        ]);
      expect(await strategy.bonds(1)).to.equal(FHM_WFTM_BOND);
      expect(await strategy.numBonds()).to.equal(2);

      // Cannot remove a bond that isn't there
      await expect(strategy.removeBond(FHM_DAI_BOND)).to.be.revertedWith(
        "!valid bond"
      );
    }).timeout(TEST_TIMEOUT);

    it("Can go from staking to bonding single-sided", async function () {
      await forceHighMaxDebt(ethers.provider, daiBondDepository);
      await forceFHMBondMinimumPositive(
        ethers.provider,
        daiBondDepository,
        strategy
      );
      const daiValueInitial = ethers.utils.formatEther(
        await strategy.rebaseTokenPriceInUSD(rebaseTokenBalStart)
      );

      await vault.deposit(rebaseTokenBalStart); // Goes straight to staking

      const fhmStaked = await stakedFhm.balanceOf(strategy.address);
      expect(fhmStaked).to.equal(rebaseTokenBalStart); // Confirmed the FHM is staked

      // Now go from staking to bonding...
      await expect(
        strategy.stakeToBondSingle(fhmStaked, FHM_DAI_BOND, FHM_DAI_ROUTE)
      ).to.be.revertedWith("Unapproved bond!");
      await strategy.addBond(FHM_DAI_BOND);

      // Make sure there is no bond before calling stakeToBond
      const bondDetailsBefore = await daiBondDepository.bondInfo(
        strategy.address
      );
      const zeroPaid = bondDetailsBefore.pricePaid;
      expect(zeroPaid).to.equal(0);

      await expect(
        strategy.stakeToBondSingle(fhmStaked, FHM_DAI_BOND, FHM_DAI_ROUTE)
      ).to.emit(strategy, "Bond");
      const fhmStakedAfterBonding = await stakedFhm.balanceOf(strategy.address);
      const fhmAfterBonding = await fhm.balanceOf(strategy.address);
      expect(fhmStakedAfterBonding).to.equal(0); // Confirmed the FHM is no longer staked
      expect(fhmAfterBonding).to.equal(0);

      const bondDetailsAfter = await daiBondDepository.bondInfo(
        strategy.address
      );
      const pricePaid = ethers.utils.formatUnits(
        bondDetailsAfter.pricePaid,
        18
      );
      const payout = parseFloat(
        ethers.utils.formatUnits(bondDetailsAfter.payout, 9)
      );
      const calculatedPayout = parseFloat(daiValueInitial / pricePaid);

      // Should expect calculated to be a bit more as fee takes away some value
      // when swapping FHM for the bond token
      expect(payout).to.lte(calculatedPayout);
      expect(payout).to.gt(calculatedPayout * 0.99);
      expect(await strategy.isBonding()).to.be.true;

      // Can't do another bond while isBonding
      await strategy.addBond(FHM_WFTM_BOND);
      await expect(
        strategy.stakeToBondSingle(fhmStaked, FHM_WFTM_BOND, FHM_WFTM_ROUTE)
      ).to.be.revertedWith("Already bonding!");
      expect(await strategy.isBonding()).to.be.true;
    }).timeout(TEST_TIMEOUT);

    it("Correctly computes the maxBondableFHM", async function () {
      const fhmPriceInUSD = await strategy.rebaseTokenPriceInUSD(10 ** 9);
      const wftmBondPriceInUSD = await wftmBondDepository.bondPriceInUSD();
      const wftmMaxPayout = await wftmBondDepository.maxPayout();
      const wftmComputedMaxBondable = await strategy.maxBondSize(FHM_WFTM_BOND);

      expect(wftmComputedMaxBondable).to.equal(
        wftmBondPriceInUSD.mul(wftmMaxPayout).div(fhmPriceInUSD)
      );

      const daiBondPriceInUSD = await daiBondDepository.bondPriceInUSD();
      const daiMaxPayout = await daiBondDepository.maxPayout();
      const daiComputedMaxBondable = await strategy.maxBondSize(FHM_DAI_BOND);

      expect(daiComputedMaxBondable).to.equal(
        daiBondPriceInUSD.mul(daiMaxPayout).div(fhmPriceInUSD)
      );

      const fhmDaiBondPriceInUSD = await fhmDaiBondDepository.bondPriceInUSD();
      const fhmDaiMaxPayout = await fhmDaiBondDepository.maxPayout();
      const fhmDaiComputedMaxBondable = await strategy.maxBondSize(
        FHM_DAI_LP_BOND
      );

      expect(fhmDaiComputedMaxBondable).to.equal(
        fhmDaiBondPriceInUSD.mul(fhmDaiMaxPayout).div(fhmPriceInUSD)
      );
    }).timeout(TEST_TIMEOUT);

    it("Can go from staking to bonding with a multi-step route", async function () {
      await forceHighMaxDebt(ethers.provider, wftmBondDepository);
      await forceFHMBondMinimumPositive(
        ethers.provider,
        wftmBondDepository,
        strategy
      );
      await vault.deposit(rebaseTokenBalStart); // Goes straight to staking

      const serviceFee = await strategy.serviceFee();
      const serviceFeeDenom = await strategy.SERVICE_FEE_DIVISOR();
      const serviceFeeAmount = rebaseTokenBalStart
        .mul(serviceFee)
        .div(serviceFeeDenom);

      const ftmOut = (
        await unirouter.getAmountsOut(
          rebaseTokenBalStart.sub(serviceFeeAmount),
          FHM_WFTM_ROUTE
        )
      )[2];
      const ftmPrice = await wftmBondDepository.assetPrice();

      const fhmStaked = await stakedFhm.balanceOf(strategy.address);
      expect(fhmStaked).to.equal(rebaseTokenBalStart); // Confirmed the FHM is staked

      // Now go from staking to bonding...
      await expect(
        strategy.stakeToBondSingle(fhmStaked, FHM_WFTM_BOND, FHM_WFTM_ROUTE)
      ).to.be.revertedWith("Unapproved bond!");
      await strategy.addBond(FHM_WFTM_BOND);

      // Make sure there is no bond before calling stakeToBond
      const bondDetailsBefore = await wftmBondDepository.bondInfo(
        strategy.address
      );
      const zeroPaid = bondDetailsBefore.pricePaid;
      expect(zeroPaid).to.equal(0);

      await strategy.stakeToBondSingle(
        fhmStaked,
        FHM_WFTM_BOND,
        FHM_WFTM_ROUTE
      );
      const fhmStakedAfterBonding = await stakedFhm.balanceOf(strategy.address);
      const fhmAfterBonding = await fhm.balanceOf(strategy.address);
      expect(fhmStakedAfterBonding).to.equal(0); // Confirmed the FHM is no longer staked
      expect(fhmAfterBonding).to.equal(0);

      const bondDetailsAfter = await wftmBondDepository.bondInfo(
        strategy.address
      );
      // NOTICE: that price paid on the bondDetails is in DAI
      const pricePaid = ethers.utils.formatUnits(
        bondDetailsAfter.pricePaid,
        18
      );
      const payout = parseFloat(
        ethers.utils.formatUnits(bondDetailsAfter.payout, 9)
      );

      const parsedFTMPrice = parseFloat(ethers.utils.formatUnits(ftmPrice, 8));
      const parsedFTMOut = parseFloat(ethers.utils.formatEther(ftmOut));

      const truncatedPayout = truncateToFixed(
        (parsedFTMPrice * parsedFTMOut) / pricePaid,
        9
      );

      // Allowed inaccuracy for varying oracle/swap data
      expect(payout).to.lte(parseFloat(truncatedPayout) / 0.999);
      expect(payout).to.gte(parseFloat(truncatedPayout) * 0.999);
      expect(await strategy.isBonding()).to.be.true;
    }).timeout(TEST_TIMEOUT);

    it("Cannot stakeToBond if not manager", async function () {
      await vault.depositAll();

      await strategy.addBond(FHM_DAI_BOND);
      await expect(
        strategy
          .connect(whale)
          .stakeToBondSingle(rebaseTokenBalStart, FHM_DAI_BOND, FHM_DAI_ROUTE)
      ).to.be.revertedWith("!manager");
      await expect(
        strategy
          .connect(whale)
          .stakeToBondSingleAll(FHM_DAI_BOND, FHM_DAI_ROUTE)
      ).to.be.revertedWith("!manager");
      await expect(
        strategy
          .connect(whale)
          .stakeToBondLP(
            rebaseTokenBalStart,
            FHM_DAI_LP_BOND,
            [FHM],
            FHM_DAI_ROUTE
          )
      ).to.be.revertedWith("!manager");
      await expect(
        strategy
          .connect(whale)
          .stakeToBondLPAll(FHM_DAI_LP_BOND, [FHM], FHM_DAI_ROUTE)
      ).to.be.revertedWith("!manager");
    }).timeout(TEST_TIMEOUT);

    it("Rejects invalid bond amounts and swapping routes ", async function () {
      await forceHighMaxDebt(ethers.provider, wftmBondDepository);
      await forceFHMBondPositive(
        ethers.provider,
        wftmBondDepository,
        fhmCirculatingSupply,
        (isNonStable = true)
      );
      await forceFHMBondPositive(
        ethers.provider,
        daiBondDepository,
        fhmCirculatingSupply
      );
      await forceFHMBondPositive(
        ethers.provider,
        fhmDaiBondDepository,
        fhmCirculatingSupply
      );
      await forceFHMBondMinimumPositive(
        ethers.provider,
        wftmBondDepository,
        strategy
      );
      await strategy.addBond(FHM_WFTM_BOND);
      await strategy.addBond(FHM_DAI_BOND);

      const serviceFee = await strategy.serviceFee();
      const serviceFeeDenom = await strategy.SERVICE_FEE_DIVISOR();
      const serviceFeeAmount = rebaseTokenBalStart
        .mul(serviceFee)
        .div(serviceFeeDenom);

      const ftmOut = (
        await unirouter.getAmountsOut(
          rebaseTokenBalStart.sub(serviceFeeAmount),
          FHM_WFTM_ROUTE
        )
      )[2];
      const ftmPrice = await wftmBondDepository.assetPrice();

      await expect(
        strategy.stakeToBondSingle(0, FHM_WFTM_BOND, [])
      ).to.be.revertedWith("amount <= 0!");

      await expect(
        strategy.stakeToBondSingle(5, FHM_WFTM_BOND, [])
      ).to.be.revertedWith("Route must start with rebaseToken!");

      await expect(
        strategy.stakeToBondSingleAll(FHM_WFTM_BOND, [])
      ).to.be.revertedWith("amount <= 0!");

      await expect(
        strategy.stakeToBondSingle(5, FHM_WFTM_BOND, DAI_FHM_ROUTE)
      ).to.be.revertedWith("Route must start with rebaseToken!");

      await expect(
        strategy.stakeToBondSingle(5, FHM_WFTM_BOND, WFTM_FHM_ROUTE)
      ).to.be.revertedWith("Route must start with rebaseToken!");

      await expect(
        strategy.stakeToBondSingle(5, FHM_WFTM_BOND, FHM_DAI_ROUTE)
      ).to.be.revertedWith("Route must end with bond principle!");

      await expect(
        strategy.stakeToBondSingle(5, FHM_DAI_BOND, FHM_WFTM_ROUTE)
      ).to.be.revertedWith("Route must end with bond principle!");

      await expect(
        strategy.stakeToBondLP(5, FHM_DAI_LP_BOND, [FHM], FHM_DAI_ROUTE)
      ).to.be.revertedWith("Unapproved bond!");

      await strategy.addBond(FHM_DAI_LP_BOND);

      await expect(
        strategy.stakeToBondLP(0, FHM_DAI_LP_BOND, [], FHM_DAI_ROUTE)
      ).to.be.revertedWith("amount <= 0!");

      // Notice: Token0 = FHM Token1 = DAI
      await expect(
        strategy.stakeToBondLP(5, FHM_DAI_LP_BOND, [], FHM_DAI_ROUTE)
      ).to.be.revertedWith("Routes must start with {rebaseToken}!");

      await expect(
        strategy.stakeToBondLPAll(FHM_DAI_LP_BOND, [], FHM_DAI_ROUTE)
      ).to.be.revertedWith("amount <= 0!");

      await expect(
        strategy.stakeToBondLP(5, FHM_DAI_LP_BOND, [FHM], [])
      ).to.be.revertedWith("Routes must start with {rebaseToken}!");

      await expect(
        strategy.stakeToBondLP(5, FHM_DAI_LP_BOND, [], [])
      ).to.be.revertedWith("Routes must start with {rebaseToken}!");

      await expect(
        strategy.stakeToBondLP(5, FHM_DAI_LP_BOND, [FHM], FHM_DAI_ROUTE)
      ).to.be.revertedWith("Routes must end with their respective tokens!");

      await expect(
        strategy.stakeToBondLP(5, FHM_DAI_LP_BOND, [FHM], [FHM])
      ).to.be.revertedWith("Routes must end with their respective tokens!");

      await expect(
        strategy.stakeToBondLP(5, FHM_DAI_LP_BOND, FHM_DAI_ROUTE, FHM_DAI_ROUTE)
      ).to.be.revertedWith("Routes must end with their respective tokens!");

      await vault.deposit(rebaseTokenBalStart); // Goes straight to staking

      await expect(
        strategy.stakeToBondLPAll(FHM_DAI_LP_BOND, [], FHM_DAI_ROUTE)
      ).to.be.revertedWith("Routes must start with {rebaseToken}!");

      await expect(
        strategy.stakeToBondSingleAll(FHM_WFTM_BOND, [])
      ).to.be.revertedWith("Route must start with rebaseToken!");

      // Valid bond goes through
      await strategy.stakeToBondSingleAll(FHM_WFTM_BOND, FHM_WFTM_ROUTE);

      const bondDetailsAfter = await wftmBondDepository.bondInfo(
        strategy.address
      );
      const pricePaid = ethers.utils.formatUnits(
        bondDetailsAfter.pricePaid,
        18
      );
      const payout = parseFloat(
        ethers.utils.formatUnits(bondDetailsAfter.payout, 9)
      );
      const parsedFTMPrice = parseFloat(ethers.utils.formatUnits(ftmPrice, 8));
      const parsedFTMOut = parseFloat(ethers.utils.formatEther(ftmOut));

      const truncatedPayout = truncateToFixed(
        (parsedFTMPrice * parsedFTMOut) / pricePaid,
        9
      );

      expect(payout).to.equal(parseFloat(truncatedPayout));
      expect(await strategy.isBonding()).to.be.true;
    }).timeout(TEST_TIMEOUT);

    it("Can go from staking to bonding double-sided", async function () {
      await forceHighMaxDebt(ethers.provider, fhmDaiBondDepository);
      await forceFHMBondMinimumPositive(
        ethers.provider,
        fhmDaiBondDepository,
        strategy,
        lpBondCalculator,
        FHM_DAI_PAIR
      );
      const daiValueInitial = ethers.utils.formatEther(
        await strategy.rebaseTokenPriceInUSD(rebaseTokenBalStart)
      );

      await vault.depositAll();

      const fhmStaked = await stakedFhm.balanceOf(strategy.address);
      const fhmBalanceBeforeBonding = await fhm.balanceOf(strategy.address);
      expect(fhmStaked).to.equal(rebaseTokenBalStart); // Confirmed the FHM is staked
      expect(fhmBalanceBeforeBonding).to.equal(0);

      // Now go from staking to bonding...
      await strategy.addBond(FHM_DAI_LP_BOND);
      await strategy.stakeToBondLP(fhmStaked, FHM_DAI_LP_BOND, FHM_DAI_ROUTE, [
        FHM,
      ]);
      expect(await strategy.unstakedRebasing()).to.equal(0); // Confirm that no unstaked fhm is left
      expect(await strategy.stakedRebasing()).to.lt(
        ethers.utils.parseUnits("0.01", 9)
      ); // Not exactly 0 as division by 2 may leave some FHM

      const bondDetails = await fhmDaiBondDepository.bondInfo(strategy.address);
      const pricePaid = ethers.utils.formatUnits(bondDetails.pricePaid, 18);
      const payout = parseFloat(
        ethers.utils.formatUnits(bondDetails.payout, 9)
      );
      const calculatedPayout = parseFloat(daiValueInitial / pricePaid);

      // Should expect calculated to be a bit more as fee takes away some value
      // when swapping FHM for the bond token
      expect(payout).to.lte(calculatedPayout);
      expect(payout).to.gt(calculatedPayout * 0.99);
      expect(await strategy.isBonding()).to.be.true;
    }).timeout(TEST_TIMEOUT);

    it("Can't bond more than FHM staked", async function () {
      await forceHighMaxDebt(ethers.provider, daiBondDepository);
      await forceFHMBondMinimumPositive(
        ethers.provider,
        daiBondDepository,
        strategy
      );
      const daiValueInitial = ethers.utils.formatEther(
        await strategy.rebaseTokenPriceInUSD(rebaseTokenBalStart)
      );

      await vault.depositAll(); // Goes straight to staking

      const fhmStaked = await stakedFhm.balanceOf(strategy.address);
      expect(fhmStaked).to.equal(rebaseTokenBalStart); // Confirmed the FHM is staked

      // Now go from staking to bonding...
      await strategy.addBond(FHM_DAI_BOND);
      // Trying to stake more than available...
      await strategy.stakeToBondSingle(
        fhmStaked.mul(2),
        FHM_DAI_BOND,
        FHM_DAI_ROUTE
      );

      const fhmStakedAfterBonding = await stakedFhm.balanceOf(strategy.address);
      const fhmAfterBonding = await fhm.balanceOf(strategy.address);
      expect(fhmStakedAfterBonding).to.equal(0); // Confirmed the FHM is no longer staked
      expect(fhmAfterBonding).to.equal(0);

      const bondDetails = await daiBondDepository.bondInfo(strategy.address);
      const pricePaid = ethers.utils.formatUnits(bondDetails.pricePaid, 18);
      const payout = parseFloat(
        ethers.utils.formatUnits(bondDetails.payout, 9)
      );
      const calculatedPayout = parseFloat(daiValueInitial / pricePaid);

      // Should expect calculated to be a bit more as fee takes away some value
      // when swapping FHM for the bond token
      expect(payout).to.lte(calculatedPayout);
      expect(payout).to.gt(calculatedPayout * 0.99);
    }).timeout(TEST_TIMEOUT);

    it("stakeToBond with amount > sFHM in strat bonds all available rebasing", async function () {
      await forceHighMaxDebt(ethers.provider, daiBondDepository);
      await forceFHMBondMinimumPositive(
        ethers.provider,
        daiBondDepository,
        strategy
      );
      const daiValueInitial = ethers.utils.formatEther(
        await strategy.rebaseTokenPriceInUSD(rebaseTokenBalStart)
      );

      await vault.deposit(rebaseTokenBalStart.div(2));

      await strategy.addBond(FHM_DAI_BOND);
      await strategy.stakeToBondSingle(
        rebaseTokenBalStart,
        FHM_DAI_BOND,
        FHM_DAI_ROUTE
      );

      const fhmStakedAfterBonding = await stakedFhm.balanceOf(strategy.address);
      const fhmAfterBonding = await fhm.balanceOf(strategy.address);
      expect(fhmStakedAfterBonding).to.equal(0); // There should be none left
      expect(fhmAfterBonding).to.equal(0);

      const bondDetails = await daiBondDepository.bondInfo(strategy.address);
      const pricePaid = ethers.utils.formatUnits(bondDetails.pricePaid, 18);
      const payout = parseFloat(
        ethers.utils.formatUnits(bondDetails.payout, 9)
      );
      const calculatedPayout = parseFloat(daiValueInitial / pricePaid);

      // Payout should be based on half of rebaseTokenBalStart
      expect(payout).to.lte(calculatedPayout / 2);
      expect(payout).to.gt((calculatedPayout * 0.99) / 2);
      expect(await strategy.isBonding()).to.be.true;
    }).timeout(TEST_TIMEOUT);

    it("Will not bond into a negative bond", async function () {
      await vault.depositAll();

      await strategy.addBond(FHM_DAI_BOND);
      await strategy.addBond(FHM_WFTM_BOND);
      await strategy.addBond(FHM_DAI_LP_BOND);

      await forceFHMBondNegative(ethers.provider, daiBondDepository, strategy);
      await forceFHMBondNegative(ethers.provider, wftmBondDepository, strategy);
      await forceFHMBondNegative(
        ethers.provider,
        fhmDaiBondDepository,
        strategy,
        lpBondCalculator,
        FHM_DAI_PAIR
      );

      await expect(
        strategy.stakeToBondSingle(
          rebaseTokenBalStart.div(2),
          FHM_DAI_BOND,
          FHM_DAI_ROUTE
        )
      ).to.be.revertedWith("!bondIsPositive");
      await expect(
        strategy.stakeToBondSingle(
          rebaseTokenBalStart.div(2),
          FHM_WFTM_BOND,
          FHM_WFTM_ROUTE
        )
      ).to.be.revertedWith("!bondIsPositive");
      await expect(
        strategy.stakeToBondLP(
          rebaseTokenBalStart.div(2),
          FHM_DAI_LP_BOND,
          FHM_DAI_ROUTE,
          [FHM]
        )
      ).to.be.revertedWith("!bondIsPositive");

      await expect(
        strategy.stakeToBondSingleAll(FHM_DAI_BOND, FHM_DAI_ROUTE)
      ).to.be.revertedWith("!bondIsPositive");
      await expect(
        strategy.stakeToBondSingleAll(FHM_WFTM_BOND, FHM_WFTM_ROUTE)
      ).to.be.revertedWith("!bondIsPositive");
      await expect(
        strategy.stakeToBondLPAll(FHM_DAI_LP_BOND, FHM_DAI_ROUTE, [FHM])
      ).to.be.revertedWith("!bondIsPositive");
    }).timeout(TEST_TIMEOUT);
  }
);
