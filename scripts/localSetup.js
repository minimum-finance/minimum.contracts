const { swapForToken, stakeTokens } = require("../utils/localSetupUtils.ts");
const deploy = require("./deploy");
const { localProvider } = require("../utils/testUtils.ts");
const { FHM, FHM_STAKER } = require("../constants");

async function main() {
  await deploy();
  await swapForToken(localProvider, FHM);
  await stakeTokens(localProvider, FHM, FHM_STAKER);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
