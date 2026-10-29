// What an agent reads while it works through a review store: builds stores of
// 10, 50 and 200 reviews (Markdown and PDF, mixed actions and requests), runs
// the real `pdf-next reviews` loop and counts the characters of every reply.
//
//   node tools/agent_cost.mjs [--bin path/to/pdf-next]   print the tables
//   node tools/agent_cost.mjs --check                    fail when a 50-review loop exceeds BUDGET
//
// Tokens are estimated two ways: characters / 3.5, and words × 4/3.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Characters an agent may read in one 50-review loop (36 open items), about
// 10% over what 0.17.0 prints. Before 0.17.0 the brief loop read 5 749 / 5 613.
const BUDGET = {
  'markdown brief': 5_600,
  'markdown next': 18_700,
  'pdf brief': 5_500,
  'pdf next': 14_300,
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const check = args.includes('--check');
const exe = process.platform === 'win32' ? '.exe' : '';
const bin = args.includes('--bin')
  ? args[args.indexOf('--bin') + 1]
  : ['debug', 'release'].map((profile) => join(root, 'src-tauri', 'target', profile, `pdf-next${exe}`)).find(existsSync);
if (!bin || !existsSync(bin)) {
  console.error('agent_cost: build pdf-next first (cd src-tauri && cargo build), or pass --bin');
  process.exit(2);
}

function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = `the flow wake behind cylinder Reynolds number boundary layer separates downstream of vortex
shedding frequency increases with adverse pressure gradient global mode eigenvalue growth rate base
linear stability analysis shows that perturbation energy at low and high amplitude jet nozzle exit
speed gas is assumed ideal viscous we compute Strouhal resolvent forcing response gain optimal fiber
drawing tension neck radius preform furnace temperature viscosity drops sharply so the draw ratio
sets final diameter this model neglects inertia surface tension gravity which remain small here
mesh convergence confirms results within one percent for every case`.split(/\s+/);
const COMMENTS = [
  'say this is an ideal value', 'this contradicts Figure 3, check the sign', 'move this before the table',
  'split this sentence', 'cite Barkley (2006) here', 'use the same symbol as in section 2',
  'define the Strouhal number at first use', 'is this the linearised operator or the full one?',
  'state the boundary conditions', 'too vague, give the number',
];
const NOTES = ['keep the equation', 'one sentence is enough', 'for a general reader', 'as in the abstract'];
const ASKS = ['ask:why', 'ask:how', 'ask:more', 'ask:example', 'ask:source', 'ask:derive'];
const CHANGES = ['change:simplify', 'change:shorten', 'change:expand', 'change:check', 'change:figure'];
const SCOPES = ['scope:phrase', 'scope:paragraph', 'scope:section'];
const TONES = ['tone:formal', 'tone:plain', 'tone:jfm'];

function wrap(text, width = 88) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  return [...lines, line];
}

const normalize = (text) => text.replace(/\s+/g, ' ').trim().toLowerCase();

