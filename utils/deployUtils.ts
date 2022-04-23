const { web3, ethers } = require("hardhat");
const rlp = require("rlp");
const keccak = require("keccak");
const fs = require("fs");

const predictAddresses = async ({ creator }) => {
  creator = creator || "0x565EB5e5B21F97AE9200D121e77d2760FFf106cb";

  let currentNonce = await web3.eth.getTransactionCount(creator);
  let currentNonceHex = `0x${currentNonce.toString(16)}`;
  let currentInputArr = [creator, currentNonceHex];
  let currentRlpEncoded = rlp.encode(currentInputArr);
  let currentContractAddressLong = keccak("keccak256")
    .update(currentRlpEncoded)
    .digest("hex");
  let currentContractAddress = `0x${currentContractAddressLong.substring(24)}`;
  let currentContractAddressChecksum = web3.utils.toChecksumAddress(
    currentContractAddress
  );

  let nextNonce = currentNonce + 1;
  let nextNonceHex = `0x${nextNonce.toString(16)}`;
  let nextInputArr = [creator, nextNonceHex];
  let nextRlpEncoded = rlp.encode(nextInputArr);
  let nextContractAddressLong = keccak("keccak256")
    .update(nextRlpEncoded)
    .digest("hex");
  let nextContractAddress = `0x${nextContractAddressLong.substring(24)}`;
  let nextContractAddressChecksum =
    web3.utils.toChecksumAddress(nextContractAddress);

  return {
    vault: currentContractAddressChecksum,
    strategy: nextContractAddressChecksum,
  };
};

const deployVaultAndStrategy = async (
  contractConfig,
  vaultConfig,
  stratConfig,
  deployer
) => {
  const VaultFactory = await ethers.getContractFactory(
    contractConfig.vault,
    deployer
  );
  const StrategyFactory = await ethers.getContractFactory(
    contractConfig.strategy,
    deployer
  );

  const predictedAddresses = await predictAddresses({
    creator: deployer.address,
  });

  const vault = await VaultFactory.deploy(
    predictedAddresses.strategy,
    ...Object.values(vaultConfig)
  );

  await vault.deployed();

  const strategy = await StrategyFactory.deploy(
    vault.address,
    ...Object.values(stratConfig)
  );

  await strategy.deployed();

  return { vault, strategy };
};

const deployStrategy = async (contractConfig, stratConfig, vaultAddr) => {
  const StrategyFactory = await ethers.getContractFactory(
    contractConfig.strategy
  );
  const strategy = await StrategyFactory.deploy(
    vaultAddr,
    ...Object.values(stratConfig)
  );

  await strategy.deployed();

  return strategy;
};

const updateFenderVaults = (minimumVault, poolName) => {
  let fantomPools = JSON.parse(
    fs.readFileSync(
      "../minimum.fender/src/features/configure/vault/fantom_pools.json"
    )
  );

  const targetPool = fantomPools.filter((pool) => pool.id == poolName)[0];
  const updatedSPAPool = {
    ...targetPool,
    earnedTokenAddress: minimumVault,
    earnContractAddress: minimumVault,
  };

  fantomPools = fantomPools.map((pool) => {
    if (pool.id == poolName) {
      return updatedSPAPool;
    } else {
      return pool;
    }
  });

  fs.writeFileSync(
    "../minimum.fender/src/features/configure/vault/fantom_pools.json",
    JSON.stringify(fantomPools)
  );
  console.log("Updated Fender vaults");
};

const updateContractConfig = (vaultAddr, strategyAddr) => {
  fs.writeFileSync(
    "./contractConfig.json",
    JSON.stringify({ vaultAddress: vaultAddr, strategyAddress: strategyAddr })
  );
  console.log("Updated contract config");
};

module.exports = {
  predictAddresses,
  deployVaultAndStrategy,
  updateFenderVaults,
  deployStrategy,
  updateContractConfig,
};
