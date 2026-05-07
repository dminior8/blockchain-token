// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MultiChainToken is ERC20, Ownable {
    constructor(uint256 initialSupply)
    ERC20("MultiChain Research Token", "MCRT")
    Ownable(msg.sender)
    {
        // P4: Deployment to kosztowna transakcja
        // Początkowy mint dla deployera
        _mint(msg.sender, initialSupply * 10 ** decimals());
    }

    // Funkcja do badania kosztów zmiany stanu (state trie)
    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }
}