// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title DemoAaveOracle
/// @notice Settable price oracle with Aave's `getAssetPrice` interface, etched over Aave's oracle on a fork
///         so the demo can move prices. Demo only.
/// @dev No access control: anyone can set any price.
contract DemoAaveOracle {
    /// @notice A price was set.
    /// @param asset Asset address.
    /// @param price New price.
    event PriceSet(address indexed asset, uint256 price);

    /// @notice Current price per asset.
    mapping(address asset => uint256 price) public prices;

    /// @notice Sets the price returned for `asset`.
    /// @param asset Asset address.
    /// @param price New price, in the oracle's base currency units.
    function setPrice(address asset, uint256 price) external {
        prices[asset] = price;
        emit PriceSet(asset, price);
    }

    /// @notice Price last set for `asset`, 0 if never set.
    /// @param asset Asset address.
    /// @return Price of `asset`.
    function getAssetPrice(address asset) external view returns (uint256) {
        return prices[asset];
    }
}
