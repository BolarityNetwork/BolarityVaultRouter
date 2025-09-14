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
    base: {
          url: process.env.EVM_RPC!,
          chainId: 8453,
          accounts: [
              process.env.PRIVATE!,
          ]
    },
    hoodi: {
          url: process.env.EVM_RPC!,
          chainId: 560048,
          accounts: [
              process.env.PRIVATE!,
          ]
    },
  },
  etherscan: {
    apiKey: process.env.API_KEY!,
    customChains: [
      {
        network: "hoodi",
        chainId: 560048,
        urls: {
          apiURL: "https://api-hoodi.etherscan.io/api",
          browserURL: "https://hoodi.etherscan.io/"
        }
      }
    ]
  }
};

export default config;
