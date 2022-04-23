// SPDX-License-Identifier: MIT

pragma solidity >=0.6.12;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../Interfaces/IDERC20.sol";
import "../Interfaces/IStrategy.sol";

/*
 __    __     __     __   __      ______   __
/\ "-./  \   /\ \   /\ "-.\ \    /\  ___\ /\ \
\ \ \-./\ \  \ \ \  \ \ \-.  \   \ \  __\ \ \ \
 \ \_\ \ \_\  \ \_\  \ \_\\"\_\   \ \_\    \ \_\
  \/_/  \/_/   \/_/   \/_/ \/_/    \/_/     \/_/
*/

/**
 * @dev Implementation of a vault to deposit funds for yield optimizing.
 * This is the contract that receives funds and that users interface with.
 * The yield optimizing strategy itself is implemented in a separate 'Strategy.sol' contract.
 * @author minimum.finance
 */
contract MinimumVault is ERC20, Ownable, ReentrancyGuard {
    using SafeERC20 for IDERC20;
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    /**
     * @dev Cap on the amount of {want} that can be in this vault.
     * @notice Funds in the vault can grow beyond this, but deposits cease here
     */
    uint256 public wantCap;

    struct StratCandidate {
        address implementation;
        uint256 proposedTime;
    }

    // The last proposed strategy to switch to.
    StratCandidate public stratCandidate;
    // The strategy currently in use by the vault.
    IStrategy public strategy;
    // The minimum time it has to pass before a strat candidate can be approved.
    uint256 public immutable approvalDelay;

    /**
     * @dev Events:
     * NewStratCandidate        - Emitted when a new strategy is proposed
     * UpgradeStrat             - Emitted when a strategy candidate is implemented
     * NewWantCap               - Emitted when the {wantCap} is changed
     */
    event NewStratCandidate(address implementation);
    event UpgradeStrat(address implementation);
    event NewWantCap(uint256 newCap);

    /**
     * @dev Assigns a strategy and therefore also an underlying {token}
     * for the vault to hold. Initializes the vaults own 'min' token.
     * The vault's 'min' token represents a share of the vault. 'min'
     * tokens are minted when someone makes a deposit and burned when
     * someone makes a withdrawal such that their 'min' token share is
     * equivalent of the ratio of their contribution/TVL in the vault.
     * @param _strategy The address of the strategy.
     * @param name_ The name of the vault 'min' token.
     * @param symbol_ The symbol of the vault 'min' token.
     * @param _approvalDelay The minimum delay before a strat can be approved
     * @param _wantCap The cap of {want} that can be deposited
     */
    constructor(
        IStrategy _strategy,
        string memory name_,
        string memory symbol_,
        uint256 _approvalDelay,
        uint256 _wantCap
    ) public ERC20(name_, symbol_) {
        strategy = _strategy;
        approvalDelay = _approvalDelay;
        wantCap = _wantCap;
    }

    /* ======== VIEW FUNCTIONS ======== */

    /**
     * @dev Returns the underlying {token} used by this vault and strategy
     */
    function want() public view returns (IDERC20) {
        return IStrategy(strategy).want();
    }

    /**
     * @dev Returns the output token that users will receive from the vault
     */
    function output() public view returns (IDERC20) {
        return IStrategy(strategy).output();
    }

    /**
     * @dev Returns the total balance of {want} in this vault contract,
     * the vault's strategy contract and the user deposited balance that
     * has been deployed in other contracts as a result of the strategy.
     */
    function balance() public view returns (uint256) {
        return want().balanceOf(address(this)).add(strategy.totalBalance());
    }

    /**
     * @dev Returns the total available {want} in this vault contract
     * that can be used with the strat. Currently returns 100% of {want}.
     * @notice In the future we may want to hold some of the {want} in
     * reserve, rather than putting 100% of funds to work.
     */
    function availableWant() public view returns (uint256) {
        return want().balanceOf(address(this));
    }

    /**
     * @dev Returns the total available {output} in this vault contract
     * that can be used with the strat. Currently returns 100% of {output}.
     */
    function availableOutput() public view returns (uint256) {
        return output().balanceOf(address(this));
    }

    /**
     * @dev Whether or not the vault's strategy is currently bonding
     */
    function isBonding() external view returns (bool) {
        return strategy.isBonding();
    }

    /**
     * @dev Whether or not the strategy's funds are warmed up
     */
    function warmedUp() external view returns (bool) {
        return strategy.warmedUp();
    }

    /**
     * @dev The block expiration of the current reserve period
     */
    function currentReservePeriodExpiry() external view returns (uint256) {
        return
            strategy.blocksLeftInReservePeriod(strategy.currentReservePeriod());
    }

    /**
     * @dev Amount of {want} until {wantCap} is hit
     */
    function capRoom() external view returns (uint256) {
        uint256 vaultBal = balance();
        return wantCap > vaultBal ? wantCap.sub(vaultBal) : 0;
    }

    /**
     * @dev Minimum amount of {_want} that can be deposited
     * @notice Protects against denial of service attacks
     */
    function minDeposit() public view returns (uint256) {
        return IStrategy(strategy).minDeposit();
    }

    /**
     * @dev Info about a claimers reserve
     */
    function claimerInfo(address _claimer)
        external
        view
        returns (uint256 _amount, uint256 _blocks)
    {
        uint256 _period;
        (_amount, , _period) = strategy.claimOfReserves(_claimer);
        _blocks = strategy.blocksLeftInReservePeriod(_period);
    }

    /* ======== USER FUNCTIONS ======== */

    /**
     * @dev Convenience function to deposit all of the sender's {want}
     */
    function depositAll() external {
        deposit(want().balanceOf(msg.sender));
    }

    /**
     * @dev Convenience function to reserve all the sender's funds
     */
    function reserveAll() external {
        reserve(balanceOf(msg.sender));
    }

    /**
     * @dev Claim function for users who are vested out
     */
    function claim() external returns (uint256) {
        return IStrategy(strategy).claim(msg.sender);
    }

    /**
     * @dev Deposit's the sender's funds into the vault and then puts
     * them to work in the strategy
     * @param _amount The amount of {want} to deposit into the strategy
     */
    function deposit(uint256 _amount) public nonReentrant {
        require(_amount >= minDeposit(), "< minDeposit!");
        require(balance().add(_amount) <= wantCap, "> wantCap!");

        uint256 poolBalBefore = balance();
        want().safeTransferFrom(msg.sender, address(this), _amount);
        earn();

        _amount = balance().sub(poolBalBefore); // Pre-cautionary check for deflationary tokens

        uint256 shares;

        if (totalSupply() <= 0) {
            // Control for difference in decimals between the vault token and {want}
            shares = _amount.mul(10**uint256(decimals())).div(
                10**uint256(want().decimals())
            );
        } else {
            // Issue shares proportional to the exchange rate of vaultToken / {want}
            shares = _amount.mul(totalSupply()).div(poolBalBefore);
        }
        _mint(msg.sender, shares);
    }

    /**
     * @dev Function to exit the system. The vault will redeem the required tokens
     * from the strategy or keep them in reserves until bonding is over.
     * A proportional number of IOU vault tokens are burned in the process.
     * @param _shares The number of shares to reserve
     */
    function reserve(uint256 _shares) public nonReentrant {
        require(_shares > 0, "!shares > 0");
        // Proportional to the number of shares user owns
        uint256 withdrawAmount = balance().mul(_shares).div(totalSupply());
        _burn(msg.sender, _shares);
        strategy.reserve(withdrawAmount, msg.sender);
    }

    /**
     * @dev Sends available vault funds to the strategy to be put to work
     */
    function earn() public {
        want().safeTransfer(address(strategy), availableWant());
        output().safeTransfer(address(strategy), availableOutput());
        strategy.deposit();
    }

    /* ======== MANAGER FUNCTIONS ======== */

    /**
     * @dev Set want cap for this vault
     * @param _cap Cap amount to be set
     */
    function setCap(uint256 _cap) external onlyOwner {
        wantCap = _cap;

        emit NewWantCap(_cap);
    }

    /* ======== STRATEGY UPGRADE FUNCTIONS ======== */

    /**
     * @dev Sets the candidate for the new strat to use with this vault
     * @param _implementation The address of the candidate strategy
     */
    function proposeStrat(address _implementation) external onlyOwner {
        require(
            address(this) == IStrategy(_implementation).vault(),
            "Proposal not valid for this Vault"
        );
        stratCandidate = StratCandidate({
            implementation: _implementation,
            proposedTime: block.timestamp
        });

        emit NewStratCandidate(_implementation);
    }

    /**
     * @dev It switches the active strat for the strat candidate. After upgrading, the
     * candidate implementation is set to the 0x00 address, and proposedTime to a time
     * happening in +100 years for safety.
     */
    function upgradeStrat() external onlyOwner {
        require(
            stratCandidate.implementation != address(0),
            "There is no candidate"
        );
        require(
            stratCandidate.proposedTime.add(approvalDelay) < block.timestamp,
            "Delay has not passed"
        );

        emit UpgradeStrat(stratCandidate.implementation);

        strategy.retireStrat();
        strategy = IStrategy(stratCandidate.implementation);
        stratCandidate.implementation = address(0);
        stratCandidate.proposedTime = 5000000000;

        earn();
    }

    /* ======== EMERGENCY CONTROL FUNCTIONS ======== */

    /**
     * @dev Rescues random funds stuck that the strat can't handle
     * @param _token address of the token to rescue
     */
    function inCaseTokensGetStuck(address _token) external onlyOwner {
        require(
            _token != address(want()) && _token != address(output()),
            "!token"
        );

        uint256 amount = IERC20(_token).balanceOf(address(this));
        IERC20(_token).safeTransfer(msg.sender, amount);
    }

    /* ======== UTILITY FUNCTIONS ======== */

    /**
     * @dev Function for various UIs to display the current value of one of our yield tokens.
     * Returns an uint256 with {want}'s decimals of how much underlying asset one vault share represents.
     */
    function getPricePerFullShare() external view returns (uint256) {
        return
            totalSupply() == 0
                ? 10**uint256(want().decimals())
                : balance().mul(1e18).div(totalSupply());
    }
}
