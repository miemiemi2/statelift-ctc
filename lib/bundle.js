import fs from "node:fs";
import { recoverAddress } from "ethers";
import { termsHash as jsonDigest } from "./primitives.js";
import {
  goalContextHash,
  quoteTermsHash,
  sourceNonce,
  digest,
} from "./terms.js";
export function verifyBundle(bundle) {
  if (
    bundle.version !== 1 ||
    !["local-synthetic", "network-observation"].includes(bundle.evidenceKind) ||
    !bundle.order?.goal ||
    !bundle.quote ||
    !bundle.quoteSignature
  )
    throw Error(
      "complete public order, signed quote and evidence kind required",
    );
  if (bundle.quote.goalId.toLowerCase() !== bundle.order.goalId.toLowerCase())
    throw Error("goal mismatch");
  const contextHash = goalContextHash(bundle.order),
    termsHash = quoteTermsHash(contextHash, bundle.quote),
    nonce = sourceNonce(termsHash);
  if (
    bundle.termsHash?.toLowerCase() !== termsHash.toLowerCase() ||
    bundle.sourceNonce?.toLowerCase() !== nonce.toLowerCase()
  )
    throw Error("on-chain terms or nonce mismatch");
  const signer = recoverAddress(
    digest(bundle.order.targetChainId, bundle.order.hub, termsHash),
    bundle.quoteSignature,
  );
  if (signer.toLowerCase() !== bundle.quote.solver.toLowerCase())
    throw Error("wrong quote signer");
  const { bundleDigest, ...body } = bundle;
  if (!bundleDigest || jsonDigest(body) !== bundleDigest)
    throw Error("bundle content digest mismatch");
  return {
    contextHash,
    termsHash,
    sourceNonce: nonce,
    signer,
    evidenceKind: bundle.evidenceKind,
    scope:
      "Bundle integrity and quote authentication only; chain lock, source proof and finality must be checked separately.",
  };
}
export function writeBundle(file, input) {
  const body = { ...input };
  delete body.bundleDigest;
  const out = { ...body, bundleDigest: jsonDigest(body) };
  verifyBundle(out);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  return out;
}
export function readBundle(file) {
  const b = JSON.parse(fs.readFileSync(file, "utf8"));
  verifyBundle(b);
  return b;
}
