// Content Security Policy for every HTML page. Each response gets a fresh nonce: only <script> tags we serve carry it,
// and NEAR Connect passes it into its sandboxed wallet iframes (srcdoc iframes inherit this policy).
// Wallet code also talks to its own backends, so connect-src and frame-src allow https; scripts stay locked to 'self' + nonce.
export const policy = n => [
  "default-src 'self'",
  `script-src 'self' 'nonce-${n}' 'wasm-unsafe-eval'`,
  "style-src 'self' 'unsafe-inline' https:",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  "connect-src 'self' blob: data: https: wss:",
  "frame-src https:",
  "worker-src 'self' blob:",
  "media-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
export const nonce = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18))));
export const withNonce = (html, n) => html.replace(/<script\b(?![^>]*\bnonce=)/gi, `<script nonce="${n}"`);
