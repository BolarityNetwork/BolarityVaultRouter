# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Hardhat-based Ethereum smart contract development project using TypeScript and Solidity 0.8.28.

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
npx hardhat ignition deploy ./ignition/modules/Lock.ts  # Deploy using Hardhat Ignition
```

## Project Architecture

### Directory Structure
- `contracts/` - Solidity smart contracts
- `test/` - TypeScript test files using Hardhat's testing framework
- `ignition/modules/` - Hardhat Ignition deployment modules
- `artifacts/` - Compiled contract artifacts (generated)
- `cache/` - Hardhat cache (generated)
- `typechain-types/` - TypeScript type definitions for contracts (generated)

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
4. Deploy using Hardhat Ignition modules in `ignition/modules/`