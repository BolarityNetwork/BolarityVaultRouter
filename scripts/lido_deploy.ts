
import { ethers } from "hardhat";

const REGISTER            = "0x4f8b2F36CC24547d1e35a8984B81c3C2C498c138";
const VAULT_FACTORY       = "0x2aA8D287625517ffD1d95BD93766BC56908fF050";
const BOLARITY_ROUTER     = "0x4268Ca1F10B1c642b7Af9971525faf94153241d5";
const WST_ETH_STRATEGY    = "0x3F686f86D0e1Cf8E9B120635b948F01CD8e9DCb4";

const UNDERLYING_ASSET    = "0x3508A952176b3c15387C97BE809eaffB1982176a"; // stETH
const WST_ETH             = "0x7e99ee3c66636de415d2d7c880938f2f40f94de4";
const market = ethers.encodeBytes32String("LIDO");
let RegistryContract:any;
let VaultFactoryContract:any;
let BolarityRouterContract:any;
let WstETHStrategy:any;
let MockERC20Contract:any;

async function deploy() {
  console.log("Starting deployment...");
  
  // 1. Deploy Registry
  const Registry = await ethers.deployContract("Registry", []);
  await Registry.waitForDeployment();
  console.log(`Registry deployed to ${Registry.target}`);
  
  // 2. Deploy BolarityRouter first (before VaultFactory)
  const BolarityRouter = await ethers.deployContract("BolarityRouter", [Registry.target]);
  await BolarityRouter.waitForDeployment();
  console.log(`BolarityRouter deployed to ${BolarityRouter.target}`);
  
  // 3. Deploy VaultFactory with router address
  const VaultFactory = await ethers.deployContract("VaultFactory", [Registry.target, BolarityRouter.target]);
  await VaultFactory.waitForDeployment();
  console.log(`VaultFactory deployed to ${VaultFactory.target}`);
  
  // 4. Transfer Registry ownership to VaultFactory
  let tx = await Registry.transferOwnership(VaultFactory.target);
  await tx.wait();
  console.log("Registry ownership transferred to VaultFactory");
  
  // Note: No need to set router anymore, it's set in constructor

  // 5. Deploy WstETHStrategy
  const WstETHStrategy = await ethers.deployContract("WstETHStrategy", [WST_ETH]);
  await WstETHStrategy.waitForDeployment();
  console.log(`WstETHStrategy deployed to ${WstETHStrategy.target}`);

  console.log("\nDeployment complete!");
  console.log("====================");
  console.log("Registry:", Registry.target);
  console.log("VaultFactory:", VaultFactory.target);
  console.log("BolarityRouter:", BolarityRouter.target);
  console.log("WstETHStrategy:", WstETHStrategy.target);
  // =====================================create vault===============================================

  // Create vault using the strategy
  tx = await VaultFactory.createVault(
    UNDERLYING_ASSET,
    market,
    WstETHStrategy.target,
    process.env.FEE_COLLECTOR!, // fee collector
    2000, // 20% performance fee
    "Lido WSTETH Vault",
    "LWST"
  );
  await tx.wait();
  console.log("Creating an lido strategy vault");
}

async function attchContract() {
  const Registry_factory = await ethers.getContractFactory("Registry");
  RegistryContract = await Registry_factory.attach(REGISTER);

  const VaultFactory_factory = await ethers.getContractFactory("VaultFactory");
  VaultFactoryContract = await VaultFactory_factory.attach(VAULT_FACTORY);

  const BolarityRouter_factory = await ethers.getContractFactory("BolarityRouter");
  BolarityRouterContract = await BolarityRouter_factory.attach(BOLARITY_ROUTER);

  const WstETHStrategy_factory = await ethers.getContractFactory("CompoundStrategy");
  WstETHStrategy = await WstETHStrategy_factory.attach(WST_ETH_STRATEGY);

  const MockERC20_factory = await ethers.getContractFactory("MockERC20");
  MockERC20Contract = await MockERC20_factory.attach(UNDERLYING_ASSET);
}

