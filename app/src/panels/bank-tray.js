// Mist Bank city tray. One gold button per tab.
// A card file is read here. A model audit sends those lines to NEAR AI and the server does not store them.

import { installBankDock, armBankDock, bankDockLog } from './bank-dock.js';
import { parseBankAgent } from './bank-agent.js';
import { liveTee } from '../tee-view.js';
import { tokenStack, bindTokenFallbacks } from './token-badge.js';
import {
  DEFAULT_MODEL, SAMPLES, FORMAT_LINE, SAMPLE_CSV, sampleById, parseStatementCsv, auditStatement,
  statementFindings, agentReply, messageAuditReply, preferModelSentence, APPLY_NOTE, verifyBrowserSignature,
  tightenDecision, freshNonce, saltFor, commitmentText, hashText,
  proofLogEntry, plural, attestFields, attestForNonce, browserSignatureLine, checkSplitFor, CHECK_SPLIT,
} from './bank-audit.js';
import { tightenCall, anchorCall, boardRefusal } from './bank-board.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DOC = `<svg class="bank-doc" viewBox="0 0 48 48" width="48" height="48" aria-hidden="true"><rect x="10" y="6" width="22" height="30" rx="3" fill="none" stroke="#f3e6cf" stroke-width="2"/><path d="M32 12h6v24a3 3 0 0 1-3 3H16" fill="none" stroke="#e2b35b" stroke-width="2"/><path d="M16 16h12M16 22h12M16 28h8" stroke="#f3e6cf" stroke-width="2" stroke-linecap="round"/></svg>`;
const LIST = `<svg class="bank-doc" viewBox="0 0 48 48" width="48" height="48" aria-hidden="true"><rect x="10" y="8" width="28" height="32" rx="4" fill="none" stroke="#e2b35b" stroke-width="2"/><path d="M16 18h16M16 24h16M16 30h10" stroke="#f3e6cf" stroke-width="2" stroke-linecap="round"/></svg>`;

function ensureCss(doc) {
  const d = doc || globalThis.document;
  if (!d || d.getElementById('bank-css')) return;
  const link = d.createElement('link');
  link.id = 'bank-css';
  link.rel = 'stylesheet';
  link.href = '/panels/bank.css';
  d.head?.appendChild(link);
}

export function ensureBankDock(doc) {
  const d = doc || globalThis.document;
  if (!d) return null;
  let dock = d.getElementById('bank-agent-dock');
  if (dock) { dock.hidden = false; return dock; }
  dock = d.createElement('div');
  dock.id = 'bank-agent-dock';
  dock.setAttribute('data-testid', 'bank-agent-dock');
  dock.innerHTML = `<div id="bank-agent-pop" class="bank-agent-pop" data-testid="bank-agent" hidden>
      <p id="bank-agent-log" class="bank-agent-log" data-testid="bank-agent-log" hidden></p>
      <div class="bank-agent-row">
        <input id="bank-agent" data-testid="bank-agent-input" placeholder="Audit the cafe sample" autocomplete="off" aria-label="Ask the shop commands">
        <button type="button" class="bank-agent-send" id="bank-agent-go" data-testid="bank-agent-go" aria-label="Send">➤</button>
      </div>
    </div>
    <button type="button" class="bank-agent-char" data-testid="bank-agent-toggle" aria-expanded="false" aria-controls="bank-agent-pop" title="Shop commands">
      <img class="bank-agent-avatar" src="/setup/chars/robotexpressive.webp" width="72" height="72" alt="" decoding="async">
      <span class="bank-agent-name">Commands</span>
    </button>`;
  (d.getElementById('shopUI') || d.body).appendChild(dock);
  const toggle = dock.querySelector('[data-testid=bank-agent-toggle]');
  const pop = dock.querySelector('#bank-agent-pop');
  toggle?.addEventListener('click', () => {
    const willOpen = pop.hasAttribute('hidden');
    pop.toggleAttribute('hidden', !willOpen);
    toggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  });
  return dock;
}

function readSetup() {
  try { return JSON.parse(localStorage.getItem('nearcarta.setup.v1') || 'null'); } catch { return null; }
}

function shortNonce(n) {
  const s = String(n || '');
  return s.length > 14 ? `${s.slice(0, 8)}…${s.slice(-4)}` : s;
}

function nearText(n) {
  if (n == null || !Number.isFinite(Number(n))) return 'No cap yet';
  return `${Number(n)} NEAR`;
}

function apiBase() {
  return String(globalThis.NEARCARTA_API || '').replace(/\/$/, '');
}

