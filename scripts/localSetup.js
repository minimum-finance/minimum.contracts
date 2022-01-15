const { swapForToken } = require("../utils/localSetupUtils.ts");
const deploy = require("./deploy");
const { localProvider } = require("../utils/testUtils.ts");
const { SPA } = require("../constants");

async function main() {
  await deploy();
  await swapForToken(localProvider, SPA);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
