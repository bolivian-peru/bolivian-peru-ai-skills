#!/usr/bin/env node
// Board helper for the agent-ops-board engine. Node 18+, no dependencies.
//
//   node export-board.mjs [export] --out ./board-export   read-only: board.json, board.md, export-status.json
//   node export-board.mjs health   --out ./board-export   read-only: health.json, health.md; exit 4 on findings
//   node export-board.mjs post <cardId> <file> [--id <uuid>]   write, then read back
//
// Exit codes: 0 ok/verified, 1 error or incomplete export, 2 post rejected, 3 post UNCERTAIN, 4 health findings.
// Required: BOARD_API_URL, BOARD_API_TOKEN. Optional variables are listed in README.md.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const env = (k, d) => process.env[k] ?? d;
const BASE = env('BOARD_API_URL');
const TOKEN = env('BOARD_API_TOKEN');
if (!BASE || !TOKEN) {
  console.error('Set BOARD_API_URL and BOARD_API_TOKEN.');
  process.exit(1);
}
const TASKS = env('BOARD_TASKS_PATH', '/tasks');
const ARCHIVED = env('BOARD_ARCHIVED_PARAM', 'archived=true');
const MESSAGES = env('BOARD_MESSAGES_PATH', '/tasks/{id}/messages');
const AUTH = env('BOARD_AUTH_HEADER', 'Authorization');
const DELAY = Number(env('BOARD_DELAY_MS', '1500'));
const PAGE_MODE = env('BOARD_PAGE_MODE', 'none'); // none | cursor | offset | page
const PAGE_SIZE = Number(env('BOARD_PAGE_SIZE', '100'));
const CURSOR_PARAM = env('BOARD_CURSOR_PARAM', 'cursor');
const THREAD_LIMIT = Number(env('BOARD_THREAD_LIMIT', '50'));
const THREAD_CURSOR = env('BOARD_THREAD_CURSOR_PARAM', 'before');
const LIMIT_PARAM = env('BOARD_LIMIT_PARAM', 'limit');
const OFFSET_PARAM = env('BOARD_OFFSET_PARAM', 'offset');
const PAGE_PARAM = env('BOARD_PAGE_PARAM', 'page');
const LIST_KEY = env('BOARD_LIST_KEY'); // e.g. issues; default: tasks, items, data, results
const THREAD_KEY = env('BOARD_THREAD_KEY'); // e.g. comments; default: messages, items, data.messages
const REFUSE_IPS = env('BOARD_POST_REFUSE_IPS', '1') === '1';
const STATUSES = env('BOARD_STATUSES', 'todo,in_progress,done').split(',').map((s) => s.trim());
const TERMINAL = STATUSES[STATUSES.length - 1]; // the last status means verified
const STALE_HOURS = Number(env('BOARD_STALE_HOURS', '72'));
const MSG_FIELD = env('BOARD_MESSAGE_FIELD', 'text');
const MSG_ID_FIELD = env('BOARD_MESSAGE_ID_FIELD', 'clientMessageId');

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const VALUE_FLAGS = ['--out', '--id'];
const positional = argv.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.includes(argv[i - 1]));
const COMMAND = ['export', 'health', 'post'].includes(positional[0]) ? positional.shift() : 'export';
const OUT = flag('--out') ?? './board-export';
const REDACT = !argv.includes('--no-redact');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const headers = { [AUTH]: AUTH === 'Authorization' ? `Bearer ${TOKEN}` : TOKEN };

// ---------- shared request core: one request at a time, paced ----------
const retryAfterMs = (res, attempt) => {
  const s = Number(res?.headers.get('retry-after'));
  return Number.isFinite(s) && s > 0 ? Math.min(s, 120) * 1000 : 20_000 * attempt;
};

async function send(method, p, body) {
  await sleep(DELAY);
  const res = await fetch(BASE + p, {
    method,
    headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(45_000),
  });
  return { res, text: await res.text() };
}

function parseJson(p, res, text) {
  try {
    return JSON.parse(text);
  } catch {
    const type = res.headers.get('content-type') ?? 'unknown content type';
    throw new Error(`${p} -> ${res.status} but body is not JSON (${type}): check the URL and token`);
  }
}

