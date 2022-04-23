const { ethers } = require("hardhat");
const { swapForToken } = require("../utils/localSetupUtils.ts");
const { FTM_WHALE_ADDR, DAI, DAI_BOND } = require("../constants");
const { impersonateAddr, localProvider } = require("../utils/testUtils.ts");
const { getERC20At } = require("../utils/testUtils.ts");
const IBondDepository = require("../artifacts/contracts/Interfaces/Rebasing/IBondDepository.sol/IBondDepository.json");

async function main() {
  let dai = await getERC20At(DAI);
  const signer = await impersonateAddr(localProvider, FTM_WHALE_ADDR);
  // Swap for DAI to bond with
  await swapForToken(localProvider, DAI, signer, 2000000, FTM_WHALE_ADDR);

  let bondDepository = await ethers.getContractAt(
    IBondDepository.abi,
    DAI_BOND
  );
  bondDepository = bondDepository.connect(signer);
  dai = dai.connect(signer);

  const daiBal = await dai.balanceOf(FTM_WHALE_ADDR);

  await dai.approve(DAI_BOND, daiBal);

  for (let i = 0; i < 5; i++) {
    console.log(`BONDING ${i}`);
    const bondPrice = ethers.utils.formatUnits(
      await bondDepository.bondPrice(),
      0
    );
    const maxPremium = parseInt(bondPrice * 1.005);

    const maxPayout = await bondDepository.maxPayout();

    console.log("bond price", bondPrice);
    const spaAmount = parseInt(ethers.utils.formatUnits(maxPayout, 9));
    const daiPrice = parseInt(
      ethers.utils.formatUnits(await bondDepository.bondPrice(), 2)
    );

    console.log("max Payout in SPA", ethers.utils.formatUnits(maxPayout, 9));
    console.log("max payout in DAI", spaAmount * daiPrice);
    await bondDepository.deposit(
      ethers.utils.parseEther("200000"),
      maxPremium,
      FTM_WHALE_ADDR
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
