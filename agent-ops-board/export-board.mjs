#!/usr/bin/env node
// Export a task board (cards + message threads) to board.json and board.md.
// Read-only, paced, rate-limit aware. Node 18+, no dependencies.
//
//   BOARD_API_URL=https://your-admin.example.com/v1 BOARD_API_TOKEN=... node export-board.mjs --out ./board-export
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
const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 ? process.argv[outArg + 1] : './board-export';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const headers = { [AUTH]: AUTH === 'Authorization' ? `Bearer ${TOKEN}` : TOKEN };

// One request at a time, paced; back off on rate limits instead of hammering.
async function get(p) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    await sleep(DELAY);
    const res = await fetch(BASE + p, { headers, signal: AbortSignal.timeout(45_000) });
    const text = await res.text();
    if (res.ok) return JSON.parse(text);
    if (res.status === 429 || /rate limit/i.test(text)) {
      await sleep(20_000 * attempt);
      continue;
    }
    throw new Error(`GET ${p} -> ${res.status} ${text.slice(0, 200)}`);
  }
  throw new Error(`GET ${p}: still rate-limited, giving up`);
}

const list = (r) => (Array.isArray(r) ? r : r.tasks ?? r.items ?? r.data ?? []);
const idOf = (x) => x._id ?? x.id;

const seen = new Set();
const cards = [...list(await get(TASKS)), ...list(await get(`${TASKS}?${ARCHIVED}`))].filter(
  (c) => !seen.has(idOf(c)) && seen.add(idOf(c)),
);

for (const card of cards) {
  const messages = [];
  let before;
  for (let page = 0; page < 50; page++) {
    const q = `?limit=50${before ? `&before=${encodeURIComponent(before)}` : ''}`;
    const r = await get(MESSAGES.replace('{id}', encodeURIComponent(idOf(card))) + q);
    const batch = r.messages ?? r.items ?? r.data?.messages ?? (Array.isArray(r) ? r : []);
    messages.push(...batch);
    if (batch.length < 50) break;
    before = r.nextBefore ?? idOf(batch[batch.length - 1]);
  }
  card.messages = messages.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  process.stderr.write('.');
}

const rank = { in_progress: 0, todo: 1, review: 2, done: 3 };
cards.sort(
  (a, b) =>
    Number(!!a.archived) - Number(!!b.archived) ||
    (rank[a.status] ?? 9) - (rank[b.status] ?? 9) ||
    String(b.updatedAt).localeCompare(String(a.updatedAt)),
);

fs.mkdirSync(OUT, { recursive: true, mode: 0o700 });
fs.writeFileSync(path.join(OUT, 'board.json'), JSON.stringify(cards, null, 2), { mode: 0o600 });

const day = (v) => String(v ?? '').slice(0, 16).replace('T', ' ');
let md = `# Board export\n\nExported ${new Date().toISOString()}. ${cards.length} cards.\n\n`;
for (const c of cards) {
  md += `## ${c.title}\n\n`;
  md += `- Status: ${c.status}${c.archived ? ' (archived)' : ''} · Priority: ${c.priority ?? '-'} · Labels: ${(c.labels ?? []).join(', ') || '-'}\n`;
  md += `- Created: ${day(c.createdAt)} · Updated: ${day(c.updatedAt)} · Id: ${idOf(c)}\n\n`;
  md += `${c.description || '(no description)'}\n\n`;
  if (c.messages.length) {
    md += `### Thread (${c.messages.length})\n\n`;
    for (const m of c.messages) {
      const who = m.authorName ?? m.author ?? m.sender ?? '';
      md += `- **${day(m.createdAt)} ${who}**: ${String(m.text ?? m.body ?? '').replace(/\n/g, '\n  ')}\n`;
    }
    md += '\n';
  }
}
fs.writeFileSync(path.join(OUT, 'board.md'), md, { mode: 0o600 });
const total = cards.reduce((s, c) => s + c.messages.length, 0);
console.error(`\nWrote ${OUT}/board.json and board.md: ${cards.length} cards, ${total} messages.`);
