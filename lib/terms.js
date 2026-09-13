import { AbiCoder, id, keccak256, concat } from "ethers";
const coder = AbiCoder.defaultAbiCoder();
export const GOAL_TUPLE =
  "tuple(bytes32 sourceDomain,bytes32 manifestId,address token,address recipient,uint256 usdcAmount,uint256 principalCap,uint256 serviceCap,uint32 maxAttempts,bool automaticRetry)";
export const QUOTE_TUPLE =
  "tuple(bytes32 goalId,uint32 attemptNumber,address solver,address authorizer,uint64 validAfter,uint64 validBefore,uint64 acceptBefore,uint256 principal,uint256 serviceCap,uint256 proofReward,uint256 bond,uint256 nonfulfillmentPenalty,uint256 solverNonce)";
export const QUOTE_TYPEHASH = id(
  "Quote(bytes32 goalContextHash,bytes32 goalId,uint32 attemptNumber,address solver,address authorizer,uint64 validAfter,uint64 validBefore,uint64 acceptBefore,uint256 principal,uint256 serviceCap,uint256 proofReward,uint256 bond,uint256 nonfulfillmentPenalty,uint256 solverNonce)",
);
export const NONCE_DOMAIN = id("StateLift.sourceNonce.v1");
export function goalContextHash({ targetChainId, hub, goalId, owner, goal }) {
  return keccak256(
    coder.encode(
      ["uint256", "address", "bytes32", "address", GOAL_TUPLE],
      [targetChainId, hub, goalId, owner, goal],
    ),
  );
}
export function quoteTermsHash(contextHash, quote) {
  return keccak256(
    coder.encode(
      ["bytes32", "bytes32", QUOTE_TUPLE],
      [QUOTE_TYPEHASH, contextHash, quote],
    ),
  );
}
export function sourceNonce(termsHash) {
  return keccak256(
    coder.encode(["bytes32", "bytes32"], [NONCE_DOMAIN, termsHash]),
  );
}
export function digest(targetChainId, hub, termsHash) {
  const domain = keccak256(
    coder.encode(
      ["bytes32", "bytes32", "bytes32", "uint256", "address"],
      [
        id(
          "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
        ),
        id("StateLift"),
        id("1"),
        targetChainId,
        hub,
      ],
    ),
  );
  return keccak256(concat(["0x1901", domain, termsHash]));
}
