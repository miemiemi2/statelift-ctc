// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// ============================================================================
// TEST DOUBLE — NOT USDC.
//
// Minimal ERC-20 + EIP-3009 `receiveWithAuthorization` used only by the local
// source-chain fixture. It reproduces the authorization semantics StateLift
// depends on (caller must be the payee, one-shot nonce, validAfter/validBefore)
// so the GoalRouter one-shot gate can be exercised against real execution.
//
// It deliberately does NOT reproduce real USDC: no proxy/upgrade layout, no
// blacklist, no minting controls, no fee logic. Any claim about real USDC
// behaviour must be re-established against the real token.
// ============================================================================

contract MockUSDC3009 {
    string public constant name = "TEST-DOUBLE USD Coin";
    string public constant symbol = "tdUSDC";
    uint8 public constant decimals = 6;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    /// EIP-3009: true once an authorization nonce has been used or cancelled.
    mapping(address => mapping(bytes32 => bool)) public authorizationState;

    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 public constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH =
        keccak256(
            "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
        );

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);

    error BadSignature();
    error AuthorizationUsedAlready();
    error AuthorizationNotYetValid();
    error AuthorizationExpired();
    error CallerMustBePayee();
    error InsufficientBalance();

    constructor() {
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes(name)),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    /// Fixture-only faucet. Real USDC has no such function.
    function mintForTest(address to, uint256 value) external {
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _move(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(
        address from,
        address to,
        uint256 value
    ) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a < value) revert InsufficientBalance();
        if (a != type(uint256).max) allowance[from][msg.sender] = a - value;
        _move(from, to, value);
        return true;
    }

    /// EIP-3009. Only the payee may submit, which is what lets a router bind a
    /// payment to itself and prevents the same signature from paying anyone else.
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external {
        if (msg.sender != to) revert CallerMustBePayee();
        if (block.timestamp <= validAfter) revert AuthorizationNotYetValid();
        if (block.timestamp >= validBefore) revert AuthorizationExpired();
        if (authorizationState[from][nonce]) revert AuthorizationUsedAlready();

        bytes32 digest = keccak256(
            abi.encodePacked(
                hex"1901",
                DOMAIN_SEPARATOR,
                keccak256(
                    abi.encode(
                        RECEIVE_WITH_AUTHORIZATION_TYPEHASH,
                        from,
                        to,
                        value,
                        validAfter,
                        validBefore,
                        nonce
                    )
                )
            )
        );
        if (_recover(digest, signature) != from) revert BadSignature();

        authorizationState[from][nonce] = true;
        emit AuthorizationUsed(from, nonce);
        _move(from, to, value);
    }

    function _move(address from, address to, uint256 value) private {
        uint256 b = balanceOf[from];
        if (b < value) revert InsufficientBalance();
        balanceOf[from] = b - value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }

    function _recover(
        bytes32 digest,
        bytes calldata signature
    ) private pure returns (address) {
        if (signature.length != 65) revert BadSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (
            uint256(s) >
            0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0 ||
            v < 27 ||
            v > 28
        ) revert BadSignature();
        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert BadSignature();
        return signer;
    }
}