/// A document and a store of `count` reviews on it.
function fixture(count, kind, seed = 7) {
  const rand = random(seed + count);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const sentence = () => {
    const words = Array.from({ length: 8 + Math.floor(rand() * 14) }, () => pick(WORDS));
    return `${words.join(' ').replace(/^./, (c) => c.toUpperCase())}.`;
  };
  const lines = ['# A study of the wake', ''];
  const paragraphs = [];
  for (let index = 0; index < Math.max(20, Math.ceil(count * 0.7)); index += 1) {
    if (index % 6 === 5) lines.push(`## Section ${(index + 1) / 6}`, '');
    const text = Array.from({ length: 3 + Math.floor(rand() * 4) }, sentence).join(' ');
    const wrapped = wrap(text);
    paragraphs.push({ text, first: lines.length + 1, wrapped });
    lines.push(...wrapped, '');
  }
  const reviews = [];
  for (let index = 1; index <= count; index += 1) {
    const paragraph = pick(paragraphs);
    const words = paragraph.text.split(' ');
    const length = rand() < 0.75 ? 3 + Math.floor(rand() * 10) : 20 + Math.floor(rand() * 35);
    const from = Math.floor(rand() * Math.max(1, words.length - length));
    const quote = words.slice(from, from + length).join(' ').replace(/[.]$/, '');
    const start = words.slice(0, from).join(' ').length + (from ? 1 : 0);
    const end = start + quote.length;
    const lineOf = (offset) => {
      let seen = 0;
      for (let k = 0; k < paragraph.wrapped.length; k += 1) {
        seen += paragraph.wrapped[k].length + 1;
        if (offset < seen) return paragraph.first + k;
      }
      return paragraph.first + paragraph.wrapped.length - 1;
    };
    const roll = rand();
    let action = 'improve';
    let comment = '';
    let requests = [];
    if (roll < 0.3) comment = pick(COMMENTS);
    else if (roll < 0.6) {
      action = 'request';
      requests = [...new Set([pick(rand() < 0.6 ? ASKS : CHANGES), ...(rand() < 0.4 ? [pick(CHANGES)] : [])])];
      if (rand() < 0.5) requests.push(pick(SCOPES));
      if (rand() < 0.3) requests.push(pick(TONES));
      if (rand() < 0.3) comment = pick(NOTES);
    } else {
      action = pick(['polish', 'polish', 'shorten', 'shorten', 'delete', 'check', 'define', 'define', 'gloss', 'clarify', 'expand', 'bold']);
      if (rand() < 0.3) comment = pick(NOTES);
      if (rand() < 0.15) requests = [pick(SCOPES)];
    }
    const status = rand() < 0.75 ? 'open' : rand() < 0.6 ? 'applied' : 'resolved';
    const before = paragraph.text.slice(Math.max(0, start - 200), start);
    const after = paragraph.text.slice(end, end + 200);
    const review = {
      id: `r${index}`,
      at: kind === 'pdf' ? { page: 1 + Math.floor((index - 1) / 6) } : { line: lineOf(start), ...(lineOf(end - 1) > lineOf(start) ? { end: lineOf(end - 1) } : {}) },
      action,
      status,
      comment,
      resolution: status === 'open' ? '' : 'reworded the sentence and kept the symbol',
      color: 1 + (index % 16),
      file: kind === 'pdf' ? 'paper.pdf' : 'paper.md',
      kind,
      quote,
      anchor: {
        prefix: normalize(before).slice(-48),
        suffix: normalize(after).slice(0, 48),
        documentRevision: 'sha256:fixture',
        ...(kind === 'pdf' ? { position: { page: 1 + Math.floor((index - 1) / 6), x: 72 + index % 300, y: 100 + (index * 37) % 600 } } : {}),
      },
      ...(kind === 'pdf' && status !== 'open' ? { build: { success: true, command: 'latexmk -pdf paper.tex' } } : {}),
      ...(requests.length ? { requests } : {}),
    };
    reviews.push(review);
  }
  const store = { format: 3, revision: 40, nextId: count + 1, reviews };
  return { source: `${lines.join('\n')}\n`, store };
}

function makeTree(count, kind) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-cost-'));
  const { source, store } = fixture(count, kind);
  const doc = join(dir, kind === 'pdf' ? 'paper.pdf' : 'paper.md');
  writeFileSync(doc, kind === 'pdf' ? '%PDF-1.1\n%%EOF\n' : source);
  writeFileSync(join(dir, 'paper_review.json'), `${JSON.stringify(store, null, 2)}\n`);
  return { dir, doc };
}

function run(cliArgs, { allowFail = false } = {}) {
  const result = spawnSync(bin, ['reviews', ...cliArgs], { encoding: 'utf8' });
  if (result.status !== 0 && !allowFail) {
    throw new Error(`pdf-next reviews ${cliArgs.join(' ')} failed: ${result.stderr}`);
  }
  return { ok: result.status === 0, out: result.stdout, err: result.stderr };
}

// An older binary measured for comparison may not have every command.
const supports = (command) => !run([command], { allowFail: true }).err.includes('unknown reviews command');

const ids = (text) => [...text.matchAll(/^(r\d+) /gm)].map((match) => match[1]);

function tally() {
  return { calls: 0, chars: 0, words: 0 };
}

function read(step, text) {
  step.calls += 1;
  step.chars += text.length;
  step.words += text.split(/\s+/).filter(Boolean).length;
}

function doneArgs(doc, kind, id) {
  return ['done', doc, id, 'reworded the sentence to state the assumption',
    ...(kind === 'pdf' ? ['--built', 'latexmk -pdf paper.tex'] : [])];
}

