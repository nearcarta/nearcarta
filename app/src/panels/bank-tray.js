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
  proofLogEntry, plural, attestFields, attestForNonce, browserSignatureLine, CHECK_SPLIT,
} from './bank-audit.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DOC = `<svg class="bank-doc" viewBox="0 0 48 48" width="48" height="48" aria-hidden="true"><rect x="10" y="6" width="22" height="30" rx="3" fill="none" stroke="#f3e6cf" stroke-width="2"/><path d="M32 12h6v24a3 3 0 0 1-3 3H16" fill="none" stroke="#e2b35b" stroke-width="2"/><path d="M16 16h12M16 22h12M16 28h8" stroke="#f3e6cf" stroke-width="2" stroke-linecap="round"/></svg>`;
const SHIELD = `<svg class="bank-doc" viewBox="0 0 48 48" width="48" height="48" aria-hidden="true"><path d="M24 6l14 6v12c0 9-6 14-14 18-8-4-14-9-14-18V12z" fill="none" stroke="#e2b35b" stroke-width="2"/><path d="M16 24l5 5 11-12" fill="none" stroke="#f3e6cf" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
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
        <input id="bank-agent" data-testid="bank-agent-input" placeholder="Audit the cafe sample" autocomplete="off" aria-label="Ask the AI Agent">
        <button type="button" class="bank-agent-send" id="bank-agent-go" data-testid="bank-agent-go" aria-label="Send">➤</button>
      </div>
    </div>
    <button type="button" class="bank-agent-char" data-testid="bank-agent-toggle" aria-expanded="false" aria-controls="bank-agent-pop" title="AI Agent">
      <img class="bank-agent-avatar" src="/setup/chars/robotexpressive.webp" width="72" height="72" alt="" decoding="async">
      <span class="bank-agent-name">AI Agent</span>
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

function flow(right) {
  return `<div class="bank-flow" data-testid="bank-flow">${DOC}<span class="bank-flow-arrow" aria-hidden="true">→</span>${right}</div>`;
}

function fieldHtml(f) {
  if (f.id === 'signature') {
    const line = f.ok ? browserSignatureLine(true) : `${browserSignatureLine(false)}${f.why ? `. ${f.why}` : ''}`;
    return `<li data-testid="tee-field-signature">${esc(line)}</li>`;
  }
  if (f.id === 'signer') {
    const full = String(f.value || '');
    const copy = full
      ? ` <button type="button" class="bank-copy" data-testid="tee-copy-signer" data-copy="${esc(full)}">Copy</button>`
      : '';
    return `<li data-testid="tee-field-signer"><b>Signing address</b> checked on the server, ${f.ok ? 'verified' : 'not verified'} · <span class="bank-signer" data-testid="tee-signer">${esc(full)}</span>${copy}${f.ok ? '' : ` · ${esc(f.why)}`}</li>`;
  }
  const shown = f.id === 'nonce' ? shortNonce(f.value) : f.value;
  return `<li data-testid="tee-field-${esc(f.id)}"><b>${esc(f.label)}</b> checked on the server, ${f.ok ? 'verified' : 'not verified'}${shown ? ` · ${esc(shown)}` : ''}${f.ok ? '' : ` · ${esc(f.why)}`}</li>`;
}

export function bankMarkup(state) {
  const tab = state.tab || 'audit';
  const who = state.who;
  const session = who?.account
    ? (who.name && who.name !== who.account ? `Signed in as ${esc(who.name)} · ${esc(who.account)}` : `Signed in as ${esc(who.account)}`)
    : 'Finish setup to read your cap.';
  const tabBtn = (id, label) => `<button type="button" role="tab" class="bank-tab${tab === id ? ' on' : ''}" data-tab="${id}" aria-selected="${tab === id ? 'true' : 'false'}" data-testid="bank-tab-${id}">${label}</button>`;
  const review = state.review;
  const cta = review ? 'Apply tighter limits' : 'Audit privately';
  const pairs = (review?.findings || []).filter(f => f.kind !== 'subscription');
  const extras = (review?.anomalies || []).filter(a => !['same-day', 'month', 'repeat', 'duplicate'].includes(a.kind));
  const anomalyLines = [...pairs.map(f => f.text), ...extras.map(a => a.text)];
  const anomalies = anomalyLines.length ? anomalyLines.map(t => esc(t)).join(' ') : (review ? 'No anomalies.' : '');
  const capNote = !review ? '' : (review.before == null || !Number.isFinite(Number(review.before))
    ? `<p class="bank-format" data-testid="bank-cap-note">No per-payment cap is saved in /setup, so there is no limit to show.</p>
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
    ? (state.browserSig.ok ? browserSignatureLine(true) : (state.browserSig.why || browserSignatureLine(false)))
    : '';
  const audit = `<section class="bank-pane" data-pane="audit" data-testid="bank-pane-audit" ${tab === 'audit' ? '' : 'hidden'}>
      <div class="bank-scroll" data-testid="bank-scroll">
      ${review ? '' : flow(tokenStack('NEAR', '', { size: 40 }))}
      ${review ? '' : `<p class="bank-format" data-testid="bank-format">Accepted format: ${esc(FORMAT_LINE)}.</p>
      <button type="button" class="bank-sample-link" data-testid="bank-sample-file">Download a sample</button>
      <label class="choice-label" for="bank-sample" data-testid="bank-sample-label">Sample</label>
      <select id="bank-sample" data-testid="bank-sample">${SAMPLES.map(s => `<option value="${s.id}"${state.sample === s.id ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
      <div class="bank-split">
        <div>
          <label class="choice-label" for="bank-file">Statement file</label>
          <input id="bank-file" data-testid="bank-file" type="file" accept=".csv,text/csv,text/plain">
        </div>
        <div>
          <label class="choice-label" for="bank-paste">Or paste</label>
          <textarea id="bank-paste" data-testid="bank-paste" rows="2" placeholder="merchant, amount">${esc(state.paste || '')}</textarea>
        </div>
      </div>
      <p class="bank-format" data-testid="bank-detected">${esc(state.detected || 'No file yet.')}</p>`}
      ${review ? `<p class="bank-format" data-testid="bank-detected">${esc(state.detected || '')}</p>
      <label class="choice-label">Summary</label><p class="bank-field" data-testid="bank-summary">${esc(plural(review.lines, 'line', 'lines'))} · ${esc(plural(review.counted, 'counted', 'counted'))}${review.currency ? ` · ${esc(review.currency)}` : ''}</p>
      <label class="choice-label">Findings</label><p class="bank-field" data-testid="bank-waste">${esc(review.wasteText || '')}</p>
      <label class="choice-label">Anomalies</label><p class="bank-field" data-testid="bank-anomalies">${anomalies}</p>
      ${capNote}
      <label class="bank-consent"><input type="checkbox" data-testid="bank-consent"${state.consent ? ' checked' : ''}> Publish a salted commitment, not the statement</label>
      ${state.modelAnswer ? `<p class="bank-status" data-testid="bank-model-answer">${esc(state.modelAnswer)}</p>` : ''}
      ${sigLine ? `<p class="bank-status" data-testid="bank-browser-sig">${esc(sigLine)}</p>` : ''}
      ${state.status2 ? `<p class="bank-status" data-testid="bank-status-2">${esc(state.status2)}</p>` : ''}` : ''}
      </div>
      <div class="bank-foot" data-testid="bank-foot-audit">
      ${review ? '<button type="button" class="bank-again" data-testid="bank-again">Audit another statement</button>' : ''}
      <button type="button" class="primary bank-cta" data-testid="bank-audit" id="bank-audit">${esc(cta)}</button>
      <p class="bank-status" data-testid="bank-status">${esc(state.status || '')}</p>
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
  const signerFoot = attestView.checked ? `<p class="bank-status" data-testid="tee-field-signature">${esc(sigField?.ok ? browserSignatureLine(true) : browserSignatureLine(false))}</p>
      <div class="bank-signer-line" data-testid="bank-signer-line">
        <span class="bank-kicker">Signing address</span>
        ${signerHex ? `<button type="button" class="bank-copy" data-testid="tee-copy-signer" data-copy="${esc(signerHex)}">Copy</button>` : ''}
        <span class="bank-signer" data-testid="tee-signer">${esc(signerHex || 'No signing address was in the report.')}</span>
      </div>` : '';
  const attest = `<section class="bank-pane" data-pane="attest" data-testid="bank-pane-attest" ${tab === 'attest' ? '' : 'hidden'}>
      <div class="bank-scroll" data-testid="bank-scroll-attest">
      ${attestView.checked ? '' : flow(SHIELD)}
      <div class="bank-meta">
        <label class="choice-label" for="bank-model">TEE model</label>
        <input id="bank-model" data-testid="bank-model" value="${esc(state.model || DEFAULT_MODEL)}" readonly>
        <label class="choice-label" for="bank-nonce">Fresh nonce</label>
        <input id="bank-nonce" data-testid="bank-nonce" value="${esc(shortNonce(state.attestNonce))}" title="${esc(state.attestNonce || '')}" readonly>
      </div>
      <p class="bank-field" data-testid="bank-eligibility">${esc(attestView.checked ? (state.eligibility || attestView.live) : attestView.live)}</p>
      ${attestView.checked ? `<p class="bank-format" data-testid="tee-where">${esc(CHECK_SPLIT)}</p>` : ''}
      ${fields ? `<ul class="bank-steps" data-testid="tee-fields">${fields}</ul>` : ''}
      </div>
      <div class="bank-foot" data-testid="bank-foot-attest">
      ${signerFoot}
      <button type="button" class="primary bank-cta" data-testid="tee-verify" id="tee-verify">Verify the TEE now</button>
      <p class="bank-status" data-testid="tee-result">${esc(attestView.label || '')}</p>
      <p class="bank-status" data-testid="tee-live">${esc(attestView.live || '')}</p>
      ${attestView.checked && state.teeFail ? `<p class="bank-status" data-testid="tee-fail">${esc(state.teeFail)}</p>` : ''}
      </div>
    </section>`;
  const rows = (state.log || []).slice(-6).map(e => {
    const n = e.anomalyCount;
    const anom = n == null ? '' : `${plural(n, 'anomaly', 'anomalies')} · `;
    return `<li data-testid="bank-log-row">${esc(e.kind)} · ${e.lines == null ? 'no lines' : plural(e.lines, 'line', 'lines')} · ${anom}${esc(e.nonce)}</li>`;
  }).join('');
  const log = `<section class="bank-pane" data-pane="log" data-testid="bank-pane-log" ${tab === 'log' ? '' : 'hidden'}>
      <div class="bank-scroll" data-testid="bank-scroll-log">
      ${flow(LIST)}
      <ul class="bank-log" data-testid="bank-log">${rows || '<li data-testid="bank-log-empty">No audit yet.</li>'}</ul>
      </div>
      <div class="bank-foot" data-testid="bank-foot-log">
      <button type="button" class="primary bank-cta" data-testid="bank-file-btn" id="bank-file-btn">Show the attestation file</button>
      <p class="bank-status" data-testid="bank-file-note">${esc(state.fileNote || 'Request and response bytes are not stored.')}</p>
      <p class="bank-status" data-testid="bank-held">${esc(state.held || 'Confidential pay stays off. Nothing was spent.')}</p>
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
      return { verified: false, step: `Response signature: ${why}`, fields: null };
    }
    return body;
  } catch (e) {
    return { verified: false, step: `Response signature: ${e?.message || 'the audit route did not answer'}`, fields: null };
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
    if (model?.signed_text && model?.signature && model?.signing_address) {
      state.browserSig = await verifyBrowserSignature({
        text: model.signed_text,
        signature: model.signature,
        signingAddress: model.signing_address,
      });
    } else if (model) {
      state.browserSig = { ok: false, why: 'The signature bytes were not in the response, so this browser did not check them.' };
    }
    if (model?.answer) state.modelAnswer = model.answer;
    else state.modelAnswer = '';
    if (state.browserSig?.ok) state.status2 = browserSignatureLine(true);
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
    state.appliedKey = key;
    state.status = decision.reason;
    state.status2 = 'Simulation only. No wallet opened.';
    if (state.consent) {
      const salt = saltFor();
      const text = commitmentText({ nonce: state.nonce, afterNear: decision.after, salt });
      const hash = await hashText(text);
      state.commitment = hash;
      state.status2 = `Salted commitment ${hash.slice(0, 10)}… stays in this browser. It was not published.`;
    }
    pushLog(proofLogEntry({ kind: 'tighten-blocked', lines: review.lines, anomalyCount: review.anomalies.length, nonce: state.nonce, eligible: false }));
    paint();
    return { ok: false, hint: state.status, say: `${state.status} ${state.status2}`, keep: true, kind: 'no', live: 'blocked' };
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
    let signature = { ok: false, why: 'no completion was sent, so this step was not checked' };
    if (state.statement?.length) {
      const model = await postAudit(state.statement, state.model);
      if (state.attestNonce !== nonce) return { ok: false, hint: 'Not checked yet.', say: 'Not checked yet.', keep: true, kind: 'no' };
      await takeModel(model);
      signature = {
        ok: !!state.browserSig?.ok,
        why: state.browserSig?.ok ? '' : (state.browserSig?.why || String(model.step || '').replace(/^Response signature:\s*/i, '')),
      };
    }
    const echoed = body?.nonce || nonce;
    state.fields = attestFields({ ...body, nonce: echoed }, signature).map(f => (
      f.id === 'nonce' ? { ...f, ok: f.ok && echoed === nonce, value: nonce, why: echoed === nonce ? f.why : 'The quote nonce does not match the one this page sent' } : f
    ));
    const failed = state.fields.filter(f => !f.ok);
    state.attestPending = false;
    state.checkedNonce = nonce;
    state.eligibility = failed.length ? failed.map(f => `${f.label}: ${f.why}`).join(' ') : 'Every listed field was verified.';
    if (body?.ok && !failed.length && echoed === nonce) {
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
    pushLog(proofLogEntry({ kind: 'tee', lines: null, anomalyCount: null, nonce, eligible: state.teeLabel === 'attested' }));
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
    state.status = picked.source === 'model'
      ? 'NEAR AI named the rows in your message.'
      : 'The parser named the rows in your message.';
    state.status2 = 'Nothing was signed.';
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
