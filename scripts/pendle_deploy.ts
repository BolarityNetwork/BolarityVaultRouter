
import { ethers } from "hardhat";
import {ContractFactory, MaxUint256, ZeroAddress} from 'ethers'
import { callConvertAPI, printConvertOutput } from "./helper";
const PendleRouter = require('../artifacts/contracts/interfaces/IPendle.sol/IPendleRouter.json')
const PendleOracle = require('../artifacts/contracts/interfaces/IPendle.sol/IPendleOracle.json')
const PendleMarket = require('../artifacts/contracts/interfaces/IPendle.sol/IPendleMarket.json')

const REGISTER            = "0x75971D67503Ff0BD74cf53A531Cfa49e78e831e8";
const VAULT_FACTORY       = "0x73327F71E7A756B68040fA9FEF68b602E35e633d";
const BOLARITY_ROUTER     = "0x1db547B5Ce21661A32A290C09DBA5F83E0Bb0081";
const PENDLE_STRATEGY     = "0xFaBE35dBF80Ea83046ea9aba5f998cf177fa6c4d";
const UNDERLYING_ASSET    = "0x35E5dB674D8e93a03d814FA0ADa70731efe8a4b9"; // USR
const PENDLE_ROUTER       = "0x888888888889758f76e7103c6cbf23abbf58f946";
const PENDLE_ORACLE       = "0x9a9fa8338dd5e5b2188006f1cd2ef26d921650c2";
const PENDLE_MARKET       = "0x715509bde846104cf2ccebf6fdf7ef1bb874bc45";
const PENDLE_PT           = "0xa6F0A4D18B6f6DdD408936e81b7b3A8BEFA18e77";

async function swapTokenToPt(amountsIn:string, receiver:string) {
    const resp = await callConvertAPI(8453, {
        tokensIn: UNDERLYING_ASSET,
        amountsIn,
        tokensOut: PENDLE_PT,
        receiver: receiver,
        slippage: 0.01, // 1% slippage
    });

    // printConvertOutput(resp);

    return resp.data.routes[0].tx.data;
}

