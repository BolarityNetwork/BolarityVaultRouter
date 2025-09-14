
import { ethers } from "hardhat";

const REGISTER            = "0x4f8b2F36CC24547d1e35a8984B81c3C2C498c138";
const VAULT_FACTORY       = "0x2aA8D287625517ffD1d95BD93766BC56908fF050";
const BOLARITY_ROUTER     = "0x4268Ca1F10B1c642b7Af9971525faf94153241d5";
const WST_ETH_STRATEGY    = "0x3F686f86D0e1Cf8E9B120635b948F01CD8e9DCb4";
const UNDERLYING_ASSET    = "0x3508A952176b3c15387C97BE809eaffB1982176a"; // stETH
const WST_ETH             = "0x7e99ee3c66636de415d2d7c880938f2f40f94de4";

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
  // const WstETHStrategy = await ethers.deployContract("WstETHStrategy", [WST_ETH]);
  // await WstETHStrategy.waitForDeployment();
  // console.log(`WstETHStrategy deployed to ${WstETHStrategy.target}`);

  // console.log("Register atoken");
  // console.log("\nDeployment complete!");
  // console.log("====================");
  // console.log("Registry:", Registry.target);
  // console.log("VaultFactory:", VaultFactory.target);
  // console.log("BolarityRouter:", BolarityRouter.target);
  // console.log("WstETHStrategy:", WstETHStrategy.target);

  const Registry_factory = await ethers.getContractFactory("Registry");
  const Registry = await Registry_factory.attach(REGISTER);

  const VaultFactory_factory = await ethers.getContractFactory("VaultFactory");
  const VaultFactory = await VaultFactory_factory.attach(VAULT_FACTORY);

  const BolarityRouter_factory = await ethers.getContractFactory("BolarityRouter");
  const BolarityRouter = await BolarityRouter_factory.attach(BOLARITY_ROUTER);

  const WstETHStrategy_factory = await ethers.getContractFactory("WstETHStrategy");
  const WstETHStrategy = await WstETHStrategy_factory.attach(WST_ETH_STRATEGY);

  const MockERC20_factory = await ethers.getContractFactory("MockERC20");
  const MockERC20 = await MockERC20_factory.attach(UNDERLYING_ASSET);

  const signer = await ethers.provider.getSigner();
  const market = ethers.encodeBytes32String("LIDO");
  console.log(market);

  // // =====================================create vault===============================================

  // // Create vault using the strategy
  // await VaultFactory.createVault(
  //   UNDERLYING_ASSET, // Link address
  //   market,
  //   WstETHStrategy.target,
  //   signer.address, // fee collector
  //   2000, // 20% performance fee
  //   "Bolarity WST ETH Vault",
  //   "WstETHV"
  // );
  // console.log("Vault created for WST ETH with WstETH strategy");

  // =====================================deposit===============================================

  // await MockERC20.approve(BOLARITY_ROUTER, ethers.MaxUint256);
  // const amout = ethers.parseEther('0.1');
  // await BolarityRouter.deposit(
  //   UNDERLYING_ASSET, // Link address
  //   market,
  //   amout,
  //   signer.address,
  //   '0x',
  // );
  // console.log("Deposit from stETH vault");

  // =====================================withdraw===============================================

  const vault = await BolarityRouter.vaultFor(
  UNDERLYING_ASSET, // Link address
  market);
  const BolarityVault_factory = await ethers.getContractFactory("BolarityVault");
  const BolarityVault = await BolarityVault_factory.attach(vault);
  await BolarityVault.approve(BOLARITY_ROUTER, ethers.MaxUint256);
  console.log("Approve success");
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
  //   ethers.MaxUint256,
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