// Reads retry on rate limits, 5xx, network errors and timeouts, with bounded backoff.
async function get(p) {
  let last;
  for (let attempt = 1; attempt <= 5; attempt++) {
    let r;
    try {
      r = await send('GET', p);
    } catch (e) {
      last = `GET ${p}: ${e.name === 'TimeoutError' ? 'timeout' : e.message}`;
      await sleep(5_000 * attempt);
      continue;
    }
    const { res, text } = r;
    if (res.ok) return parseJson(p, res, text);
    last = `GET ${p} -> ${res.status} ${text.slice(0, 200)}`;
    if (res.status === 429 || /rate limit/i.test(text)) await sleep(retryAfterMs(res, attempt));
    else if (res.status >= 500) await sleep(5_000 * attempt);
    else throw new Error(last);
  }
  throw new Error(`${last} (gave up after 5 attempts)`);
}

// ---------- board reading ----------
// An unrecognised response shape is an error, never an empty list (doctrine 10).
function pick(r, key, fallbacks, what) {
  if (Array.isArray(r)) return r;
  const found = key ? key.split('.').reduce((o, k) => o?.[k], r) : fallbacks.map((f) => f(r)).find(Array.isArray);
  if (Array.isArray(found)) return found;
  const keys = r && typeof r === 'object' ? Object.keys(r).join(', ') : typeof r;
  throw new Error(`unrecognised ${what} shape: keys=[${keys}]; set ${what === 'card list' ? 'BOARD_LIST_KEY' : 'BOARD_THREAD_KEY'}`);
}
const list = (r) => pick(r, LIST_KEY, [(x) => x.tasks, (x) => x.items, (x) => x.data, (x) => x.results], 'card list');
const threadOf = (r) => pick(r, THREAD_KEY, [(x) => x.messages, (x) => x.items, (x) => x.data?.messages], 'thread');
const idOf = (x) => x._id ?? x.id;
const textOf = (m) => String(m.text ?? m.body ?? m.message ?? m.content ?? '');
const withQuery = (p, q) => (q ? p + (p.includes('?') ? '&' : '?') + q : p);
const nextCursorOf = (r) => r.nextCursor ?? r.next_cursor ?? r.cursor?.next ?? r.pageInfo?.endCursor ?? r.next;

async function listCards(extra, warnings) {
  if (PAGE_MODE === 'none') {
    const cards = list(await get(withQuery(TASKS, extra)));
    if (cards.length && cards.length % 25 === 0)
      warnings.push(`card list returned exactly ${cards.length}: it may be truncated; set BOARD_PAGE_MODE`);
    return cards;
  }
  const cards = [];
  let cursor;
  let firstIdPrev;
  for (let page = 0; page < 1000; page++) {
    const q = [extra, `${LIMIT_PARAM}=${PAGE_SIZE}`];
    if (PAGE_MODE === 'cursor' && cursor) q.push(`${CURSOR_PARAM}=${encodeURIComponent(cursor)}`);
    if (PAGE_MODE === 'offset') q.push(`${OFFSET_PARAM}=${cards.length}`);
    if (PAGE_MODE === 'page') q.push(`${PAGE_PARAM}=${page + 1}`);
    const r = await get(withQuery(TASKS, q.filter(Boolean).join('&')));
    const batch = list(r);
    if (!batch.length) break;
    if (idOf(batch[0]) === firstIdPrev) {
      warnings.push(`card paging repeated a page (${PAGE_MODE}); stopped`);
      break;
    }
    firstIdPrev = idOf(batch[0]);
    cards.push(...batch);
    if (PAGE_MODE === 'cursor') {
      const next = nextCursorOf(r);
      if (!next || next === cursor) break;
      cursor = next;
    } else if (batch.length < PAGE_SIZE) break;
  }
  return cards;
}

