
import { ethers } from "hardhat";

const REGISTER          = "0x1Af0f95e9E2078242334B2AF5F7464eEB1683c7f";
const VAULT_FACTORY     = "0xE8cd4B1EaD3C6D63600a1fbdF8245cDeEC970a5C";
const BOLARITY_ROUTER   = "0x458561d68a3eEAb1DCf85b079B8166fCC2dC312c";
const AAVE_STRATEGY     = "0xF6E5710Ab9422273486ea53bA59E6212595A0Be4";
// const ATOKEN            = "0x3FfAf50D4F4E96eB78f2407c090b72e86eCaed24"; // link atoken
const UNDERLYING_ASSET  = "0xf8fb3713d459d7c1018bd0a49d19b4c44290ebe5"; // link
const AAVE_POOL         = "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951";
const AAVE_DATA_PROVIDER = "0x3e9708d80f7B3e43118013075F7e95CE3AB31F31";

async function main() {
  // console.log("Starting deployment...");
  
  // // 1. Deploy Registry
  // const Registry = await ethers.deployContract("Registry", []);
  // await Registry.waitForDeployment();
  // console.log(`Registry deployed to ${Registry.target}`);
  
  // // 2. Deploy VaultFactory
  // const VaultFactory = await ethers.deployContract("VaultFactory", [Registry.target]);
  // await VaultFactory.waitForDeployment();
  // console.log(`VaultFactory deployed to ${VaultFactory.target}`);
  
  // // 3. Deploy BolarityRouter
  // const BolarityRouter = await ethers.deployContract("BolarityRouter", [Registry.target, VaultFactory.target]);
  // await BolarityRouter.waitForDeployment();
  // console.log(`BolarityRouter deployed to ${BolarityRouter.target}`);
  
  // // 4. Transfer Registry ownership to VaultFactory
  // await Registry.transferOwnership(VaultFactory.target);
  // console.log("Registry ownership transferred to VaultFactory");
  
  // // 5. Set Router in VaultFactory
  // await VaultFactory.setRouter(BolarityRouter.target);
  // console.log("Router set in VaultFactory");

  // // 6.Deploy AaveStrategy
  // const AaveStrategy = await ethers.deployContract("AaveStrategy", [AAVE_POOL, AAVE_DATA_PROVIDER]);
  // await AaveStrategy.waitForDeployment();
  // console.log(`AaveStrategy deployed to ${AaveStrategy.target}`);

  // console.log("Register atoken");
  // console.log("\nDeployment complete!");
  // console.log("====================");
  // console.log("Registry:", Registry.target);
  // console.log("VaultFactory:", VaultFactory.target);
  // console.log("BolarityRouter:", BolarityRouter.target);
  // console.log("AaveStrategy:", AaveStrategy.target);

  const Registry_factory = await ethers.getContractFactory("Registry");
  const Registry = await Registry_factory.attach(REGISTER);

  const VaultFactory_factory = await ethers.getContractFactory("VaultFactory");
  const VaultFactory = await VaultFactory_factory.attach(VAULT_FACTORY);

  const BolarityRouter_factory = await ethers.getContractFactory("BolarityRouter");
  const BolarityRouter = await BolarityRouter_factory.attach(BOLARITY_ROUTER);

  const AaveStrategy_factory = await ethers.getContractFactory("AaveStrategy");
  const AaveStrategy = await AaveStrategy_factory.attach(AAVE_STRATEGY);
  // Create vault using the strategy
  const market = ethers.encodeBytes32String("AAVE-V3");
  console.log(market);
  // await VaultFactory.createVault(
  //   UNDERLYING_ASSET, // Link address
  //   market,
  //   AaveStrategy.target,
  //   await (await ethers.getSigners())[0].getAddress(), // fee collector
  //   2000, // 20% performance fee
  //   "Bolarity Link Vault",
  //   "LinkV"
  // );
  // console.log("Vault created for Link with Aave strategy");

  const signer = await ethers.provider.getSigner();
  const amout = ethers.parseEther('1');
  // await BolarityRouter.deposit(
  //   UNDERLYING_ASSET, // Link address
  //   market,
  //   amout,
  //   signer.address,
  //   '0x',
  // );
  // console.log("Deposit from link vault");
  // const BolarityVault_factory = await ethers.getContractFactory("BolarityVault");
  // const BolarityVault = await BolarityVault_factory.attach("0x1641aa8f45f8ef6b6f85cc97b78ba3e4ef4d1552");
  // await BolarityVault.approve(BOLARITY_ROUTER, ethers.parseEther('100000000000'));
  await BolarityRouter.withdraw(
    UNDERLYING_ASSET, // Link address
    market,
    amout,
    signer.address,
    signer.address,
    '0x',
  );
  console.log("Withdraw from link vault");
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