async function swapPtToToken(amountsIn:string, receiver:string, slippageOverride?:number) {
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
  // const BolarityRouter = await ethers.deployContract("BolarityRouter", [Registry.target]);
  // await BolarityRouter.waitForDeployment();
  // console.log(`BolarityRouter deployed to ${BolarityRouter.target}`);
  
  // // 4. Transfer Registry ownership to VaultFactory
  // await Registry.transferOwnership(VaultFactory.target);
  // console.log("Registry ownership transferred to VaultFactory");
  
  // // 5. Set Router in VaultFactory
  // await VaultFactory.setRouter(BolarityRouter.target);
  // console.log("Router set in VaultFactory");

  // // 6.Deploy CompoundStrategy (no parameters needed, msg.sender becomes owner)
  // const PendlePTStrategy = await ethers.deployContract("PendlePTStrategy", [PENDLE_ROUTER, PENDLE_ORACLE]);
  // await PendlePTStrategy.waitForDeployment();
  // console.log(`PendlePTStrategy deployed to ${PendlePTStrategy.target}`);
  // // await PendlePTStrategy.setPendleMarket(UNDERLYING_ASSET, PENDLE_MARKET, PENDLE_PT);
  // // console.log(`PendlePTStrategy set market`);

  // console.log("\nDeployment complete!");
  // console.log("====================");
  // console.log("Registry:", Registry.target);
  // console.log("VaultFactory:", VaultFactory.target);
  // console.log("BolarityRouter:", BolarityRouter.target);
  // console.log("PendlePTStrategy:", PendlePTStrategy.target);


  const Registry_factory = await ethers.getContractFactory("Registry");
  const Registry = await Registry_factory.attach(REGISTER);

  const VaultFactory_factory = await ethers.getContractFactory("VaultFactory");
  const VaultFactory = await VaultFactory_factory.attach(VAULT_FACTORY);

  const BolarityRouter_factory = await ethers.getContractFactory("BolarityRouter");
  const BolarityRouter = await BolarityRouter_factory.attach(BOLARITY_ROUTER);

  const PendlePTStrategy_factory = await ethers.getContractFactory("PendlePTStrategy");
  const PendlePTStrategy = await PendlePTStrategy_factory.attach(PENDLE_STRATEGY);

  const MockERC20_factory = await ethers.getContractFactory("MockERC20");
  const MockERC20 = await MockERC20_factory.attach(UNDERLYING_ASSET);

  const signer = await ethers.provider.getSigner();

  const market = ethers.encodeBytes32String("PENDLE-V4");
  console.log(market);
  const vault = await BolarityRouter.vaultFor(UNDERLYING_ASSET,market);
  // // =====================================create vault===============================================

  // // Create vault using the strategy
  // await VaultFactory.createVault(
  //   UNDERLYING_ASSET, // Link address
  //   market,
  //   PendlePTStrategy.target,
  //   signer.address, // fee collector
  //   2000, // 20% performance fee
  //   "Bolarity USDC Vault",
  //   "USDCV"
  // );
  // console.log("Vault created for USDC with Compound strategy");

  // =====================================deposit===============================================
  // await MockERC20.approve(BOLARITY_ROUTER, ethers.MaxUint256);
  // console.log("Approve success");
  // const amout = ethers.parseEther("0.1");
  // const calldata = await swapTokenToPt(amout.toString(), vault);
  // await BolarityRouter.deposit(
  //   UNDERLYING_ASSET, // Link address
  //   market,
  //   amout,
  //   signer.address,
  //   calldata,
  // );
  // console.log("Deposit from vault");

  // =====================================withdraw/redeem===============================================
  // Option 1: Using withdraw with slippage adjustment (commented out)
  const BolarityVault_factory = await ethers.getContractFactory("BolarityVault");
  const BolarityVault = await BolarityVault_factory.attach(vault);
  await BolarityVault.approve(BOLARITY_ROUTER, ethers.MaxUint256);
  console.log("Approve success");
  const userBalance = await BolarityRouter.getUserBalance(UNDERLYING_ASSET,market, signer.address);
  console.log("User balance (shares):", userBalance);
  const userAsset = await BolarityRouter.previewRedeem(UNDERLYING_ASSET,market, userBalance);
  console.log("Expected assets from redeem:", userAsset);
  
  // Apply slippage tolerance (99% of expected amount to account for swap slippage)
  const withdrawAmount = userAsset * 99n / 100n;
  console.log("Adjusted withdraw amount (with slippage):", withdrawAmount);
  
  const calldata = await swapPtToToken(userAsset.toString(), vault);
  console.log("Swap calldata generated");
  
  await BolarityRouter.withdraw(
    UNDERLYING_ASSET,
    market,
    withdrawAmount, // Use adjusted amount instead of full userAsset
    signer.address,
    signer.address,
    calldata,
  );
  console.log("Withdraw from vault");

  // // Option 2: Using redeem (recommended - works with shares directly)
  // const BolarityVault_factory = await ethers.getContractFactory("BolarityVault");
  // const BolarityVault = await BolarityVault_factory.attach(vault);
  // await BolarityVault.approve(BOLARITY_ROUTER, ethers.MaxUint256);
  // console.log("Approve success");
  
  // const userBalance = await BolarityRouter.getUserBalance(UNDERLYING_ASSET, market, signer.address);
  // console.log("User balance (shares):", userBalance);
  
  // const userAsset = await BolarityRouter.previewRedeem(UNDERLYING_ASSET, market, userBalance);
  // console.log("Expected assets from redeem:", userAsset);
  
  // // Check PT balance in the vault
  // const PendlePT = await ethers.getContractAt("IERC20", PENDLE_PT);
  // const vaultPTBalance = await PendlePT.balanceOf(vault);
  // console.log("Vault PT balance:", vaultPTBalance);
  
  // // Use higher slippage (3%) for the swap
  // const calldata = await swapPtToToken(vaultPTBalance.toString(), vault, 0.03);
  // console.log("Swap calldata generated with 3% slippage for PT amount:", vaultPTBalance.toString());
  
  // // Using redeem instead of withdraw - it handles shares directly
  // await BolarityRouter.redeem(
  //   UNDERLYING_ASSET,
  //   market,
  //   userBalance, // redeem all shares
  //   signer.address,
  //   signer.address,
  //   calldata,
  // );
  // console.log("Redeem from vault");


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
