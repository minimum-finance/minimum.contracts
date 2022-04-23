require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-web3");
require("@nomiclabs/hardhat-ethers");
require("hardhat-gas-reporter");
require("@nomiclabs/hardhat-etherscan");

const {
  SKIP_TEST_FLAG,
  SPARTACUS_TEST_FLAG,
  FANTOHM_TEST_FLAG,
  VAULT_TEST_FLAG,
} = require("./constants");

let config = {
  mocha: {
    grep: `${SKIP_TEST_FLAG}|${SPARTACUS_TEST_FLAG}|${VAULT_TEST_FLAG}`,
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

const privateKey =
  "1a606c5428853b04492907ef541644bbcc149c93542543ca0bb431b56660323f";

const ownerPrivate = "";

const ALCHEMY_API_KEY = "Lfg5h2hGB5k_s-ObFDYZ9O7b0uc1NN0O";

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
    opera: {
      chainId: 250,
      url: "https://rpc.ftm.tools/",
      //accounts: [ownerPrivate]
    },
    testnet: {
      chainId: 0xfa2,
      url: "https://rpc.testnet.fantom.network/",
      //accounts: [ownerPrivate],
    },
    ropsten: {
      url: `https://eth-ropsten.alchemyapi.io/v2/${ALCHEMY_API_KEY}`,
      accounts: [privateKey],
    },
    hardhat: {
      chainId: 1337,
      forking: {
        url: "https://rpc.ftm.tools/",
        blockNumber: 30589697,
      },
    },
  },
  mocha: config.mocha,
  gasReporter: config.gasReporter,
  etherscan: {
    apiKey: {
      opera: "Y6VN26THPYU97I8XXC91TZ3BGSNZ7XFRDJ",
      ftmTestnet: "Y6VN26THPYU97I8XXC91TZ3BGSNZ7XFRDJ",
      ropsten: "75QG2FN2UIM853PD23U3BW98VFXUERIE99",
    },
  },
};
