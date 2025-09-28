
import { ethers } from "hardhat";
import {ContractFactory, MaxUint256, ZeroAddress} from 'ethers'
import { callConvertAPI, printConvertOutput } from "./helper";
const PendleRouter = require('../artifacts/contracts/interfaces/IPendle.sol/IPendleRouter.json')
const PendleOracle = require('../artifacts/contracts/interfaces/IPendle.sol/IPendleOracle.json')
const PendleMarket = require('../artifacts/contracts/interfaces/IPendle.sol/IPendleMarket.json')

const REGISTER            = "0xD73d63eCdB1144fd15Ee01fD0DEF0CdF87466620";
const VAULT_FACTORY       = "0x83777d4727A03EF66E54e814e19d0C44F2b07274";
const BOLARITY_ROUTER     = "0x2553ee51c76F005925d9eb98936d2D2645284416";
const PENDLE_STRATEGY     = "0x214E7E678A683bCb807292159fA8083D6431DF73";


const UNDERLYING_ASSET    = "0xf3527ef8dE265eAa3716FB312c12847bFBA66Cef"; // USDX
const PENDLE_ROUTER       = "0x888888888889758f76e7103c6cbf23abbf58f946";
const PENDLE_ORACLE       = "0x9a9fa8338dd5e5b2188006f1cd2ef26d921650c2";
const PENDLE_MARKET       = "0x5304a194a535b7c4c54a1e7bc138e8556f412a5d";
const PENDLE_PT           = "0x44759Cc0B62a863D59235695BE88750B70Dc4b36";
// USR 0x35E5dB674D8e93a03d814FA0ADa70731efe8a4b9 0x715509bde846104cf2ccebf6fdf7ef1bb874bc45 0xa6F0A4D18B6f6DdD408936e81b7b3A8BEFA18e77
const market = ethers.encodeBytes32String("PENDLE-V4");
let RegistryContract:any;
let VaultFactoryContract:any;
let BolarityRouterContract:any;
let PendlePTStrategy:any;
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

  // 5. Deploy PendlePTStrategy
  const PendlePTStrategy = await ethers.deployContract("PendlePTStrategy", [PENDLE_ROUTER, PENDLE_ORACLE]);
  await PendlePTStrategy.waitForDeployment();
  console.log(`PendlePTStrategy deployed to ${PendlePTStrategy.target}`);
  tx = await PendlePTStrategy.setPendleMarket(UNDERLYING_ASSET, PENDLE_MARKET, PENDLE_PT);
    await tx.wait();
  console.log(`PendlePTStrategy set market`);

  console.log("\nDeployment complete!");
  console.log("====================");
  console.log("Registry:", Registry.target);
  console.log("VaultFactory:", VaultFactory.target);
  console.log("BolarityRouter:", BolarityRouter.target);
  console.log("PendlePTStrategy:", PendlePTStrategy.target);
  // =====================================create vault===============================================

  // Create vault using the strategy
  tx = await VaultFactory.createVault(
    UNDERLYING_ASSET,
    market,
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

  const PendlePTStrategy_factory = await ethers.getContractFactory("PendlePTStrategy");
  const PendlePTStrategy = await PendlePTStrategy_factory.attach(PENDLE_STRATEGY);

  const MockERC20_factory = await ethers.getContractFactory("MockERC20");
  MockERC20Contract = await MockERC20_factory.attach(UNDERLYING_ASSET);
}

async function deposit(amout:bigint, reciver:string, calldata:string) {
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
    calldata,
  );
  await tx.wait();
  console.log("Deposit underlying asset");
}


async function withdraw(amout:bigint, reciver:string, calldata:string) {
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
    calldata,
  );
  console.log("Withdraw underlying asset");
}

async function mint(shares:bigint, reciver:string, calldata:string) {
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
    calldata,
  );
  console.log("Mint shares");
}

async function redeem(shares:bigint, reciver:string, calldata:string) {
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
    calldata,
  );
  console.log("Reddem underlying asset");
}

async function swapTokenToPt(amountsIn:string, receiver:string, slippageOverride?:number) {
  // base chainid 8453
    const resp = await callConvertAPI(8453, {
        tokensIn: UNDERLYING_ASSET,
        amountsIn,
        tokensOut: PENDLE_PT,
        receiver: receiver,
        slippage: slippageOverride || 0.01, // 1% slippage
    });

    // printConvertOutput(resp);

    return resp.data.routes[0].tx.data;
}

async function swapPtToToken(amountsIn:string, receiver:string, slippageOverride?:number) {
    // base chainid 8453
    const resp = await callConvertAPI(8453, {
        tokensIn: PENDLE_PT,
        amountsIn: amountsIn,
        tokensOut: UNDERLYING_ASSET,
        receiver: receiver,
        slippage: slippageOverride || 0.02, // Increased default slippage to 2%
    });

    // printConvertOutput(resp);

    return resp.data.routes[0].tx.data;
}

async function main() {
  // await deploy();

  await attchContract();

  const signer = await ethers.provider.getSigner();
  const vault = await BolarityRouterContract.vaultFor(
  UNDERLYING_ASSET,
  market);

  // =====================================deposit===============================================
  const depositAmout = ethers.parseEther("0.1");
  const depositCalldata = await swapTokenToPt(depositAmout.toString(), vault);
  await deposit(depositAmout, signer.address, depositCalldata);

  // =====================================withdraw===============================================
  const userShares = await BolarityRouterContract.getUserBalance(UNDERLYING_ASSET, market, signer.address);
  const userAsset = await BolarityRouterContract.previewRedeem(UNDERLYING_ASSET, market, userShares);

  const withdrawCalldata = await swapPtToToken(userAsset.toString(), vault);
  await withdraw(userAsset, signer.address, withdrawCalldata)// or ethers.MaxUint256


  // =====================================mint===============================================
  const mintShares = ethers.parseEther("0.1");
  const mintAsset = await BolarityRouterContract.previewMint(UNDERLYING_ASSET, market, mintShares);
  const mintCalldata = await swapTokenToPt(mintAsset.toString(), vault);
  await mint(mintShares, signer.address, mintCalldata)

  // =====================================redeem===============================================
  const userBalance = await BolarityRouterContract.getUserBalance(UNDERLYING_ASSET, market, signer.address);
  const userRedeemAsset = await BolarityRouterContract.previewRedeem(UNDERLYING_ASSET, market, userBalance);

  const redeemCalldata = await swapPtToToken(userRedeemAsset.toString(), vault);
  await redeem(userBalance, signer.address, redeemCalldata);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
