const hardhat = require("hardhat");
const { ethers } = hardhat;
const {
  FHM_DAI_BOND,
  FHM_DAI_ROUTE,
  FHM,
  TOKEN_ADDR_TO_NAME,
} = require("../constants.js");
const fs = require("fs");
const { minimizeBondPeriod } = require("../utils/testUtils.ts");

const contractNames = {
  vault: "MinimumVault",
  strategy: "StrategyFantOHM",
};

const redeemAndStakeConfig = {
  ...contractNames,
  bondAddr: FHM_DAI_BOND,
  rebaseToken: FHM,
};

async function main() {
  const [deployer] = await ethers.getSigners();

  const contractAddresses = JSON.parse(
    fs.readFileSync("./contractConfig.json")
  );

  const strategy = await ethers.getContractAt(
    contractNames.strategy,
    contractAddresses.strategyAddress
  );

  await strategy.connect(deployer).redeemAndStake();

  console.log(`Redeemed and staked for bond: ${redeemAndStakeConfig.bondAddr}`);
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
