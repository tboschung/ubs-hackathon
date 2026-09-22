import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const TARGET = path.join(PUBLIC, 'login.html');   // the only file the agent may touch
const PORT = 4000;

/* ------------------------------------------------------------------ *
 *  .env  (no dependencies)
 * ------------------------------------------------------------------ */
function loadEnv() {
  const out = {};
  try {
    for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* no .env */ }
  return out;
}
const ENV = loadEnv();
const API_KEY = ENV.GPT_API;
const MODEL = ENV.GPT_MODEL || 'gpt-5.6-terra';

/* ------------------------------------------------------------------ *
 *  Tickets
 * ------------------------------------------------------------------ */
const tickets = new Map();
let seq = 4817;
const newId = () => `INC-${new Date().getFullYear()}-${++seq}`;

/* ------------------------------------------------------------------ *
 *  Dashboard integration
 *
 *  The Ticket Intelligence dashboard consumes tickets in its own
 *  contract, tagged with stable ontology IDs. We map our service-desk
 *  categories onto those IDs with plain rules.
 * ------------------------------------------------------------------ */
const CATEGORY_ONTOLOGY = {
  'Login & Authentication — e-banking':
    { node_ids: ['actor:user', 'platform:e_banking'],      edge_ids: ['edge:user_login_ebanking'],        symptoms: ['login_failure'] },
  'Login & Authentication — Mobile Banking':
    { node_ids: ['actor:user', 'platform:e_banking'],      edge_ids: ['edge:user_login_ebanking'],        symptoms: ['login_failure'] },
  'E-banking — Account overview':
    { node_ids: ['actor:user', 'platform:e_banking'],      edge_ids: ['edge:user_login_ebanking'],        symptoms: ['display_error'] },
  'E-banking — Payments & transfers':
    { node_ids: ['actor:user', 'actor:supplier'],          edge_ids: ['edge:user_pays_supplier'],         symptoms: ['payment_failure'] },
  'E-banking — QR-bill scanning':
    { node_ids: ['actor:user', 'platform:e_banking'],      edge_ids: [],                                  symptoms: ['payment_failure'] },
  'E-banking — Statements & documents':
    { node_ids: ['actor:user', 'platform:e_banking'],      edge_ids: [],                                  symptoms: ['document_unavailable'] },
  'Mobile App — Push notifications':
    { node_ids: ['actor:user', 'platform:e_banking'],      edge_ids: [],                                  symptoms: ['notification_failure'] },
  'UBS TWINT integration':
    { node_ids: ['actor:user', 'actor:supplier'],          edge_ids: ['edge:user_pays_supplier'],         symptoms: ['payment_failure'] },
  'Credit card portal':
    { node_ids: ['actor:user', 'platform:e_banking'],      edge_ids: [],                                  symptoms: ['card_issue'] },
  'Card blocking / replacement':
    { node_ids: ['actor:user', 'platform:e_banking'],      edge_ids: [],                                  symptoms: ['card_issue'] },
  'SEPA / SIC payment rails':
    { node_ids: ['actor:user', 'actor:supplier'],          edge_ids: ['edge:user_pays_supplier'],         symptoms: ['payment_failure'] },
  'Standing orders':
    { node_ids: ['actor:user', 'actor:supplier'],          edge_ids: ['edge:user_pays_supplier'],         symptoms: ['payment_failure'] },
  'Trading platform — order entry':
    { node_ids: ['actor:user', 'platform:e_banking'],      edge_ids: [],                                  symptoms: ['order_failure'] },
  'Custody account reporting':
    { node_ids: ['actor:user', 'platform:e_banking'],      edge_ids: [],                                  symptoms: ['document_unavailable'] },
  'Market data feed':
    { node_ids: ['platform:e_banking', 'server:ebanking_primary'], edge_ids: ['edge:ebanking_depends_on_server'], symptoms: ['data_stale'] },
  'Client advisor CRM':
    { node_ids: ['actor:employee', 'platform:crm'],        edge_ids: ['edge:employee_login_crm'],         symptoms: ['login_failure'] },
  'KYC / onboarding workflow':
    { node_ids: ['actor:employee', 'platform:crm'],        edge_ids: ['edge:employee_login_crm'],         symptoms: ['workflow_blocked'] },
  'Compliance reporting tool':
    { node_ids: ['actor:employee', 'platform:crm'],        edge_ids: [],                                  symptoms: ['document_unavailable'] },
  'Internal SSO / Active Directory':
    { node_ids: ['actor:employee', 'platform:hr'],         edge_ids: ['edge:employee_login_hr'],          symptoms: ['login_failure'] },
  'Branch terminal software':
    { node_ids: ['actor:employee', 'server:ebanking_primary'], edge_ids: ['edge:ebanking_depends_on_server'], symptoms: ['terminal_failure'] }
};

