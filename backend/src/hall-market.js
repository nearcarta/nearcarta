// Agent Market reads and the townhall bounty view. This module does not sign and does not register an agent.
// Assignments: GET /v1/agents/me/assignments with Authorization Bearer — https://market.near.ai/skill/SKILL.md
// Public agent: GET /v1/agents/{id_or_handle}
// The jobs board returned HTTP 401 on 2026-11-06, so it is not called.
// Town hall views: get_state, get_bounties on townhall.nearcarta.near.
// Listing docs: https://docs.market.near.ai/list-your-agent

import { LAMPLIGHTER_REGISTER, MARKET_BASE } from '../../shared/hall/plan.js';

export { LAMPLIGHTER_REGISTER };

export function marketToken(env = process.env) {
  const t = String(env.AGENT_API_TOKEN || '').trim();
  return t || null;
}

export function assignmentRows(body) {
  const list = Array.isArray(body?.assignments) ? body.assignments : [];
  return list.map(row => {
    const a = row?.assignment || {};
    const job = row?.job || {};
    return {
      assignmentId: a.assignmentId ?? null,
      jobId: a.jobId ?? job.jobId ?? null,
      title: job.title ?? null,
      description: job.description ?? null,
      status: a.status ?? job.status ?? null,
      escrowAmount: a.escrowAmount ?? null,
      escrowToken: a.escrowToken ?? null,
    };
  });
}

export function agentCard(body, httpStatus) {
  if (httpStatus === 404 || !body || body.error) return { listed: false, status: httpStatus || 0, handle: null, name: null, description: null, avatarUrl: null, listingStatus: null };
  return {
    listed: body.listing_status === 'live' || body.listingStatus === 'live',
    status: httpStatus || 200,
    handle: body.handle ?? null,
    name: body.name ?? null,
    description: body.description ?? null,
    avatarUrl: body.avatar_url || body.avatarUrl || null,
    listingStatus: body.listing_status || body.listingStatus || null,
  };
}

function yoctoDigits(amount) {
  if (amount == null) return null;
  if (typeof amount === 'string' || typeof amount === 'number') return String(amount);
  if (typeof amount === 'object') {
    if (typeof amount.amount === 'string') return amount.amount;
    const v = amount[''] ?? amount.yocto ?? null;
    return v == null ? null : String(v);
  }
  return null;
}

export function bountyRows(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const row of list) {
    const pair = Array.isArray(row) ? row : null;
    const hash = pair ? pair[0] : row?.hash;
    const b = pair ? pair[1] : row;
    if (!hash || !b || typeof b !== 'object') continue;
    const amount = yoctoDigits(b.amount);
    if (!amount) continue;
    out.push({
      hash: String(hash),
      amount,
      claimedBy: b.claimed_by ?? b.claimedBy ?? null,
      policyVersion: b.policy_version ?? b.policyVersion ?? null,
    });
  }
  return out;
}

async function readJson(fetchImpl, url, headers) {
  const res = await fetchImpl(url, { headers });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { error: 'bad_json' }; }
  return { status: res.status, body };
}

export async function marketStatus({ token, fetchImpl = fetch, handle = 'lamplighter', base = MARKET_BASE } = {}) {
  const draft = LAMPLIGHTER_REGISTER;
  if (!token) return { ok: false, blocked: 'no_token', ready: true, draft, agent: null, assignments: [], sent: false };
  const root = String(base || MARKET_BASE).replace(/\/$/, '');
  try {
    const pub = await readJson(fetchImpl, `${root}/v1/agents/${encodeURIComponent(handle)}`, { accept: 'application/json' });
    const mine = await readJson(fetchImpl, `${root}/v1/agents/me/assignments?status=in_progress&limit=20`, {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
    });
    const agent = agentCard(pub.body, pub.status);
    if (mine.status === 401 || mine.status === 403) {
      return { ok: false, blocked: 'bad_token', ready: true, draft, agent, assignments: [], sent: false };
    }
    if (mine.status >= 400) {
      return { ok: false, blocked: 'market_unread', ready: true, draft, agent, assignments: [], sent: false };
    }
    return { ok: true, blocked: null, ready: true, draft, agent, assignments: assignmentRows(mine.body), sent: false };
  } catch (e) {
    return { ok: false, blocked: 'market_unread', ready: true, draft, agent: null, assignments: [], sent: false, error: String(e?.message || 'market unread').slice(0, 160) };
  }
}

export async function readBounties({ view, contract = 'townhall.nearcarta.near' } = {}) {
  if (typeof view !== 'function') return { contract, state: null, bounties: [], error: 'no view' };
  try {
    const [state, raw] = await Promise.all([
      view(contract, 'get_state', {}),
      view(contract, 'get_bounties', {}),
    ]);
    return { contract, state: state || null, bounties: bountyRows(raw) };
  } catch (e) {
    return { contract, state: null, bounties: [], error: String(e?.message || 'bounty read failed').slice(0, 160) };
  }
}
