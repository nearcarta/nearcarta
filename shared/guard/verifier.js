// Versioned guard verifier surface for Arena and Hall.
// Provider signature checks are UNVERIFIED: this module binds a typed context
// and rejects reuse. It does not implement ecrecover and it does not claim
// an on-chain TEE. https://docs.near.ai/cloud/verification

export {
  VERIFIER_INTERFACE,
  VERIFIER_VERSION,
  LIVE_ENFORCEMENT,
  HOLD_MS,
  canonicalContext,
  contextDigest,
  classifyCheck,
  bindVerdict,
  contextMatches,
  createLedger,
  nearToYocto,
} from '../../app/src/panels/guard-pay.js';