// Always present, so the dashboard can be built against this endpoint
// without anyone having to use the demo first.
const SEED_TICKET = {
  id: 'TCK-4001',
  occurred_at: '2026-09-22T09:14:00+02:00',
  title: 'Cannot log in to e-banking',
  description: "Clicking Login shows 'Something went wrong. Please try again later.' " +
               'Contract number and password are correct. Happens on every attempt.',
  source: 'service_desk',
  source_severity: 'medium',
  status: 'awaiting_approval',
  context: {
    region: 'CH',
    channel: 'web',
    environment: 'production',
    error_code: 'AUTH_JS_TYPEERROR',
    release_id: 'ebanking-web-2026.09'
  },
  ontology_tags: {
    node_ids: ['actor:user', 'platform:e_banking'],
    edge_ids: ['edge:user_login_ebanking'],
    symptoms: ['login_failure'],
    tagging_method: 'rules',
    confidence: 0.96
  }
};

// Our internal ticket -> the dashboard's contract.
function toContract(t) {
  const tags = CATEGORY_ONTOLOGY[t.category];
  return {
    id: t.id,
    occurred_at: t.createdAt,
    title: t.summary || t.description.split('\n')[0].slice(0, 120) || t.category,
    description: t.description || t.summary,
    source: 'service_desk',
    source_severity: 'medium',
    status: t.status,
    context: {
      region: 'CH',
      channel: 'web',
      environment: 'production',
      error_code: null,
      release_id: 'ebanking-web-2026.09'
    },
    ontology_tags: tags
      ? { ...tags, tagging_method: 'rules', confidence: 0.96 }
      : { node_ids: [], edge_ids: [], symptoms: ['unknown'], tagging_method: 'rules', confidence: 0.3 }
  };
}

/* ------------------------------------------------------------------ *
 *  Diff (LCS over lines)
 * ------------------------------------------------------------------ */
function diffLines(before, after) {
  const a = before.split('\n'), b = after.split('\n');
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);

  const ops = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { ops.push([' ', a[i]]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push(['-', a[i++]]); }
    else { ops.push(['+', b[j++]]); }
  }
  while (i < m) ops.push(['-', a[i++]]);
  while (j < n) ops.push(['+', b[j++]]);

  // keep 2 lines of context around changes
  const keep = new Set();
  ops.forEach(([s], k) => {
    if (s !== ' ') for (let d = -2; d <= 2; d++) keep.add(k + d);
  });
  const out = [];
  let gap = false;
  ops.forEach(([s, t], k) => {
    if (keep.has(k)) { out.push(s + ' ' + t.trim()); gap = false; }
    else if (!gap) { out.push('  …'); gap = true; }
  });
  return out.length ? out.slice(0, 40) : ['  (no textual change)'];
}

/* ------------------------------------------------------------------ *
 *  The agent
 * ------------------------------------------------------------------ */
const SYSTEM_PROMPT = `You are the UBS autonomous remediation agent.
You maintain one production file: the e-banking login page (public/login.html).
A user has filed an incident ticket. Find the defect in the HTML and repair it.

Rules:
- Return the COMPLETE corrected file, not a fragment.
- Change ONLY what is required to fix the reported defect. Preserve every other
  line of markup, CSS and JavaScript byte-for-byte, including the
  "See an error? Please report it!" button and the demo credentials logic
  (username "fcaldas", password "1234", redirect to /ebanking.html).
- Do not add comments about the fix, do not reformat, do not "improve" anything else.

Respond with a single JSON object, no markdown fences:
{
  "diagnosis":  "one or two sentences: the root cause, naming the exact symbol/line",
  "fix":        "one sentence: what you changed",
  "fixed_html": "the full corrected file as a string"
}`;

