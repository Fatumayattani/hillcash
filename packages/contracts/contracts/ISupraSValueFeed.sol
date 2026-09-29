// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Supra push oracle interface: https://docs.supra.com/oracles/data-feeds/push-oracle
interface ISupraSValueFeed {
    struct PriceFeed {
        uint256 round;
        uint256 decimals;
        uint256 time;
        uint256 price;
    }

    function getSvalue(uint256 pairIndex) external view returns (PriceFeed memory);
}
