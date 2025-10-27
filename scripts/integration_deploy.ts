
import { ethers } from "hardhat";

const REGISTER            = "0xbE6B3Fd5B15C8747d2a5251B56607410ADD4b766";
const VAULT_FACTORY       = "0x1B529D8dBCF363E23f991cf1378d4e5075A24199";
const BOLARITY_ROUTER     = "0xF68D4a33EAc79ea42eFE1822F395cd0E9BC02C77";
const AAVE_STRATEGY       = "0xf4999c9CEeEE408d2E74d5DF969E6eE5806c23f1";
const COMPOUND_STRATEGY   = "0xd855FEA20459c8DEdc94B52bb32392202Cd2258f";
const PENDLE_STRATEGY     = "0x9f2f1d7106bEf07F10B470153DadfDB3326D3ED9";


const AAVE_UNDERLYING_ASSET    = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"; // usdc
const AAVE_POOL                = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
const AAVE_DATA_PROVIDER       = "0xC4Fcf9893072d61Cc2899C0054877Cb752587981";

const COMPOUND_UNDERLYING_ASSET    = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // usdc
const USDC_MARKET                  = "0xb125e6687d4313864e53df431d5425969c15eb2f"; // compound usdc market

const PENDLE_UNDERLYING_ASSET    = "0xf3527ef8dE265eAa3716FB312c12847bFBA66Cef"; // USDX
const PENDLE_ROUTER       = "0x888888888889758f76e7103c6cbf23abbf58f946";
const PENDLE_ORACLE       = "0x9a9fa8338dd5e5b2188006f1cd2ef26d921650c2";
const PENDLE_MARKET       = "0x5304a194a535b7c4c54a1e7bc138e8556f412a5d"; // USDX market
const PENDLE_PT           = "0x44759Cc0B62a863D59235695BE88750B70Dc4b36"; // PT USDX

const aave_market           = ethers.encodeBytes32String("AAVE-V3");
const compound_market       = ethers.encodeBytes32String("COMPOUND-V3");
const pendle_market         = ethers.encodeBytes32String("PENDLE-V4");


let RegistryContract:any;
let VaultFactoryContract:any;
let BolarityRouterContract:any;
let AaveStrategyContract:any;
let MockERC20Contract:any;
let UNDERLYING_ASSET:any;
let market:any

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

  // 6. Deploy CompoundStrategy
  const CompoundStrategy = await ethers.deployContract("CompoundStrategy", []);
  await CompoundStrategy.waitForDeployment();
  console.log(`CompoundStrategy deployed to ${CompoundStrategy.target}`);
  tx = await CompoundStrategy.setCometMarket(COMPOUND_UNDERLYING_ASSET, USDC_MARKET);
  await tx.wait();
  console.log(`CompoundStrategy set usdc market`);

  // 7. Deploy PendlePTStrategy
  const PendlePTStrategy = await ethers.deployContract("PendlePTStrategy", [PENDLE_ROUTER, PENDLE_ORACLE]);
  await PendlePTStrategy.waitForDeployment();
  console.log(`PendlePTStrategy deployed to ${PendlePTStrategy.target}`);
  tx = await PendlePTStrategy.setPendleMarket(PENDLE_UNDERLYING_ASSET, PENDLE_MARKET, PENDLE_PT);
  await tx.wait();
  console.log(`PendlePTStrategy set market`);

  console.log("\nDeployment complete!");
  console.log("====================");
  console.log("Registry:", Registry.target);
  console.log("VaultFactory:", VaultFactory.target);
  console.log("BolarityRouter:", BolarityRouter.target);
  console.log("AaveStrategy:", AaveStrategy.target);
  console.log("CompoundStrategy:", CompoundStrategy.target);
  console.log("PendlePTStrategy:", PendlePTStrategy.target);
  // =====================================create vault===============================================

  // Create vault using the aave strategy
  tx = await VaultFactory.createVault(
    AAVE_UNDERLYING_ASSET,
    aave_market,
    AaveStrategy.target,
    process.env.FEE_COLLECTOR!, // fee collector
    2000, // 20% performance fee
    "AAVE USDC Vault",
    "AUV"
  );
  await tx.wait();
  console.log("Creating an Aave strategy vault");
  // Create vault using the compund strategy
  tx = await VaultFactory.createVault(
    COMPOUND_UNDERLYING_ASSET,
    compound_market,
    CompoundStrategy.target,
    process.env.FEE_COLLECTOR!, // fee collector
    2000, // 20% performance fee
    "Compound USDC Vault",
    "CUV"
  );
  await tx.wait();
  console.log("Creating an Compound strategy vault");
  // Create vault using the pendle strategy
  tx = await VaultFactory.createVault(
    PENDLE_UNDERLYING_ASSET,
    pendle_market,
    PendlePTStrategy.target,
    process.env.FEE_COLLECTOR!, // fee collector
    2000, // 20% performance fee
    "PendlePT Vault",
    "PPT"
  );
  await tx.wait();
  console.log("Creating an PendlePT strategy vault");
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

//   await deploy();

  market = aave_market;
  UNDERLYING_ASSET = AAVE_UNDERLYING_ASSET;

  await attchContract();

  const signer = await ethers.provider.getSigner();

  // ================================================================================================
  // If you are using the pendle strategy, please refer to the code of the pendle_deploy.ts file. The contract address is still the same as here.
  // ================================================================================================


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
