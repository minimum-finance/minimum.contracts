// SPDX-License-Identifier: MIT

pragma solidity >=0.6.12;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @dev Abstraction over common strategy components.
 */
abstract contract StratManager is Ownable, Pausable {
    /**
     * @dev Events:
     * NewKeeper                - Emitted when the {keeper} is changed
     * NewUnirouter             - Emitted when the {unirouter} is changed
     * NewVault                 - Emitted when the {vault} is changed
     * NewServiceFeeRecipient   - Emitted when the {serviceFeeRecipient} is changed
     * NewMinDeposit            - Emitted when the {minDeposit} is changed
     */
    event NewKeeper(address newKeeper);
    event NewUnirouter(address newUnirouter);
    event NewVault(address newVault);
    event NewServiceFeeRecipient(address newServiceFeeRecipient);
    event NewMinDeposit(uint256 newMinDeposit);

    /**
     * @dev Strategy behavior config:
     * {minDeposit}         - The minimum threshold of {rebaseToken} to enter rebasing
     */
    uint256 public minDeposit;

    /**
     * @dev Addresses:
     * {keeper}                 - Manages strategy performance
     * {unirouter}              - Address of exchange to execute swaps
     * {vault}                  - Address of the vault that controls the strategy's funds
     * {serviceFeeRecipient}    - Address to receive service fees
     */
    address public keeper;
    address public unirouter;
    address public vault;
    address public serviceFeeRecipient;

    constructor(
        address _keeper,
        address _unirouter,
        address _vault,
        address _serviceFeeRecipient,
        uint256 _minDeposit
    ) public {
        require(
            _keeper != address(0) &&
                _unirouter != address(0) &&
                _vault != address(0) &&
                _serviceFeeRecipient != address(0),
            "!0 Address"
        );

        keeper = _keeper;
        unirouter = _unirouter;
        vault = _vault;
        serviceFeeRecipient = _serviceFeeRecipient;
        minDeposit = _minDeposit;
    }

    // checks that caller is either owner or keeper.
    modifier onlyManager() {
        require(msg.sender == owner() || msg.sender == keeper, "!manager");
        _;
    }

    /**
     * @dev Updates address of the strat keeper.
     * @param _keeper new keeper address.
     */
    function setKeeper(address _keeper) external onlyOwner {
        require(_keeper != address(0), "!0 Address");

        keeper = _keeper;

        emit NewKeeper(_keeper);
    }

    /**
     * @dev Updates router that will be used for swaps.
     * @param _unirouter new unirouter address.
     */
    function setUnirouter(address _unirouter) external onlyOwner {
        require(_unirouter != address(0), "!0 Address");

        unirouter = _unirouter;

        emit NewUnirouter(_unirouter);
    }

    /**
     * @dev Updates parent vault.
     * @param _vault new vault address.
     */
    function setVault(address _vault) external onlyOwner {
        require(_vault != address(0), "!0 Address");

        vault = _vault;

        emit NewVault(_vault);
    }

    /**
     * @dev Updates beefy fee recipient.
     * @param _serviceFeeRecipient new beefy fee recipient address.
     */
    function setServiceFeeRecipient(address _serviceFeeRecipient)
        external
        onlyOwner
    {
        require(_serviceFeeRecipient != address(0), "!0 Address");

        serviceFeeRecipient = _serviceFeeRecipient;

        emit NewServiceFeeRecipient(_serviceFeeRecipient);
    }

    /**
     * @dev Updates the minimum deposit amount.
     * @param _minDeposit The new minimum deposit amount.
     */
    function setMinDeposit(uint256 _minDeposit) external onlyOwner {
        minDeposit = _minDeposit;

        emit NewMinDeposit(_minDeposit);
    }

    /**
     * @dev Function to synchronize balances before new user deposit.
     * Can be overridden in the strategy.
     */
    function beforeDeposit() external virtual {}
}
