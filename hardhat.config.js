require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-web3");
require("@nomiclabs/hardhat-ethers");
require("hardhat-gas-reporter");

const { SKIP_TEST_FLAG } = require("./constants");

let config = {
  mocha: {
    grep: SKIP_TEST_FLAG,
    invert: true,
    forbidOnly: true,
    timeout: 100000,
  },
  gasReporter: {
    currency: "USD",
    gasPrice: 600,
  },
};

try {
  config = require("./local-config.json");
} catch (error) {}

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async (taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.6.12",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
  },
  networks: {
    hardhat: {
      chainId: 1337,
      forking: {
        url: "https://rpc.ftm.tools/",
        blockNumber: 26917583,
      },
    },
  },
  mocha: config.mocha,
  gasReporter: config.gasReporter,
};
