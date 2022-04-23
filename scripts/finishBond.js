const { ethers } = require("hardhat");
const { SHORTEST_BOND_LENGTH } = require("../constants.js");
const { timeTravelBlocks } = require("../utils/testUtils.ts");
const fs = require("fs");

const contractNames = {
  vault: "MinimumVault",
  strategy: "StrategyFantOHM",
};

async function main() {
  await timeTravelBlocks(ethers.provider, SHORTEST_BOND_LENGTH);

  const contractAddresses = JSON.parse(
    fs.readFileSync("./contractConfig.json")
  );

  const strategy = await ethers.getContractAt(
    contractNames.strategy,
    contractAddresses.strategyAddress
  );

  await strategy.redeemAndStake();

  console.log(
    `Time traveled ${SHORTEST_BOND_LENGTH} blocks and redeemed the bond`
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
