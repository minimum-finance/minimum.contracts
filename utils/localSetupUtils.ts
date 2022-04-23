const {
  getUnirouterData,
  swapNativeForToken,
  getERC20At,
} = require("../utils/testUtils.ts");
const { ethers } = require("hardhat");
const {
  LOCAL_ACC_PRIVATE,
  LOCAL_ACC_ADDR,
  TOKEN_ADDR_TO_NAME,
} = require("../constants");
const { addressBook } = require("blockchain-addressbook");

const { spookyswap } = addressBook.fantom.platforms;

const {
  SCREAM: { address: SCREAM },
  fUSDT: { address: fUSDT },
  WFTM: { address: WFTM },
  ETH: { address: ETH },
  WBTC: { address: WBTC },
  DAI: { address: DAI },
} = addressBook.fantom.tokens;

const swapForToken = async (
  provider,
  tokenAddr,
  signer = null,
  ftmAmount = 500,
  recipient = LOCAL_ACC_ADDR,
  unirouterAddr = spookyswap.router,
  privateKey = LOCAL_ACC_PRIVATE
) => {
  if (signer == null) {
    signer = new ethers.Wallet(privateKey, provider);
  }
  const unirouterData = getUnirouterData(unirouterAddr);

  const unirouter = await ethers.getContractAt(
    unirouterData.interface,
    unirouterAddr,
    signer
  );

  const token = await getERC20At(tokenAddr);

  await swapNativeForToken({
    unirouter,
    amount: ethers.utils.parseEther("" + ftmAmount),
    nativeTokenAddr: WFTM,
    token: token,
    recipient: recipient,
    swapSignature: unirouterData.swapSignature,
  });

  console.log(`Swapped ${ftmAmount} FTM for ${TOKEN_ADDR_TO_NAME[tokenAddr]}`);
};

const stakeTokens = async (
  provider,
  token,
  stakingHelper,
  signer = null,
  privateKey = LOCAL_ACC_PRIVATE
) => {
  const unstaked = await getERC20At(token);
  const staker = await ethers.getContractAt("IRebaseStaker", stakingHelper);
  if (signer == null) {
    signer = new ethers.Wallet(privateKey, provider);
  }
  const amount = await unstaked.balanceOf(signer.address);

  await unstaked.connect(signer).approve(stakingHelper, amount);
  await staker.stake(amount);

  console.log(
    `Staked ${ethers.utils.formatUnits(amount, 9)} ${TOKEN_ADDR_TO_NAME[token]}`
  );
};

module.exports = {
  swapForToken,
  stakeTokens,
};