/// `brief` once, then `done` for every open item it listed.
function briefLoop(count, kind) {
  const { dir, doc } = makeTree(count, kind);
  const brief = tally();
  const done = tally();
  try {
    const view = run(['brief', doc]).out;
    read(brief, view);
    for (const id of ids(view)) read(done, run(doneArgs(doc, kind, id)).out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return { brief, done };
}

/// `next`, `done`, until `next` has nothing open.
function nextLoop(count, kind) {
  const { dir, doc } = makeTree(count, kind);
  const next = tally();
  const done = tally();
  try {
    for (let guard = 0; guard <= count; guard += 1) {
      const out = run(['next', doc]).out;
      read(next, out);
      const [id] = ids(out);
      if (!id) break;
      read(done, run(doneArgs(doc, kind, id)).out);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return { next, done };
}

/// Half the items done, then the reader files five more: the whole brief
/// again against `brief --since` the revision the agent started from.
function reread(count, kind) {
  const { dir, doc } = makeTree(count, kind);
  const full = tally();
  const since = tally();
  try {
    // A store this version has written once: every item carries its stamp.
    run(['relocate', doc], { allowFail: true });
    run(['add', doc, ...(kind === 'pdf' ? ['--page', '1'] : ['--line', '1']), '--quote', 'A study of the wake', '--action', 'polish']);
    const view = run(['brief', doc]).out;
    const revision = view.match(/rev(?:ision)? (\d+)/)[1];
    const open = ids(view);
    for (const id of open.slice(0, Math.floor(open.length / 2))) run(doneArgs(doc, kind, id));
    for (let k = 0; k < 5; k += 1) {
      run(['add', doc, ...(kind === 'pdf' ? ['--page', '1'] : ['--line', '3']), '--quote', 'A study of the wake', '--comment', `new point ${k}`]);
    }
    read(full, run(['brief', doc]).out);
    read(since, run(['brief', doc, '--since', revision]).out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return { full, since };
}

const tokensByChars = (step) => Math.round(step.chars / 3.5);
const tokensByWords = (step) => Math.round((step.words * 4) / 3);
const sum = (...steps) => steps.reduce((total, step) => ({
  calls: total.calls + step.calls, chars: total.chars + step.chars, words: total.words + step.words,
}), tally());

const hasNext = supports('next');
const hasAdd = supports('add');

if (args.includes('--sample')) {
  for (const kind of ['markdown', 'pdf']) {
    const { dir, doc } = makeTree(10, kind);
    console.log(run(['brief', doc]).out);
    if (hasNext) console.log(run(['next', doc]).out);
    rmSync(dir, { recursive: true, force: true });
  }
  process.exit(0);
}

if (check) {
  const failures = [];
  for (const kind of ['markdown', 'pdf']) {
    const brief = briefLoop(50, kind);
    const loops = { [`${kind} brief`]: sum(brief.brief, brief.done) };
    if (hasNext) {
      const next = nextLoop(50, kind);
      loops[`${kind} next`] = sum(next.next, next.done);
    }
    for (const [name, total] of Object.entries(loops)) {
      const verdict = total.chars <= BUDGET[name] ? 'ok' : 'OVER';
      console.log(`${name} loop, 50 reviews: ${total.chars} chars (budget ${BUDGET[name]}) ${verdict}`);
      if (verdict !== 'ok') failures.push(name);
    }
  }
  if (failures.length) {
    console.error(`agent_cost: over budget: ${failures.join(', ')}. Make the agent view leaner, or raise BUDGET in tools/agent_cost.mjs with a reason.`);
    process.exit(1);
  }
  process.exit(0);
}

const rows = [];
const row = (count, kind, step, data) => rows.push(data
  ? [count, kind, step, data.calls, data.chars, tokensByChars(data), tokensByWords(data)]
  : [count, kind, step, '–', 'n/a', 'n/a', 'n/a']);
for (const count of [10, 50, 200]) {
  for (const kind of ['markdown', 'pdf']) {
    const brief = briefLoop(count, kind);
    row(count, kind, 'brief', brief.brief);
    row(count, kind, 'done (all)', brief.done);
    row(count, kind, '**brief loop**', sum(brief.brief, brief.done));
    if (hasNext) {
      const next = nextLoop(count, kind);
      row(count, kind, 'next (all)', next.next);
      row(count, kind, '**next loop**', sum(next.next, next.done));
    } else {
      row(count, kind, '**next loop**', null);
    }
    if (hasAdd) {
      const again = reread(count, kind);
      row(count, kind, 're-read: brief', again.full);
      row(count, kind, 're-read: brief --since', again.since);
    }
  }
}
console.log(`pdf-next: ${bin}\n`);
console.log('| reviews | document | step | calls | chars | tokens (chars/3.5) | tokens (words×4/3) |');
console.log('| ---: | --- | --- | ---: | ---: | ---: | ---: |');
for (const cells of rows) console.log(`| ${cells.join(' | ')} |`);