async function deposit(amout:bigint, reciver:string) {
  // Check current allowance
  const currentAllowance = await MockERC20Contract.allowance(reciver, BOLARITY_ROUTER);
  
  // Only approve if current allowance is insufficient
  if (currentAllowance < amout) {
    let approveTx = await MockERC20Contract.approve(BOLARITY_ROUTER, ethers.MaxUint256);
    await approveTx.wait();
    console.log("Approval granted for deposit");
  }

  let tx = await BolarityRouterContract.deposit(
    UNDERLYING_ASSET,
    market,
    amout,
    reciver,
    '0x',
  );
  await tx.wait();
  console.log("Deposit underlying asset");
}


async function withdraw(amout:bigint, reciver:string) {
  const vault = await BolarityRouterContract.vaultFor(
  UNDERLYING_ASSET,
  market);
  const BolarityVault_factory = await ethers.getContractFactory("BolarityVault");
  const BolarityVaultContract = await BolarityVault_factory.attach(vault);

  const currentAllowance = await BolarityVaultContract.allowance(reciver, BOLARITY_ROUTER);

  // Only approve if current allowance is insufficient
  if (currentAllowance < amout) {
    let approveTx = await BolarityVaultContract.approve(BOLARITY_ROUTER, ethers.MaxUint256);
    await approveTx.wait();
    console.log("Approval granted for withdraw");
  }

  await BolarityRouterContract.withdraw(
    UNDERLYING_ASSET,
    market,
    amout,
    reciver,
    reciver,
    '0x',
  );
  console.log("Withdraw underlying asset");
}

async function mint(shares:bigint, reciver:string) {
  const asset = await BolarityRouterContract.previewMint(UNDERLYING_ASSET, market, shares);
  // Check current allowance
  const currentAllowance = await MockERC20Contract.allowance(reciver, BOLARITY_ROUTER);
  
  // Only approve if current allowance is insufficient
  if (currentAllowance < asset) {
    let approveTx = await MockERC20Contract.approve(BOLARITY_ROUTER, ethers.MaxUint256);
    await approveTx.wait();
    console.log("Approval granted for mint");
  }

  await BolarityRouterContract.mint(
    UNDERLYING_ASSET,
    market,
    shares,
    reciver,
    '0x',
  );
  console.log("Mint shares");
}

async function redeem(shares:bigint, reciver:string) {
  const vault = await BolarityRouterContract.vaultFor(
  UNDERLYING_ASSET,
  market);
  const BolarityVault_factory = await ethers.getContractFactory("BolarityVault");
  const BolarityVaultContract = await BolarityVault_factory.attach(vault);

  const currentAllowance = await BolarityVaultContract.allowance(reciver, BOLARITY_ROUTER);
  const asset = await BolarityRouterContract.previewRedeem(UNDERLYING_ASSET, market, shares);

  // Only approve if current allowance is insufficient
  if (currentAllowance < asset) {
    let approveTx = await BolarityVaultContract.approve(BOLARITY_ROUTER, ethers.MaxUint256);
    await approveTx.wait();
    console.log("Approval granted for redeem");
  }

  await BolarityRouterContract.redeem(
    UNDERLYING_ASSET,
    market,
    shares,
    reciver,
    reciver,
    '0x',
  );
  console.log("Reddem underlying asset");
}

async function main() {

  // await deploy();

  await attchContract();

  const signer = await ethers.provider.getSigner();

  // // =====================================deposit===============================================
  const depositAmout = 100000n; // 0.1 USDC
  await deposit(depositAmout, signer.address);

  // =====================================withdraw===============================================
  const userShares = await BolarityRouterContract.getUserBalance(UNDERLYING_ASSET, market, signer.address);
  const userAsset = await BolarityRouterContract.previewRedeem(UNDERLYING_ASSET, market, userShares);
  await withdraw(userAsset, signer.address)// or ethers.MaxUint256



  // // =====================================mint===============================================
  const mintShares = 100000n;
  await mint(mintShares, signer.address)

  // // =====================================redeem===============================================
  const shares = await BolarityRouterContract.getUserBalance(UNDERLYING_ASSET, market, signer.address);
  await redeem(shares, signer.address)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
