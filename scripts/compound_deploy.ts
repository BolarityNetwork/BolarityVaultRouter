
import { ethers } from "hardhat";

const REGISTER            = "0xD2be0b6A432609059dd5d44Bc3243e3ac7811Eb0";
const VAULT_FACTORY       = "0x59c8d6E9bf3EE7A0c739E77C1e48815a77BF10dE";
const BOLARITY_ROUTER     = "0xE5d9502aA905ea0D68DC16fCcf6A7B4Bca58737e";
const COMPOUND_STRATEGY   = "0xcBC5C892cfEfD08BE5389e8ab8cB6be2985908d8";
const UNDERLYING_ASSET    = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // usdc
const USDC_MARKET         = "0xb125e6687d4313864e53df431d5425969c15eb2f";

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

  // // 6.Deploy CompoundStrategy (no parameters needed, msg.sender becomes owner)
  // const CompoundStrategy = await ethers.deployContract("CompoundStrategy", []);
  // await CompoundStrategy.waitForDeployment();
  // console.log(`CompoundStrategy deployed to ${CompoundStrategy.target}`);
  // await CompoundStrategy.setCometMarket(UNDERLYING_ASSET, USDC_MARKET);
  // console.log(`CompoundStrategy set usdc market`);

  // console.log("Register atoken");
  // console.log("\nDeployment complete!");
  // console.log("====================");
  // console.log("Registry:", Registry.target);
  // console.log("VaultFactory:", VaultFactory.target);
  // console.log("BolarityRouter:", BolarityRouter.target);
  // console.log("CompoundStrategy:", CompoundStrategy.target);


  const Registry_factory = await ethers.getContractFactory("Registry");
  const Registry = await Registry_factory.attach(REGISTER);

  const VaultFactory_factory = await ethers.getContractFactory("VaultFactory");
  const VaultFactory = await VaultFactory_factory.attach(VAULT_FACTORY);

  const BolarityRouter_factory = await ethers.getContractFactory("BolarityRouter");
  const BolarityRouter = await BolarityRouter_factory.attach(BOLARITY_ROUTER);

  const CompoundStrategy_factory = await ethers.getContractFactory("CompoundStrategy");
  const CompoundStrategy = await CompoundStrategy_factory.attach(COMPOUND_STRATEGY);

  const MockERC20_factory = await ethers.getContractFactory("MockERC20");
  const MockERC20 = await MockERC20_factory.attach(UNDERLYING_ASSET);

  const signer = await ethers.provider.getSigner();

  const market = ethers.encodeBytes32String("COMPOUND-V3");
  console.log(market);

  // // =====================================create vault===============================================

  // // Create vault using the strategy
  // await VaultFactory.createVault(
  //   UNDERLYING_ASSET, // Link address
  //   market,
  //   CompoundStrategy.target,
  //   signer.address, // fee collector
  //   2000, // 20% performance fee
  //   "Bolarity USDC Vault",
  //   "USDCV"
  // );
  // console.log("Vault created for USDC with Compound strategy");

  // =====================================deposit===============================================

  // await MockERC20.approve(BOLARITY_ROUTER, ethers.MaxUint256);
  // const amout = 100000;
  // await BolarityRouter.deposit(
  //   UNDERLYING_ASSET, // Link address
  //   market,
  //   amout,
  //   signer.address,
  //   '0x',
  // );
  // console.log("Deposit from USDC vault");

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
  console.log("Withdraw from USDC vault");


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
