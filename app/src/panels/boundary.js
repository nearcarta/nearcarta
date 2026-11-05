// One friendly line when a room throws. The raw engine text stays out of the page.

import { roomError } from '../room-error.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function boundaryHtml(err) {
  return `<p data-testid="room-boundary" role="alert">${esc(roomError(err))}</p>`;
}

export function installBoundary(root) {
  const show = (err) => {
    const host = root && root.isConnected ? root : document.body;
    let box = host.querySelector('[data-testid=room-boundary]');
    if (!box) {
      box = document.createElement('p');
      box.dataset.testid = 'room-boundary';
      box.setAttribute('role', 'alert');
      host.prepend(box);
    }
    box.textContent = roomError(err);
  };
  window.addEventListener('error', (e) => { show(e.error || e.message); });
  window.addEventListener('unhandledrejection', (e) => { show(e.reason); });
  return show;
}
