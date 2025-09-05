# Bolarity Vault Router

## Overview

Bolarity Vault Router is a decentralized finance (DeFi) protocol built on Ethereum that provides flexible asset management and yield optimization solutions. The protocol automatically allocates user funds across different yield strategies through an intelligent routing system to achieve optimal asset allocation.

### Core Features

- **Smart Routing System**: Asset routing and management through the BolarityRouter contract
- **Vault Management**: BolarityVault provides standardized ERC4626 vault implementation with deposit, withdrawal, and yield distribution
- **Strategy Management**: Supports multiple yield strategies (e.g., Aave, Compound) with flexible switching and optimization
- **Factory Pattern**: VaultFactory provides standardized vault creation and management
- **Registry System**: Registry contract manages registration of all vaults and strategies

### Tech Stack

- **Solidity 0.8.28**: Smart contract development language
- **Hardhat**: Ethereum development environment and testing framework
- **OpenZeppelin**: Secure smart contract libraries
- **TypeScript**: Testing and configuration scripts
- **Ethers.js**: JavaScript library for Ethereum interaction

## Installation

### Prerequisites

- Node.js >= 18.0.0
- npm or yarn

### Setup

```bash
# Clone the repository
git clone https://github.com/your-org/BolarityVaultRouter.git
cd BolarityVaultRouter

# Install dependencies
npm install
```

## Compilation

Compile all smart contracts:

```bash
npx hardhat compile
```

Clean cache and build files:

```bash
npx hardhat clean
```

## Testing

### Run all tests

```bash
npx hardhat test
```

### Run specific test file

```bash
npx hardhat test test/BolarityRouter.test.ts
```

### Run tests with gas reporting

```bash
REPORT_GAS=true npx hardhat test
```

### Generate code coverage report

```bash
npx hardhat coverage
```

## Deployment

### Start local development network

```bash
npx hardhat node
```

### Deploy contracts

Using Hardhat Ignition:

```bash
npx hardhat ignition deploy ./ignition/modules/Deploy.ts
```

### Deploy to testnet

```bash
npx hardhat ignition deploy ./ignition/modules/Deploy.ts --network sepolia
```

## Project Structure

```
BolarityVaultRouter/
├── contracts/              # Solidity smart contracts
│   ├── BolarityRouter.sol  # Main router contract
│   ├── BolarityVault.sol   # ERC4626 vault contract
│   ├── Registry.sol        # Registry contract
│   ├── VaultFactory.sol    # Vault factory contract
│   ├── interfaces/         # Interface definitions
│   ├── strategies/         # Strategy implementations
│   └── mocks/             # Mock contracts for testing
├── test/                  # TypeScript test files
├── ignition/             # Hardhat Ignition deployment modules
│   └── modules/
├── scripts/              # Deployment and interaction scripts
├── artifacts/            # Compilation artifacts (auto-generated)
├── cache/               # Hardhat cache (auto-generated)
├── typechain-types/     # TypeScript type definitions (auto-generated)
└── hardhat.config.ts    # Hardhat configuration
```

## Main Contracts

### BolarityRouter

Main router contract responsible for managing deposits, withdrawals, and strategy routing.

- `deposit()`: Deposit assets to specified vault
- `withdraw()`: Withdraw assets from vault
- `redeem()`: Redeem vault shares

### BolarityVault

ERC4626-compliant vault contract managing user assets and yield distribution.

- `totalAssets()`: Get total vault assets
- `convertToShares()`: Convert assets to shares
- `convertToAssets()`: Convert shares to assets

### Registry

Registry contract maintaining registration information for all vaults and strategies.

- `registerVault()`: Register new vault
- `registerStrategy()`: Register new strategy
- `getVault()`: Get vault information

### VaultFactory

Vault factory contract for creating and deploying new vault instances.

- `createVault()`: Create new vault
- `deployVault()`: Deploy vault contract

## Development

### Run Hardhat console

```bash
npx hardhat console
```

### Verify contracts

```bash
npx hardhat verify --network mainnet DEPLOYED_CONTRACT_ADDRESS
```

## Security

- All contracts utilize OpenZeppelin's security components
- Reentrancy protection (ReentrancyGuard)
- Emergency pause functionality (Pausable)
- Access control (Ownable)

## Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) file for details.

MIT License

Copyright (c) 2024 Bolarity Team

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