/** An absolute URL for a link in the proof log, or '' when this page has no origin to name. */
function absUrl(path) {
  const base = apiBase() || (globalThis.location?.origin || '');
  if (!/^https?:\/\//.test(base)) return '';
  return base.replace(/\/$/, '') + path;
}

/** A mainnet tx on the explorer, for a proof-log row that names a real transaction. */
function txUrl(hash) {
  const h = String(hash || '');
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(h) ? `https://nearblocks.io/txns/${h}` : '';
}

function flow(right) {
  return `<div class="bank-flow" data-testid="bank-flow">${DOC}<span class="bank-flow-arrow" aria-hidden="true">→</span>${right}</div>`;
}

function fieldHtml(f) {
  if (f.id === 'signature') {
    const line = browserSignatureLine(f.ok, f.algo);
    return `<li data-testid="tee-field-signature">${esc(line)}${f.ok || !f.why ? '' : ` ${esc(f.why)}`}</li>`;
  }
  if (f.id === 'signer') {
    const full = String(f.value || '');
    const copy = full
      ? ` <button type="button" class="bank-copy" data-testid="tee-copy-signer" data-copy="${esc(full)}">Copy</button>`
      : '';
    return `<li data-testid="tee-field-signer"><b>${esc(f.label || 'Signing address')}</b> checked on the server, ${f.ok ? 'verified' : 'not verified'} · <span class="bank-signer" data-testid="tee-signer">${esc(full)}</span>${copy}${f.ok ? '' : ` · ${esc(f.why)}`}</li>`;
  }
  const shown = f.id === 'nonce' ? shortNonce(f.value) : f.value;
  return `<li data-testid="tee-field-${esc(f.id)}"><b>${esc(f.label)}</b> checked on the server, ${f.ok ? 'verified' : 'not verified'}${shown ? ` · ${esc(shown)}` : ''}${f.ok ? '' : ` · ${esc(f.why)}`}</li>`;
}

export function bankMarkup(state) {
  const tab = state.tab || 'audit';
  const who = state.who;
  const session = who?.account
    ? (who.name && who.name !== who.account ? `Signed in as ${esc(who.name)} · ${esc(who.account)}` : `Signed in as ${esc(who.account)}`)
    // This line is the first thing in the tray. It used to read "Finish setup to read your cap",
    // which opens with an instruction and a term ("cap") a first-time visitor has no reason to
    // know. The audit works with no wallet at all, so say that first.
    : 'No sign-in needed: press Audit privately and this browser reads the sample statement.';
  const tabBtn = (id, label) => `<button type="button" role="tab" class="bank-tab${tab === id ? ' on' : ''}" data-tab="${id}" aria-selected="${tab === id ? 'true' : 'false'}" data-testid="bank-tab-${id}">${label}</button>`;
  const review = state.review;
  const cta = review ? 'Apply tighter limits' : 'Audit privately';
  const pairs = (review?.findings || []).filter(f => f.kind !== 'subscription');
  const extras = (review?.anomalies || []).filter(a => !['same-day', 'month', 'repeat', 'duplicate'].includes(a.kind));
  const anomalyLines = [...pairs.map(f => f.text), ...extras.map(a => a.text)];
  const anomalies = anomalyLines.length ? anomalyLines.map(t => esc(t)).join(' ') : (review ? 'No anomalies.' : '');
  const capNote = !review ? '' : (review.before == null || !Number.isFinite(Number(review.before))
    ? `<p class="bank-format" data-testid="bank-cap-note">No per-payment cap is saved on your board row, so there is no limit to show.</p>
      <p class="bank-format" data-testid="bank-apply-note">${esc(APPLY_NOTE)}</p>`
    : review.tighten
      ? `<label class="choice-label">Current cap</label><p class="bank-field" data-testid="bank-before">${esc(nearText(review.before))}</p>
      <label class="choice-label">Proposed cap</label><p class="bank-field" data-testid="bank-after">${esc(nearText(review.after))}</p>
      <p class="bank-format" data-testid="bank-rate">${esc(review.rateSource || '')}</p>
      <p class="bank-format" data-testid="bank-apply-note">${esc(APPLY_NOTE)} This statement would move it from ${esc(nearText(review.before))} to ${esc(nearText(review.after))}.</p>`
      : `<label class="choice-label">Current cap</label><p class="bank-field" data-testid="bank-before">${esc(nearText(review.before))}</p>
      <p class="bank-format" data-testid="bank-cap-note">${esc(review.rateSource || 'No lower cap comes from this statement.')}</p>
      <p class="bank-format" data-testid="bank-apply-note">${esc(APPLY_NOTE)}</p>`);
  const sigLine = state.browserSig
    ? browserSignatureLine(state.browserSig.ok, state.browserSig.algo || undefined, { checked: state.browserSig.checked !== false })
    : '';
  const audit = `<section class="bank-pane" data-pane="audit" data-testid="bank-pane-audit" ${tab === 'audit' ? '' : 'hidden'}>
      <div class="bank-scroll" data-testid="bank-scroll">
      ${review ? `<button type="button" class="bank-again" data-testid="bank-again">Audit another statement</button>` : `<p class="bank-format" data-testid="bank-format">Accepted format: ${esc(FORMAT_LINE)}.</p>
      <div class="bank-row field">
        <label class="choice-label" for="bank-sample" data-testid="bank-sample-label">Sample</label>
        <select id="bank-sample" data-testid="bank-sample">${SAMPLES.map(s => `<option value="${s.id}"${state.sample === s.id ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
        <button type="button" class="bank-sample-link" data-testid="bank-sample-file">Download</button>
      </div>
      <div class="bank-split">
        <div class="field">
          <label class="choice-label" for="bank-file">Statement file</label>
          <div class="bank-file-row">
            <input id="bank-file" data-testid="bank-file" type="file" accept=".csv,text/csv,text/plain">
            <label class="bank-file-btn" for="bank-file">Choose file</label>
            <span class="bank-file-name" data-testid="bank-file-name">No file chosen</span>
          </div>
        </div>
        <div class="field">
          <label class="choice-label" for="bank-paste">Or paste</label>
          <textarea id="bank-paste" data-testid="bank-paste" rows="2" placeholder="merchant, amount">${esc(state.paste || '')}</textarea>
        </div>
      </div>
      ${state.detected ? `<p class="bank-format" data-testid="bank-detected">${esc(state.detected)}</p>` : ''}`}
      ${review ? `<p class="bank-format" data-testid="bank-detected">${esc(state.detected || '')}</p>
      <label class="choice-label">Summary</label><p class="bank-field" data-testid="bank-summary">${esc(plural(review.lines, 'line', 'lines'))} · ${esc(plural(review.counted, 'counted', 'counted'))}${review.currency ? ` · ${esc(review.currency)}` : ''}</p>
      <label class="choice-label">Findings</label><p class="bank-field" data-testid="bank-waste">${esc(review.wasteText || '')}</p>
      <label class="choice-label">Anomalies</label><p class="bank-field" data-testid="bank-anomalies">${anomalies}</p>
      ${capNote}
      <label class="bank-consent"><input type="checkbox" data-testid="bank-consent"${state.consent ? ' checked' : ''}> Publish a salted commitment, not the statement</label>
      ${state.modelAnswer ? `<p class="bank-note" data-testid="bank-model-answer">${esc(state.modelAnswer)}</p>` : ''}
      ${sigLine ? `<p class="bank-note" data-testid="bank-browser-sig">${esc(sigLine)}</p>` : ''}` : ''}
      </div>
      <div class="bank-foot" data-testid="bank-foot-audit">
      <div class="bank-foot-rows" data-testid="bank-foot-rows">
        <p class="bank-status" data-testid="bank-status" title="${esc(state.status || '')}">${esc(state.status || '')}</p>
        <p class="bank-status" data-testid="bank-status-2" title="${esc(state.status2 || '')}">${esc(state.status2 || '')}</p>
      </div>
      <button type="button" class="primary bank-cta" data-testid="bank-audit" id="bank-audit">${esc(cta)}</button>
      </div>
    </section>`;
  const attestView = attestForNonce({
    nonce: state.attestNonce,
    checkedNonce: state.checkedNonce,
    label: state.teeLabel,
    live: state.teeLive,
    fields: state.fields,
    pending: state.attestPending,
  });
  const fieldOrder = ['model', 'tdx', 'gpu', 'nonce'];
  const listed = (attestView.fields || []).filter(f => f.id !== 'signature' && f.id !== 'signer');
  const fields = [...listed]
    .sort((a, b) => fieldOrder.indexOf(a.id) - fieldOrder.indexOf(b.id))
    .map(fieldHtml)
    .join('');
  const sigField = (attestView.fields || []).find(f => f.id === 'signature');
  const signerField = (attestView.fields || []).find(f => f.id === 'signer');
  const signerHex = String(signerField?.value || '');
  const signerLabel = signerField?.label || 'Signing address';
  const algos = String(sigField?.algo || '').toLowerCase();
  const sigChecked = (sigField?.checked ?? true) && !!sigField;
  const sigFootLine = esc(sigField
    ? browserSignatureLine(sigField.ok, sigField.algo || undefined, { checked: sigChecked })
    : 'No response signature was checked.');
  const whereLine = esc(sigField ? checkSplitFor(sigField.algo) : checkSplitFor(''));
  const signerFoot = attestView.checked ? `<div class="bank-signer-line" data-testid="bank-signer-line">
        <span class="bank-kicker">${esc(signerLabel)}</span>
        ${signerHex ? `<button type="button" class="bank-copy" data-testid="tee-copy-signer" data-copy="${esc(signerHex)}">Copy</button>` : ''}
        <span class="bank-signer" data-testid="tee-signer">${esc(signerHex || 'No signing address was in the report.')}</span>
      </div>` : '';
  const sigFootBlock = attestView.checked ? `<p class="bank-status" data-testid="tee-field-signature">${sigFootLine}</p>` : '';
  const attest = `<section class="bank-pane" data-pane="attest" data-testid="bank-pane-attest" ${tab === 'attest' ? '' : 'hidden'}>
      <div class="bank-scroll" data-testid="bank-scroll-attest">
      <div class="bank-meta">
        <label class="choice-label" for="bank-model">TEE model</label>
        <input id="bank-model" data-testid="bank-model" value="${esc(state.model || DEFAULT_MODEL)}" readonly>
        <label class="choice-label" for="bank-nonce">Fresh nonce</label>
        <input id="bank-nonce" data-testid="bank-nonce" value="${esc(shortNonce(state.attestNonce))}" title="${esc(state.attestNonce || '')}" readonly>
      </div>
      ${attestView.checked
        ? `<p class="bank-field" data-testid="bank-eligibility">${esc(state.eligibility || 'Every listed field was verified.')}</p>`
        : ''}
      ${fields ? `<ul class="bank-steps" data-testid="tee-fields">${fields}</ul>` : ''}
      ${attestView.checked ? `<p class="bank-status" data-testid="tee-field-signature">${sigFootLine}</p>` : ''}
      ${signerFoot}
      ${attestView.checked ? `<p class="bank-where" data-testid="tee-where">${whereLine}</p>` : ''}
      ${attestView.checked && state.teeFail ? `<p class="bank-note" data-testid="tee-fail">${esc(state.teeFail)}</p>` : ''}
      </div>
      <div class="bank-foot" data-testid="bank-foot-attest">
      <div class="bank-foot-rows" data-testid="bank-foot-rows">
        <p class="bank-status" title="${esc(`${attestView.label || ''} ${attestView.live || ''}`.trim())}"><span data-testid="tee-result">${esc(attestView.label || '')}</span>${attestView.label && attestView.live ? ' · ' : ''}<span data-testid="tee-live">${esc(attestView.live || '')}</span></p>
      </div>
      <button type="button" class="primary bank-cta" data-testid="tee-verify" id="tee-verify">Verify the TEE now</button>
      </div>
    </section>`;
  const rows = (state.log || []).slice(-6).map(e => {
    const n = e.anomalyCount;
    const anom = n == null ? '' : `${plural(n, 'anomaly', 'anomalies')} · `;
    const art = (e.evidence || []).map(v => ` <a class="bank-art" href="${esc(v.url)}" target="_blank" rel="noopener" data-testid="bank-log-link">${esc(v.label)} ↗</a>`).join('');
    const plain = art ? '' : ' <span class="bank-plain">no public artifact</span>';
    return `<li data-testid="bank-log-row">${esc(e.kind)} · ${e.lines == null ? 'no lines' : plural(e.lines, 'line', 'lines')} · ${anom}${esc(e.nonce)}${art}${plain}</li>`;
  }).join('');
  const log = `<section class="bank-pane" data-pane="log" data-testid="bank-pane-log" ${tab === 'log' ? '' : 'hidden'}>
      <div class="bank-scroll" data-testid="bank-scroll-log">
      ${flow(LIST)}
      <ul class="bank-log" data-testid="bank-log">${rows || '<li data-testid="bank-log-empty">No audit yet.</li>'}</ul>
      <p class="bank-format" data-testid="bank-held">${esc(state.held || 'Confidential pay stays off. Nothing was spent.')}</p>
      </div>
      <div class="bank-foot" data-testid="bank-foot-log">
      <div class="bank-foot-rows" data-testid="bank-foot-rows">
        <p class="bank-status" data-testid="bank-file-note" title="${esc(state.fileNote || 'Request and response bytes are not stored.')}">${esc(state.fileNote || 'Request and response bytes are not stored.')}</p>
      </div>
      <button type="button" class="primary bank-cta" data-testid="bank-file-btn" id="bank-file-btn">Show the attestation file</button>
      </div>
    </section>`;
  return `<div class="bank-card">
    <p class="bank-session" data-testid="bank-session" title="${esc(who?.account || '')}">${session}</p>
    <div class="bank-tabs" role="tablist">${tabBtn('audit', 'Audit')}${tabBtn('attest', 'Attestation')}${tabBtn('log', 'Proof log')}</div>
    <div class="card shop-card shop-stack">
      ${audit}${attest}${log}
    </div>
  </div>`;
}

async function readRate(currency) {
  if (!currency || currency === 'NEAR') return null;
  try {
    const res = await fetch(`${apiBase()}/api/bank/rate?currency=${encodeURIComponent(currency)}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, source: body.source || body.error || `The cap was not converted. Price desk HTTP ${res.status}.` };
    return body;
  } catch {
    return { ok: false, source: 'The cap was not converted. The price desk did not answer.' };
  }
}

