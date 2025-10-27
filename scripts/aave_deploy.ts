
import { ethers } from "hardhat";

const REGISTER            = "0x3a254517F65fc839421FE3d9a018f0b9fa184A70";
const VAULT_FACTORY       = "0x7BE4a3516bC9e15854A21156D65d864FaAa97e35";
const BOLARITY_ROUTER     = "0x80C89E0c038f03f7A65A3B1E68fEBaA648075749";
const AAVE_STRATEGY       = "0x7f07aDBc6e3eEF79E0952b5c1bF22E571B211c10";

const UNDERLYING_ASSET    = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"; // usdc
const AAVE_POOL           = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
const AAVE_DATA_PROVIDER  = "0xC4Fcf9893072d61Cc2899C0054877Cb752587981";
const market              = ethers.encodeBytes32String("AAVE-V3");
let RegistryContract:any;
let VaultFactoryContract:any;
let BolarityRouterContract:any;
let AaveStrategyContract:any;
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

  // 5. Deploy AaveStrategy
  const AaveStrategy = await ethers.deployContract("AaveStrategy", [AAVE_POOL, AAVE_DATA_PROVIDER]);
  await AaveStrategy.waitForDeployment();
  console.log(`AaveStrategy deployed to ${AaveStrategy.target}`);

  console.log("\nDeployment complete!");
  console.log("====================");
  console.log("Registry:", Registry.target);
  console.log("VaultFactory:", VaultFactory.target);
  console.log("BolarityRouter:", BolarityRouter.target);
  console.log("AaveStrategy:", AaveStrategy.target);
  // =====================================create vault===============================================

  // Create vault using the strategy
  tx = await VaultFactory.createVault(
    UNDERLYING_ASSET,
    market,
    AaveStrategy.target,
    process.env.FEE_COLLECTOR!, // fee collector
    2000, // 20% performance fee
    "AAVE USDC Vault",
    "AUV"
  );
  await tx.wait();
  console.log("Creating an Aave strategy vault");
}

async function attchContract() {
  const Registry_factory = await ethers.getContractFactory("Registry");
  RegistryContract = await Registry_factory.attach(REGISTER);

  const VaultFactory_factory = await ethers.getContractFactory("VaultFactory");
  VaultFactoryContract = await VaultFactory_factory.attach(VAULT_FACTORY);

  const BolarityRouter_factory = await ethers.getContractFactory("BolarityRouter");
  BolarityRouterContract = await BolarityRouter_factory.attach(BOLARITY_ROUTER);

  const AaveStrategy_factory = await ethers.getContractFactory("AaveStrategy");
  AaveStrategyContract = await AaveStrategy_factory.attach(AAVE_STRATEGY);

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



  // =====================================mint===============================================
  const mintShares = 100000n;
  await mint(mintShares, signer.address)

  // =====================================redeem===============================================
  const shares = await BolarityRouterContract.getUserBalance(UNDERLYING_ASSET, market, signer.address);
  await redeem(shares, signer.address)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
