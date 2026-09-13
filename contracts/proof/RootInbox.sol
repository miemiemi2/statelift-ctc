// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {StrictRLP} from "./StrictRLP.sol";
interface IAttestcoinBlockProver {
    struct Sibling {
        bytes32 hash;
        bool isLeft;
    }
    struct MerkleProof {
        bytes32 root;
        Sibling[] siblings;
    }
    struct ContinuityProof {
        bytes32 lowerEndpointDigest;
        bytes32[] roots;
    }
    function verify(
        uint64 chainKey,
        uint64 height,
        bytes calldata txBytes,
        MerkleProof calldata merkle,
        ContinuityProof calldata continuity
    ) external view returns (bool);
}
/// Roots enter only through verified HeaderAnchor receipts. No administrator root setter.
contract RootInbox {
    struct Log {
        address emitter;
        bytes32[] topics;
        bytes data;
    }
    struct Header {
        uint64 height;
        uint64 timestamp;
        bytes32 parentHash;
        bytes32 stateRoot;
        bytes32 transactionsRoot;
        bytes32 receiptsRoot;
    }
    IAttestcoinBlockProver public immutable prover;
    uint64 public immutable chainKey;
    uint256 public immutable sourceChainId;
    address public immutable anchor;
    bytes32 public immutable sourceDomain;
    mapping(bytes32 => Header) private roots;
    mapping(uint64 => bytes32) public canonicalHash;
    bytes32 public constant ANCHOR_EVENT =
        keccak256("HeaderAnchored(uint256,uint256,bytes32)");
    error InvalidProof();
    error InvalidAnchor();
    error InvalidHeader();
    error Conflict();
    event HeaderAccepted(
        bytes32 indexed sourceDomain,
        uint64 indexed height,
        bytes32 indexed blockHash,
        bytes32 stateRoot,
        bytes32 transactionsRoot,
        bytes32 receiptsRoot,
        uint64 timestamp
    );
    constructor(
        address nativeProver,
        uint64 sourceChainKey,
        uint256 ethereumChainId,
        address headerAnchor
    ) {
        if (
            nativeProver == address(0) ||
            headerAnchor == address(0) ||
            ethereumChainId == 0
        ) revert InvalidAnchor();
        prover = IAttestcoinBlockProver(nativeProver);
        chainKey = sourceChainKey;
        sourceChainId = ethereumChainId;
        anchor = headerAnchor;
        sourceDomain = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                nativeProver,
                sourceChainKey,
                ethereumChainId,
                headerAnchor
            )
        );
    }
    function accept(
        uint64 anchorHeight,
        bytes calldata txBytes,
        IAttestcoinBlockProver.MerkleProof calldata merkle,
        IAttestcoinBlockProver.ContinuityProof calldata continuity,
        bytes calldata fullHeader
    ) external returns (bytes32 hash) {
        if (!prover.verify(chainKey, anchorHeight, txBytes, merkle, continuity))
            revert InvalidProof();
        (uint8 kind, bytes[] memory chunks) = abi.decode(
            txBytes,
            (uint8, bytes[])
        );
        if (kind > 4 || chunks.length != (kind <= 2 ? 3 : 4))
            revert InvalidAnchor();
        (uint8 status, , Log[] memory logs, ) = abi.decode(
            chunks[chunks.length - 1],
            (uint8, uint64, Log[], bytes)
        );
        if (status != 1 || logs.length > 1024) revert InvalidAnchor();
        hash = keccak256(fullHeader);
        Header memory h = parseHeader(fullHeader);
        if (h.height >= anchorHeight || anchorHeight - h.height > 256)
            revert InvalidAnchor();
        uint256 matches;
        for (uint256 i; i < logs.length; ++i) {
            Log memory l = logs[i];
            if (
                l.emitter == anchor &&
                l.topics.length == 3 &&
                l.topics[0] == ANCHOR_EVENT &&
                uint256(l.topics[1]) == sourceChainId &&
                uint256(l.topics[2]) == h.height &&
                l.data.length == 32 &&
                abi.decode(l.data, (bytes32)) == hash
            ) ++matches;
        }
        if (matches != 1) revert InvalidAnchor();
        store(hash, h);
    }
    function acceptParent(
        bytes32 acceptedChild,
        bytes calldata parentRlp
    ) external returns (bytes32 parentHash) {
        Header memory child = roots[acceptedChild];
        if (
            acceptedChild == bytes32(0) ||
            canonicalHash[child.height] != acceptedChild
        ) revert InvalidHeader();
        parentHash = keccak256(parentRlp);
        if (parentHash != child.parentHash) revert InvalidHeader();
        Header memory p = parseHeader(parentRlp);
        if (
            uint256(p.height) + 1 != child.height ||
            p.timestamp >= child.timestamp
        ) revert InvalidHeader();
        store(parentHash, p);
    }
    function getHeader(bytes32 hash) external view returns (Header memory h) {
        h = roots[hash];
        if (hash == bytes32(0) || canonicalHash[h.height] != hash)
            revert InvalidHeader();
    }
    function store(bytes32 hash, Header memory h) private {
        bytes32 old = canonicalHash[h.height];
        if (old != bytes32(0) && old != hash) revert Conflict();
        roots[hash] = h;
        canonicalHash[h.height] = hash;
        emit HeaderAccepted(
            sourceDomain,
            h.height,
            hash,
            h.stateRoot,
            h.transactionsRoot,
            h.receiptsRoot,
            h.timestamp
        );
    }
    function parseHeader(
        bytes memory data
    ) public pure returns (Header memory h) {
        if (data.length > 4096) revert InvalidHeader();
        StrictRLP.Item[] memory f = StrictRLP.children(data, 21);
        if (
            f.length != 15 &&
            f.length != 16 &&
            f.length != 17 &&
            f.length != 20 &&
            f.length != 21
        ) revert InvalidHeader();
        h.parentHash = StrictRLP.hash32(data, f[0]);
        h.stateRoot = StrictRLP.hash32(data, f[3]);
        h.transactionsRoot = StrictRLP.hash32(data, f[4]);
        h.receiptsRoot = StrictRLP.hash32(data, f[5]);
        uint256 height = StrictRLP.scalar(data, f[8]);
        uint256 timestamp = StrictRLP.scalar(data, f[11]);
        if (height > type(uint64).max || timestamp > type(uint64).max)
            revert InvalidHeader();
        h.height = uint64(height);
        h.timestamp = uint64(timestamp);
    }
}
