const { ethers } = require("hardhat");
const hre = require("hardhat");
const {
  SPA_WHALES,
  STAKED_SPA,
  DAI,
  WFTM_BOND,
  DAI_BOND,
  SPA_DAI_BOND,
  SPA_STAKE_MANAGER,
  DAI_WFTM_PAIR,
  WFTM,
  SHORTEST_BOND_LENGTH,
  SPA_DAI_BOND_CALCULATOR,
  SPA_TREASURY,
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
}) => {
  if (token.address === nativeTokenAddr) {
    await wrapNative(amount, nativeTokenAddr);
    return;
  }

  try {
    await unirouter[swapSignature](
      0,
      [nativeTokenAddr, token.address],
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

const getSuperSPAWhale = async (provider, stakeManager) => {
  const superWhaleAddr = SPA_WHALES[0];
  const superWhale = await impersonateAddr(provider, superWhaleAddr);
  const stakedSpa = await getERC20At(STAKED_SPA);

  for (let i = 1; i < SPA_WHALES.length; i++) {
    let whale = await impersonateAddr(provider, SPA_WHALES[i]);
    let spaBal = await stakedSpa.balanceOf(SPA_WHALES[i]);
    await stakedSpa.connect(whale).transfer(superWhaleAddr, spaBal);
  }
  const superWhaleBal = await stakedSpa.balanceOf(superWhaleAddr);
  stakeManager.connect(superWhale).unstake(superWhaleBal, true);

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
  for (let i = 0; i < blocks; i++) provider.send("evm_mine");
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

const beforeHook = async ({
  stratConfig,
  rebaseTokenAddr,
  stakedRebaseTokenAddr,
}) => {
  await resetForkedChain();
  const daiBondDepository = await ethers.getContractAt(
    "IBondDepository",
    DAI_BOND
  );

  const wftmBondDepository = await ethers.getContractAt(
    "IWFTMBondDepository",
    WFTM_BOND
  );

  const spaDaiBondDepository = await ethers.getContractAt(
    "IBondDepository",
    SPA_DAI_BOND
  );

  const stakeManager = await ethers.getContractAt(
    "IStakingManager",
    SPA_STAKE_MANAGER
  );

  const daiWftmPair = await ethers.getContractAt(
    "IUniswapV2Pair",
    DAI_WFTM_PAIR
  );

  const spaDaiBondCalculator = await ethers.getContractAt(
    "IBondCalculator",
    SPA_DAI_BOND_CALCULATOR
  );

  const spaTreasury = await ethers.getContractAt("ITreasury", SPA_TREASURY);

  const dai = await getERC20At(DAI);

  const whale = await getSuperSPAWhale(ethers.provider, stakeManager);

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
    spaDaiBondDepository,
    spaDaiBondCalculator,
    spaTreasury,
    daiWftmPair,
    stakeManager,
    dai,
  };
};

const beforeEachHook = async ({
  contractNames,
  vaultConfig,
  stratConfig,
  unirouter,
  rebaseToken,
  whale,
}) => {
  const [deployer, keeper, other] = await ethers.getSigners();

  const deployed = await deployVaultAndStrategy(
    contractNames,
    vaultConfig,
    stratConfig,
    deployer
  );

  const unirouterData = getUnirouterData(unirouter.address);

  await swapNativeForToken({
    unirouter,
    amount: ethers.utils.parseEther("100"),
    nativeTokenAddr: WFTM,
    token: rebaseToken,
    recipient: deployer.address,
    swapSignature: unirouterData.swapSignature,
  });

  const rebaseTokenBalStart = await rebaseToken.balanceOf(deployer.address);

  const whaleSpa = await rebaseToken.balanceOf(whale._address);
  await rebaseToken.approve(
    deployed.vault.address,
    rebaseTokenBalStart.mul(10 ** 5)
  );
  await rebaseToken.connect(whale).approve(deployed.vault.address, whaleSpa);
  await rebaseToken.connect(whale).approve(unirouter.address, whaleSpa);

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

module.exports = {
  getUnirouterData,
  swapNativeForToken,
  swapTokenForToken,
  unpauseIfPaused,
  getERC20At,
  impersonateAddr,
  localProvider,
  getSuperSPAWhale,
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
};
