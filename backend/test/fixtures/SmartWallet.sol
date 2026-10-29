// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
// Local integration fixture only. Deliberately small, never deployed to a public network.
contract SmartWallet {
    address public owner;
    address private immutable factory = msg.sender;
    bool public ready = true;
    constructor(address initialOwner) { owner = initialOwner; }
    function changeOwner(address next) external { require(msg.sender == owner); owner = next; }
    function setReady(bool value) external { require(msg.sender == owner || (msg.sender == factory && value)); ready = value; }
    function isValidSignature(bytes32 digest, bytes calldata signature) external view returns(bytes4) {
        if (!ready || signature.length != 65) return 0xffffffff;
        bytes32 r; bytes32 s; uint8 v;
        assembly { r := calldataload(signature.offset) s := calldataload(add(signature.offset,32)) v := byte(0,calldataload(add(signature.offset,64))) }
        return ecrecover(digest,v,r,s) == owner ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}

contract SmartWalletFactory {
    function getAddress(address owner, bytes32 salt) public view returns(address) {
        bytes32 codeHash = keccak256(abi.encodePacked(type(SmartWallet).creationCode, abi.encode(owner)));
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, codeHash)))));
    }
    function create(address owner, bytes32 salt) public returns(address predicted) {
        predicted = getAddress(owner, salt);
        if (predicted.code.length == 0) require(address(new SmartWallet{salt:salt}(owner)) == predicted);
    }
    function prepare(address wallet) external { SmartWallet(wallet).setReady(true); }
    function fail() external pure { revert("local factory failure"); }
}
