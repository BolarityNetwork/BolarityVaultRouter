// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./strategies/AaveStrategy.sol";

contract StrategyFactory is Ownable {
    // Deployed strategy instances
    mapping(bytes32 => address) public strategies;
    
    // Events
    event StrategyDeployed(bytes32 indexed strategyId, address indexed strategy, string strategyType);
    event ATokenRegistered(address indexed strategy, address indexed asset, address indexed aToken);
    
    constructor() Ownable(msg.sender) {}
    
    /**
     * @dev Deploy an Aave strategy
     * @param aavePool The Aave pool address
     * @return strategy The deployed strategy address
     */
    function deployAaveStrategy(address aavePool) external onlyOwner returns (address strategy) {
        require(aavePool != address(0), "StrategyFactory: Invalid pool");
        
        bytes32 strategyId = keccak256(abi.encodePacked("AAVE", aavePool));
        require(strategies[strategyId] == address(0), "StrategyFactory: Strategy already exists");
        
        strategy = address(new AaveStrategy(aavePool));
        strategies[strategyId] = strategy;
        
        emit StrategyDeployed(strategyId, strategy, "AAVE");
        
        return strategy;
    }
    
    /**
     * @dev Register aToken for an asset in Aave strategy
     * @param strategyId The strategy identifier
     * @param asset The underlying asset address
     * @param aToken The corresponding aToken address
     */
    function registerATokenForStrategy(
        bytes32 strategyId,
        address asset,
        address aToken
    ) external onlyOwner {
        address strategy = strategies[strategyId];
        require(strategy != address(0), "StrategyFactory: Strategy not found");
        
        AaveStrategy(strategy).registerAToken(asset, aToken);
        
        emit ATokenRegistered(strategy, asset, aToken);
    }
    
    /**
     * @dev Get strategy by ID
     * @param strategyId The strategy identifier
     * @return The strategy address
     */
    function getStrategy(bytes32 strategyId) external view returns (address) {
        return strategies[strategyId];
    }
    
    /**
     * @dev Compute strategy ID for Aave
     * @param aavePool The Aave pool address
     * @return The strategy ID
     */
    function computeAaveStrategyId(address aavePool) external pure returns (bytes32) {
        return keccak256(abi.encodePacked("AAVE", aavePool));
    }
}