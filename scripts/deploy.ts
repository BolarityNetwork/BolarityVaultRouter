
import { ethers } from "hardhat";

const REGISTER          = "0xe302dBBC557620C49f7E88D48DDc27a10FA317F6";
const VAULT_FACTORY     = "0x1c018e72C44fe926005adf01E06EC686B0802CC3";
const BOLARITY_ROUTER   = "0x619a08B8ff836984307F8f4b27684B463FF42233";
const AAVE_STRATEGY     = "0x768A323B2e479c29c7cf91B23d2057Cb63787BE6";
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

  const MockERC20_factory = await ethers.getContractFactory("MockERC20");
  const MockERC20 = await MockERC20_factory.attach(UNDERLYING_ASSET);

  const signer = await ethers.provider.getSigner();
  const market = ethers.encodeBytes32String("AAVE-V3");
  // console.log(market);

  // =====================================create vault===============================================

  // // Create vault using the strategy
  // await VaultFactory.createVault(
  //   UNDERLYING_ASSET, // Link address
  //   market,
  //   AaveStrategy.target,
  //   signer.address, // fee collector
  //   2000, // 20% performance fee
  //   "Bolarity Link Vault",
  //   "LinkV"
  // );
  // console.log("Vault created for Link with Aave strategy");

  // =====================================deposit===============================================

  // await MockERC20.approve(BOLARITY_ROUTER, ethers.MaxUint256);
  // const amout = ethers.parseEther('1');
  // await BolarityRouter.deposit(
  //   UNDERLYING_ASSET, // Link address
  //   market,
  //   amout,
  //   signer.address,
  //   '0x',
  // );
  // console.log("Deposit from link vault");

  // =====================================withdraw===============================================

  // const vault = await BolarityRouter.vaultFor(
  // UNDERLYING_ASSET, // Link address
  // market);
  // const BolarityVault_factory = await ethers.getContractFactory("BolarityVault");
  // const BolarityVault = await BolarityVault_factory.attach(vault);
  // await BolarityVault.approve(BOLARITY_ROUTER, ethers.MaxUint256);
  // console.log("Approve success");
  await BolarityRouter.withdraw(
    UNDERLYING_ASSET, // Link address
    market,
    ethers.MaxUint256,
    signer.address,
    signer.address,
    '0x',
  );
  console.log("Withdraw from link vault");


  // =====================================mint===============================================
  // const shares = ethers.parseEther('1');
  // await BolarityRouter.mint(
  //   UNDERLYING_ASSET, // Link address
  //   market,
  //   shares,
  //   signer.address,
  //   '0x',
  // );
  // console.log("Mint shares from link vault");

  // =====================================redeem===============================================
  // await BolarityRouter.redeem(
  //   UNDERLYING_ASSET, // Link address
  //   market,
  //   shares,
  //   signer.address,
  //   signer.address,
  //   '0x',
  // );
  // console.log("Reddem assets from link vault");
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
