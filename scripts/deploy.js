const hardhat = require("hardhat");
const { ethers } = hardhat;
const {
  deployVaultAndStrategy,
  updateFenderVaults,
} = require("../utils/deployUtils.ts");
const { addressBook } = require("blockchain-addressbook");
const {
  SPA_STAKER,
  SPA_STAKE_MANAGER,
  SPA_DAI_PAIR,
  BOGUS_ADDR_1,
  BOGUS_ADDR_3,
} = require("../constants.js");

const { spookyswap } = addressBook.fantom.platforms;

const contractNames = {
  vault: "MinimumVault",
  strategy: "StrategySpartacus",
};

const vaultConfig = {
  name: "Minimum Spartacus",
  symbol: "minSPA",
  stratApprovalDelay: 21600,
  wantCap: ethers.utils.parseUnits("6000", 9),
};

const stratConfig = {
  rebaseStaker: SPA_STAKER,
  stakeManager: SPA_STAKE_MANAGER,
  keeper: BOGUS_ADDR_1,
  unirouter: spookyswap.router,
  serviceFeeRecipient: BOGUS_ADDR_3,
  minDeposit: 100,
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

  await updateFenderVaults(vault.address);
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
