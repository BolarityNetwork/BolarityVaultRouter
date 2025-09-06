
import { ethers } from "hardhat";

async function main() {
  console.log("Starting deployment...");
  
  // 1. Deploy Registry
  const Registry = await ethers.deployContract("Registry", []);
  await Registry.waitForDeployment();
  console.log(`Registry deployed to ${Registry.target}`);
  
  // 2. Deploy StrategyFactory
  const StrategyFactory = await ethers.deployContract("StrategyFactory", []);
  await StrategyFactory.waitForDeployment();
  console.log(`StrategyFactory deployed to ${StrategyFactory.target}`);
  
  // 3. Deploy VaultFactory
  const VaultFactory = await ethers.deployContract("VaultFactory", [Registry.target]);
  await VaultFactory.waitForDeployment();
  console.log(`VaultFactory deployed to ${VaultFactory.target}`);
  
  // 4. Deploy BolarityRouter
  const BolarityRouter = await ethers.deployContract("BolarityRouter", [Registry.target, VaultFactory.target]);
  await BolarityRouter.waitForDeployment();
  console.log(`BolarityRouter deployed to ${BolarityRouter.target}`);
  
  // 5. Transfer Registry ownership to VaultFactory
  await Registry.transferOwnership(VaultFactory.target);
  console.log("Registry ownership transferred to VaultFactory");
  
  // 6. Set Router in VaultFactory
  await VaultFactory.setRouter(BolarityRouter.target);
  console.log("Router set in VaultFactory");
  
  // Example: Deploy an Aave strategy (uncomment and configure when ready)
  /*
  // Deploy Aave strategy with Aave pool address
  const AAVE_POOL_ADDRESS = "0x..."; // Replace with actual Aave pool address on your network
  const deployAaveTx = await StrategyFactory.deployAaveStrategy(AAVE_POOL_ADDRESS);
  const receipt = await deployAaveTx.wait();
  
  // Get strategy ID
  const strategyId = await StrategyFactory.computeAaveStrategyId(AAVE_POOL_ADDRESS);
  const aaveStrategyAddress = await StrategyFactory.getStrategy(strategyId);
  console.log(`Aave Strategy deployed to ${aaveStrategyAddress}`);
  
  // Register aTokens for different assets
  const assets = [
    { asset: "0x...", aToken: "0x..." }, // USDC and aUSDC
    { asset: "0x...", aToken: "0x..." }, // WETH and aWETH
  ];
  
  for (const { asset, aToken } of assets) {
    await StrategyFactory.registerATokenForStrategy(strategyId, asset, aToken);
    console.log(`Registered aToken ${aToken} for asset ${asset}`);
  }
  
  // Create vault using the strategy
  const market = ethers.encodeBytes32String("AAVE-V3");
  await VaultFactory.createVault(
    assets[0].asset, // USDC address
    market,
    aaveStrategyAddress,
    await (await ethers.getSigners())[0].getAddress(), // fee collector
    2000, // 20% performance fee
    "Bolarity USDC Vault",
    "bUSDC"
  );
  console.log("Vault created for USDC with Aave strategy");
  */
  
  console.log("\nDeployment complete!");
  console.log("====================");
  console.log("Registry:", Registry.target);
  console.log("StrategyFactory:", StrategyFactory.target);
  console.log("VaultFactory:", VaultFactory.target);
  console.log("BolarityRouter:", BolarityRouter.target);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
