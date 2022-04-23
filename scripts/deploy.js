const hardhat = require("hardhat");
const { ethers } = hardhat;
const {
  deployVaultAndStrategy,
  updateFenderVaults,
  updateContractConfig,
} = require("../utils/deployUtils.ts");
const { addressBook } = require("blockchain-addressbook");
const {
  BOGUS_ADDR_1,
  BOGUS_ADDR_3,
  FHM_STAKER,
  FHM_STAKE_MANAGER,
} = require("../constants.js");

const { spookyswap } = addressBook.fantom.platforms;

const contractNames = {
  vault: "MinimumVault",
  strategy: "StrategyFantOHM",
  vaultID: "fantohm-fhm",
};

const vaultConfig = {
  name: "Minimum FantOHM",
  symbol: "minFHM",
  stratApprovalDelay: 21600,
  wantCap: ethers.utils.parseUnits("50", 9),
};

const TESTNET_STAKER = "0x1cED6A6253388A56759da72F16D16544577D4dB7";
const TESTNET_ROUTER = "0xcCAFCf876caB8f9542d6972f87B5D62e1182767d";
const TESTNET_BURNER = "0x0ed9bB13cB4024555C7cC6374501e796b79e1a7f";

const stratConfig = {
  rebaseStaker: FHM_STAKER,
  stakeManager: FHM_STAKE_MANAGER,
  keeper: "0xC6cE315Ad5c636452aB28B4Dcd650C9212a4B92a",
  unirouter: spookyswap.router,
  serviceFeeRecipient: "0x1d116207f651bEdB7f05160B7Ac9b2Ce1A6b33B1",
  minDeposit: 1000000,
  discordLink: "https://discord.gg/fS5ZUwDtVK",
};

async function main() {
  await hardhat.run("compile");

  const [deployer] = await ethers.getSigners();

  const deployed = await deployVaultAndStrategy(
    contractNames,
    vaultConfig,
    stratConfig,
    deployer
  );

  const vault = deployed.vault;
  const strategy = deployed.strategy;

  console.log("Vault deployed to: ", vault.address);
  console.log("Strategy deployed to: ", strategy.address);

  //await updateFenderVaults(vault.address, contractNames.vaultID);
  await updateContractConfig(vault.address, strategy.address);
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