async function callModel(source, ticket) {
  const userMsg = `INCIDENT TICKET ${ticket.id}
Service:     ${ticket.category}
Summary:     ${ticket.summary || '(none)'}
Description: ${ticket.description || '(none)'}

--- BEGIN public/login.html ---
${source}
--- END public/login.html ---`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMsg }
      ],
      response_format: { type: 'json_object' }
    })
  });

  if (!res.ok) throw new Error(`model API ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const data = await res.json();
  let content = data.choices?.[0]?.message?.content ?? '';
  content = content.replace(/^```(?:json)?/, '').replace(/```$/, '').trim();

  let parsed;
  try { parsed = JSON.parse(content); }
  catch { throw new Error('model did not return valid JSON'); }

  if (!parsed.fixed_html || !/<html/i.test(parsed.fixed_html))
    throw new Error('model response did not contain a full HTML document');
  if (parsed.fixed_html.length < source.length * 0.5)
    throw new Error('model response was truncated — patch rejected for safety');

  // Normalise the trailing newline so repeat runs produce a clean diff.
  if (!parsed.fixed_html.endsWith('\n')) parsed.fixed_html += '\n';

  return parsed;
}

// Runs in the background after the ticket is acknowledged. Progress goes to
// the terminal only — the reporter just sees "we are working on it".
async function runAgent(ticket) {
  const t0 = Date.now();
  const log = (msg) => console.log(`           ${msg}`);

  const before = fs.readFileSync(TARGET, 'utf8');
  log(`analysing public/login.html (${before.split('\n').length} lines) with ${MODEL}…`);

  let result;
  try {
    result = await callModel(before, ticket);
  } catch (err) {
    // Never let the demo die: fall back to the known-good snapshot.
    const snapshot = path.join(ROOT, 'snapshots', 'login.pristine.html');
    if (!fs.existsSync(snapshot)) {
      ticket.status = 'failed';
      log(`✕ ${String(err.message || err)}`);
      return;
    }
    log(`✕ model unreachable — ${String(err.message || err).slice(0, 120)}`);
    log('→ falling back to last known-good snapshot');
    result = {
      diagnosis: '(skipped — model unreachable)',
      fix: 'Rolled back to last known-good snapshot.',
      fixed_html: fs.readFileSync(snapshot, 'utf8')
    };
  }

  log(`cause: ${result.diagnosis}`);
  for (const line of diffLines(before, result.fixed_html)) {
    if (line[0] === '+' || line[0] === '-') log(`  ${line}`);
  }

  fs.writeFileSync(TARGET, result.fixed_html, 'utf8');
  ticket.status = 'resolved';
  ticket.diagnosis = result.diagnosis;
  console.log(`  ✓ ${ticket.id} resolved in ${((Date.now() - t0) / 1000).toFixed(1)}s — public/login.html patched\n`);
}

/* ------------------------------------------------------------------ *
 *  HTTP
 * ------------------------------------------------------------------ */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
                '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
                '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };

// The dashboard runs on another localhost port, so its browser calls are
// cross-origin. Without this they fail silently.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  // --- API ---------------------------------------------------------
  if (req.method === 'OPTIONS') {           // CORS preflight
    res.writeHead(204, CORS);
    return res.end();
  }

  if (p === '/api/tickets' && req.method === 'POST') {
    const body = await readBody(req);
    const ticket = {
      id: newId(),
      category: body.category || 'Unclassified',
      summary: body.summary || '',
      description: body.description || '',
      status: 'awaiting_approval',
      createdAt: new Date().toISOString()
    };
    tickets.set(ticket.id, ticket);

    console.log(`\n  [ticket] ${ticket.id}  ${ticket.category}`);
    if (ticket.summary) console.log(`           "${ticket.summary}"`);
    console.log('           ⏸ waiting for dashboard approval');
    console.log(`           curl -X POST localhost:${PORT}/api/tickets/${ticket.id}/approve`);

    // The repair does NOT start here — it waits for /approve.
    res.writeHead(201, { 'Content-Type': 'application/json', ...CORS });
    res.end(JSON.stringify(ticket));
    return;
  }

  // Dashboard reads the ticket feed in its own contract.
  if (p === '/api/tickets' && req.method === 'GET') {
    const feed = [SEED_TICKET, ...[...tickets.values()].map(toContract)];
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS });
    return res.end(JSON.stringify(feed, null, 2));
  }

  // Dashboard releases the agent. GET is allowed too, so the gate can be
  // tripped from a browser address bar if anything goes wrong on stage.
  const approve = /^\/api\/tickets\/([\w-]+)\/approve$/.exec(p);
  if (approve && (req.method === 'POST' || req.method === 'GET')) {
    const ticket = tickets.get(approve[1]);
    const json = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json', ...CORS });
      res.end(JSON.stringify(body));
    };

    if (!ticket) return json(404, { error: 'unknown ticket', id: approve[1] });
    if (ticket.status !== 'awaiting_approval')
      return json(409, { error: 'already approved', id: ticket.id, status: ticket.status });

    ticket.status = 'in_progress';
    console.log(`\n  [approved] ${ticket.id} — released by dashboard`);

    const repair = runAgent(ticket).catch((err) => {
      ticket.status = 'failed';
      console.error(`  ✕ ${ticket.id} failed:`, err.message || err);
    });

    // Default: answer at once and let the dashboard poll the feed.
    if (url.searchParams.get('wait') !== '1')
      return json(202, { id: ticket.id, status: 'in_progress' });

    // ?wait=1: hold the connection until the repair finishes.
    await repair;
    return json(200, { id: ticket.id, status: ticket.status, diagnosis: ticket.diagnosis || null });
  }

  // --- static ------------------------------------------------------
  let file = p === '/' ? '/login.html' : p;
  const full = path.join(PUBLIC, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
  if (!full.startsWith(PUBLIC) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    return res.end('<h1>404</h1>');
  }

  const content = fs.readFileSync(full);
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream',
    'Cache-Control': 'no-store'
  });
  res.end(content);
});

server.listen(PORT, () => {
  console.log('');
  console.log('  UBS self-healing demo');
  console.log('  ─────────────────────────────────────────────');
  console.log(`  Login page    →  http://localhost:${PORT}/login.html`);
  console.log(`  Service desk  →  http://localhost:${PORT}/ticket.html`);
  console.log(`  Ticket feed   →  http://localhost:${PORT}/api/tickets`);
  console.log(`  Approve       →  POST http://localhost:${PORT}/api/tickets/{id}/approve`);
  console.log(`  Model         →  ${MODEL}  ${API_KEY ? '(key loaded)' : '(NO KEY — will use snapshot fallback)'}`);
  console.log('');
  console.log('  Break public/login.html by hand, then file a ticket.');
  console.log('  npm run reset   restores the file from the snapshot');
  console.log('');
});
