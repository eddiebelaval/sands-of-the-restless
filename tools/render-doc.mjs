#!/usr/bin/env node
// render-doc.mjs
//
// Renders a markdown doc from docs/ into a self-contained reading surface.
//
//   node tools/render-doc.mjs [input.md] [output.html]
//
// Defaults: docs/NARRATIVE.md -> docs/NARRATIVE.html
//
// No dependencies, no network, no CDN. The output HTML embeds all CSS and JS.
// The markdown subset handled is exactly what the docs/ files use: headings,
// paragraphs, bold, italic, inline code, fenced code, blockquotes, tables,
// horizontal rules, bullet and numbered lists, links.
//
// The point of this script is fidelity. Nothing here rewrites, summarises or
// reorders source text. Every word in the markdown reaches the HTML.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// ---------------------------------------------------------------------------
// claim markers
// ---------------------------------------------------------------------------

// A marker blockquote opens a paragraph with a bolded tag. Families drive the
// visual treatment; the label is what the chip prints.
const MARKERS = [
  { key: 'WORLD BOUNDARY', family: 'boundary', label: 'WORLD BOUNDARY' },
  { key: 'FIXED', family: 'fixed', label: 'FIXED' },
  { key: 'LOCKED', family: 'fixed', label: 'LOCKED' },
  { key: 'OPEN', family: 'open', label: 'OPEN' },
  { key: 'PROPOSAL', family: 'proposal', label: 'PROPOSAL' },
  { key: 'RECOMMENDATION', family: 'proposal', label: 'RECOMMENDATION' },
  { key: 'REVISED', family: 'revised', label: 'REVISED' },
];

