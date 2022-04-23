const { ethers } = require("hardhat");
const hre = require("hardhat");
const {
  STAKED_SPA,
  DAI,
  DAI_WFTM_PAIR,
  SHORTEST_BOND_LENGTH,
  BOGUS_ADDR_3,
} = require("../constants");
const { deployVaultAndStrategy } = require("./deployUtils.ts");

const getUnirouterData = (address) => {
  switch (address) {
    case "0xA52aBE4676dbfd04Df42eF7755F01A3c41f28D27":
    case "0x60aE616a2155Ee3d9A68541Ba4544862310933d4":
      return {
        interface: "IUniswapRouterAVAX",
        swapSignature: "swapExactAVAXForTokens",
      };
    case "0xf38a7A7Ac2D745E2204c13F824c00139DF831FFf":
      return {
        interface: "IUniswapRouterMATIC",
        swapSignature: "swapExactMATICForTokens",
      };
    case "0xA63B831264183D755756ca9AE5190fF5183d65D6":
      return {
        interface: "IUniswapRouterBNB",
        swapSignature: "swapExactBNBForTokens",
      };
    default:
      return {
        interface: "IUniswapRouterETH",
        swapSignature: "swapExactETHForTokens",
      };
  }
};

const swapNativeForToken = async ({
  unirouter,
  amount,
  nativeTokenAddr,
  token,
  recipient,
  swapSignature,
  route = null,
}) => {
  if (token.address === nativeTokenAddr) {
    await wrapNative(amount, nativeTokenAddr);
    return;
  }

  try {
    await unirouter[swapSignature](
      0,
      route || [nativeTokenAddr, token.address],
      recipient,
      5000000000,
      {
        value: amount,
      }
    );
  } catch (e) {
    console.log(`Could not swap for ${token.address}: ${e}`);
  }
};

const swapTokenForToken = async ({ unirouter, amount, route, recipient }) => {
  try {
    await unirouter["swapExactTokensForTokens"](
      amount,
      0,
      route,
      recipient,
      5000000000,
      {
        value: 0,
      }
    );
  } catch (e) {
    console.log(
      `Could not swap ${route[0]} for ${route[route.length - 1]}: ${e}`
    );
  }
};

const unpauseIfPaused = async (pausable, keeper) => {
  const paused = await pausable.paused();
  if (paused) {
    await pausable.connect(keeper).unpause();
  }
};

const wrapNative = async (amount, wNativeAddr) => {
  const wNative = await ethers.getContractAt("IWrappedNative", wNativeAddr);
  await wNative.deposit({ value: amount });
};

const getERC20At = async (address) =>
  await ethers.getContractAt(
    "@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20",
    address
  );

const impersonateAddr = async (provider, addr) => {
  await provider.send("hardhat_impersonateAccount", [addr]);
  return provider.getSigner(addr);
};

const resetForkedChain = async () => {
  // Parent directory's hardhat.config.js needs these to be set
  const forkUrl = hre.config.networks.hardhat.forking.url;
  const blockNumber = hre.config.networks.hardhat.forking.blockNumber;
  await hre.network.provider.request({
    method: "hardhat_reset",
    params: [
      {
        forking: {
          jsonRpcUrl: forkUrl,
          blockNumber: blockNumber,
        },
      },
    ],
  });
};

const getSuperWhale = async (
  provider,
  stakeManager,
  whales,
  token = STAKED_SPA,
  fundStaked = false
) => {
  const superWhaleAddr = whales[0];
  const superWhale = await impersonateAddr(provider, superWhaleAddr);
  const stakedRebase = await getERC20At(token);

  for (let i = 1; i < whales.length; i++) {
    let whale = await impersonateAddr(provider, whales[i]);
    let spaBal = await stakedRebase.balanceOf(whales[i]);
    await stakedRebase.connect(whale).transfer(superWhaleAddr, spaBal);
  }
  if (!fundStaked) {
    const superWhaleBal = await stakedRebase.balanceOf(superWhaleAddr);
    stakeManager.connect(superWhale).unstake(superWhaleBal, true);
  }

  return superWhale;
};

const convertWftmToDai = async (pair, amount) => {
  const [res0, res1] = await pair.getReserves();
  return amount.mul(res0).div(res1);
};

const localProvider = ethers.getDefaultProvider("http://localhost:8545");

// Travel {seconds} seconds into the future
const timeTravelBlockTime = async (provider, seconds) => {
  await provider.send("evm_increaseTime", [seconds]);
  await provider.send("evm_mine");
};

