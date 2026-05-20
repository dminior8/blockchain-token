// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title TokenSalePrefund
 * @notice Wariant sprzedazy ERC-20, w ktorym owner pre-fundowal kontrakt - przed startem
 *         przeslal `tokensForSale * 10**decimals` tokenow bezposrednio na adres tego kontraktu.
 *         Claim() wyplaca tokeny przez token.transfer() z balansu kontraktu, BEZ uzywania approve.
 *
 *         Po releaseTime owner moze withdrawUnsold() - odebrac niesprzedana reszte.
 */
contract TokenSalePrefund is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    uint256 public immutable priceWeiPerToken;
    uint256 public immutable startTime;
    uint256 public immutable endTime;
    uint256 public immutable releaseTime;
    uint256 public immutable tokensForSale;

    uint256 private immutable _tokenUnit;

    uint256 public tokensSold;
    mapping(address => uint256) public purchased;
    mapping(address => bool) public claimed;
    bool public unsoldWithdrawn;

    enum Phase {
        BeforeStart,
        SaleOpen,
        SaleClosed,
        ClaimOpen
    }

    event TokensPurchased(address indexed buyer, uint256 qty, uint256 paidWei);
    event TokensClaimed(address indexed buyer, uint256 baseUnits);
    event ProceedsWithdrawn(address indexed to, uint256 amountWei);
    event UnsoldWithdrawn(address indexed to, uint256 baseUnits);

    error SaleNotStarted();
    error SaleEnded();
    error SaleStillOpen();
    error ReleaseNotReached();
    error InvalidQuantity();
    error IncorrectPayment();
    error SoldOut();
    error NothingToClaim();
    error AlreadyClaimed();
    error AlreadyWithdrawn();
    error InvalidTimes();
    error NotPrefunded();
    error EthTransferFailed();

    constructor(
        IERC20 _token,
        uint256 _priceWeiPerToken,
        uint256 _startTime,
        uint256 _endTime,
        uint256 _releaseTime,
        uint256 _tokensForSale
    ) Ownable(msg.sender) {
        if (
            _startTime < block.timestamp ||
            _endTime <= _startTime ||
            _releaseTime < _endTime
        ) revert InvalidTimes();
        if (_priceWeiPerToken == 0 || _tokensForSale == 0) revert InvalidQuantity();

        token = _token;
        priceWeiPerToken = _priceWeiPerToken;
        startTime = _startTime;
        endTime = _endTime;
        releaseTime = _releaseTime;
        tokensForSale = _tokensForSale;
        _tokenUnit = 10 ** IERC20Metadata(address(_token)).decimals();
    }

    /**
     * @notice Kupuje `qty` calych tokenow placac qty * priceWeiPerToken w ETH.
     *         Wymaga, ze kontrakt zostal wczesniej zasilony (token.balanceOf(this)) - sprawdzane
     *         przy pierwszym kupnie w danym oknie. Tokeny rezerwowane do claim po releaseTime.
     */
    function buyTokens(uint256 qty) external payable nonReentrant {
        if (block.timestamp < startTime) revert SaleNotStarted();
        if (block.timestamp > endTime) revert SaleEnded();
        if (qty == 0) revert InvalidQuantity();

        uint256 remaining = tokensForSale - tokensSold;
        if (qty > remaining) revert SoldOut();

        if (token.balanceOf(address(this)) < tokensForSale * _tokenUnit) {
            revert NotPrefunded();
        }

        uint256 cost = qty * priceWeiPerToken;
        if (msg.value != cost) revert IncorrectPayment();

        purchased[msg.sender] += qty;
        tokensSold += qty;

        emit TokensPurchased(msg.sender, qty, cost);
    }

    /// @notice Odbiera zakupione tokeny po releaseTime - kontrakt wysyla je z wlasnego balansu.
    function claim() external nonReentrant {
        if (block.timestamp < releaseTime) revert ReleaseNotReached();
        uint256 qty = purchased[msg.sender];
        if (qty == 0) revert NothingToClaim();
        if (claimed[msg.sender]) revert AlreadyClaimed();

        claimed[msg.sender] = true;
        uint256 baseUnits = qty * _tokenUnit;
        token.safeTransfer(msg.sender, baseUnits);
        emit TokensClaimed(msg.sender, baseUnits);
    }

    /// @notice Owner odbiera zebrane ETH po zakonczeniu sprzedazy.
    function withdrawProceeds(address payable to) external onlyOwner nonReentrant {
        if (block.timestamp <= endTime) revert SaleStillOpen();
        uint256 amount = address(this).balance;
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert EthTransferFailed();
        emit ProceedsWithdrawn(to, amount);
    }

    /// @notice Owner odbiera niesprzedane tokeny po releaseTime (jeden raz).
    function withdrawUnsold(address to) external onlyOwner nonReentrant {
        if (block.timestamp < releaseTime) revert ReleaseNotReached();
        if (unsoldWithdrawn) revert AlreadyWithdrawn();
        unsoldWithdrawn = true;
        uint256 unsoldBase = (tokensForSale - tokensSold) * _tokenUnit;
        if (unsoldBase > 0) {
            token.safeTransfer(to, unsoldBase);
        }
        emit UnsoldWithdrawn(to, unsoldBase);
    }

    function phase() external view returns (Phase) {
        if (block.timestamp < startTime) return Phase.BeforeStart;
        if (block.timestamp <= endTime) return Phase.SaleOpen;
        if (block.timestamp < releaseTime) return Phase.SaleClosed;
        return Phase.ClaimOpen;
    }

    function tokensRemaining() external view returns (uint256) {
        return tokensForSale - tokensSold;
    }

    function claimableOf(address user) external view returns (uint256) {
        if (claimed[user] || block.timestamp < releaseTime) return 0;
        return purchased[user] * _tokenUnit;
    }
}
