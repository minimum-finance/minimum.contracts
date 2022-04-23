const hardhat = require("hardhat");
const { ethers } = hardhat;
const {
  FHM_DAI_BOND,
  FHM_DAI_ROUTE,
  FHM,
  TOKEN_ADDR_TO_NAME,
  FHM_DAI_LP_BOND,
} = require("../constants.js");
const fs = require("fs");
const { minimizeBondPeriod } = require("../utils/testUtils.ts");

const contractNames = {
  vault: "MinimumVault",
  strategy: "StrategyFantOHM",
};

const stakeToBondConfig = {
  ...contractNames,
  bondAddr: FHM_DAI_LP_BOND,
  //bondPrincipleRoute: FHM_DAI_ROUTE,
  isLP: true,
  bondPrinciple1Route: FHM_DAI_ROUTE,
  bondPrinciple2Route: [FHM, FHM],
  rebaseToken: FHM,
};

async function main() {
  const [deployer] = await ethers.getSigners();

  const contractAddresses = JSON.parse(
    fs.readFileSync("./contractConfig.json")
  );

  /*
  const bondDepository = await ethers.getContractAt(
    "IBondDepository",
    stakeToBondConfig.bondAddr
  );

  await minimizeBondPeriod(ethers.provider, bondDepository);
   */

  const strategy = await ethers.getContractAt(
    contractNames.strategy,
    contractAddresses.strategyAddress
  );

  const bondIsValid = await strategy.isBondValid(stakeToBondConfig.bondAddr);

  if (!bondIsValid)
    await strategy.connect(deployer).addBond(stakeToBondConfig.bondAddr);

  const bondBal = await strategy.totalRebasing();
  if (stakeToBondConfig.isLP) {
    await strategy
      .connect(deployer)
      .stakeToBondLPAll(
        stakeToBondConfig.bondAddr,
        stakeToBondConfig.bondPrinciple1Route,
        stakeToBondConfig.bondPrinciple2Route
      );
  } else {
    await strategy
      .connect(deployer)
      .stakeToBondSingleAll(
        stakeToBondConfig.bondAddr,
        stakeToBondConfig.bondPrincipleRoute
      );
  }

  console.log(
    `Bonded ${ethers.utils.formatUnits(bondBal, 9)} ${
      TOKEN_ADDR_TO_NAME[stakeToBondConfig.rebaseToken]
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
