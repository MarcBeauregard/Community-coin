// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MemeToken
/// @notice Plain ERC20 whose supply is controlled by the CommunityCoin hub that deployed it.
/// Tokens only exist because someone bought them on the hub's curve, so every unit is backed.
/// @dev The hub is immutable and ownerless; it only ever burns or moves tokens of `msg.sender`
/// (sells, commits, union votes), which saves users an `approve` before each action.
contract MemeToken is ERC20 {
    address public immutable hub;

    error OnlyHub();

    modifier onlyHub() {
        if (msg.sender != hub) revert OnlyHub();
        _;
    }

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {
        hub = msg.sender;
    }

    function mint(address to, uint256 amount) external onlyHub {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyHub {
        _burn(from, amount);
    }

    function hubTransfer(address from, address to, uint256 amount) external onlyHub {
        _transfer(from, to, amount);
    }
}
