# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Bolarity Vault Router** is a DeFi protocol for automated yield optimization on Ethereum. This is a Hardhat-based smart contract development project using TypeScript and Solidity 0.8.28, featuring a modular architecture with vault management, strategy routing, and factory patterns.

### Key Components
- **BolarityRouter** - Main entry point for deposits, withdrawals, and strategy routing
- **BolarityVault** - ERC4626-compliant vault for asset management
- **VaultFactory** - Factory contract for creating new vault instances
- **Registry** - Central registry for vaults and strategies
- **Strategies** - Multiple yield strategies (Aave, Compound, Pendle, WstETH)

### Dependencies
- **OpenZeppelin Contracts v5.4.0** - Security and standard implementations
- **Hardhat Toolbox v6.1.0** - Complete development environment
- **Solidity 0.8.28** - With optimizer enabled (200 runs)

## Common Development Commands

### Build and Compilation
```bash
npx hardhat compile  # Compiles all Solidity contracts
npx hardhat clean    # Clears cache and deletes all artifacts
```

### Testing
```bash
npx hardhat test                  # Run all tests
npx hardhat test test/Lock.ts     # Run specific test file
REPORT_GAS=true npx hardhat test  # Run tests with gas reporting
npx hardhat coverage              # Generate code coverage report
```

### Development Environment
```bash
npx hardhat node     # Start local Hardhat network
npx hardhat console  # Open Hardhat console
```

### Deployment
```bash
# Deploy to local network
npx hardhat run scripts/aave_deploy.ts

# Deploy to specific network
npx hardhat run scripts/aave_deploy.ts --network sepolia
npx hardhat run scripts/compound_deploy.ts --network base
npx hardhat run scripts/pendle_deploy.ts --network hoodi
```

## Project Architecture

### Directory Structure
```
BolarityVaultRouter/
├── contracts/              # Solidity smart contracts
│   ├── BolarityRouter.sol  # Main router contract
│   ├── BolarityVault.sol   # ERC4626 vault implementation
│   ├── Registry.sol        # Vault/strategy registry
│   ├── VaultFactory.sol    # Vault creation factory
│   ├── interfaces/         # Contract interfaces
│   ├── strategies/         # Yield strategy implementations
│   │   ├── AaveStrategy.sol
│   │   ├── CompoundStrategy.sol
│   │   ├── PendlePTStrategy.sol
│   │   └── WstETHStrategy.sol
│   └── mocks/             # Test mock contracts
├── test/                  # TypeScript test suite
├── scripts/               # Deployment and utility scripts
├── artifacts/             # Compiled contract artifacts (generated)
├── cache/                # Hardhat cache (generated)
└── typechain-types/      # TypeScript type definitions (generated)
```

### Key Technologies
- **Hardhat** - Development environment and testing framework
- **Hardhat Toolbox** - Bundle of commonly used plugins including:
  - Ethers.js for contract interactions
  - Chai for assertions
  - TypeChain for TypeScript bindings
  - Hardhat Ignition for deployments
- **Solidity 0.8.28** - Smart contract language version
- **TypeScript** - For tests and configuration

### Contract Development Workflow
1. Write/modify contracts in `contracts/` directory
2. Run `npx hardhat compile` to compile
3. Write tests in `test/` directory using TypeScript
4. Deploy using strategy-specific scripts in `scripts/` directory:
   - `aave_deploy.ts` - Aave strategy deployment
   - `compound_deploy.ts` - Compound strategy deployment
   - `lido_deploy.ts` - Lido/WstETH strategy deployment
   - `pendle_deploy.ts` - Pendle strategy deployment
   - `helper.ts` - Deployment utilities
   - `cashappSDK/` - SDK prototype implementation

### Network Configuration
- **Local**: Hardhat network (default)
- **Sepolia Testnet**: chainId 11155111 (Ethereum testnet)
- **Base Mainnet**: chainId 8453 (Layer 2 network)
- **Hoodi Network**: chainId 560048 (Custom network with Etherscan verification)
- **Environment Variables**: EVM_RPC, PRIVATE, API_KEY for deployment and verification

### Testing Framework
- **9 Test Files**: Comprehensive coverage of all major components
- **Integration Tests**: Full end-to-end workflow testing
- **Mock Contracts**: Extensive mocking for external dependencies
- **Gas Reporting**: Available with REPORT_GAS=true flag