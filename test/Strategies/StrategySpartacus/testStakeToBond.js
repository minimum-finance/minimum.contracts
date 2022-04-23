const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  truncateToFixed,
  beforeHook,
  beforeEachHook,
  forceBondNegative,
  forceBondPositive,
} = require("../../../utils/testUtils.ts");
const { addressBook } = require("blockchain-addressbook");
const {
  SPA,
  SPA_STAKER,
  STAKED_SPA,
  SPA_STAKE_MANAGER,
  SPA_DAI_PAIR,
  BOGUS_ADDR_1,
  BOGUS_ADDR_2,
  TEST_TIMEOUT,
  DAI_BOND,
  WFTM_BOND,
  SPA_DAI_BOND,
  SPA_DAI_ROUTE,
  SPA_WFTM_ROUTE,
  WFTM_SPA_ROUTE,
  DAI_SPA_ROUTE,
  SPARTACUS_TEST_FLAG,
  SPA_DAI_BOND_CALCULATOR,
  SPA_WHALES,
  SPA_TREASURY,
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
  wantCap: ethers.utils.parseUnits("100000", 9),
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

describe(SPARTACUS_TEST_FLAG + " Strategy stakeToBond", function () {
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
      lpBondCalculator,
      daiWftmPair,
      stakeManager,
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

  it("Can add a bond", async function () {
    // Initially empty
    expect(await strategy.numBonds()).to.equal(0);

    await expect(strategy.addBond(DAI_BOND))
      .to.emit(strategy, "BondAdded")
      .withArgs([ethers.utils.getAddress(DAI_BOND)]);
    expect(await strategy.bonds(0)).to.equal(DAI_BOND);
    expect(await strategy.numBonds()).to.equal(1);

    await expect(strategy.addBond(WFTM_BOND))
      .to.emit(strategy, "BondAdded")
      .withArgs([
        ethers.utils.getAddress(DAI_BOND),
        ethers.utils.getAddress(WFTM_BOND),
      ]);
    expect(await strategy.bonds(1)).to.equal(WFTM_BOND);
    expect(await strategy.numBonds()).to.equal(2);

    // Make sure can't add same bond again. Length stays the same
    await expect(strategy.addBond(WFTM_BOND)).to.be.revertedWith(
      "!invalid bond"
    );
    expect(await strategy.bonds(1)).to.equal(WFTM_BOND);
    expect(await strategy.numBonds()).to.equal(2);

    await expect(strategy.addBond(SPA_DAI_BOND))
      .to.emit(strategy, "BondAdded")
      .withArgs([
        ethers.utils.getAddress(DAI_BOND),
        ethers.utils.getAddress(WFTM_BOND),
        ethers.utils.getAddress(SPA_DAI_BOND),
      ]);
    expect(await strategy.bonds(2)).to.equal(SPA_DAI_BOND);
    expect(await strategy.numBonds()).to.equal(3);

    // Can't add bond if not manager
    await expect(
      strategy.connect(keeper).addBond(SPA_DAI_BOND)
    ).to.be.revertedWith("Ownable: caller is not the owner");
  }).timeout(TEST_TIMEOUT);

  it("Can remove a bond", async function () {
    // Initially empty
    expect(await strategy.numBonds()).to.equal(0);

    await strategy.addBond(DAI_BOND);
    expect(await strategy.bonds(0)).to.equal(DAI_BOND);
    expect(await strategy.numBonds()).to.equal(1);

    await strategy.addBond(WFTM_BOND);
    expect(await strategy.bonds(1)).to.equal(WFTM_BOND);
    expect(await strategy.numBonds()).to.equal(2);

    await strategy.addBond(SPA_DAI_BOND);
    expect(await strategy.bonds(2)).to.equal(SPA_DAI_BOND);
    expect(await strategy.numBonds()).to.equal(3);

    await expect(strategy.removeBond(WFTM_BOND))
      .to.emit(strategy, "BondRemoved")
      .withArgs([
        ethers.utils.getAddress(DAI_BOND),
        ethers.utils.getAddress(SPA_DAI_BOND),
      ]);
    expect(await strategy.bonds(1)).to.equal(SPA_DAI_BOND);
    expect(await strategy.numBonds()).to.equal(2);

    await expect(strategy.removeBond(DAI_BOND))
      .to.emit(strategy, "BondRemoved")
      .withArgs([ethers.utils.getAddress(SPA_DAI_BOND)]);
    expect(await strategy.bonds(0)).to.equal(SPA_DAI_BOND);
    expect(await strategy.numBonds()).to.equal(1);

    // Make sure we can add again
    await expect(strategy.addBond(WFTM_BOND))
      .to.emit(strategy, "BondAdded")
      .withArgs([
        ethers.utils.getAddress(SPA_DAI_BOND),
        ethers.utils.getAddress(WFTM_BOND),
      ]);
    expect(await strategy.bonds(1)).to.equal(WFTM_BOND);
    expect(await strategy.numBonds()).to.equal(2);

    // Cannot remove a bond that isn't there
    await expect(strategy.removeBond(DAI_BOND)).to.be.revertedWith(
      "!valid bond"
    );
  }).timeout(TEST_TIMEOUT);

  it("Can go from staking to bonding single-sided", async function () {
    await forceBondPositive(ethers.provider, daiBondDepository, strategy);
    const daiValueInitial = ethers.utils.formatEther(
      await strategy.rebaseTokenPriceInUSD(rebaseTokenBalStart)
    );

    await vault.deposit(rebaseTokenBalStart); // Goes straight to staking

    const spaStaked = await stakedSpa.balanceOf(strategy.address);
    expect(spaStaked).to.equal(rebaseTokenBalStart); // Confirmed the SPA is staked

    // Now go from staking to bonding...
    await expect(
      strategy.stakeToBondSingle(spaStaked, DAI_BOND, SPA_DAI_ROUTE)
    ).to.be.revertedWith("Unapproved bond!");
    await strategy.addBond(DAI_BOND);

    // Make sure there is no bond before calling stakeToBond
    const bondDetailsBefore = await daiBondDepository.bondInfo(
      strategy.address
    );
    const zeroPaid = bondDetailsBefore.pricePaid;
    expect(zeroPaid).to.equal(0);

    await expect(strategy.stakeToBondSingle(spaStaked, DAI_BOND, SPA_DAI_ROUTE))
      .to.emit(strategy, "Bond")
      .withArgs(0, 0, spaStaked, ethers.utils.getAddress(DAI_BOND));
    const spaStakedAfterBonding = await stakedSpa.balanceOf(strategy.address);
    const spaAfterBonding = await spa.balanceOf(strategy.address);
    expect(spaStakedAfterBonding).to.equal(0); // Confirmed the SPA is no longer staked
    expect(spaAfterBonding).to.equal(0);

    const bondDetailsAfter = await daiBondDepository.bondInfo(strategy.address);
    const pricePaid = ethers.utils.formatUnits(bondDetailsAfter.pricePaid, 18);
    const payout = parseFloat(
      ethers.utils.formatUnits(bondDetailsAfter.payout, 9)
    );
    const calculatedPayout = parseFloat(daiValueInitial / pricePaid);

    // Should expect calculated to be a bit more as fee takes away some value
    // when swapping SPA for the bond token
    expect(payout).to.lte(calculatedPayout);
    expect(payout).to.gt(calculatedPayout * 0.99);
    expect(await strategy.isBonding()).to.be.true;

    // Can't do another bond while isBonding
    await strategy.addBond(WFTM_BOND);
    await expect(
      strategy.stakeToBondSingle(spaStaked, WFTM_BOND, SPA_WFTM_ROUTE)
    ).to.be.revertedWith("Already bonding!");
    expect(await strategy.isBonding()).to.be.true;
  }).timeout(TEST_TIMEOUT);

  it("Correctly computes the maxBondableSPA", async function () {
    const spaPriceInUSD = await strategy.rebaseTokenPriceInUSD(10 ** 9);
    const wftmBondPriceInUSD = await wftmBondDepository.bondPriceInUSD();
    const wftmMaxPayout = await wftmBondDepository.maxPayout();
    const wftmComputedMaxBondable = await strategy.maxBondSize(WFTM_BOND);

    expect(wftmComputedMaxBondable).to.equal(
      wftmBondPriceInUSD.mul(wftmMaxPayout).div(spaPriceInUSD)
    );

    const daiBondPriceInUSD = await daiBondDepository.bondPriceInUSD();
    const daiMaxPayout = await daiBondDepository.maxPayout();
    const daiComputedMaxBondable = await strategy.maxBondSize(DAI_BOND);

    expect(daiComputedMaxBondable).to.equal(
      daiBondPriceInUSD.mul(daiMaxPayout).div(spaPriceInUSD)
    );

    const spaDaiBondPriceInUSD = await spaDaiBondDepository.bondPriceInUSD();
    const spaDaiMaxPayout = await spaDaiBondDepository.maxPayout();
    const spaDaiComputedMaxBondable = await strategy.maxBondSize(SPA_DAI_BOND);

    expect(spaDaiComputedMaxBondable).to.equal(
      spaDaiBondPriceInUSD.mul(spaDaiMaxPayout).div(spaPriceInUSD)
    );
  }).timeout(TEST_TIMEOUT);

  it("Can go from staking to bonding with a multi-step route", async function () {
    await forceBondPositive(ethers.provider, wftmBondDepository, strategy);
    await vault.deposit(rebaseTokenBalStart); // Goes straight to staking
    const ftmOut = (
      await unirouter.getAmountsOut(rebaseTokenBalStart, SPA_WFTM_ROUTE)
    )[2];
    const ftmPrice = await wftmBondDepository.assetPrice();

    const spaStaked = await stakedSpa.balanceOf(strategy.address);
    expect(spaStaked).to.equal(rebaseTokenBalStart); // Confirmed the SPA is staked

    // Now go from staking to bonding...
    await expect(
      strategy.stakeToBondSingle(spaStaked, WFTM_BOND, SPA_WFTM_ROUTE)
    ).to.be.revertedWith("Unapproved bond!");
    await strategy.addBond(WFTM_BOND);

    // Make sure there is no bond before calling stakeToBond
    const bondDetailsBefore = await wftmBondDepository.bondInfo(
      strategy.address
    );
    const zeroPaid = bondDetailsBefore.pricePaid;
    expect(zeroPaid).to.equal(0);

    await strategy.stakeToBondSingle(spaStaked, WFTM_BOND, SPA_WFTM_ROUTE);
    const spaStakedAfterBonding = await stakedSpa.balanceOf(strategy.address);
    const spaAfterBonding = await spa.balanceOf(strategy.address);
    expect(spaStakedAfterBonding).to.equal(0); // Confirmed the SPA is no longer staked
    expect(spaAfterBonding).to.equal(0);

    const bondDetailsAfter = await wftmBondDepository.bondInfo(
      strategy.address
    );
    // NOTICE: that price paid on the bondDetails is in DAI
    const pricePaid = ethers.utils.formatUnits(bondDetailsAfter.pricePaid, 18);
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

    await strategy.addBond(DAI_BOND);
    await expect(
      strategy
        .connect(whale)
        .stakeToBondSingle(rebaseTokenBalStart, DAI_BOND, SPA_DAI_ROUTE)
    ).to.be.revertedWith("!manager");
    await expect(
      strategy.connect(whale).stakeToBondSingleAll(DAI_BOND, SPA_DAI_ROUTE)
    ).to.be.revertedWith("!manager");
    await expect(
      strategy
        .connect(whale)
        .stakeToBondLP(rebaseTokenBalStart, SPA_DAI_BOND, [SPA], SPA_DAI_ROUTE)
    ).to.be.revertedWith("!manager");
    await expect(
      strategy
        .connect(whale)
        .stakeToBondLPAll(SPA_DAI_BOND, [SPA], SPA_DAI_ROUTE)
    ).to.be.revertedWith("!manager");
  }).timeout(TEST_TIMEOUT);

  it("Rejects invalid bond amounts and swapping routes ", async function () {
    await forceBondPositive(ethers.provider, wftmBondDepository, strategy);
    await strategy.addBond(WFTM_BOND);
    await strategy.addBond(DAI_BOND);
    const ftmOut = (
      await unirouter.getAmountsOut(rebaseTokenBalStart, SPA_WFTM_ROUTE)
    )[2];
    const ftmPrice = await wftmBondDepository.assetPrice();

    await expect(
      strategy.stakeToBondSingle(0, WFTM_BOND, [])
    ).to.be.revertedWith("amount <= 0!");

    await expect(
      strategy.stakeToBondSingle(5, WFTM_BOND, [])
    ).to.be.revertedWith("Route must start with rebaseToken!");

    await expect(
      strategy.stakeToBondSingleAll(WFTM_BOND, [])
    ).to.be.revertedWith("amount <= 0!");

    await expect(
      strategy.stakeToBondSingle(5, WFTM_BOND, DAI_SPA_ROUTE)
    ).to.be.revertedWith("Route must start with rebaseToken!");

    await expect(
      strategy.stakeToBondSingle(5, WFTM_BOND, WFTM_SPA_ROUTE)
    ).to.be.revertedWith("Route must start with rebaseToken!");

    await expect(
      strategy.stakeToBondSingle(5, WFTM_BOND, SPA_DAI_ROUTE)
    ).to.be.revertedWith("Route must end with bond principle!");

    await expect(
      strategy.stakeToBondSingle(5, DAI_BOND, SPA_WFTM_ROUTE)
    ).to.be.revertedWith("Route must end with bond principle!");

    await expect(
      strategy.stakeToBondLP(5, SPA_DAI_BOND, [SPA], SPA_DAI_ROUTE)
    ).to.be.revertedWith("Unapproved bond!");

    await strategy.addBond(SPA_DAI_BOND);

    await expect(
      strategy.stakeToBondLP(0, SPA_DAI_BOND, [], SPA_DAI_ROUTE)
    ).to.be.revertedWith("amount <= 0!");

    // Notice: Token0 = SPA Token1 = DAI
    await expect(
      strategy.stakeToBondLP(5, SPA_DAI_BOND, [], SPA_DAI_ROUTE)
    ).to.be.revertedWith("Routes must start with {rebaseToken}!");

    await expect(
      strategy.stakeToBondLPAll(SPA_DAI_BOND, [], SPA_DAI_ROUTE)
    ).to.be.revertedWith("amount <= 0!");

    await expect(
      strategy.stakeToBondLP(5, SPA_DAI_BOND, [SPA], [])
    ).to.be.revertedWith("Routes must start with {rebaseToken}!");

    await expect(
      strategy.stakeToBondLP(5, SPA_DAI_BOND, [], [])
    ).to.be.revertedWith("Routes must start with {rebaseToken}!");

    await expect(
      strategy.stakeToBondLP(5, SPA_DAI_BOND, SPA_DAI_ROUTE, [SPA])
    ).to.be.revertedWith("Routes must end with their respective tokens!");

    await expect(
      strategy.stakeToBondLP(5, SPA_DAI_BOND, [SPA], [SPA])
    ).to.be.revertedWith("Routes must end with their respective tokens!");

    await expect(
      strategy.stakeToBondLP(5, SPA_DAI_BOND, SPA_DAI_ROUTE, SPA_DAI_ROUTE)
    ).to.be.revertedWith("Routes must end with their respective tokens!");

    await vault.deposit(rebaseTokenBalStart); // Goes straight to staking

    await expect(
      strategy.stakeToBondLPAll(SPA_DAI_BOND, [], SPA_DAI_ROUTE)
    ).to.be.revertedWith("Routes must start with {rebaseToken}!");

    await expect(
      strategy.stakeToBondSingleAll(WFTM_BOND, [])
    ).to.be.revertedWith("Route must start with rebaseToken!");

    // Valid bond goes through
    await strategy.stakeToBondSingleAll(WFTM_BOND, SPA_WFTM_ROUTE);

    const bondDetailsAfter = await wftmBondDepository.bondInfo(
      strategy.address
    );
    const pricePaid = ethers.utils.formatUnits(bondDetailsAfter.pricePaid, 18);
    const payout = parseFloat(
      ethers.utils.formatUnits(bondDetailsAfter.payout, 9)
    );
    const parsedFTMPrice = parseFloat(ethers.utils.formatUnits(ftmPrice, 8));
    const parsedFTMOut = parseFloat(ethers.utils.formatEther(ftmOut));

    const truncatedPayout = truncateToFixed(
      (parsedFTMPrice * parsedFTMOut) / pricePaid,
      9
    );

    expect(payout).to.lte(parseFloat(truncatedPayout) / 0.999);
    expect(payout).to.gte(parseFloat(truncatedPayout) * 0.999);
    expect(await strategy.isBonding()).to.be.true;
  }).timeout(TEST_TIMEOUT);

  it("Can go from staking to bonding double-sided", async function () {
    await forceBondPositive(
      ethers.provider,
      spaDaiBondDepository,
      strategy,
      lpBondCalculator,
      SPA_DAI_PAIR
    );
    const rebaseTokenBalStart = await spa.balanceOf(deployer.address);
    const daiValueInitial = ethers.utils.formatEther(
      await strategy.rebaseTokenPriceInUSD(rebaseTokenBalStart)
    );

    await vault.deposit(rebaseTokenBalStart); // Goes straight to staking

    const spaStaked = await stakedSpa.balanceOf(strategy.address);
    const spaBalanceBeforeBonding = await spa.balanceOf(strategy.address);
    expect(spaStaked).to.equal(rebaseTokenBalStart); // Confirmed the SPA is staked
    expect(spaBalanceBeforeBonding).to.equal(0);

    // Now go from staking to bonding...
    await strategy.addBond(SPA_DAI_BOND);
    await strategy.stakeToBondLP(spaStaked, SPA_DAI_BOND, [SPA], SPA_DAI_ROUTE);
    expect(await strategy.unstakedRebasing()).to.equal(0); // Confirm that no unstaked spa is left
    expect(await strategy.stakedRebasing()).to.lt(
      ethers.utils.parseUnits("0.01", 9)
    ); // Not exactly 0 as division by 2 may leave some SPA

    const bondDetails = await spaDaiBondDepository.bondInfo(strategy.address);
    const pricePaid = ethers.utils.formatUnits(bondDetails.pricePaid, 18);
    const payout = parseFloat(ethers.utils.formatUnits(bondDetails.payout, 9));
    const calculatedPayout = parseFloat(daiValueInitial / pricePaid);

    // Should expect calculated to be a bit more as fee takes away some value
    // when swapping SPA for the bond token
    expect(payout).to.lte(calculatedPayout);
    expect(payout).to.gt(calculatedPayout * 0.99);
    expect(await strategy.isBonding()).to.be.true;
  }).timeout(TEST_TIMEOUT);

  it("Can't bond more than SPA staked", async function () {
    await forceBondPositive(ethers.provider, daiBondDepository, strategy);
    const rebaseTokenBalStart = await spa.balanceOf(deployer.address);
    const daiValueInitial = ethers.utils.formatEther(
      await strategy.rebaseTokenPriceInUSD(rebaseTokenBalStart)
    );

    await vault.deposit(rebaseTokenBalStart); // Goes straight to staking

    const spaStaked = await stakedSpa.balanceOf(strategy.address);
    expect(spaStaked).to.equal(rebaseTokenBalStart); // Confirmed the SPA is staked

    // Now go from staking to bonding...
    await strategy.addBond(DAI_BOND);
    // Trying to stake more than available...
    await strategy.stakeToBondSingle(spaStaked.mul(2), DAI_BOND, SPA_DAI_ROUTE);

    const spaStakedAfterBonding = await stakedSpa.balanceOf(strategy.address);
    const spaAfterBonding = await spa.balanceOf(strategy.address);
    expect(spaStakedAfterBonding).to.equal(0); // Confirmed the SPA is no longer staked
    expect(spaAfterBonding).to.equal(0);

    const bondDetails = await daiBondDepository.bondInfo(strategy.address);
    const pricePaid = ethers.utils.formatUnits(bondDetails.pricePaid, 18);
    const payout = parseFloat(ethers.utils.formatUnits(bondDetails.payout, 9));
    const calculatedPayout = parseFloat(daiValueInitial / pricePaid);

    // Should expect calculated to be a bit more as fee takes away some value
    // when swapping SPA for the bond token
    expect(payout).to.lte(calculatedPayout);
    expect(payout).to.gt(calculatedPayout * 0.99);
  }).timeout(TEST_TIMEOUT);

  it("stakeToBond with amount > sSPA in strat bonds all available rebasing", async function () {
    await forceBondPositive(ethers.provider, daiBondDepository, strategy);
    const rebaseTokenBalStart = await spa.balanceOf(deployer.address);
    const daiValueInitial = ethers.utils.formatEther(
      await strategy.rebaseTokenPriceInUSD(rebaseTokenBalStart)
    );

    await vault.deposit(rebaseTokenBalStart.div(2));

    await strategy.addBond(DAI_BOND);
    await strategy.stakeToBondSingle(
      rebaseTokenBalStart,
      DAI_BOND,
      SPA_DAI_ROUTE
    );

    const spaStakedAfterBonding = await stakedSpa.balanceOf(strategy.address);
    const spaAfterBonding = await spa.balanceOf(strategy.address);
    expect(spaStakedAfterBonding).to.equal(0); // There should be none left
    expect(spaAfterBonding).to.equal(0);

    const bondDetails = await daiBondDepository.bondInfo(strategy.address);
    const pricePaid = ethers.utils.formatUnits(bondDetails.pricePaid, 18);
    const payout = parseFloat(ethers.utils.formatUnits(bondDetails.payout, 9));
    const calculatedPayout = parseFloat(daiValueInitial / pricePaid);

    // Payout should be based on half of rebaseTokenBalStart
    expect(payout).to.lte(calculatedPayout / 2);
    expect(payout).to.gt((calculatedPayout * 0.99) / 2);
    expect(await strategy.isBonding()).to.be.true;
  }).timeout(TEST_TIMEOUT);

  it("Won't bond more than the max amount for DAI bond", async function () {
    await forceBondPositive(ethers.provider, daiBondDepository, strategy);
    const maxSpaBondSize = await strategy.maxBondSize(DAI_BOND);
    await vault
      .connect(whale)
      .deposit(maxSpaBondSize.add(ethers.utils.parseUnits("1000", 9)));
    const stratSpa = await stakedSpa.balanceOf(strategy.address);
    const maxPayout = await daiBondDepository.maxPayout();

    expect(stratSpa).to.be.gt(maxSpaBondSize);

    await strategy.addBond(DAI_BOND);
    await strategy.stakeToBondSingleAll(DAI_BOND, SPA_DAI_ROUTE);

    const stakedSpaAfterBond = await stakedSpa.balanceOf(strategy.address);

    expect(stakedSpaAfterBond).to.equal(stratSpa.sub(maxSpaBondSize));

    const bondDetails = await daiBondDepository.bondInfo(strategy.address);

    // NOTICE: We get slipped pretty bad here, should aim to keep vaults sub 3k SPA
    expect(bondDetails.payout).to.be.lte(maxPayout);
    expect(bondDetails.payout).to.be.gt(maxPayout.mul(95).div(100));
  }).timeout(TEST_TIMEOUT);

  it("Won't bond more than the max amount for WFTM bond", async function () {
    await forceBondPositive(ethers.provider, wftmBondDepository, strategy);
    const maxSpaBondSize = await strategy.maxBondSize(WFTM_BOND);
    await vault
      .connect(whale)
      .deposit(maxSpaBondSize.add(ethers.utils.parseUnits("1000", 9)));
    const stratSpa = await stakedSpa.balanceOf(strategy.address);
    const maxPayout = await wftmBondDepository.maxPayout();

    expect(stratSpa).to.be.gt(maxSpaBondSize);

    await strategy.addBond(WFTM_BOND);
    await strategy.stakeToBondSingleAll(WFTM_BOND, SPA_WFTM_ROUTE);

    const stakedSpaAfterBond = await stakedSpa.balanceOf(strategy.address);

    expect(stakedSpaAfterBond).to.equal(stratSpa.sub(maxSpaBondSize));

    const bondDetails = await wftmBondDepository.bondInfo(strategy.address);

    // NOTICE: We get slipped pretty bad here, should aim to keep vaults sub 3k SPA
    expect(bondDetails.payout).to.be.lte(maxPayout);
    expect(bondDetails.payout).to.be.gt(maxPayout.mul(80).div(100));
  }).timeout(TEST_TIMEOUT);

  it("Won't bond more than the max amount for DAI-SPA LP bond", async function () {
    await forceBondPositive(
      ethers.provider,
      spaDaiBondDepository,
      strategy,
      lpBondCalculator,
      SPA_DAI_PAIR
    );
    const maxSpaBondSize = await strategy.maxBondSize(SPA_DAI_BOND);
    await vault
      .connect(whale)
      .deposit(maxSpaBondSize.add(ethers.utils.parseUnits("1000", 9)));
    const stratSpa = await stakedSpa.balanceOf(strategy.address);
    const maxPayout = await spaDaiBondDepository.maxPayout();

    expect(stratSpa).to.be.gt(maxSpaBondSize);

    await strategy.addBond(SPA_DAI_BOND);
    await strategy.stakeToBondLPAll(SPA_DAI_BOND, [SPA], SPA_DAI_ROUTE);

    const stakedSpaAfterBond = await stakedSpa.balanceOf(strategy.address);

    expect(stakedSpaAfterBond).to.equal(stratSpa.sub(maxSpaBondSize));

    const bondDetails = await spaDaiBondDepository.bondInfo(strategy.address);

    expect(bondDetails.payout).to.be.lte(maxPayout);
    expect(bondDetails.payout).to.be.gt(maxPayout.mul(98).div(100));
  }).timeout(TEST_TIMEOUT);

  it.skip("Will not bond into a negative bond", async function () {
    await vault.depositAll();

    await strategy.addBond(DAI_BOND);
    await strategy.addBond(WFTM_BOND);
    await strategy.addBond(SPA_DAI_BOND);

    await forceBondNegative(ethers.provider, daiBondDepository, strategy);
    await forceBondNegative(ethers.provider, wftmBondDepository, strategy);
    await forceBondNegative(
      ethers.provider,
      spaDaiBondDepository,
      strategy,
      lpBondCalculator,
      SPA_DAI_PAIR
    );

    await expect(
      strategy.stakeToBondSingle(
        rebaseTokenBalStart.div(2),
        DAI_BOND,
        SPA_DAI_ROUTE
      )
    ).to.be.revertedWith("!bondIsPositive");
    await expect(
      strategy.stakeToBondSingle(
        rebaseTokenBalStart.div(2),
        WFTM_BOND,
        SPA_WFTM_ROUTE
      )
    ).to.be.revertedWith("!bondIsPositive");
    await expect(
      strategy.stakeToBondLP(
        rebaseTokenBalStart.div(2),
        SPA_DAI_BOND,
        [SPA],
        SPA_DAI_ROUTE
      )
    ).to.be.revertedWith("!bondIsPositive");

    await expect(
      strategy.stakeToBondSingleAll(DAI_BOND, SPA_DAI_ROUTE)
    ).to.be.revertedWith("!bondIsPositive");
    await expect(
      strategy.stakeToBondSingleAll(WFTM_BOND, SPA_WFTM_ROUTE)
    ).to.be.revertedWith("!bondIsPositive");
    await expect(
      strategy.stakeToBondLPAll(SPA_DAI_BOND, [SPA], SPA_DAI_ROUTE)
    ).to.be.revertedWith("!bondIsPositive");
  }).timeout(TEST_TIMEOUT);
});
