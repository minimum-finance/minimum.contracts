const hardhat = require("hardhat");
const { ethers } = hardhat;
const { TOKEN_ADDR_TO_NAME } = require("../constants.js");
const { getERC20At } = require("../utils/testUtils.ts");

const stakeConfig = {
  unstakedToken: "0x4B209fd2826e6880e9605DCAF5F8dB0C2296D6d2",
  stakerContract: "0x1cED6A6253388A56759da72F16D16544577D4dB7",
  stakerAddr: "0x0ed9bB13cB4024555C7cC6374501e796b79e1a7f",
  stakeAmount: ethers.utils.parseUnits("20", 9),
  tokenName: "FHM",
};

async function main() {
  const staker = await ethers.getContractAt(
    "IStakingManager",
    stakeConfig.stakerContract
  );

  const unstakedToken = await getERC20At(stakeConfig.unstakedToken);

  const unstakedBal = await unstakedToken.balanceOf(stakeConfig.stakerAddr);

  await unstakedToken.approve(
    stakeConfig.stakerContract,
    stakeConfig.stakeAmount
  );
  await staker.stake(stakeConfig.stakeAmount, stakeConfig.stakerAddr);

  console.log(
    `Staked ${ethers.utils.formatUnits(stakeConfig.stakeAmount, 9)} ${
      TOKEN_ADDR_TO_NAME[stakeConfig.unstakedToken]
    }`
  );
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = main;
