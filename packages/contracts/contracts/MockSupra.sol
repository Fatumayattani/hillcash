// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ISupraSValueFeed.sol";

contract MockSupra is ISupraSValueFeed {
    PriceFeed public feed;
    function set(uint256 price, uint256 decimals, uint256 time) external {
        feed = PriceFeed(feed.round + 1, decimals, time, price);
    }
    function getSvalue(uint256 pairIndex) external view returns (PriceFeed memory) {
        require(pairIndex == 432, "wrong pair");
        return feed;
    }
}
