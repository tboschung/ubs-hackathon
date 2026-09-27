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
  console.log(`  ✓ ${ticket.id} resolved in ${((Date.now() - t0) / 1000).toFixed(1)}s — public/login.html patched\n`);
}

/* ------------------------------------------------------------------ *
 *  HTTP
 * ------------------------------------------------------------------ */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
                '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
                '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };

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
  if (p === '/api/tickets' && req.method === 'POST') {
    const body = await readBody(req);
    const ticket = {
      id: newId(),
      category: body.category || 'Unclassified',
      summary: body.summary || '',
      description: body.description || '',
      status: 'open',
      createdAt: new Date().toISOString()
    };
    tickets.set(ticket.id, ticket);

    console.log(`\n  [ticket] ${ticket.id}  ${ticket.category}`);
    if (ticket.summary) console.log(`           "${ticket.summary}"`);

    // Acknowledge immediately, then repair in the background.
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(ticket));

    runAgent(ticket).catch((err) => {
      ticket.status = 'failed';
      console.error(`  ✕ ${ticket.id} failed:`, err.message || err);
    });
    return;
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
  console.log(`  Model         →  ${MODEL}  ${API_KEY ? '(key loaded)' : '(NO KEY — will use snapshot fallback)'}`);
  console.log('');
  console.log('  Break public/login.html by hand, then file a ticket.');
  console.log('  npm run reset   restores the file from the snapshot');
  console.log('');
});
