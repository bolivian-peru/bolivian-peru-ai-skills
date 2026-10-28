// Renders the repo and per-skill social preview images (1280x640) from template.html with headless Chrome.
// Usage: node assets/og/build.mjs   (run from the repo root; set CHROME to override the browser path)
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const template = readFileSync('assets/og/template.html', 'utf8');
const skills = JSON.parse(readFileSync('assets/og/skills.json', 'utf8'));
const work = mkdtempSync(join(tmpdir(), 'og-'));

for (const s of skills) {
  const html = template
    .replace('{{kicker}}', s.kicker).replace('{{title}}', s.title).replace('{{sub}}', s.sub)
    .replace('{{chips}}', s.chips.map(c => `<span class="chip">${c}</span>`).join(''))
    .replace('{{path}}', s.slug ? `/${s.slug}` : '');
  const page = join(work, `${s.slug || 'repo'}.html`);
  writeFileSync(page, html);
  const out = s.out || `${s.slug}/assets/og.png`;
  execFileSync('mkdir', ['-p', out.slice(0, out.lastIndexOf('/'))]);
  execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--virtual-time-budget=4000',
    '--window-size=1280,640', `--screenshot=${join(process.cwd(), out)}`, `file://${page}`], { stdio: 'ignore' });
  console.log(out);
}

// Share pages for GitHub Pages (docs/): GitHub folder links always show the repo-wide preview, so each skill gets
// its own small page whose og:image is that skill's card. Images are served from the repo via raw.githubusercontent.com.
const RAW = 'https://raw.githubusercontent.com/bolivian-peru/bolivian-peru-ai-skills/main';
const REPO = 'https://github.com/bolivian-peru/bolivian-peru-ai-skills';
const SITE = 'https://bolivian-peru.github.io/bolivian-peru-ai-skills';
const text = html => html.replace(/<br\/>/g, ' ').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');
const esc = value => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const page = (s, links) => {
  const title = s.slug ? `${text(s.title)} · bolivian-peru AI skills` : 'bolivian-peru AI skills';
  const desc = text(s.sub), img = `${RAW}/${s.out || `${s.slug}/assets/og.png`}`;
  const url = `${SITE}/${s.slug ? `${s.slug}/` : ''}`, repo = s.slug ? `${REPO}/tree/main/${s.slug}` : REPO;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website"><meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${img}"><meta property="og:image:width" content="1280"><meta property="og:image:height" content="640">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${img}">
<style>body{margin:0;background:#05070d;color:#c5d2e6;font:16px/1.6 ui-monospace,Menlo,monospace;padding:32px max(16px,env(safe-area-inset-left))}
main{max-width:860px;margin:0 auto}img{width:100%;border-radius:10px;border:1px solid #1c2638}a{color:#39c5cf}
.btn{display:inline-block;margin:20px 12px 0 0;padding:10px 18px;border:1px solid #39c5cf;border-radius:8px;text-decoration:none}
ul{padding-left:1.2em}</style></head>
<body><main><img src="${img}" alt="${esc(title)}"><p>${esc(desc)}</p>
<a class="btn" href="${repo}">Open on GitHub</a>${s.slug ? `<a class="btn" href="${repo}/SKILL.md">Read SKILL.md</a>` : ''}
${links}</main></body></html>
`;
};
const list = `<ul>${skills.filter(s => s.slug).map(s => `<li><a href="${SITE}/${s.slug}/">${text(s.title)}</a>: ${esc(text(s.sub))}</li>`).join('')}</ul>`;
for (const s of skills) {
  const dir = s.slug ? `docs/${s.slug}` : 'docs';
  execFileSync('mkdir', ['-p', dir]);
  writeFileSync(`${dir}/index.html`, page(s, s.slug ? '' : list));
  console.log(`${dir}/index.html`);
}
writeFileSync('docs/.nojekyll', '');