async function loadThread(card) {
  const byId = new Map();
  let before;
  for (let page = 0; page < 50; page++) {
    const q = `${LIMIT_PARAM}=${THREAD_LIMIT}${before ? `&${THREAD_CURSOR}=${encodeURIComponent(before)}` : ''}`;
    const r = await get(withQuery(MESSAGES.replace('{id}', encodeURIComponent(idOf(card))), q));
    const batch = threadOf(r);
    const sizeBefore = byId.size;
    for (const m of batch) byId.set(idOf(m) ?? JSON.stringify(m), m);
    if (batch.length < THREAD_LIMIT || r.hasMore === false) return { messages: [...byId.values()], complete: true };
    const next = r.nextBefore ?? idOf(batch[batch.length - 1]);
    if (byId.size === sizeBefore || next === before) return { messages: [...byId.values()], complete: false }; // repeated page
    before = next;
  }
  return { messages: [...byId.values()], complete: false };
}

async function loadBoard() {
  const errors = [];
  const warnings = [];
  const seen = new Set();
  const cards = await listCards('', warnings); // without the active list there is nothing to export
  try {
    // the archived request is the evidence; do not rely on the API returning an archived field
    cards.push(...(await listCards(ARCHIVED, warnings)).map((c) => ({ ...c, archived: c.archived ?? true })));
  } catch (e) {
    errors.push(`archived cards: ${e.message}`);
  }
  const unique = cards.filter((c) => !seen.has(idOf(c)) && seen.add(idOf(c)));
  for (const card of unique) {
    try {
      const { messages, complete } = await loadThread(card);
      card.messages = messages.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      if (!complete) {
        card.messagesIncomplete = true;
        errors.push(`thread ${idOf(card)}: paging did not finish (repeated page or 50-page cap)`);
      }
    } catch (e) {
      card.messages = [];
      card.messagesIncomplete = true;
      errors.push(`thread ${idOf(card)}: ${e.message}`);
    }
    process.stderr.write('.');
  }
  process.stderr.write('\n');
  return { cards: unique, errors, warnings };
}

// ---------- redaction: secret-shaped strings never leave in an export or a post ----------
const PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[redacted-private-key]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[redacted-jwt]'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/g, 'Bearer [redacted]'],
  [/\b(password|passwd|pwd|secret|token|api[_-]?key)(\s*[:=]\s*)\S+/gi, '$1$2[redacted]'],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b|\bAIza[0-9A-Za-z_-]{35}\b|\bglpat-[0-9A-Za-z_-]{20,}/g, '[redacted-key]'],
  [/\b(?:sk|pk|rk|ghp|gho|ghu|ghs|github_pat|xox[a-z])[-_](?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{16,}/g, '[redacted-key]'],
  [/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}\b/g, (m) =>
    // keep hashes, UUIDs and long slugs; a token has a long random run
    /^[0-9a-f-]+$/i.test(m) || m.split(/[-_]/).every((seg) => seg.length < 20) ? m : '[redacted-token]'],
];
// IPv4 addresses are masked in exports; post refuses them only when BOARD_POST_REFUSE_IPS=1 (default).
const IP_PATTERN = [/\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g, 'x.x.x.x'];
const EXPORT_PATTERNS = [...PATTERNS, IP_PATTERN];
const POST_PATTERNS = REFUSE_IPS ? EXPORT_PATTERNS : PATTERNS;
function redactString(s, patterns = EXPORT_PATTERNS) {
  let count = 0;
  let out = s;
  for (const [re, rep] of patterns)
    out = out.replace(re, (...m) => {
      const r = typeof rep === 'function' ? rep(m[0]) : m[0].replace(new RegExp(re.source, re.flags.replace('g', '')), rep);
      if (r !== m[0]) count++;
      return r;
    });
  return { out, count };
}
const KEEP = /^(_?id|.*Id|createdAt|updatedAt|due.*)$/;
function redactDeep(v, stats, key = '') {
  if (typeof v === 'string' && !KEEP.test(key)) {
    const { out, count } = redactString(v);
    stats.redactions += count;
    return out;
  }
  if (Array.isArray(v)) return v.map((x) => redactDeep(x, stats, key));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactDeep(x, stats, k)]));
  return v;
}

const writePrivate = (name, data) => {
  fs.mkdirSync(OUT, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(OUT, name), data, { mode: 0o600 });
};
const day = (v) => String(v ?? '').slice(0, 16).replace('T', ' ');
const known = (s) => STATUSES.includes(s);

