import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installTollDock, armTollDock } from '../../../app/src/panels/toll-dock.js';

const read = (p) => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');

function fakeDoc(value) {
  const listeners = [];
  const input = { value, closest: (s) => (s === '#t-agent' ? input : null) };
  const log = { textContent: '', hidden: true };
  return {
    input, log, listeners,
    addEventListener: (type, fn) => listeners.push({ type, fn }),
    getElementById: (id) => (id === 't-agent' ? input : id === 't-agent-log' ? log : null),
  };
}

test('the dock capture listener marks the event, so the shell handler does not send it twice', async () => {
  const doc = fakeDoc('show policy');
  const seen = [];
  armTollDock(async (text) => { seen.push(text); return { ok: true, hint: 'Policy on toll.' }; });
  installTollDock(doc);
  const e = { type: 'keydown', key: 'Enter', target: doc.input, preventDefault() {} };
  for (const l of doc.listeners.filter(x => x.type === 'keydown')) l.fn(e);
  assert.equal(e.__nearcartaDockSent, true);
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(seen, ['show policy']);
  assert.equal(doc.log.textContent, 'Policy on toll.');
});

test('every shell send skips an event the dock already sent', () => {
  const shell = read('app/design/D8_shops/js/shopui.js');
  for (const d of ['Toll', 'Ferry', 'Hall', 'Guard']) {
    assert.match(shell, new RegExp(`if \\(e\\?\\.__nearcartaDockSent\\) return undefined; return dispatch${d}Dock\\(document\\)`));
    assert.match(read(`app/src/panels/${d.toLowerCase()}-dock.js`), /e\.__nearcartaDockSent = true;/);
  }
});