const adjustBondPeriod = async (provider, period, bond) => {
  const ownerAddr = await bond.policy();
  const owner = await impersonateAddr(provider, ownerAddr);

  await bond.connect(owner).setBondTerms(0, period);
};

// Make bonds as short as possible (10,000) blocks
const minimizeBondPeriod = async (provider, bond) => {
  await adjustBondPeriod(provider, SHORTEST_BOND_LENGTH, bond);
};

const timeTravelBlocks = async (provider, blocks) => {
  // Notice hardhat does not yet support mining many blocks with a single call
  // https://gitcoin.co/issue/nomiclabs/hardhat/1112
  // https://github.com/nomiclabs/hardhat/pull/2032
  for (let i = 0; i < blocks; i++) await provider.send("evm_mine");
};

const forceBondPrice = async (
  targetPrice,
  provider,
  bondDepository,
  strategy,
  bondCalculator = null,
  lpAddr = null
) => {
  const ownerAddr = await bondDepository.policy();
  const owner = await impersonateAddr(provider, ownerAddr);
  let isBondLP = false;
  try {
    isBondLP = await bondDepository.isLiquidityBond();
  } catch (error) {}

  const bondTerms = await bondDepository.terms();
  const debtRatio = await bondDepository.debtRatio();
  let assetPrice = ethers.utils.parseUnits("1", 8);
  try {
    assetPrice = await bondDepository.assetPrice();
  } catch (error) {}

  if (isBondLP)
    assetPrice = (await bondCalculator.markdown(lpAddr)).div(10 ** 10);
  // Notice, need to make bond price < rebasePrice
  // Bond Price = control variable * debtRatio + basePrice
  // Set base price so that bondPrice is $10 less than rebasePrice
  let targetBondPrice = targetPrice.div(assetPrice.mul(10));

  const basePrice = targetBondPrice.sub(
    bondTerms.controlVariable.mul(debtRatio)
  );

  await bondDepository.connect(owner).setBasePrice(basePrice);
};

const forceBondPositive = async (
  provider,
  bondDepository,
  strategy,
  bondCalculator = null,
  lpAddr = null
) =>
  await forceBondPrice(
    (await strategy.rebaseTokenPriceInUSD(1e9)).mul(90).div(100), // 10% Discount
    provider,
    bondDepository,
    strategy,
    bondCalculator,
    lpAddr
  );

const forceBondNegative = async (
  provider,
  bondDepository,
  strategy,
  bondCalculator = null,
  lpAddr = null
) =>
  await forceBondPrice(
    (await strategy.rebaseTokenPriceInUSD(1e9)).mul(110).div(100), // 10% Premium
    provider,
    bondDepository,
    strategy,
    bondCalculator,
    lpAddr
  );

const forceFHMBondMinimumPrice = async (
  provider,
  bondDepository,
  targetPrice,
  bondCalculator = null,
  lpAddr = null
) => {
  const ownerAddr = await bondDepository.policy();
  const owner = await impersonateAddr(provider, ownerAddr);

  let isBondLP = false;
  try {
    isBondLP = await bondDepository.isLiquidityBond();
  } catch (error) {}
  let assetPrice = 1e10;
  let parameter = 4;
  try {
    assetPrice = await bondDepository.assetPrice();
    parameter = 3;
  } catch (error) {}

  if (isBondLP) assetPrice = (await bondCalculator.markdown(lpAddr)).div(1e8);

  await bondDepository
    .connect(owner)
    .setBondTerms(parameter, targetPrice.div(assetPrice).div(1e6));
};

const forceFHMBondMinimumPositive = async (
  provider,
  bondDepository,
  strategy,
  bondCalculator = null,
  lpAddr = null
) =>
  await forceFHMBondMinimumPrice(
    provider,
    bondDepository,
    (await strategy.rebaseTokenPriceInUSD(1e9)).mul(100).div(110), // 10% Discount
    bondCalculator,
    lpAddr
  );

const forceFHMBondNegative = async (
  provider,
  bondDepository,
  strategy,
  bondCalculator = null,
  lpAddr = null
) =>
  await forceFHMBondMinimumPrice(
    provider,
    bondDepository,
    (await strategy.rebaseTokenPriceInUSD(1e9)).mul(110).div(100), // 10% Premium
    bondCalculator,
    lpAddr
  );

const forceMaxDebt = async (provider, bondDepository, target) => {
  const ownerAddr = await bondDepository.policy();
  const owner = await impersonateAddr(provider, ownerAddr);

  let parameter = 3;
  try {
    await bondDepository.assetPrice();
    parameter = 2;
  } catch (error) {}

  bondDepository.connect(owner).setBondTerms(parameter, target);
};