async function postAudit(rows, model) {
  const payload = {
    model,
    rows: rows.map(r => ({
      date: r.date || '',
      payee: r.payee,
      amount: r.amount ?? r.near,
      currency: r.currency || (r.near != null ? 'NEAR' : ''),
    })),
  };
  try {
    const res = await fetch(`${apiBase()}/api/bank/audit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(25000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const why = body.error || body.step || `audit route HTTP ${res.status}`;
      // A route that never answered is a provider outage, not a failed signature. Say which.
      const outage = res.status >= 500 || res.status === 429 || /attestation|unavailable|busy|timeout|rpc/i.test(String(why));
      return outage
        ? { verified: false, outage: true, step: `NEAR AI did not answer (${why}). The parser named your rows, and nothing here is attested.`, fields: null }
        : { verified: false, step: `Response signature: ${why}`, fields: null };
    }
    return body;
  } catch (e) {
    const why = e?.message || 'the audit route did not answer';
    return { verified: false, outage: true, step: `NEAR AI did not answer (${why}). The parser named your rows, and nothing here is attested.`, fields: null };
  }
}

export function mountBankRoom(root, hooks = {}) {
  if (!root) return;
  const doc0 = root.ownerDocument || document;
  ensureCss(doc0);
  ensureBankDock(doc0);
  const state = hooks.state || {};
  if (!state.nonce) state.nonce = freshNonce();
  if (!state.attestNonce) state.attestNonce = freshNonce(32);
  if (!state.sample) state.sample = 'cafe';
  if (!state.model) state.model = DEFAULT_MODEL;
  if (!state.log) state.log = [];
  if (!state.tab) state.tab = 'audit';
  if (!state.status) {
    state.status = 'Paste a statement or choose a file.';
    state.status2 = 'A sample is used only when you name it. Nothing was signed.';
  }
  const capNear = () => {
    try { return hooks.capNear ? hooks.capNear() : null; } catch { return null; }
  };
  const who = () => {
    try {
      const fromHook = hooks.who?.();
      if (fromHook?.account) return fromHook;
    } catch { /* fall through */ }
    const saved = readSetup();
    if (saved?.accountId) return { name: saved.displayName || 'visitor', account: saved.accountId };
    return null;
  };
  const paint = () => {
    state.who = who();
    root.innerHTML = bankMarkup(state);
    bindTokenFallbacks(root);
    bind();
    armBankDock(runAgent);
  };
  const pushLog = entry => {
    state.log = [...(state.log || []), entry].slice(-6);
  };
  const fail = (hint) => {
    state.status = hint;
    state.status2 = 'No wallet opened.';
    paint();
    return { ok: false, hint, say: hint, keep: true, kind: 'no' };
  };

  function remember(rows, detected) {
    state.statement = rows.map(r => ({ ...r }));
    state.pendingRows = state.statement;
    state.detected = detected || state.detected;
  }

  async function takeModel(model) {
    state.signingAddress = model?.signing_address || '';
    state.signingAlgo = String(model?.signing_algo || '').toLowerCase();
    // NEAR AI's own verify page for this receipt. Only a signed receipt gets one.
    const proofUrl = /^https:\/\//.test(String(model?.verify_url || '')) ? String(model.verify_url) : '';
    if (proofUrl && Array.isArray(state.log) && state.log.length) {
      state.log = state.log.map((e, i) => (i === state.log.length - 1 ? { ...e, evidence: [{ label: 'NEAR AI receipt', url: proofUrl }] } : e));
    }
    if (model?.outage) {
      // The provider did not answer. The rows were audited in this browser by the parser;
      // no model sentence and no signature exists, so nothing may claim one.
      state.browserSig = null;
      state.signingAddress = '';
      state.modelAnswer = '';
      state.status2 = model.step || 'NEAR AI did not answer. The parser named your rows, and nothing here is attested.';
      return;
    }
    if (model?.signed_text && model?.signature && model?.signing_address) {
      state.browserSig = await verifyBrowserSignature({
        text: model.signed_text,
        signature: model.signature,
        signingAddress: model.signing_address,
        algo: model.signing_algo,
      });
    } else if (model) {
      state.browserSig = { ok: false, checked: false, why: 'The signature bytes were not in the response, so this browser did not check them.' };
    }
    if (model?.answer) state.modelAnswer = model.answer;
    else state.modelAnswer = '';
    if (state.browserSig?.ok) state.status2 = browserSignatureLine(true, state.browserSig.algo);
    else if (model?.step) state.status2 = String(model.step).slice(0, 180);
  }

  async function runAudit(sampleId, opts = {}) {
    hooks.hideRefuse?.();
    state.tab = 'audit';
    let rows = null;
    let sampleName = '';
    let uploaded = false;
    if (opts.loaded) {
      rows = (state.statement || []).map(r => ({ ...r }));
      if (!rows.length) return fail('Paste a statement or choose a file. I will not use a sample unless you name one.');
      uploaded = true;
    } else if (opts.sample || sampleId) {
      const id = sampleId || state.sample;
      const sample = sampleById(id);
      state.sample = sample.id;
      rows = sample.rows.map(r => ({ ...r }));
      sampleName = sample.name;
      state.detected = `This is the ${sample.name} sample, not your statement.`;
    } else if (state.statement?.length) {
      rows = state.statement.map(r => ({ ...r }));
      uploaded = true;
    } else {
      const sample = sampleById(state.sample);
      rows = sample.rows.map(r => ({ ...r }));
      sampleName = sample.name;
      state.detected = `This is the ${sample.name} sample, not your statement.`;
    }
    const currency = rows.map(r => r.currency).find(Boolean) || '';
    const rate = currency && currency !== 'NEAR' ? await readRate(currency) : null;
    const liveCap = capNear();
    const report = auditStatement(rows, {
      capNear: liveCap,
      nearPerUnit: rate?.ok ? rate.nearPerUnit : null,
      rateSource: rate?.source || '',
    });
    const findings = statementFindings(rows);
    const wasteText = agentReply(rows, 'waste', { sampleName });
    const reply = opts.question && opts.question !== 'waste'
      ? agentReply(rows, opts.question, { capNear: liveCap, sampleName })
      : wasteText;
    state.statement = rows.map(r => ({ ...r }));
    state.review = { ...report, wasteText, findings };
    state.nonce = freshNonce();
    pushLog(proofLogEntry({
      kind: uploaded ? 'upload' : (sampleName ? state.sample : 'audit'),
      lines: report.lines,
      anomalyCount: report.anomalies.length,
      nonce: state.nonce,
      eligible: false,
    }));
    state.status = 'Nothing was signed.';
    state.status2 = `${plural(report.lines, 'line', 'lines')}. ${plural(report.anomalies.length, 'anomaly', 'anomalies')}.`;
    const ticket = {};
    state.auditTicket = ticket;
    const asked = rows.map(r => ({ ...r }));
    paint();
    postAudit(asked, state.model).then(async model => {
      if (state.auditTicket !== ticket) return;
      await takeModel(model);
      // An unanswered provider is named here, on the same line as the audit counts, so the
      // page never shows an audit beside a claim that the model verified it.
      if (model?.outage) state.status2 = String(model.step || 'NEAR AI did not answer. Nothing here is attested.').slice(0, 180);
      paint();
    }).catch(() => {});
    return { ok: true, hint: reply, say: reply, keep: true, kind: 'ok' };
  }

  async function runApply() {
    hooks.hideRefuse?.();
    const review = state.review;
    if (!review) return fail('Audit a statement first. Nothing was signed.');
    const decision = tightenDecision({ beforeCap: review.before, afterCap: review.after });
    const key = `${state.nonce}|${review.after}|${state.consent ? '1' : '0'}`;
    if (!decision.ok) return fail(decision.reason);
    if (state.appliedKey === key) return fail('Already reviewed. Nothing was signed again.');
    if (!hooks.boardRow || !hooks.boardWrite) return fail('This page cannot reach the board, so nothing was signed.');

    // Read the row the chain has right now: tighten_rules compares every field against it,
    // and a cached row would be a stale nonce and a stale cap.
    const before = await hooks.boardRow().catch(() => null);
    if (!before) return fail('The board did not return your row. Nothing was signed.');
    const call = tightenCall({ row: before, afterNear: review.after });
    if (!call.ok) return fail(call.why);
    state.appliedKey = key;
    // Two short lines: what is being sent, then the result. The tx links live in the proof log.
    state.status = `Tightening your cap: ${call.before} → ${call.after} NEAR.`;
    state.status2 = 'Signed here. No wallet opens.';
    paint();

    let sent;
    try {
      sent = await hooks.boardWrite({ method: call.method, args: call.args, gasTgas: 30 });
    } catch (e) {
      const why = boardRefusal(e);
      state.status = `Tighten not sent: ${why}`;
      state.status2 = 'Nothing was signed.';
      pushLog(proofLogEntry({ kind: 'tighten-failed', lines: review.lines, anomalyCount: review.anomalies.length, nonce: state.nonce, eligible: false }));
      paint();
      return { ok: false, hint: state.status, say: `${state.status} ${state.status2}`, keep: true, kind: 'no', live: 'blocked' };
    }
    const okChain = sent.decision === 'allowed';
    state.status = okChain
      ? `Cap on your row is now ${call.after} NEAR (was ${call.before}).`
      : `Board refused the tighten: ${boardRefusal(sent.reason)}.`;
    state.status2 = okChain ? 'The board wrote it. No wallet opened.' : 'Nothing changed.';
    pushLog(proofLogEntry({
      kind: okChain ? 'tighten' : 'tighten-refused',
      lines: review.lines,
      anomalyCount: review.anomalies.length,
      nonce: state.nonce,
      eligible: okChain,
      evidence: sent.tx ? [{ label: 'tighten_rules', url: txUrl(sent.tx) }] : [],
    }));

    // The opt-in salted commitment is anchored only after the cap it commits to is on chain.
    // The board hashes salt || digest itself and stores neither, so only the commitment goes out.
    if (okChain && state.consent) {
      const salt = saltFor();
      const text = commitmentText({ nonce: state.nonce, afterNear: call.after, salt });
      const digest = await hashText(text);
      state.commitment = digest;
      const anchor = anchorCall({ kind: 'bank_cap', digest, salt });
      if (!anchor.ok) state.status2 = `Commitment not anchored: ${anchor.why}`;
      else {
        try {
          const a = await hooks.boardWrite({ method: anchor.method, args: anchor.args, gasTgas: 20 });
          const anchored = a.decision === 'allowed';
          state.status2 = anchored
            ? `Commitment ${digest.slice(0, 10)}… anchored. The statement is not in it.`
            : `Commitment refused: ${boardRefusal(a.reason)}.`;
          pushLog(proofLogEntry({
            kind: anchored ? 'anchor' : 'anchor-refused',
            lines: review.lines,
            anomalyCount: review.anomalies.length,
            nonce: state.nonce,
            eligible: anchored,
            evidence: a.tx ? [{ label: 'anchor', url: txUrl(a.tx) }] : [],
          }));
        } catch (e) {
          state.status2 = `Commitment not anchored: ${boardRefusal(e)}.`;
        }
      }
    }
    paint();
    return {
      ok: okChain,
      hint: state.status,
      say: [state.status, state.status2].filter(Boolean).join(' '),
      keep: true,
      kind: okChain ? 'ok' : 'no',
      live: okChain ? 'signed' : 'blocked',
    };
  }

  async function runTee() {
    hooks.hideRefuse?.();
    state.tab = 'attest';
    if (!state.attestNonce || state.checkedNonce === state.attestNonce) state.attestNonce = freshNonce(32);
    const nonce = state.attestNonce;
    state.attestPending = true;
    state.teeFail = '';
    state.fields = [];
    paint();
    let body;
    try {
      body = await liveTee({ api: apiBase(), model: state.model, nonce, timeoutMs: 20000 });
    } catch (e) {
      body = { ok: false, nonce, failure: e?.message || 'The attestation request failed' };
    }
    if (state.attestNonce !== nonce) return { ok: false, hint: 'Not checked yet.', say: 'Not checked yet.', keep: true, kind: 'no' };
    // With no audit yet there is no completion to sign, so the signature step cannot be
    // checked. Saying "failed" there is wrong: nothing failed, the step had nothing to check.
    // Measured 2026-11-08: pressing Verify TEE now before any audit reported `failed` and
    // "A listed step did not verify", which reads as a broken attestation.
    let signature = {
      ok: false, checked: false, absent: !state.statement?.length,
      why: 'no completion was sent, so this step was not checked',
    };
    if (state.statement?.length) {
      const model = await postAudit(state.statement, state.model);
      if (state.attestNonce !== nonce) return { ok: false, hint: 'Not checked yet.', say: 'Not checked yet.', keep: true, kind: 'no' };
      await takeModel(model);
      signature = {
        ok: !!state.browserSig?.ok,
        checked: !!state.browserSig && state.browserSig.checked !== false,
        algo: state.browserSig?.algo || String(model?.signing_algo || '').toLowerCase(),
        why: state.browserSig?.ok ? '' : (state.browserSig?.why || String(model.step || '').replace(/^Response signature:\s*/i, '')),
      };
    }
    const echoed = body?.nonce || nonce;
    state.fields = attestFields({ ...body, nonce: echoed }, signature).map(f => (
      f.id === 'nonce' ? { ...f, ok: f.ok && echoed === nonce, value: nonce, why: echoed === nonce ? f.why : 'The quote nonce does not match the one this page sent' } : f
    ));
    const failed = state.fields.filter(f => !f.ok);
    // A step that had nothing to check is not a failure, and it should not be described as one.
    const uncheckedOnly = failed.length > 0 && failed.every(f => f.id === 'signature' && signature.absent);
    state.attestPending = false;
    state.checkedNonce = nonce;
    state.eligibility = failed.length ? failed.map(f => `${f.label}: ${f.why}`).join(' ') : 'Every listed field was verified.';
    if (uncheckedOnly && body?.ok && echoed === nonce) {
      // Everything the server can attest passed; only the browser-side signature step was
      // skipped because there was no completion. Say that, not "failed".
      state.teeLabel = 'partial';
      state.teeFail = '';
      state.teeLive = 'The hardware checks passed. Run an audit first, then verify again to check the response signature. Nothing was signed.';
      state.eligibility = state.teeLive;
    } else if (body?.ok && !failed.length && echoed === nonce) {
      state.teeLabel = 'attested';
      state.teeLive = 'Live check passed.';
      state.teeFail = '';
    } else {
      state.teeLabel = 'failed';
      const why = failed.length ? state.eligibility : (body?.failure || body?.error || 'The hardware check did not pass');
      state.teeFail = String(why).includes(':') ? String(why) : `NEAR AI attestation: ${why}`;
      state.teeLive = body?.ok
        ? 'A listed step did not verify. Nothing was signed.'
        : 'The hardware check did not pass. Nothing was signed.';
    }
    pushLog(proofLogEntry({ kind: 'tee', lines: null, anomalyCount: null, nonce, eligible: state.teeLabel === 'attested',
      evidence: body?.ok && state.teeLabel === 'attested'
        ? [{ label: 're-read this nonce', url: absUrl(`/api/ai/tee?nonce=${encodeURIComponent(nonce)}`) }]
        : [] }));
    paint();
    return { ok: state.teeLabel === 'attested', hint: state.teeLive, say: state.eligibility, keep: true, kind: state.teeLabel === 'attested' ? 'ok' : 'no' };
  }

  async function runFile() {
    hooks.hideRefuse?.();
    state.tab = 'log';
    paint();
    try {
      const r = await fetch(`${apiBase()}/api/bank/proof`, { cache: 'no-store' });
      const j = await r.json();
      const note = j.retention || j.proof?.retention || 'Request and response bytes are not stored.';
      state.fileNote = note;
      state.held = 'Confidential pay stays off. Nothing was spent.';
      paint();
      return { ok: true, hint: note, say: note, keep: true, kind: 'ok' };
    } catch {
      state.fileNote = 'The attestation file could not be read. Nothing was signed.';
      paint();
      return { ok: false, hint: state.fileNote, say: state.fileNote, keep: true, kind: 'no' };
    }
  }

  async function runExplain() {
    const review = state.review;
    if (!review) return fail('Audit a statement first. Nothing was signed.');
    const text = review.wasteText || (review.anomalies.length ? review.anomalies.map(a => a.text).join(' ') : 'No anomalies in the last audit.');
    state.status = text;
    state.status2 = 'That names the line. It is not in the proof log.';
    paint();
    return { ok: true, hint: text, say: text, keep: true, kind: 'ok' };
  }

  async function runMessageAudit(rows) {
    hooks.hideRefuse?.();
    state.tab = 'audit';
    const kept = (state.statement || []).map(r => ({ ...r }));
    const currency = rows.map(r => r.currency).find(Boolean) || '';
    const rate = currency && currency !== 'NEAR' ? await readRate(currency) : null;
    const liveCap = capNear();
    const report = auditStatement(rows, {
      capNear: liveCap,
      nearPerUnit: rate?.ok ? rate.nearPerUnit : null,
      rateSource: rate?.source || '',
    });
    const local = messageAuditReply(rows);
    state.statement = kept;
    state.detected = 'These rows are from your message, not the pasted file.';
    state.review = { ...report, wasteText: local, findings: statementFindings(rows) };
    state.status = 'Asking NEAR AI about the rows in your message.';
    state.status2 = 'Nothing was signed.';
    state.modelAnswer = '';
    state.browserSig = null;
    const ticket = {};
    state.auditTicket = ticket;
    state.nonce = freshNonce();
    pushLog(proofLogEntry({
      kind: 'message',
      lines: report.lines,
      anomalyCount: report.anomalies.length,
      nonce: state.nonce,
      eligible: false,
    }));
    paint();
    const model = await postAudit(rows, state.model);
    if (state.auditTicket !== ticket) return { ok: true, hint: local, say: local, keep: true, kind: 'ok' };
    await takeModel(model);
    const picked = preferModelSentence(model?.answer, rows, local);
    state.review = { ...state.review, wasteText: picked.text };
    state.status = model?.outage
      ? 'NEAR AI did not answer. These rows were named in this browser.'
      : picked.source === 'model'
        ? 'NEAR AI named the rows in your message.'
        : 'The parser named the rows in your message.';
    // An outage is named as one; the parser's sentence is still the answer, and it says so.
    state.status2 = model?.outage ? String(model.step || 'Nothing here is attested.').slice(0, 180) : 'Nothing was signed.';
    paint();
    return { ok: true, hint: picked.text, say: picked.text, keep: true, kind: 'ok' };
  }

  async function runAgent(text) {
    const live = root.querySelector('#bank-paste')?.value || '';
    if (live.trim()) {
      const parsedCsv = parseStatementCsv(live);
      if (parsedCsv.ok) remember(parsedCsv.rows, parsedCsv.detectedText);
    }
    const parsed = parseBankAgent(text, { review: state.review, hasStatement: !!state.statement?.length });
    if (!parsed.ok) {
      bankDockLog(root.ownerDocument || document, parsed.hint);
      return fail(parsed.hint);
    }
    if (parsed.action === 'tee') return runTee();
    if (parsed.action === 'file') return runFile();
    if (parsed.action === 'apply') return runApply();
    if (parsed.action === 'explain') return runExplain();
    if (parsed.source === 'message') return runMessageAudit(parsed.rows);
    if (parsed.source === 'loaded') return runAudit(null, { loaded: true, question: parsed.question });
    return runAudit(parsed.sample, { sample: true, question: parsed.question });
  }
  state.runAgent = runAgent;

  function bind() {
    const doc = root.ownerDocument || document;
    root.querySelectorAll('[data-copy]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const text = btn.getAttribute('data-copy') || '';
        try {
          await navigator.clipboard.writeText(text);
          btn.textContent = 'Copied';
        } catch {
          btn.textContent = 'Copy';
        }
      });
    });
    root.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-tab');
        if (id === 'attest' && state.tab !== 'attest' && state.attestNonce && state.checkedNonce === state.attestNonce) {
          state.attestNonce = freshNonce(32);
          state.attestPending = false;
        } else if (id === 'attest' && !state.attestNonce) {
          state.attestNonce = freshNonce(32);
        }
        state.tab = id;
        paint();
      });
    });
    const sample = root.querySelector('#bank-sample');
    if (sample) sample.addEventListener('change', () => { state.sample = sample.value; });
    const sampleFile = root.querySelector('[data-testid=bank-sample-file]');
    if (sampleFile) sampleFile.addEventListener('click', () => {
      const blob = new Blob([SAMPLE_CSV], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = doc.createElement('a');
      a.href = url;
      a.download = 'bank-sample.csv';
      a.click();
      URL.revokeObjectURL(url);
    });
    const note = () => root.querySelector('[data-testid=bank-detected]');
    const takeText = (text) => {
      state.paste = text;
      if (!String(text || '').trim()) {
        state.detected = 'No file yet.';
        state.pendingRows = null;
        if (note()) note().textContent = state.detected;
        return;
      }
      const parsed = parseStatementCsv(text);
      if (!parsed.ok) {
        state.pendingRows = null;
        state.statement = null;
        state.detected = parsed.error;
      } else {
        remember(parsed.rows, parsed.detectedText);
        state.review = null;
      }
      if (note()) note().textContent = state.detected;
    };
    const file = root.querySelector('#bank-file');
    if (file) file.addEventListener('change', () => {
      const picked = file.files && file.files[0];
      // The visible name, since the native control is sr-only: the file's own name, or the
      // unchanged "No file chosen" when the picker was dismissed.
      const nameEl = root.querySelector('[data-testid=bank-file-name]');
      if (nameEl) nameEl.textContent = picked ? picked.name : 'No file chosen';
      if (!picked) return;
      if (picked.size > 6000) {
        state.pendingRows = null;
        state.statement = null;
        state.detected = 'That file is over 6000 characters. Nothing was audited.';
        state.status = state.detected;
        state.status2 = 'Nothing was signed.';
        paint();
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result || '');
        state.paste = text;
        const parsed = parseStatementCsv(text);
        if (!parsed.ok) {
          state.pendingRows = null;
          state.statement = null;
          state.detected = parsed.error;
          state.status = parsed.error;
          state.status2 = 'Nothing was signed.';
        } else {
          remember(parsed.rows, parsed.detectedText);
          state.review = null;
          state.status = parsed.detectedText;
          state.status2 = 'Press Audit privately. The file stays in this browser until you ask the model.';
        }
        paint();
      };
      reader.onerror = () => {
        state.status = 'The file could not be read. Nothing was audited.';
        state.status2 = 'Nothing was signed.';
        paint();
      };
      reader.readAsText(picked);
    });
    const paste = root.querySelector('#bank-paste');
    if (paste) paste.addEventListener('input', () => takeText(paste.value));
    const consent = root.querySelector('[data-testid=bank-consent]');
    if (consent) consent.addEventListener('change', () => { state.consent = consent.checked; });
    const again = root.querySelector('[data-testid=bank-again]');
    if (again) again.addEventListener('click', () => {
      state.review = null;
      state.pendingRows = null;
      state.statement = null;
      state.paste = '';
      state.detected = '';
      state.status = 'Paste a statement or choose a file.';
      state.status2 = 'A sample is used only when you name it. Nothing was signed.';
      paint();
    });
    const audit = root.querySelector('#bank-audit');
    if (audit) audit.addEventListener('click', () => {
      // A private audit signs nothing, so no wallet, charter or key is required. It never leaves this page.
      const live = root.querySelector('#bank-paste')?.value || '';
      if (!state.review && live.trim()) {
        const parsed = parseStatementCsv(live);
        if (!parsed.ok) { fail(parsed.error); return; }
        remember(parsed.rows, parsed.detectedText);
      }
      const job = state.review ? runApply() : runAudit(null, state.statement?.length ? { loaded: true } : { sample: true });
      job.catch(() => {});
    });
    const tee = root.querySelector('#tee-verify');
    if (tee) tee.addEventListener('click', () => { runTee().catch(() => {}); });
    const proof = root.querySelector('#bank-file-btn');
    if (proof) proof.addEventListener('click', () => { runFile().catch(() => {}); });
    installBankDock(doc, () => runAgent(doc.getElementById('bank-agent')?.value || ''));
  }

  paint();
  return { paint, runAgent };
}

export function hideBankDock(doc = document) {
  const dock = doc.getElementById('bank-agent-dock');
  if (dock) dock.hidden = true;
}