// ---------- export ----------
async function runExport() {
  let board;
  try {
    board = await loadBoard();
  } catch (e) {
    console.error(`Export failed before any card was read: ${e.message}`);
    process.exit(1);
  }
  const stats = { redactions: 0 };
  let cards = REDACT ? redactDeep(board.cards, stats) : board.cards;
  const rank = (s) => (known(s) ? STATUSES.indexOf(s) : STATUSES.length - 1.5); // unknown sorts just before the terminal status
  cards = [...cards].sort(
    (a, b) =>
      Number(!!a.archived) - Number(!!b.archived) ||
      rank(a.status) - rank(b.status) ||
      String(b.updatedAt).localeCompare(String(a.updatedAt)),
  );
  const unclassified = cards.filter((c) => !known(c.status)).map((c) => ({ id: idOf(c), status: c.status }));
  const incomplete = board.errors.length > 0;
  const total = cards.reduce((s, c) => s + c.messages.length, 0);

  writePrivate('board.json', JSON.stringify(cards, null, 2));
  writePrivate(
    'export-status.json',
    JSON.stringify(
      { exportedAt: new Date().toISOString(), incomplete, cards: cards.length, messages: total, redacted: REDACT,
        redactions: stats.redactions, unclassifiedStatuses: unclassified, errors: board.errors, warnings: board.warnings },
      null, 2,
    ),
  );

  let md = `# Board export\n\nExported ${new Date().toISOString()}. ${cards.length} cards, ${total} messages.`;
  md += REDACT ? ` ${stats.redactions} secret-shaped strings masked.\n\n` : ' Redaction OFF.\n\n';
  if (incomplete) md += `**INCOMPLETE:** ${board.errors.length} read error(s); see export-status.json.\n\n`;
  for (const w of board.warnings) md += `> Warning: ${w}\n\n`;
  for (const c of cards) {
    const status = known(c.status) ? c.status : `${c.status} (unclassified status)`;
    md += `## ${c.title}\n\n`;
    md += `- Status: ${status}${c.archived ? ' (archived)' : ''} · Priority: ${c.priority ?? '-'} · Labels: ${(c.labels ?? []).join(', ') || '-'}\n`;
    md += `- Created: ${day(c.createdAt)} · Updated: ${day(c.updatedAt)} · Id: ${idOf(c)}\n\n`;
    md += `${c.description || '(no description)'}\n\n`;
    if (c.messages.length || c.messagesIncomplete) {
      md += `### Thread (${c.messages.length}${c.messagesIncomplete ? ', INCOMPLETE' : ''})\n\n`;
      for (const m of c.messages) {
        const who = m.authorName ?? m.author ?? m.sender ?? m.actor?.email ?? '';
        md += `- **${day(m.createdAt)} ${typeof who === 'string' ? who : ''}**: ${textOf(m).replace(/\n/g, '\n  ')}\n`;
      }
      md += '\n';
    }
  }
  writePrivate('board.md', md);
  for (const w of board.warnings) console.error(`Warning: ${w}`);
  if (unclassified.length) console.error(`${unclassified.length} card(s) have a status outside BOARD_STATUSES (reported as unclassified).`);
  console.error(`Wrote ${OUT}/board.json, board.md, export-status.json: ${cards.length} cards, ${total} messages${incomplete ? ', INCOMPLETE' : ''}.`);
  process.exit(incomplete ? 1 : 0);
}

// ---------- health ----------
const has = (re, ...texts) => texts.some((t) => re.test(t ?? ''));
const dueOf = (c) => c.due ?? c.dueDate ?? c.dueAt ?? null;
const ownerOf = (c) =>
  c.accountableOwner ?? c.assignee ?? c.assigneeName ?? c.owner ?? (c.assignees?.length ? c.assignees : null);
// The newest thread message that carries a prefix, so a short acknowledgment posted last hides nothing.
const latestWith = (c, prefix) =>
  [...c.messages].reverse().map(textOf).find((t) => new RegExp(`^\\s*${prefix}:`, 'im').test(t)) ?? '';
const streamsOf = (c) => (c.labels ?? []).filter((l) => /^(stream|workstream):/.test(String(l)));

