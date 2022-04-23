const hardhat = require("hardhat");
const { ethers } = require("hardhat");

async function main() {
  await hardhat.run("compile");

  const MulticallFactory = await ethers.getContractFactory("Multicall");
  const multiCall = await MulticallFactory.deploy();

  await multiCall.deployed();

  console.log("Multicall deployed to: ", multiCall.address);
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
