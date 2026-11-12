// The one door to near-api-js for the guest modules. In node it is the package itself; the build bundles
// this file to dist/guest/near.js, because a browser cannot resolve the bare `near-api-js` specifier that
// guest/key.js would otherwise import. key.js loads it lazily, so a visitor who never presses Try free
// never downloads it.
export { KeyPair, KeyPairSigner, Account, JsonRpcProvider, actions } from 'near-api-js';