async function runHealth() {
  let board;
  try {
    board = await loadBoard();
  } catch (e) {
    console.error(`Health check could not read the board: ${e.message}`);
    process.exit(1);
  }
  const now = Date.now();
  const findings = [];
  const add = (type, c, detail) => findings.push({ type, id: idOf(c), title: c.title, detail });
  const dupes = new Map();
  for (const c of board.cards.filter((x) => !x.archived)) {
    const terminal = c.status === TERMINAL;
    const touched = Math.max(Date.parse(c.updatedAt) || 0, Date.parse(c.messages[c.messages.length - 1]?.createdAt) || 0);
    if (c.messagesIncomplete) add('thread_unreadable', c, 'thread not fully read; findings for this card may be wrong');
    if (!known(c.status)) add('unclassified_status', c, `status "${c.status}" not in BOARD_STATUSES`);
    if (terminal) {
      if (!c.messages.some((m) => /^\s*Proof:/im.test(textOf(m)))) add('done_without_proof', c, 'no thread message has a Proof: line');
      continue;
    }
    const streams = streamsOf(c);
    if (streams.length !== 1) add('unclassified_stream', c, streams.length ? `conflicting: ${streams.join(', ')}` : 'no stream: label');
    if (c.status !== STATUSES[0] && touched && now - touched > STALE_HOURS * 3600e3)
      add('stale', c, `no update for ${Math.round((now - touched) / 3600e3)} h`);
    if (!ownerOf(c) && !has(/^\s*Owner:\s*\S/im, latestWith(c, 'Owner'))) add('no_owner', c, 'no owner field and no Owner: line');
    if (!c.nextAction && !has(/^\s*Next:\s*\S/im, latestWith(c, 'Next'), c.description))
      add('no_next_action', c, 'no nextAction field and no Next: line');
    const due = dueOf(c);
    if (!due && !has(/^\s*Due:\s*\S/im, latestWith(c, 'Due'))) add('no_due', c, 'no due date and no Due: line');
    if (due && Date.parse(due) < now) add('overdue', c, `due ${day(due)}`);
    if ((c.labels ?? []).includes('uncertain') || /\bUNCERTAIN\b/.test(latestWith(c, 'Changed')))
      add('uncertain_action', c, 'an action awaits reconciliation');
    const key = `${streams[0] ?? '-'}|${String(c.title).toLowerCase().replace(/\W+/g, ' ').trim()}`;
    dupes.set(key, [...(dupes.get(key) ?? []), c]);
  }
  for (const group of dupes.values())
    if (group.length > 1) for (const c of group) add('duplicate', c, `${group.length} active cards share this title and stream`);

  const stats = { redactions: 0 };
  const report = redactDeep(
    { checkedAt: new Date().toISOString(), staleHours: STALE_HOURS, incomplete: board.errors.length > 0,
      errors: board.errors, warnings: board.warnings, findings },
    stats,
  );
  const counts = findings.reduce((m, f) => ({ ...m, [f.type]: (m[f.type] ?? 0) + 1 }), {});
  let md = `# Board health\n\nChecked ${report.checkedAt}. ${findings.length} finding(s).\n\n`;
  if (report.incomplete) md += `**INCOMPLETE read:** ${board.errors.length} error(s).\n\n`;
  for (const [type, n] of Object.entries(counts)) md += `- ${type}: ${n}\n`;
  md += '\n';
  for (const f of report.findings) md += `- **${f.type}** · ${f.title} (${f.id}): ${f.detail}\n`;
  writePrivate('health.json', JSON.stringify(report, null, 2));
  writePrivate('health.md', md);
  if (argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  console.error(`Health: ${findings.length} finding(s) ${JSON.stringify(counts)}; wrote ${OUT}/health.json and health.md.`);
  process.exit(board.errors.length ? 1 : findings.length ? 4 : 0);
}

// ---------- post: write, then read back; never retried with a fresh id ----------
const uuidFromHash = (h) =>
  `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;

// Match on the idempotency field. Text matching is a weaker fallback, used only for messages with no id field.
async function findInThread(cardId, id, body) {
  const { messages } = await loadThread({ id: cardId });
  const byId = messages.find((m) => m[MSG_ID_FIELD] === id);
  if (byId) return { found: byId, weak: false };
  const byText = messages.find((m) => m[MSG_ID_FIELD] == null && textOf(m).trim() === body.trim());
  return byText ? { found: byText, weak: true } : null;
}
const verified = (hit, cardId, how) =>
  `Verified${how}: message ${idOf(hit.found) ?? '(no id)'} is on card ${cardId}` +
  (hit.weak ? ' (WEAK: matched by text; the server returned no client message id)' : '') + '.';

async function runPost() {
  const [cardId, file] = positional;
  if (!cardId || !file) {
    console.error('Usage: node export-board.mjs post <cardId> <file> [--id <uuid>]');
    process.exit(1);
  }
  const body = fs.readFileSync(file, 'utf8').trimEnd();
  if (!body) {
    console.error('Refusing to post an empty message.');
    process.exit(2);
  }
  if (redactString(body, POST_PATTERNS).count) {
    console.error(`Refusing to post: the message contains secret-shaped strings (keys, tokens, JWTs, passwords${REFUSE_IPS ? ', IPv4 addresses' : ''}). Point to where the secret lives instead.`);
    process.exit(2);
  }
  const bodySha = crypto.createHash('sha256').update(body).digest('hex');
  const sidecar = `${file}.pending.json`;
  const uncertain = (id, why) => {
    console.error(`UNCERTAIN: ${why}. clientMessageId=${id}. Re-run the same command to reconcile; it will not post a second copy.`);
    process.exit(3);
  };
  let id;
  if (fs.existsSync(sidecar)) {
    const pending = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
    if (pending.cardId !== cardId || pending.bodySha256 !== bodySha) {
      console.error(
        `${sidecar} holds an unreconciled post: card ${pending.cardId}, clientMessageId ${pending.clientMessageId}, ` +
          `body sha256 ${pending.bodySha256}. Re-run post with that card and the original body to reconcile ` +
          '(see README); delete the sidecar only after the thread is confirmed not to contain that id.',
      );
      process.exit(2);
    }
    id = pending.clientMessageId;
    try {
      const hit = await findInThread(cardId, id, body);
      if (hit) {
        fs.rmSync(sidecar);
        console.error(verified(hit, cardId, ' (reconciled)'));
        process.exit(0);
      }
    } catch (e) {
      uncertain(id, `could not read the thread to reconcile (${e.message})`);
    }
  } else {
    id = flag('--id') ?? uuidFromHash(crypto.createHash('sha256').update(`${cardId}\n${body}`).digest('hex'));
    fs.writeFileSync(sidecar, JSON.stringify({ cardId, clientMessageId: id, bodySha256: bodySha, createdAt: new Date().toISOString() }), { mode: 0o600 });
  }

  const p = MESSAGES.replace('{id}', encodeURIComponent(cardId));
  let res;
  let text;
  for (let attempt = 1; ; attempt++) {
    try {
      ({ res, text } = await send('POST', p, { [MSG_FIELD]: body, [MSG_ID_FIELD]: id }));
    } catch (e) {
      uncertain(id, `transport error (${e.name === 'TimeoutError' ? 'timeout' : e.message})`);
    }
    // Only an explicit rate limit is retried: the server did not commit, and the id is unchanged.
    if ((res.status === 429 || /rate limit/i.test(text)) && !res.ok && attempt < 5) {
      await sleep(retryAfterMs(res, attempt));
      continue;
    }
    break;
  }
  if (res.status >= 500 || res.status === 429) uncertain(id, `server answered ${res.status} ${text.slice(0, 200)}`);
  if (!res.ok) {
    if (res.status !== 409) fs.rmSync(sidecar);
    console.error(`REJECTED: ${res.status} ${text.slice(0, 300)}${res.status === 409 ? ' (same id, different payload: inspect the thread)' : ''}`);
    process.exit(2);
  }
  try {
    const hit = await findInThread(cardId, id, body);
    if (!hit) uncertain(id, 'accepted, but the message is not in the thread on read-back');
    fs.rmSync(sidecar);
    console.error(verified(hit, cardId, ''));
    process.exit(0);
  } catch (e) {
    uncertain(id, `accepted, but read-back failed (${e.message})`);
  }
}

await { export: runExport, health: runHealth, post: runPost }[COMMAND]();
