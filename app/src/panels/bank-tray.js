// Mist Bank city tray. One gold button per tab. The statement stays in this browser.

import { installBankDock, armBankDock, bankDockLog } from './bank-dock.js';
import { parseBankAgent } from './bank-agent.js';
import { liveTee } from '../tee-view.js';
import { tokenStack, bindTokenFallbacks } from './token-badge.js';
import {
  DEFAULT_MODEL, SAMPLES, sampleById, parseStatementCsv, auditStatement, tightenDecision,
  freshNonce, saltFor, commitmentText, hashText, modelEligibility, proofLogEntry,
} from './bank-audit.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DOC = `<svg class="bank-doc" viewBox="0 0 48 48" width="48" height="48" aria-hidden="true"><rect x="10" y="6" width="22" height="30" rx="3" fill="none" stroke="#f3e6cf" stroke-width="2"/><path d="M32 12h6v24a3 3 0 0 1-3 3H16" fill="none" stroke="#e2b35b" stroke-width="2"/><path d="M16 16h12M16 22h12M16 28h8" stroke="#f3e6cf" stroke-width="2" stroke-linecap="round"/></svg>`;

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

export function bankMarkup(state) {
  const tab = state.tab || 'audit';
  const who = state.who;
  const session = who?.account
    ? (who.name && who.name !== who.account ? `Signed in as ${esc(who.name)} · ${esc(who.account)}` : `Signed in as ${esc(who.account)}`)
    : 'Finish setup to read your cap.';
  const tabBtn = (id, label) => `<button type="button" role="tab" class="bank-tab${tab === id ? ' on' : ''}" data-tab="${id}" aria-selected="${tab === id ? 'true' : 'false'}" data-testid="bank-tab-${id}">${label}</button>`;
  const review = state.review;
  const cta = review ? 'Apply tighter limits' : 'Audit privately';
  const anomalies = review?.anomalies?.length ? review.anomalies.map(a => esc(a.text)).join(' ') : (review ? 'No anomalies.' : '');
  const flow = `<div class="bank-flow" data-testid="bank-flow">${DOC}<span class="bank-flow-arrow" aria-hidden="true">→</span>${tokenStack('NEAR', '', { size: 48 })}</div>`;
  const audit = `<section class="bank-pane" data-pane="audit" ${tab === 'audit' ? '' : 'hidden'}>
      ${flow}
      ${review ? '' : `<label class="choice-label" for="bank-sample" data-testid="bank-sample-label">Sample</label>
      <select id="bank-sample" data-testid="bank-sample">${SAMPLES.map(s => `<option value="${s.id}"${state.sample === s.id ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
      <label class="choice-label" for="bank-file">Statement file</label>
      <input id="bank-file" data-testid="bank-file" type="file" accept=".csv,text/csv,text/plain">
      <label class="choice-label" for="bank-model">TEE model</label>
      <input id="bank-model" data-testid="bank-model" value="${esc(state.model || DEFAULT_MODEL)}" readonly>
      <label class="choice-label" for="bank-nonce">Fresh nonce</label>
      <input id="bank-nonce" data-testid="bank-nonce" value="${esc(shortNonce(state.nonce))}" title="${esc(state.nonce)}" readonly>`}
      ${review ? `<label class="choice-label">Summary</label><p class="bank-field" data-testid="bank-summary">${esc(review.lines)} lines · ${esc(review.counted)} counted</p>
      <label class="choice-label">Anomalies</label><p class="bank-field" data-testid="bank-anomalies">${anomalies}</p>
      <label class="choice-label">Current cap</label><p class="bank-field" data-testid="bank-before">${esc(nearText(review.before))}</p>
      <label class="choice-label">Proposed cap</label><p class="bank-field" data-testid="bank-after">${esc(nearText(review.after))}</p>
      <label class="bank-consent"><input type="checkbox" data-testid="bank-consent"${state.consent ? ' checked' : ''}> Publish a salted commitment, not the statement</label>` : ''}
      <button type="button" class="primary bank-cta" data-testid="bank-audit" id="bank-audit">${esc(cta)}</button>
      <p class="bank-status" data-testid="bank-status">${esc(state.status || '')}</p>
      <p class="bank-status" data-testid="bank-status-2">${esc(state.status2 || '')}</p>
      ${review ? '<button type="button" class="bank-again" data-testid="bank-again">Audit another sample</button>' : ''}
    </section>`;
  const steps = (state.teeSteps || []).map(s => `<li data-testid="tee-step">${esc(s.label)}${s.ok ? '' : `: ${esc(s.why || 'did not pass')}`}</li>`).join('');
  const attest = `<section class="bank-pane" data-pane="attest" ${tab === 'attest' ? '' : 'hidden'}>
      ${flow}
      <label class="choice-label" for="bank-model-view">TEE model</label>
      <input id="bank-model-view" data-testid="bank-model-view" value="${esc(state.model || DEFAULT_MODEL)}" readonly>
      <p class="bank-field" data-testid="bank-eligibility">${esc(state.eligibility || 'Not checked yet. A proxied model is not labelled TEE.')}</p>
      <button type="button" class="primary bank-cta" data-testid="tee-verify" id="tee-verify">Verify the TEE now</button>
      <p class="bank-status" data-testid="tee-result">${esc(state.teeLabel || '')}</p>
      <p class="bank-status" data-testid="tee-live">${esc(state.teeLive || '')}</p>
      ${state.teeFail ? `<p class="bank-status" data-testid="tee-fail">${esc(state.teeFail)}</p>` : ''}
      ${steps ? `<ol class="bank-steps">${steps}</ol>` : ''}
    </section>`;
  const rows = (state.log || []).slice(-6).map(e => {
    const n = e.anomalyCount;
    const anom = n == null ? '' : `${n} ${n === 1 ? 'anomaly' : 'anomalies'} · `;
    return `<li data-testid="bank-log-row">${esc(e.kind)} · ${e.lines == null ? 'no lines' : `${e.lines} lines`} · ${anom}${esc(e.nonce)}</li>`;
  }).join('');
  const log = `<section class="bank-pane" data-pane="log" ${tab === 'log' ? '' : 'hidden'}>
      ${flow}
      <ul class="bank-log" data-testid="bank-log">${rows || '<li data-testid="bank-log-empty">No audit yet.</li>'}</ul>
      <button type="button" class="primary bank-cta" data-testid="bank-file-btn" id="bank-file-btn">Show the attestation file</button>
      <p class="bank-status" data-testid="bank-file-note">${esc(state.fileNote || 'Request and response bytes are not stored.')}</p>
      <p class="bank-status" data-testid="bank-held">${esc(state.held || 'Confidential pay stays off. Nothing was spent.')}</p>
    </section>`;
  return `<div class="bank-card">
    <p class="bank-session" data-testid="bank-session">${session}</p>
    <div class="bank-tabs" role="tablist">${tabBtn('audit', 'Audit')}${tabBtn('attest', 'Attestation')}${tabBtn('log', 'Proof log')}</div>
    <div class="card shop-card shop-stack">
      ${audit}${attest}${log}
    </div>
  </div>`;
}

export function mountBankRoom(root, hooks = {}) {
  if (!root) return;
  const doc0 = root.ownerDocument || document;
  ensureCss(doc0);
  ensureBankDock(doc0);
  const state = hooks.state || {};
  if (!state.nonce) state.nonce = freshNonce();
  if (!state.sample) state.sample = 'cafe';
  if (!state.model) state.model = DEFAULT_MODEL;
  if (!state.log) state.log = [];
  if (!state.tab) state.tab = 'audit';
  if (!state.status) {
    state.status = 'The statement stays in this browser.';
    state.status2 = 'A TEE report is not this audit.';
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

  async function runAudit(sampleId) {
    hooks.hideRefuse?.();
    state.tab = 'audit';
    if (sampleId) state.sample = sampleId;
    let rows = state.pendingRows || null;
    const uploaded = !!rows;
    if (!rows) rows = sampleById(state.sample).rows.map(r => ({ ...r }));
    state.pendingRows = null;
    const review = auditStatement(rows, { capNear: capNear() });
    rows.length = 0;
    state.review = review;
    state.nonce = freshNonce();
    const entry = proofLogEntry({
      kind: uploaded ? 'upload' : state.sample,
      lines: review.lines,
      anomalyCount: review.anomalies.length,
      nonce: state.nonce,
      eligible: false,
    });
    pushLog(entry);
    const capLine = review.tighten
      ? `Proposed cap ${review.after} NEAR, from ${review.before}. Live write is blocked.`
      : (review.before == null ? 'No cap is on this row yet. Nothing was signed.' : 'The proposed cap matches the current cap. Nothing was signed.');
    state.status = `${review.lines} lines. ${review.anomalies.length} anomalies. Nothing was signed.`;
    state.status2 = uploaded ? `The file was audited here and was not kept. ${capLine}` : capLine;
    paint();
    return { ok: true, hint: state.status, say: `${state.status} ${state.status2}`, keep: true, kind: 'ok' };
  }

  async function runApply() {
    hooks.hideRefuse?.();
    const review = state.review;
    if (!review) return fail('Audit a sample first. Nothing was signed.');
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
    state.teeLabel = '';
    state.teeLive = 'Asking NEAR AI';
    state.teeFail = '';
    state.teeSteps = [];
    paint();
    const nonce = freshNonce();
    state.nonce = nonce;
    let body;
    try {
      body = await liveTee({ nonce, api: globalThis.NEARCARTA_API || '' });
    } catch (e) {
      body = { ok: false, failure: e?.message || 'The attestation request failed', steps: [] };
    }
    const names = (body?.models || []).map(m => m.model_name || m.model).filter(Boolean);
    const gate = modelEligibility({ model: state.model, teeOk: !!body?.ok, attested: names });
    state.eligibility = gate.label;
    state.teeSteps = body?.steps || [];
    if (body?.ok && gate.eligible) {
      state.teeLabel = 'attested';
      state.teeLive = 'Live check passed. This is a hardware report, not the audit.';
      state.teeFail = '';
    } else {
      state.teeLabel = 'failed';
      const why = gate.proxied ? gate.label : (body?.failure || body?.error || gate.label);
      state.teeFail = String(why).includes(':') ? String(why) : `NEAR AI attestation: ${why}`;
      state.teeLive = 'The hardware check did not pass. Nothing was signed.';
    }
    pushLog(proofLogEntry({ kind: 'tee', lines: null, anomalyCount: null, nonce, eligible: !!(body?.ok && gate.eligible) }));
    paint();
    return { ok: true, hint: state.teeLive, say: state.teeLive, keep: true, kind: body?.ok ? 'ok' : 'no' };
  }

  async function runFile() {
    hooks.hideRefuse?.();
    state.tab = 'log';
    paint();
    try {
      const r = await fetch(`${globalThis.NEARCARTA_API || ''}/api/bank/proof`, { cache: 'no-store' });
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
    if (!review) return fail('Audit a sample first. Nothing was signed.');
    const text = review.anomalies.length ? review.anomalies.map(a => a.text).join(' ') : 'No anomalies in the last audit.';
    state.status = text;
    state.status2 = 'That is the local report. The statement was not sent.';
    paint();
    return { ok: true, hint: text, say: text, keep: true, kind: 'ok' };
  }

  async function runAgent(text) {
    const parsed = parseBankAgent(text, { review: state.review });
    if (!parsed.ok) {
      bankDockLog(root.ownerDocument || document, parsed.hint);
      return fail(parsed.hint);
    }
    if (parsed.action === 'tee') return runTee();
    if (parsed.action === 'file') return runFile();
    if (parsed.action === 'apply') return runApply();
    if (parsed.action === 'explain') return runExplain();
    return runAudit(parsed.sample);
  }
  state.runAgent = runAgent;

  function bind() {
    const doc = root.ownerDocument || document;
    root.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.tab = btn.getAttribute('data-tab');
        paint();
      });
    });
    const sample = root.querySelector('#bank-sample');
    if (sample) sample.addEventListener('change', () => {
      state.sample = sample.value;
      state.review = null;
      state.pendingRows = null;
      state.status = 'The statement stays in this browser.';
      state.status2 = 'A TEE report is not this audit.';
      paint();
    });
    const file = root.querySelector('#bank-file');
    if (file) file.addEventListener('change', () => {
      const picked = file.files && file.files[0];
      if (!picked) return;
      if (picked.size > 6000) {
        state.pendingRows = null;
        state.status = 'That file is over 6000 characters. Nothing was audited.';
        state.status2 = 'Nothing was signed.';
        paint();
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const parsed = parseStatementCsv(String(reader.result || ''));
        if (!parsed.ok) {
          state.pendingRows = null;
          state.status = parsed.error;
          state.status2 = 'Nothing was signed.';
        } else {
          state.pendingRows = parsed.rows;
          state.review = null;
          state.status = 'File read in this browser.';
          state.status2 = 'Press Audit privately. The file is not uploaded.';
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
    const consent = root.querySelector('[data-testid=bank-consent]');
    if (consent) consent.addEventListener('change', () => { state.consent = consent.checked; });
    const again = root.querySelector('[data-testid=bank-again]');
    if (again) again.addEventListener('click', () => {
      state.review = null;
      state.pendingRows = null;
      state.status = 'The statement stays in this browser.';
      state.status2 = 'A TEE report is not this audit.';
      paint();
    });
    const audit = root.querySelector('#bank-audit');
    if (audit) audit.addEventListener('click', () => { (state.review ? runApply() : runAudit()).catch(() => {}); });
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
