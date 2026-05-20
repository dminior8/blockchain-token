// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title TokenSaleApprove
 * @notice Sprzedaz ERC-20 w oknie czasowym [startTime, endTime] z vestingiem.
 *         Kupujacy placa ETH, dystrybucja tokenow nastepuje dopiero po releaseTime
 *         przez claim(). Tokeny pozostaja w portfelu `treasury` (zwykle ownera)
 *         az do claimu i sa sciagane przez transferFrom() - dlatego treasury
 *         MUSI przed startTime wykonac token.approve(saleAddress, tokensForSale * 10**decimals).
 *
 *         To jest klasyczny ICO approve-pattern: token nie zmienia wlasciciela do
 *         momentu rzeczywistego claimu, a sale jest tylko "agentem" upowaznionym
 *         do przelania okreslonej kwoty.
 */
contract TokenSaleApprove is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice ERC-20, ktory jest sprzedawany.
    IERC20 public immutable token;
    /// @notice Adres trzymajacy tokeny do sprzedazy (musi zrobic approve).
    address public immutable treasury;
    /// @notice Cena w wei za jeden "caly" token (1 token = 10**decimals jednostek bazowych).
    uint256 public immutable priceWeiPerToken;
    /// @notice Timestamp otwarcia sprzedazy.
    uint256 public immutable startTime;
    /// @notice Timestamp zamkniecia sprzedazy (po nim nie da sie juz kupowac).
    uint256 public immutable endTime;
    /// @notice Timestamp od ktorego mozna wykonac claim().
    uint256 public immutable releaseTime;
    /// @notice Maksymalna liczba calych tokenow do sprzedania.
    uint256 public immutable tokensForSale;

    /// @dev 10 ** token.decimals(), liczone raz w konstruktorze.
    uint256 private immutable _tokenUnit;

    /// @notice Ilu calych tokenow juz sprzedano.
    uint256 public tokensSold;
    /// @notice Liczba calych tokenow zakupionych przez danego uzytkownika.
    mapping(address => uint256) public purchased;
    /// @notice Czy uzytkownik wykonal juz claim.
    mapping(address => bool) public claimed;

    enum Phase {
        BeforeStart, // 0
        SaleOpen, // 1
        SaleClosed, // 2 - po endTime, przed releaseTime
        ClaimOpen // 3 - od releaseTime
    }

    event TokensPurchased(address indexed buyer, uint256 qty, uint256 paidWei);
    event TokensClaimed(address indexed buyer, uint256 baseUnits);
    event ProceedsWithdrawn(address indexed to, uint256 amountWei);

    error SaleNotStarted();
    error SaleEnded();
    error SaleStillOpen();
    error ReleaseNotReached();
    error InvalidQuantity();
    error IncorrectPayment();
    error SoldOut();
    error NothingToClaim();
    error AlreadyClaimed();
    error InvalidTimes();
    error EthTransferFailed();

    constructor(
        IERC20 _token,
        address _treasury,
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
        if (_priceWeiPerToken == 0 || _tokensForSale == 0 || _treasury == address(0)) {
            revert InvalidQuantity();
        }

        token = _token;
        treasury = _treasury;
        priceWeiPerToken = _priceWeiPerToken;
        startTime = _startTime;
        endTime = _endTime;
        releaseTime = _releaseTime;
        tokensForSale = _tokensForSale;
        _tokenUnit = 10 ** IERC20Metadata(address(_token)).decimals();
    }

    /**
     * @notice Kupuje `qty` calych tokenow placac dokladnie qty * priceWeiPerToken w ETH.
     *         Tokeny nie sa od razu transferowane - zostaja zaksiegowane jako purchased[msg.sender]
     *         i mozna je odebrac dopiero po releaseTime przez claim().
     */
    function buyTokens(uint256 qty) external payable nonReentrant {
        if (block.timestamp < startTime) revert SaleNotStarted();
        if (block.timestamp > endTime) revert SaleEnded();
        if (qty == 0) revert InvalidQuantity();

        uint256 remaining = tokensForSale - tokensSold;
        if (qty > remaining) revert SoldOut();

        uint256 cost = qty * priceWeiPerToken;
        if (msg.value != cost) revert IncorrectPayment();

        purchased[msg.sender] += qty;
        tokensSold += qty;

        emit TokensPurchased(msg.sender, qty, cost);
    }

    /**
     * @notice Odbiera zakupione tokeny po releaseTime. Pociaga je transferFrom(treasury, msg.sender, ...).
     *         Wymaga, ze treasury wczesniej zrobil approve(saleAddress, ...) na tokenie.
     */
    function claim() external nonReentrant {
        if (block.timestamp < releaseTime) revert ReleaseNotReached();
        uint256 qty = purchased[msg.sender];
        if (qty == 0) revert NothingToClaim();
        if (claimed[msg.sender]) revert AlreadyClaimed();

        claimed[msg.sender] = true;
        uint256 baseUnits = qty * _tokenUnit;
        token.safeTransferFrom(treasury, msg.sender, baseUnits);
        emit TokensClaimed(msg.sender, baseUnits);
    }

    /// @notice Owner moze odebrac zebrane ETH po zakonczeniu sprzedazy.
    function withdrawProceeds(address payable to) external onlyOwner nonReentrant {
        if (block.timestamp <= endTime) revert SaleStillOpen();
        uint256 amount = address(this).balance;
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert EthTransferFailed();
        emit ProceedsWithdrawn(to, amount);
    }

    /// @notice Aktualna faza sprzedazy wedlug block.timestamp.
    function phase() external view returns (Phase) {
        if (block.timestamp < startTime) return Phase.BeforeStart;
        if (block.timestamp <= endTime) return Phase.SaleOpen;
        if (block.timestamp < releaseTime) return Phase.SaleClosed;
        return Phase.ClaimOpen;
    }

    /// @notice Ile calych tokenow zostalo jeszcze do sprzedania.
    function tokensRemaining() external view returns (uint256) {
        return tokensForSale - tokensSold;
    }

    /// @notice Ile jednostek bazowych (z uwzglednieniem decimals) bedzie mogl odebrac `user`.
    function claimableOf(address user) external view returns (uint256) {
        if (claimed[user] || block.timestamp < releaseTime) return 0;
        return purchased[user] * _tokenUnit;
    }
}
