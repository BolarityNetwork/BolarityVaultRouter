// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../interfaces/IAave.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockAToken is IAToken, IERC20 {
    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;
    
    address public immutable UNDERLYING_ASSET_ADDRESS;
    uint256 public override totalSupply;
    
    string public name;
    string public symbol;
    uint8 public decimals = 18;
    
    constructor(address _underlying) {
        UNDERLYING_ASSET_ADDRESS = _underlying;
        name = "Aave Interest Bearing Token";
        symbol = "aToken";
    }
    
    // Override balanceOf to include proportional gains
    function balanceOf(address account) public view override(IAToken, IERC20) returns (uint256) {
        if (totalSupply == 0) return _balances[account];
        
        // Calculate the total underlying balance
        uint256 underlyingBalance = IERC20(UNDERLYING_ASSET_ADDRESS).balanceOf(address(this));
        
        // If there are gains/losses, distribute them proportionally
        if (underlyingBalance != totalSupply) {
            // Return proportional share of total underlying
            return (_balances[account] * underlyingBalance) / totalSupply;
        }
        
        return _balances[account];
    }
    
    function allowance(address owner, address spender) public view override returns (uint256) {
        return _allowances[owner][spender];
    }
    
    function mint(address to, uint256 amount) external {
        _balances[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }
    
    function burn(address from, uint256 amount) external {
        require(_balances[from] >= amount, "Insufficient balance");
        _balances[from] -= amount;
        totalSupply -= amount;
        emit Transfer(from, address(0), amount);
    }
    
    // Helper function for withdraw - burn and transfer underlying
    function burnAndTransfer(address from, uint256 amount, address to) external {
        // Calculate the actual balance including proportional gains/losses
        uint256 actualBalance = balanceOf(from);
        require(actualBalance >= amount, "Insufficient balance");
        
        // Calculate how many internal balance units to burn to achieve the amount
        uint256 underlyingBalance = IERC20(UNDERLYING_ASSET_ADDRESS).balanceOf(address(this));
        uint256 internalToBurn;
        
        if (underlyingBalance > totalSupply) {
            // There are gains, need to burn less internal balance
            internalToBurn = (amount * totalSupply) / underlyingBalance;
        } else if (underlyingBalance < totalSupply) {
            // There are losses, need to burn more internal balance
            internalToBurn = (amount * totalSupply + underlyingBalance - 1) / underlyingBalance;
        } else {
            // No gains or losses
            internalToBurn = amount;
        }
        
        // Ensure we don't burn more than available
        if (internalToBurn > _balances[from]) {
            internalToBurn = _balances[from];
        }
        
        _balances[from] -= internalToBurn;
        totalSupply -= internalToBurn;
        
        // Transfer underlying tokens to recipient
        IERC20(UNDERLYING_ASSET_ADDRESS).transfer(to, amount);
        
        emit Transfer(from, address(0), internalToBurn);
    }
    
    // IERC20 implementation
    function transfer(address to, uint256 amount) external override returns (bool) {
        require(_balances[msg.sender] >= amount, "Insufficient balance");
        _balances[msg.sender] -= amount;
        _balances[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }
    
    function approve(address spender, uint256 amount) external override returns (bool) {
        _allowances[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }
    
    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        require(_balances[from] >= amount, "Insufficient balance");
        require(_allowances[from][msg.sender] >= amount, "Insufficient allowance");
        
        _balances[from] -= amount;
        _balances[to] += amount;
        _allowances[from][msg.sender] -= amount;
        
        emit Transfer(from, to, amount);
        return true;
    }
    
    // Test helper functions to simulate gains and losses
    function simulateGain(uint256 amount) external {
        // Pull underlying tokens from sender
        IERC20(UNDERLYING_ASSET_ADDRESS).transferFrom(msg.sender, address(this), amount);
        // The gain will be reflected in balanceOf automatically through the proportional calculation
    }
    
    function simulateLoss(uint256 amount) external {
        // Transfer tokens out to simulate losses
        IERC20(UNDERLYING_ASSET_ADDRESS).transfer(msg.sender, amount);
        // The loss will be reflected in balanceOf automatically through the proportional calculation
    }
}

contract MockPoolDataProvider is IPoolDataProvider {
    mapping(address => address) public aTokens;
    
    function setATokenAddress(address asset, address aToken) external {
        aTokens[asset] = aToken;
    }
    
    function getReserveTokensAddresses(address asset) external view override returns (
        address aTokenAddress,
        address stableDebtTokenAddress,
        address variableDebtTokenAddress
    ) {
        return (aTokens[asset], address(0), address(0));
    }
}