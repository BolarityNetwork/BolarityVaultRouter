
import { ethers } from "hardhat";
import {ContractFactory, MaxUint256, ZeroAddress} from 'ethers'
const PendleRouter = require('../artifacts/contracts/interfaces/IPendle.sol/IPendleRouter.json')
const PendleOracle = require('../artifacts/contracts/interfaces/IPendle.sol/IPendleOracle.json')

const REGISTER            = "0xFf80cbF786406959F6C2f04b3dcF439B408AD93A";
const VAULT_FACTORY       = "0x6E0d96c86df60237E61C388C3Df65664Dad3aB9D";
const BOLARITY_ROUTER     = "0x864310c6355538585a444C735d4298B05EcBbeef";
const PENDLE_STRATEGY     = "0xF79c3d0B5F6c5a6798E6Aa08475b99039af77432";
const UNDERLYING_ASSET    = "0x35E5dB674D8e93a03d814FA0ADa70731efe8a4b9"; // USR
const PENDLE_ROUTER       = "0x888888888889758f76e7103c6cbf23abbf58f946";
const PENDLE_ORACLE       = "0x9a9fa8338dd5e5b2188006f1cd2ef26d921650c2";
const PENDLE_MARKET       = "0x715509bde846104cf2ccebf6fdf7ef1bb874bc45";
const PENDLE_PT           = "0xa6F0A4D18B6f6DdD408936e81b7b3A8BEFA18e77";


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
  // const PendlePTStrategy = await ethers.deployContract("PendlePTStrategy", [PENDLE_ROUTER, PENDLE_ORACLE]);
  // await PendlePTStrategy.waitForDeployment();
  // console.log(`PendlePTStrategy deployed to ${PendlePTStrategy.target}`);
  // await PendlePTStrategy.setPendleMarket(UNDERLYING_ASSET, PENDLE_MARKET, PENDLE_PT);
  // console.log(`PendlePTStrategy set market`);

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
  // const amout = ethers.parseEther("0.01");
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