// Detects a marker at the start of a blockquote paragraph: **TAG...**
function matchMarker(line) {
  if (!line.startsWith('**')) return null;
  const rest = line.slice(2);
  for (const m of MARKERS) {
    if (rest.startsWith(m.key)) {
      const next = rest.charAt(m.key.length);
      // Tag must end at a word boundary so FIXEDLY would not match FIXED.
      if (next === '' || !/[A-Za-z0-9]/.test(next)) return m;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// inline rendering
// ---------------------------------------------------------------------------

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Inline code is pulled out before anything else so its contents are never
// treated as emphasis or links.
function inline(src) {
  const code = [];
  let s = src.replace(/`([^`\n]+)`/g, (_, c) => {
    code.push(c);
    return '\u0000' + (code.length - 1) + '\u0000';
  });

  s = escapeHtml(s);

  // links: [text](url) with optional "title"
  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)(?:\s+&quot;([^)]*)&quot;)?\)/g, (_, text, href, title) => {
    const t = title ? ` title="${title}"` : '';
    const ext = /^[a-z][a-z0-9+.-]*:/i.test(href) ? ' rel="noreferrer"' : '';
    return `<a href="${href}"${t}${ext}>${text}</a>`;
  });

  // bold, allowed to span soft-wrapped lines
  s = s.replace(/\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*/g, '<strong>$1</strong>');

  // italic: single asterisk or underscore, no empty spans
  s = s.replace(/(^|[^*\w])\*(?=\S)([^*]+?)(?<=\S)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_\w])_(?=\S)([^_]+?)(?<=\S)_(?![_\w])/g, '$1<em>$2</em>');

  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${escapeHtml(code[Number(i)])}</code>`);
  return s;
}

// Plain text of a markdown fragment, for the decisions panel and the TOC.
function plain(src) {
  return src
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\[([^\]\n]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/(^|[^*\w])\*([^*]+?)\*/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

function slug(text) {
  return plain(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'section';
}

// ---------------------------------------------------------------------------
// block rendering
// ---------------------------------------------------------------------------

const RE_HEADING = /^(#{1,6})\s+(.*)$/;
const RE_HR = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const RE_FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w-]*)\s*$/;
const RE_BULLET = /^(\s*)([-*+])\s+(.*)$/;
const RE_ORDERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const RE_TABLE_DELIM = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

function isBlank(line) {
  return line.trim() === '';
}

function listMatch(line) {
  const b = RE_BULLET.exec(line);
  if (b) return { indent: b[1].length, ordered: false, start: 1, content: b[3] };
  const o = RE_ORDERED.exec(line);
  if (o) return { indent: o[1].length, ordered: true, start: Number(o[2]), content: o[3] };
  return null;
}

function isTableRow(line) {
  return line.trim().startsWith('|');
}

// A list never breaks a paragraph that is already running: it may only begin
// after a blank line.
//
// These docs are hand wrapped at column 80, so a continuation line lands on
// "3. It is also where..." (the tail of "...in World 3.") or "+ 0 walls**."
// often enough to matter. Reading one of those as a list marker swallows the
// number, splits the paragraph, and strands the bold delimiters on either side,
// which is a silent hole in the middle of a sentence. Across every file in
// docs/ there is not one real list that starts without a blank line above it,
// so requiring the blank line costs nothing and closes the whole failure mode.
function interruptsParagraph() {
  return false;
}

// ctx carries document-wide state: heading list, marker list, id counters.
function renderBlocks(lines, ctx, opts = {}) {
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (isBlank(line)) { i++; continue; }

    // fenced code
    const fence = RE_FENCE.exec(line);
    if (fence) {
      const marker = fence[1];
      const lang = fence[2];
      const body = [];
      i++;
      while (i < lines.length) {
        const close = RE_FENCE.exec(lines[i]);
        if (close && close[1][0] === marker[0] && close[1].length >= marker.length) { i++; break; }
        body.push(lines[i]);
        i++;
      }
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
      out.push(`<div class="scrollbox"><pre><code${cls}>${escapeHtml(body.join('\n'))}</code></pre></div>`);
      continue;
    }

    // heading
    const h = RE_HEADING.exec(line);
    if (h) {
      const level = h[1].length;
      const text = h[2].trim().replace(/\s+#+\s*$/, '');
      let id = slug(text);
      let n = 2;
      while (ctx.usedIds.has(id)) id = `${slug(text)}-${n++}`;
      ctx.usedIds.add(id);
      ctx.headings.push({ level, id, text: plain(text) });
      ctx.currentSection = plain(text);
      out.push(`<h${level} id="${id}">${inline(text)}<a class="anchor" href="#${id}" aria-label="link to this section">#</a></h${level}>`);
      i++;
      continue;
    }

    // horizontal rule. A line of dashes directly under a paragraph is a setext
    // heading in strict markdown, but these docs only ever use --- as a rule,
    // and every one of them sits on its own with blank lines around it.
    if (RE_HR.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    // blockquote
    if (line.startsWith('>')) {
      const raw = [];
      while (i < lines.length && lines[i].startsWith('>')) {
        raw.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push(renderQuote(raw, ctx));
      continue;
    }

    // table
    if (isTableRow(line) && i + 1 < lines.length && RE_TABLE_DELIM.test(lines[i + 1]) && isTableRow(lines[i + 1])) {
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) { rows.push(lines[i]); i++; }
      out.push(renderTable(rows, opts));
      continue;
    }

    // list
    const lm = listMatch(line);
    if (lm) {
      const block = [];
      const baseIndent = lm.indent;
      while (i < lines.length) {
        const cur = lines[i];
        if (isBlank(cur)) {
          // A blank line continues the list only if what follows is indented
          // or is another item at the same level.
          const nxt = lines[i + 1];
          if (nxt === undefined) break;
          const nm = listMatch(nxt);
          const indented = /^\s+\S/.test(nxt) && (nxt.length - nxt.trimStart().length) > baseIndent;
          if (!(nm && nm.indent === baseIndent) && !indented) break;
          block.push('');
          i++;
          continue;
        }
        const cm = listMatch(cur);
        if (cm && cm.indent < baseIndent) break;
        if (!cm) {
          const ind = cur.length - cur.trimStart().length;
          // lazy continuation of the current item, or a nested indented block
          if (ind <= baseIndent && (RE_HEADING.test(cur) || cur.startsWith('>') || RE_HR.test(cur) || RE_FENCE.test(cur))) break;
        }
        block.push(cur);
        i++;
      }
      out.push(renderList(block, baseIndent, lm, ctx, opts));
      continue;
    }

    // paragraph
    const para = [];
    while (i < lines.length && !isBlank(lines[i])) {
      const cur = lines[i];
      if (para.length && (RE_HEADING.test(cur) || cur.startsWith('>') || RE_HR.test(cur) || RE_FENCE.test(cur) || interruptsParagraph(cur))) break;
      para.push(cur);
      i++;
    }
    if (para.length) out.push(`<p>${inline(para.join('\n'))}</p>`);
  }

  return out.join('\n');
}

function renderList(block, baseIndent, first, ctx, opts) {
  // Split the gathered block into items at markers sitting on the base indent.
  const items = [];
  let cur = null;
  for (const line of block) {
    const m = listMatch(line);
    if (m && m.indent === baseIndent) {
      if (cur) items.push(cur);
      cur = [m.content];
    } else if (cur) {
      cur.push(line.slice(Math.min(line.length - line.trimStart().length, baseIndent + 2)));
    }
  }
  if (cur) items.push(cur);

  const loose = block.some(isBlank);

  const rendered = items.map((item) => {
    const html = renderBlocks(item, ctx, opts);
    if (!loose) {
      // Tight items drop the paragraph wrapper when there is only one.
      const only = /^<p>([\s\S]*)<\/p>$/.exec(html.trim());
      if (only && !/<p>/.test(only[1])) return `<li>${only[1]}</li>`;
    }
    return `<li>${html}</li>`;
  }).join('\n');

  if (first.ordered) {
    const startAttr = first.start !== 1 ? ` start="${first.start}"` : '';
    return `<ol${startAttr}>\n${rendered}\n</ol>`;
  }
  return `<ul>\n${rendered}\n</ul>`;
}

function splitRow(row) {
  let s = row.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

function renderTable(rows, opts) {
  const header = splitRow(rows[0]);
  const aligns = splitRow(rows[1]).map((c) => {
    const left = c.startsWith(':');
    const right = c.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    return '';
  });
  const body = rows.slice(2).map(splitRow);

  const hasHeader = header.some((c) => c !== '');
  const cell = (tag, text, idx) => {
    const a = aligns[idx] ? ` style="text-align:${aligns[idx]}"` : '';
    return `<${tag}${a}>${inline(text)}</${tag}>`;
  };

  const thead = hasHeader
    ? `<thead><tr>${header.map((c, n) => cell('th', c, n)).join('')}</tr></thead>`
    : '';
  const tbody = `<tbody>${body.map((r) => `<tr>${r.map((c, n) => cell('td', c, n)).join('')}</tr>`).join('')}</tbody>`;

  const cls = hasHeader ? 'tbl' : 'tbl tbl-plain';
  const wrapCls = opts.inQuote ? 'scrollbox' : 'scrollbox tablewide';
  return `<div class="${wrapCls}"><table class="${cls}">${thead}${tbody}</table></div>`;
}

// A blockquote is one or more marker segments. A new segment begins at any
// paragraph that opens with a recognised bold tag, which is how nested markers
// like an OPEN sitting inside a FIXED quote get their own callout.
function renderQuote(raw, ctx) {
  const starts = [];
  for (let n = 0; n < raw.length; n++) {
    const atParaStart = n === 0 || isBlank(raw[n - 1]);
    if (!atParaStart) continue;
    const m = matchMarker(raw[n].trim());
    if (m) starts.push({ index: n, marker: m });
  }

  if (starts.length === 0) return callout(raw, null, ctx);

  const pieces = [];
  if (starts[0].index > 0) {
    const lead = raw.slice(0, starts[0].index);
    if (lead.some((l) => !isBlank(l))) pieces.push(callout(lead, null, ctx));
  }
  for (let n = 0; n < starts.length; n++) {
    const from = starts[n].index;
    const to = n + 1 < starts.length ? starts[n + 1].index : raw.length;
    pieces.push(callout(raw.slice(from, to), starts[n].marker, ctx));
  }
  return pieces.join('\n');
}

function callout(lines, marker, ctx) {
  const body = renderBlocks(lines, ctx, { inQuote: true });
  const text = plain(lines.join('\n'));

  if (marker && marker.family === 'boundary') {
    const id = `boundary-${++ctx.boundaryCount}`;
    ctx.boundaries.push({ id, text });
    // The title line is the bolded opener; everything after it is the body.
    return `<section class="boundary" id="${id}" data-marker="boundary">
<div class="boundary-rule" aria-hidden="true"></div>
<div class="boundary-inner">${body}</div>
<div class="boundary-rule" aria-hidden="true"></div>
</section>`;
  }

  if (!marker) {
    // Untagged quotes: a bare line of dialogue reads as a voice, anything else
    // is an unlabelled note.
    const isVoice = /^["“]/.test(text) && lines.filter((l) => !isBlank(l)).length <= 3;
    const cls = isVoice ? 'voice' : 'callout callout-note';
    return `<aside class="${cls}">${body}</aside>`;
  }

  const id = `m-${++ctx.markerCount}`;
  ctx.markers.push({
    id,
    family: marker.family,
    label: marker.label,
    section: ctx.currentSection,
    text,
  });

  return `<aside class="callout callout-${marker.family}" id="${id}" data-marker="${marker.family}">
<span class="chip chip-${marker.family}">${marker.label}</span>
<div class="callout-body">${body}</div>
</aside>`;
}

// ---------------------------------------------------------------------------
// page chrome
// ---------------------------------------------------------------------------

function decisionsPanel(markers, headings) {
  const open = markers.filter((m) => m.family === 'open');
  const proposal = markers.filter((m) => m.family === 'proposal');
  // Sections the document itself names as decisions, picked up from headings
  // rather than listed by hand.
  const decisionSections = headings.filter((h) => /decision/i.test(h.text));

  const row = (m) => {
    // Trim the summary to something scannable without changing any wording.
    let t = m.text;
    if (t.length > 190) {
      // trim to a whole word, and do not stack an ellipsis onto punctuation
      // the source already ended with
      t = t.slice(0, 190).replace(/\s+\S*$/, '').replace(/[.,;:\s]+$/, '') + '...';
    }
    return `<a class="d-row d-${m.family}" href="#${m.id}">
<span class="chip chip-${m.family}">${m.label}</span>
<span class="d-text"><span class="d-section">${escapeHtml(m.section || '')}</span>${escapeHtml(t)}</span>
</a>`;
  };

  return `<details class="decisions" id="decisions">
<summary><span class="d-title">Decisions waiting on you</span> <span class="d-counts">${open.length} open, ${proposal.length} proposals</span></summary>
<div class="d-body">
<p class="d-note">Every OPEN and every PROPOSAL in the document, in the order they appear. Read the story first. These are here so you can go straight back to what needs your call.</p>
<div class="d-group"><h3 class="d-h">Open, genuinely undecided (${open.length})</h3>${open.map(row).join('\n')}</div>
<div class="d-group"><h3 class="d-h">Proposals, overrule at no cost (${proposal.length})</h3>${proposal.map(row).join('\n')}</div>
${decisionSections.length ? `<div class="d-group"><h3 class="d-h">Sections the document names as decisions (${decisionSections.length})</h3>${decisionSections.map((h) => `<a class="d-row d-section-link" href="#${h.id}"><span class="d-text">${escapeHtml(h.text)}</span></a>`).join('\n')}</div>` : ''}
</div>
</details>`;
}

function tocMarkup(headings) {
  const items = headings.filter((h) => h.level <= 2).map((h) =>
    `<li class="toc-l${h.level}"><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`
  ).join('\n');
  return `<nav class="toc" id="toc" aria-label="Table of contents">
<button class="toc-toggle" id="toc-toggle" aria-expanded="false" aria-controls="toc-list">Contents</button>
<ol class="toc-list" id="toc-list">${items}</ol>
</nav>`;
}

const BANNER = `<div class="banner" role="note">
<span class="banner-tag">Two names settled 2026-08-01</span>
<p>The queen is <strong>HETEPHERES</strong>, and the pre-Egyptian builders of the gate are <strong>THE ANCIENTS</strong>. Both are locked and applied throughout. The Ancients are called that in fiction because no one can read their writing, so no one knows what they called themselves: the name is an admission of ignorance rather than a label.</p>
<p class="banner-note">The two story-meeting transcripts are left alone. They record what was said in the room, and the words said there were different.</p>
</div>`;

const CSS = `
*, *::before, *::after { box-sizing: border-box; }

:root {
  color-scheme: dark light;

  --measure: 37rem;
  --pad: 1.5rem;

  --serif: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, "Times New Roman", serif;
  --sans: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;

  /* dark is the considered one: lamp black, warm sand, old stone */
  --bg: #100d0a;
  --bg-sunk: #0a0806;
  --bg-raise: #191510;
  --text: #e6dcca;
  --text-dim: #ab9f8b;
  --text-faint: #7d7364;
  --rule: #2b241b;
  --rule-soft: #201a14;

  --stone: #9b9078;
  --sand: #c9a86a;
  --ember: #e08b3c;
  --ember-deep: #7a4416;
  --verdigris: #78a292;

  --shadow: 0 1px 0 rgba(255,255,255,.03);
}

@media (prefers-color-scheme: light) {
  :root {
    --bg: #f4ecdd;
    --bg-sunk: #eae0cd;
    --bg-raise: #fbf6ec;
    --text: #241d15;
    --text-dim: #574b3b;
    --text-faint: #7d7060;
    --rule: #ded2bb;
    --rule-soft: #e7ddc9;

    --stone: #6f6552;
    --sand: #8a6524;
    --ember: #a9531a;
    --ember-deep: #f0d9bf;
    --verdigris: #3c6a59;

    --shadow: 0 1px 0 rgba(0,0,0,.03);
  }
}

html { -webkit-text-size-adjust: 100%; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--serif);
  font-size: 1.1875rem;
  line-height: 1.65;
  overflow-x: hidden;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  font-kerning: normal;
}

/* ---------- reading progress ---------- */

.progress {
  position: fixed;
  top: 0; left: 0;
  height: 2px;
  width: 0;
  background: linear-gradient(90deg, var(--ember-deep), var(--sand));
  z-index: 60;
  transition: width .08s linear;
  pointer-events: none;
}

/* ---------- document grid ---------- */

.doc {
  display: grid;
  grid-template-columns:
    1fr
    min(var(--measure), 100% - (var(--pad) * 2))
    1fr;
  padding: 3.5rem 0 8rem;
}
.doc > * { grid-column: 2; }
.doc > .boundary,
.doc > .tablewide { grid-column: 1 / -1; }

/* ---------- prose ---------- */

p { margin: 0 0 1.35em; hanging-punctuation: first last; }

h1, h2, h3 {
  font-family: var(--sans);
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.01em;
  position: relative;
}

h1 {
  font-size: 1.5rem;
  letter-spacing: .04em;
  text-transform: uppercase;
  margin: 4rem 0 1.75rem;
  padding-bottom: .6rem;
  border-bottom: 1px solid var(--rule);
  color: var(--text);
}
.doc > h1:first-of-type { margin-top: 0; }

h2 {
  font-size: 1.0625rem;
  letter-spacing: .02em;
  margin: 2.75rem 0 1rem;
  color: var(--sand);
}

h3 { font-size: .9375rem; margin: 2rem 0 .75rem; color: var(--text-dim); }

.anchor {
  position: absolute;
  margin-left: .4em;
  color: var(--text-faint);
  text-decoration: none;
  opacity: 0;
  font-weight: 400;
  transition: opacity .15s;
}
h1:hover .anchor, h2:hover .anchor, h3:hover .anchor { opacity: .5; }

a { color: var(--sand); text-underline-offset: 2px; }

strong { font-weight: 600; color: var(--text); }
em { font-style: italic; }

code {
  font-family: var(--mono);
  font-size: .82em;
  background: var(--bg-sunk);
  border: 1px solid var(--rule-soft);
  border-radius: 3px;
  padding: .08em .32em;
  color: var(--text-dim);
  word-break: break-word;
}

pre {
  margin: 0;
  padding: 1rem 1.15rem;
  font-family: var(--mono);
  font-size: .82rem;
  line-height: 1.55;
  letter-spacing: .06em;
  color: var(--sand);
  background: var(--bg-sunk);
  border: 1px solid var(--rule);
  border-radius: 3px;
  text-align: center;
}
pre code { background: none; border: 0; padding: 0; font-size: inherit; color: inherit; }

hr {
  border: 0;
  height: 1px;
  background: var(--rule);
  margin: 3rem 0;
}

ul, ol { margin: 0 0 1.35em; padding-left: 1.4em; }
li { margin-bottom: .5em; }
li::marker { color: var(--text-faint); }

.scrollbox { overflow-x: auto; -webkit-overflow-scrolling: touch; max-width: 100%; margin: 0 0 1.5em; }
.tablewide { padding: 0 var(--pad); margin: 2rem 0 2.5rem; }

table { border-collapse: collapse; font-family: var(--sans); font-size: .875rem; line-height: 1.5; }
.tablewide table { margin: 0 auto; max-width: 60rem; }
th, td {
  text-align: left;
  vertical-align: top;
  padding: .6rem .85rem;
  border-bottom: 1px solid var(--rule);
}
th { color: var(--sand); font-weight: 600; font-size: .75rem; text-transform: uppercase; letter-spacing: .08em; }
td { color: var(--text-dim); }
td strong { color: var(--text); }
.tbl-plain td:first-child { color: var(--text); white-space: nowrap; }

/* ---------- banner ---------- */

.banner {
  margin: 0 0 3rem;
  padding: 1.15rem 1.25rem;
  background: var(--bg-raise);
  border: 1px solid var(--rule);
  border-top: 3px solid var(--sand);
  border-radius: 2px;
  font-family: var(--sans);
  font-size: .9375rem;
  line-height: 1.55;
  color: var(--text-dim);
}
.banner p { margin: 0; }
/* The second line of the banner is a footnote to the first, not a peer of it:
   the names are the news, the transcript caveat is the provenance. Separated by
   a rule rather than by a blank line so it cannot be mistaken for more news. */
.banner-note {
  margin-top: .8rem !important;
  padding-top: .7rem;
  border-top: 1px solid var(--rule);
  font-size: .875rem;
  opacity: .8;
}
.banner-tag {
  display: block;
  font-size: .6875rem;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: var(--sand);
  margin-bottom: .5rem;
  font-weight: 600;
}
.banner strong { color: var(--text); letter-spacing: .03em; }

/* ---------- decisions panel ---------- */

.decisions {
  margin: 0 0 3.5rem;
  border: 1px solid var(--rule);
  border-radius: 2px;
  background: var(--bg-sunk);
  font-family: var(--sans);
}
.decisions > summary {
  cursor: pointer;
  padding: .85rem 1.1rem;
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: .5rem .75rem;
  align-items: baseline;
  font-size: .8125rem;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--text-dim);
}
.decisions > summary::-webkit-details-marker { display: none; }
.decisions > summary::before {
  content: "+";
  font-family: var(--mono);
  color: var(--ember);
  margin-right: .1rem;
}
.decisions[open] > summary::before { content: "\\2212"; }
.d-title { font-weight: 600; color: var(--text); }
.d-counts { color: var(--ember); }
.d-body { padding: 0 1.1rem 1.1rem; }
.d-note { font-size: .8125rem; line-height: 1.5; color: var(--text-faint); margin: 0 0 1.25rem; }
.d-group + .d-group { margin-top: 1.5rem; }
.d-h {
  font-size: .6875rem;
  letter-spacing: .12em;
  text-transform: uppercase;
  color: var(--text-faint);
  margin: 0 0 .6rem;
  padding-bottom: .4rem;
  border-bottom: 1px solid var(--rule-soft);
}
.d-row {
  display: flex;
  gap: .7rem;
  align-items: flex-start;
  padding: .55rem .5rem .55rem .25rem;
  margin: 0 -.25rem;
  border-radius: 2px;
  text-decoration: none;
  color: var(--text-dim);
  font-size: .8125rem;
  line-height: 1.5;
}
.d-row:hover { background: var(--bg-raise); color: var(--text); }
.d-row .chip { flex: 0 0 auto; margin: .1rem 0 0; }
.d-text { min-width: 0; }
.d-section {
  display: block;
  font-size: .6875rem;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--text-faint);
  margin-bottom: .15rem;
}

/* ---------- callouts ---------- */

.callout {
  font-family: var(--sans);
  font-size: .875rem;
  line-height: 1.6;
  color: var(--text-dim);
  margin: 1.9em 0;
  padding: .1rem 0 .1rem 1.15rem;
  border-left: 2px solid var(--rule);
  scroll-margin-top: 3rem;
}
.callout + .callout { margin-top: -.9em; }
.callout p { margin: 0 0 .8em; }
.callout p:last-child { margin-bottom: 0; }
.callout ul, .callout ol { margin-bottom: .8em; }
.callout strong { color: var(--text); }
.callout .scrollbox { margin-bottom: .8em; }
.callout table { font-size: .8125rem; }

.chip {
  display: inline-block;
  font-family: var(--sans);
  font-size: .625rem;
  font-weight: 700;
  letter-spacing: .14em;
  text-transform: uppercase;
  padding: .2rem .45rem;
  border-radius: 2px;
  margin-bottom: .55rem;
  border: 1px solid transparent;
  white-space: nowrap;
}

/* FIXED: settled and quiet. Solid stone rule, hollow chip, lowest contrast. */
.callout-fixed { border-left-color: color-mix(in srgb, var(--stone) 45%, transparent); }
.chip-fixed { color: var(--stone); border-color: color-mix(in srgb, var(--stone) 35%, transparent); }

/* PROPOSAL: provisional. Dashed rule, sand chip. Reads as not yet set. */
.callout-proposal {
  border-left-style: dashed;
  border-left-color: color-mix(in srgb, var(--sand) 55%, transparent);
}
.chip-proposal { color: var(--sand); border-color: color-mix(in srgb, var(--sand) 40%, transparent); }

/* OPEN: wants something from the reader. Thickest rule, filled chip, tinted. */
.callout-open {
  border-left-width: 4px;
  border-left-color: var(--ember);
  background: color-mix(in srgb, var(--ember) 7%, transparent);
  padding: .85rem 1rem .85rem 1.1rem;
  border-radius: 0 3px 3px 0;
  color: var(--text);
}
.chip-open { color: var(--bg); background: var(--ember); border-color: var(--ember); }

/* REVISED: a correction. A doubled verdigris rule reads as struck and restated,
   distinct at a glance from the single rules the other three carry. */
.callout-revised {
  border-left-style: double;
  border-left-width: 5px;
  border-left-color: var(--verdigris);
  padding-left: 1rem;
}
.chip-revised { color: var(--verdigris); border-color: color-mix(in srgb, var(--verdigris) 45%, transparent); }

.callout-note { border-left-color: var(--rule); }

/* a bare line of dialogue */
.voice {
  margin: 2em 0;
  padding: 0 0 0 1.15rem;
  border-left: 2px solid color-mix(in srgb, var(--sand) 30%, transparent);
  font-family: var(--serif);
  font-size: 1.0625rem;
  font-style: italic;
  color: var(--text-dim);
}
.voice p { margin: 0; }

/* ---------- world boundaries ---------- */

.boundary {
  margin: 4.5rem 0;
  padding: 0 var(--pad);
  background: linear-gradient(180deg, transparent, color-mix(in srgb, var(--sand) 6%, transparent) 50%, transparent);
  scroll-margin-top: 2rem;
}
.boundary-rule {
  height: 1px;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--sand) 60%, transparent) 20%, color-mix(in srgb, var(--sand) 60%, transparent) 80%, transparent);
}
.boundary-inner {
  max-width: 44rem;
  margin: 0 auto;
  padding: 1.75rem 0;
  font-family: var(--sans);
  font-size: .875rem;
  line-height: 1.6;
  color: var(--text-dim);
  text-align: center;
}
.boundary-inner p { margin: 0 0 .7em; }
.boundary-inner p:last-child { margin-bottom: 0; }
.boundary-inner p:first-child strong {
  display: block;
  font-size: .75rem;
  font-weight: 700;
  letter-spacing: .28em;
  text-transform: uppercase;
  color: var(--sand);
  margin-bottom: .6rem;
}

/* ---------- table of contents ---------- */

.toc {
  position: fixed;
  top: 0; left: 0;
  z-index: 50;
  font-family: var(--sans);
}
.toc-toggle {
  position: fixed;
  top: .75rem; left: .75rem;
  z-index: 51;
  font: inherit;
  font-size: .6875rem;
  letter-spacing: .12em;
  text-transform: uppercase;
  color: var(--text-faint);
  background: var(--bg-raise);
  border: 1px solid var(--rule);
  border-radius: 2px;
  padding: .4rem .7rem;
  cursor: pointer;
}
.toc-toggle:hover { color: var(--text); border-color: var(--stone); }
/* On a phone the toggle floats over the prose, so it steps out of the way
   while reading forward and comes back the moment you scroll up. */
.toc-toggle { transition: opacity .18s ease, transform .18s ease; }
.toc-toggle.tucked { opacity: 0; transform: translateY(-140%); pointer-events: none; }

.toc-list {
  position: fixed;
  top: 3rem;
  left: .75rem;
  width: 15rem;
  max-height: calc(100vh - 4.5rem);
  overflow-y: auto;
  margin: 0;
  padding: .75rem 0;
  list-style: none;
  background: var(--bg-raise);
  border: 1px solid var(--rule);
  border-radius: 2px;
  font-size: .75rem;
  line-height: 1.4;
  display: none;
}
.toc-list { scrollbar-width: none; }
.toc-list::-webkit-scrollbar { width: 0; height: 0; }
.toc.open .toc-list { display: block; }
.toc-list li { margin: 0; }
.toc-list a {
  display: block;
  padding: .3rem .9rem;
  color: var(--text-faint);
  text-decoration: none;
  border-left: 2px solid transparent;
}
.toc-list a:hover { color: var(--text); }
.toc-list a.active { color: var(--sand); border-left-color: var(--sand); }
.toc-l1 > a { color: var(--text-dim); letter-spacing: .06em; text-transform: uppercase; font-size: .6875rem; margin-top: .35rem; }
.toc-l2 > a { padding-left: 1.5rem; }

@media (min-width: 1180px) {
  .toc-toggle { display: none; }
  .toc-list {
    display: block;
    top: 3.5rem;
    left: max(1rem, calc(50vw - var(--measure) / 2 - 17.5rem));
    background: transparent;
    border: 0;
    border-left: 1px solid var(--rule);
    border-radius: 0;
    max-height: calc(100vh - 7rem);
    opacity: .55;
    transition: opacity .2s;
    padding: 0;
  }
  .toc-list:hover { opacity: 1; }
}

@media (max-width: 640px) {
  :root { --pad: 1.15rem; }
  body { font-size: 1.0625rem; line-height: 1.62; }
  .doc { padding: 3.25rem 0 5rem; }
  h1 { font-size: 1.25rem; }
  h2 { font-size: 1rem; }
  .boundary { margin: 3rem 0; }
  .boundary-inner { padding: 1.35rem 0; font-size: .8125rem; }
  .decisions > summary { font-size: .75rem; }
  .callout { font-size: .84375rem; }
}

@media print {
  .toc, .progress, .toc-toggle { display: none; }
  body { background: #fff; color: #000; }
}

@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; scroll-behavior: auto !important; }
}
`;

const JS = `
(function () {
  var bar = document.getElementById('progress');
  var toc = document.getElementById('toc');
  var toggle = document.getElementById('toc-toggle');
  toggle.addEventListener('click', function () {
    var open = toc.classList.toggle('open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  toc.addEventListener('click', function (e) {
    if (e.target.tagName === 'A' && window.innerWidth < 1180) {
      toc.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });

  // Active section is recomputed on every settled scroll frame rather than by
  // IntersectionObserver, which only reports elements whose state changed and
  // so goes stale after a long jump.
  var list = document.getElementById('toc-list');
  var links = {};
  var targets = [];
  Array.prototype.forEach.call(document.querySelectorAll('.toc-list a'), function (a) {
    var id = a.getAttribute('href').slice(1);
    links[id] = a;
    var el = document.getElementById(id);
    if (el) targets.push(el);
  });

  var current = null;
  function activeId() {
    var best = targets.length ? targets[0].id : null;
    for (var i = 0; i < targets.length; i++) {
      if (targets[i].getBoundingClientRect().top <= 120) best = targets[i].id;
      else break;
    }
    return best;
  }

  var ticking = false;
  var lastY = 0;
  function update() {
    ticking = false;

    var h = document.documentElement;
    var max = h.scrollHeight - h.clientHeight;
    var y = h.scrollTop || document.body.scrollTop;
    var pct = max > 0 ? y / max : 0;
    bar.style.width = (Math.min(1, Math.max(0, pct)) * 100).toFixed(2) + '%';

    // tuck the floating toggle away while reading forward
    if (!toc.classList.contains('open')) {
      if (y > 260 && y > lastY + 4) toggle.classList.add('tucked');
      else if (y < lastY - 4 || y <= 260) toggle.classList.remove('tucked');
    }
    lastY = y;

    var id = activeId();
    if (id && id !== current) {
      if (current && links[current]) links[current].classList.remove('active');
      current = id;
      var a = links[current];
      if (a) {
        a.classList.add('active');
        // keep the active entry visible inside the list without moving the page
        var lr = list.getBoundingClientRect();
        var ar = a.getBoundingClientRect();
        if (ar.top < lr.top) list.scrollTop -= (lr.top - ar.top) + 8;
        else if (ar.bottom > lr.bottom) list.scrollTop += (ar.bottom - lr.bottom) + 8;
      }
    }
  }

  window.addEventListener('scroll', function () {
    if (!ticking) { ticking = true; window.requestAnimationFrame(update); }
  }, { passive: true });
  window.addEventListener('resize', function () {
    if (!ticking) { ticking = true; window.requestAnimationFrame(update); }
  }, { passive: true });
  update();
})();
`;

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function render(markdown) {
  const lines = markdown.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const ctx = {
    headings: [],
    markers: [],
    boundaries: [],
    usedIds: new Set(),
    markerCount: 0,
    boundaryCount: 0,
    currentSection: '',
  };

  const body = renderBlocks(lines, ctx, {});
  const title = ctx.headings.length ? ctx.headings[0].text : 'Document';

  // Chrome is injected after the first h1 so the document opens with its own
  // title, then the banner and the decisions panel, then the story.
  const firstH1End = body.indexOf('</h1>');
  const chrome = '\n' + BANNER + '\n' + decisionsPanel(ctx.markers, ctx.headings) + '\n';
  const bodyWithChrome = firstH1End === -1
    ? chrome + body
    : body.slice(0, firstH1End + 5) + chrome + body.slice(firstH1End + 5);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="progress" id="progress" role="presentation"></div>
${tocMarkup(ctx.headings)}
<main class="doc" id="doc">
${bodyWithChrome}
</main>
<script>${JS}</script>
</body>
</html>
`;

  return { html, ctx };
}

function main() {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const inPath = path.resolve(root, process.argv[2] || 'docs/NARRATIVE.md');
  const outPath = path.resolve(
    root,
    process.argv[3] || path.join(path.dirname(inPath), path.basename(inPath).replace(/\.md$/i, '') + '.html')
  );

  if (!fs.existsSync(inPath)) {
    console.error('render-doc: input not found: ' + inPath);
    process.exit(1);
  }

  const md = fs.readFileSync(inPath, 'utf8');
  const { html, ctx } = render(md);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html, 'utf8');

  const tally = {};
  for (const m of ctx.markers) tally[m.family] = (tally[m.family] || 0) + 1;

  console.log('render-doc');
  console.log('  in       ' + inPath);
  console.log('  out      ' + outPath);
  console.log('  headings ' + ctx.headings.length);
  console.log('  markers  ' + ctx.markers.length +
    ' (fixed ' + (tally.fixed || 0) +
    ', proposal ' + (tally.proposal || 0) +
    ', revised ' + (tally.revised || 0) +
    ', open ' + (tally.open || 0) + ')');
  console.log('  worlds   ' + ctx.boundaries.length + ' boundary markers');
  console.log('  bytes    ' + html.length);
}

main();
