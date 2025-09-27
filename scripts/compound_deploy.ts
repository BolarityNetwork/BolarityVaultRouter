
import { ethers } from "hardhat";

const REGISTER            = "0x5A90C6b5042237869d2fE3A51b6f4fC3E570fb2B";
const VAULT_FACTORY       = "0x05346099E678b96648DDf5B414C2929ba49816a3";
const BOLARITY_ROUTER     = "0x5Febbe5A18D728eD623B81809AB9B67cee763F06";
const COMPOUND_STRATEGY   = "0xD49b0D3Ff9cfA89094a891d8cbAE014b63b1dBe2";

const UNDERLYING_ASSET    = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // usdc
const USDC_MARKET         = "0xb125e6687d4313864e53df431d5425969c15eb2f";
const market              = ethers.encodeBytes32String("COMPOUND-V3");
let RegistryContract:any;
let VaultFactoryContract:any;
let BolarityRouterContract:any;
let CompoundStrategy:any;
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

  // 5. Deploy CompoundStrategy
  const CompoundStrategy = await ethers.deployContract("CompoundStrategy", []);
  await CompoundStrategy.waitForDeployment();
  console.log(`CompoundStrategy deployed to ${CompoundStrategy.target}`);
  tx = await CompoundStrategy.setCometMarket(UNDERLYING_ASSET, USDC_MARKET);
  await tx.wait();
  console.log(`CompoundStrategy set usdc market`);

  console.log("\nDeployment complete!");
  console.log("====================");
  console.log("Registry:", Registry.target);
  console.log("VaultFactory:", VaultFactory.target);
  console.log("BolarityRouter:", BolarityRouter.target);
  console.log("CompoundStrategy:", CompoundStrategy.target);
  // =====================================create vault===============================================

  // Create vault using the strategy
  tx = await VaultFactory.createVault(
    UNDERLYING_ASSET,
    market,
    CompoundStrategy.target,
    process.env.FEE_COLLECTOR!, // fee collector
    2000, // 20% performance fee
    "Compound USDC Vault",
    "CUV"
  );
  await tx.wait();
  console.log("Creating an Compound strategy vault");
}

async function attchContract() {
  const Registry_factory = await ethers.getContractFactory("Registry");
  RegistryContract = await Registry_factory.attach(REGISTER);

  const VaultFactory_factory = await ethers.getContractFactory("VaultFactory");
  VaultFactoryContract = await VaultFactory_factory.attach(VAULT_FACTORY);

  const BolarityRouter_factory = await ethers.getContractFactory("BolarityRouter");
  BolarityRouterContract = await BolarityRouter_factory.attach(BOLARITY_ROUTER);

  const CompoundStrategy_factory = await ethers.getContractFactory("CompoundStrategy");
  CompoundStrategy = await CompoundStrategy_factory.attach(COMPOUND_STRATEGY);

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

  // // // =====================================deposit===============================================
  const depositAmout = 100000n; // 0.1 USDC
  await deposit(depositAmout, signer.address);

  // // =====================================withdraw===============================================
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
