// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

contract DemoAaveOracle {
    event PriceSet(address indexed asset, uint256 price);

    mapping(address asset => uint256 price) public prices;

    function setPrice(address asset, uint256 price) external {
        prices[asset] = price;
        emit PriceSet(asset, price);
    }

    function getAssetPrice(address asset) external view returns (uint256) {
        return prices[asset];
    }
}
