// SPDX-License-Identifier: MIT

pragma solidity >=0.6.12;

/*
 * @dev Interface for BondDepository contracts used with rebasing tokens.
 * @author minimum.finance
 */
interface IBondDepository {
    function redeem(address _recipient, bool _stake) external;

    function deposit(
        uint256 _amount,
        uint256 _maxPrice,
        address _depositor
    ) external returns (uint256);

    function bondPrice() external view returns (uint256);

    function pendingPayoutFor(address _depositAddress)
        external
        view
        returns (uint256);

    function payoutFor(uint256 _amount) external view returns (uint256);

    function maxPayout() external view returns (uint256);

    function bondInfo(address _depositor)
        external
        view
        returns (
            uint256 payout,
            uint256 vesting,
            uint256 lastBlock,
            uint256 pricePaid
        );

    function principle() external view returns (address);

    function percentVestedFor(address _depositor)
        external
        view
        returns (uint256);

    function bondPriceInUSD() external view returns (uint256);

    function assetPrice() external view returns (uint256);

    function policy() external view returns (address);

    function setBondTerms(uint8 _paramater, uint256 _input) external;

    function setBasePrice(uint256 _basePrice) external;

    function terms()
        external
        view
        returns (
            uint256 controlVariable,
            uint256 vestingTerm,
            uint256 minimumPrice,
            uint256 maximumPayout,
            uint256 fee,
            uint256 maxDebt
        );

    function debtRatio() external view returns (uint256);

    function currentDebt() external view returns (uint256);

    function basePrice() external view returns (uint256);

    function isLiquidityBond() external view returns (bool);

    function initializeBondTerms(
        uint256 _controlVariable,
        uint256 _vestingTerm,
        uint256 _minimumPrice,
        uint256 _maximumDiscount,
        uint256 _maxPayout,
        uint256 _fee,
        uint256 _maxDebt,
        uint256 _initialDebt
    ) external;

    function totalDebt() external view returns (uint256);
}
