// QR for a pay link. Vendored MIT generator (Kazuhiko Arase). No network, no image host.
import qrcode from './qrcode-generator.js';

export function qrSvg(text, { cell = 4, margin = 2 } = {}) {
  const qr = qrcode(0, 'M');
  qr.addData(String(text || ''));
  qr.make();
  return qr.createSvgTag({ cellSize: cell, margin, scalable: false, alt: 'Pay link QR code' });
}
