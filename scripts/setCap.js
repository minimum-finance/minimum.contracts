const hardhat = require("hardhat");
const { ethers } = hardhat;
const fs = require("fs");

const contractNames = {
  vault: "MinimumVault",
  strategy: "StrategyFantOHM",
};

const setCapConfig = {
  ...contractNames,
  cap: ethers.utils.parseUnits("100", 9),
};

async function main() {
  const [deployer] = await ethers.getSigners();

  const contractAddresses = JSON.parse(
    fs.readFileSync("./contractConfig.json")
  );

  const vault = await ethers.getContractAt(
    contractNames.vault,
    contractAddresses.vaultAddress
  );

  await vault.connect(deployer).setCap(setCapConfig.cap);

  console.log(
    `Set cap to: ${setCapConfig.cap} for vault: ${contractAddresses.vaultAddress}`
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
