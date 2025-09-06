import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    hardhat: {
    },
    sepolia: {
          url: process.env.EVM_RPC!,
          chainId: 11155111,
          accounts: [
              process.env.PRIVATE!,
          ]
    },
  }
};

export default config;