const forceHighMaxDebt = async (provider, bondDepository) =>
  await forceMaxDebt(
    provider,
    bondDepository,
    ethers.utils.parseEther("1000000000000")
  );

const truncateToFixed = (num, fixed) => {
  var re = new RegExp("^-?\\d+(?:.\\d{0," + (fixed || -1) + "})?");
  return num.toString().match(re)[0];
};

const whaleBond = async (whale, bondDepository, principleRoute, unirouter) => {
  const spaBondAmount = ethers.utils.parseUnits("5000", 9);
  const principleBondAmount = (
    await unirouter.getAmountsOut(spaBondAmount, principleRoute)
  )[principleRoute.length - 1];

  const principle = await getERC20At(await bondDepository.principle());

  await swapTokenForToken({
    unirouter: unirouter.connect(whale),
    amount: spaBondAmount,
    route: principleRoute,
    recipient: whale._address,
  });

  await principle
    .connect(whale)
    .approve(bondDepository.address, principleBondAmount);

  await bondDepository
    .connect(whale)
    .deposit(
      principleBondAmount.mul(98).div(100),
      ethers.utils.parseEther("10000"),
      whale._address
    );
};

const getPawn = async (
  provider,
  token,
  whale,
  gasStation,
  amount,
  vaultAddr
) => {
  const pawn = (await ethers.Wallet.createRandom()).connect(provider);
  await token.connect(whale).transfer(pawn.address, amount);
  await gasStation.sendTransaction({
    to: pawn.address,
    value: ethers.utils.parseEther("1"),
  });
  await token.connect(pawn).approve(vaultAddr, amount);
  return pawn;
};

const forceWarmupPeriod = async (provider, stakeManager, warmup) => {
  const stakeManagerOwnerAddr = await stakeManager.manager();
  const stakeManagerOwner = await impersonateAddr(
    provider,
    stakeManagerOwnerAddr
  );
  await stakeManager.connect(stakeManagerOwner).setWarmup(warmup);
};

const beforeHook = async ({
  provider,
  stratConfig,
  rebaseTokenAddr,
  stakedRebaseTokenAddr,
  daiBondAddr,
  wftmBondAddr,
  daiLPBondAddr,
  lpBondCalculatorAddr,
  stakeManagerAddr,
  whales,
  treasuryAddr,
  stakingHelperAddr,
  whaleToken = STAKED_SPA,
  fundStaked = false,
  warmup = 0,
  circulatingSupplyAddr = null,
}) => {
  await resetForkedChain();
  const daiBondDepository = await ethers.getContractAt(
    "IBondDepository",
    daiBondAddr
  );

  const wftmBondDepository = await ethers.getContractAt(
    "IWFTMBondDepository",
    wftmBondAddr
  );

  const daiLPBondDepository = await ethers.getContractAt(
    "IBondDepository",
    daiLPBondAddr
  );

  const stakeManager = await ethers.getContractAt(
    "IStakingManager",
    stakeManagerAddr
  );

  const daiWftmPair = await ethers.getContractAt(
    "IUniswapV2Pair",
    DAI_WFTM_PAIR
  );

  const lpBondCalculator = await ethers.getContractAt(
    "IBondCalculator",
    lpBondCalculatorAddr
  );

  const stakingHelper = await ethers.getContractAt(
    "IRebaseStaker",
    stakingHelperAddr
  );

  const circulatingSupply = circulatingSupplyAddr
    ? await ethers.getContractAt("ICirculatingSupply", circulatingSupplyAddr)
    : null;

  await forceWarmupPeriod(provider, stakeManager, warmup);

  const treasury = await ethers.getContractAt("ITreasury", treasuryAddr);

  const dai = await getERC20At(DAI);

  const whale = await getSuperWhale(
    ethers.provider,
    stakeManager,
    whales,
    whaleToken,
    fundStaked
  );

  const unirouterAddr = stratConfig.unirouter;
  const unirouterData = getUnirouterData(unirouterAddr);

  const unirouter = await ethers.getContractAt(
    unirouterData.interface,
    unirouterAddr
  );

  return {
    rebaseToken: await getERC20At(rebaseTokenAddr),
    stakedRebaseToken: await getERC20At(stakedRebaseTokenAddr),
    unirouter,
    unirouterData,
    whale,
    daiBondDepository,
    wftmBondDepository,
    daiLPBondDepository,
    lpBondCalculator,
    treasury,
    daiWftmPair,
    stakeManager,
    dai,
    stakingHelper,
    circulatingSupply,
  };
};

const beforeEachHook = async ({
  contractNames,
  vaultConfig,
  stratConfig,
  unirouter,
  rebaseToken,
  stakedRebaseToken,
  whale,
  fundStaked = false,
}) => {
  const [deployer, keeper, other] = await ethers.getSigners();

  const deployed = await deployVaultAndStrategy(
    contractNames,
    vaultConfig,
    stratConfig,
    deployer
  );

  // Burn any staked/unstaked funds the deployer/whale may have
  const balStaked = await stakedRebaseToken.balanceOf(deployer.address);
  const balUnstaked = await rebaseToken.balanceOf(deployer.address);
  const balUnstakedWhale = await rebaseToken.balanceOf(whale._address);

  await stakedRebaseToken.transfer(BOGUS_ADDR_3, balStaked);
  await rebaseToken.transfer(BOGUS_ADDR_3, balUnstaked);
  await rebaseToken.connect(whale).transfer(BOGUS_ADDR_3, balUnstakedWhale);

  let rebaseTokenBalStart;

  if (fundStaked) {
    await stakedRebaseToken
      .connect(whale)
      .transfer(deployer.address, ethers.utils.parseUnits("5", 9));
    rebaseTokenBalStart = await stakedRebaseToken.balanceOf(deployer.address);
  } else {
    await rebaseToken
      .connect(whale)
      .transfer(deployer.address, ethers.utils.parseUnits("5", 9));
    rebaseTokenBalStart = await rebaseToken.balanceOf(deployer.address);
  }

  await rebaseToken.approve(
    deployed.vault.address,
    rebaseTokenBalStart.mul(10 ** 5)
  );
  await stakedRebaseToken.approve(
    deployed.vault.address,
    rebaseTokenBalStart.mul(10 ** 5)
  );
  await rebaseToken
    .connect(whale)
    .approve(deployed.vault.address, ethers.utils.parseEther("10000"));
  await rebaseToken
    .connect(whale)
    .approve(unirouter.address, ethers.utils.parseEther("10000"));
  await stakedRebaseToken
    .connect(whale)
    .approve(deployed.vault.address, ethers.utils.parseEther("10000"));
  await stakedRebaseToken
    .connect(whale)
    .approve(unirouter.address, ethers.utils.parseEther("10000"));

  return {
    vault: deployed.vault,
    strategy: deployed.strategy,
    rebaseTokenBalStart: rebaseTokenBalStart,
    daiValueInitial:
      deployed.strategy.rebaseTokenPriceInUSD(rebaseTokenBalStart),
    deployer,
    keeper,
    other,
  };
};

const forceFHMBondPositive = async (
  provider,
  bondDepository,
  circulatingSupply,
  isNonStable = false
) => {
  const owner = await impersonateAddr(provider, await bondDepository.policy());
  const vestingTerm = 15;
  const minPrice = 0;
  const maxDiscount = 1000;
  const maxPayout = 1000;
  const fee = 10000;
  const maxDebt = ethers.utils.parseEther("5");
  const initialDebt = (await circulatingSupply.OHMCirculatingSupply()).div(1e9);

  if (isNonStable) {
    await bondDepository
      .connect(owner)
      .initializeBondTerms(
        1,
        vestingTerm,
        minPrice,
        maxDiscount,
        maxPayout,
        maxDebt,
        initialDebt
      );
  } else {
    await bondDepository
      .connect(owner)
      .initializeBondTerms(
        1,
        vestingTerm,
        minPrice,
        maxDiscount,
        maxPayout,
        fee,
        maxDebt,
        initialDebt
      );
  }
};

module.exports = {
  getUnirouterData,
  swapNativeForToken,
  swapTokenForToken,
  unpauseIfPaused,
  getERC20At,
  impersonateAddr,
  localProvider,
  getSuperWhale,
  convertWftmToDai,
  timeTravelBlockTime,
  timeTravelBlocks,
  truncateToFixed,
  beforeHook,
  beforeEachHook,
  adjustBondPeriod,
  minimizeBondPeriod,
  forceBondPositive,
  forceBondNegative,
  forceBondPrice,
  whaleBond,
  resetForkedChain,
  getPawn,
  forceFHMBondNegative,
  forceFHMBondMinimumPrice,
  forceFHMBondMinimumPositive,
  forceHighMaxDebt,
  forceWarmupPeriod,
  forceFHMBondPositive,
};
