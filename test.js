import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toRoman, buildUrl } from './lib.js';
import { parseArgs as parseArgsScraper } from './un-scraper.js';
import { parseArgs, parseScSymbol, parseScListing, addLangToUrl,
         parseGAPVUrl, parseGAPVListing } from './fetch-all.js';

// ─── toRoman ──────────────────────────────────────────────────────────────────

test('toRoman: single-symbol values', () => {
  assert.equal(toRoman(1),    'I');
  assert.equal(toRoman(5),    'V');
  assert.equal(toRoman(10),   'X');
  assert.equal(toRoman(50),   'L');
  assert.equal(toRoman(100),  'C');
  assert.equal(toRoman(500),  'D');
  assert.equal(toRoman(1000), 'M');
});

test('toRoman: subtractive pairs', () => {
  assert.equal(toRoman(4),  'IV');
  assert.equal(toRoman(9),  'IX');
  assert.equal(toRoman(40), 'XL');
  assert.equal(toRoman(90), 'XC');
  assert.equal(toRoman(400), 'CD');
  assert.equal(toRoman(900), 'CM');
});

test('toRoman: GA session range (1–30)', () => {
  assert.equal(toRoman(1),  'I');
  assert.equal(toRoman(14), 'XIV');
  assert.equal(toRoman(30), 'XXX');
});

test('toRoman: larger values', () => {
  assert.equal(toRoman(1999), 'MCMXCIX');
  assert.equal(toRoman(2024), 'MMXXIV');
});

// ─── buildUrl ─────────────────────────────────────────────────────────────────

test('buildUrl: GA PV legacy (sessionId=0) uses undocs.org without language prefix', () => {
  assert.equal(
    buildUrl('ga', 'pv', 0, 49, 'en'),
    'https://undocs.org/A/PV.49'
  );
  assert.equal(
    buildUrl('ga', 'pv', 0, 2444, 'fr'),
    'https://undocs.org/A/PV.2444'
  );
});

test('buildUrl: GA PV modern (session >= 31) includes language and session', () => {
  assert.equal(
    buildUrl('ga', 'pv', 68, 70, 'fr'),
    'https://docs.un.org/fr/A/68/PV.70'
  );
  assert.equal(
    buildUrl('ga', 'pv', 79, 1, 'en'),
    'https://docs.un.org/en/A/79/PV.1'
  );
});

test('buildUrl: GA RES sessions 1–30 use Roman numerals', () => {
  assert.equal(
    buildUrl('ga', 'res', 1, 103, 'en'),
    'https://docs.un.org/en/A/RES/103(I)'
  );
  assert.equal(
    buildUrl('ga', 'res', 30, 1, 'en'),
    'https://docs.un.org/en/A/RES/1(XXX)'
  );
});

test('buildUrl: GA RES session 31+ uses numeric format', () => {
  assert.equal(
    buildUrl('ga', 'res', 48, 20, 'en'),
    'https://docs.un.org/en/A/RES/48/20'
  );
  assert.equal(
    buildUrl('ga', 'res', 79, 1, 'ar'),
    'https://docs.un.org/ar/A/RES/79/1'
  );
});

test('buildUrl: SC PV uses meeting number, no year in path', () => {
  assert.equal(
    buildUrl('sc', 'pv', 1, 7851, 'en'),
    'https://docs.un.org/en/S/PV.7851'
  );
});

test('buildUrl: SC RES includes year in parentheses', () => {
  assert.equal(
    buildUrl('sc', 'res', 2016, 2314, 'en'),
    'https://docs.un.org/en/S/RES/2314(2016)'
  );
  assert.equal(
    buildUrl('sc', 'res', 2024, 2725, 'fr'),
    'https://docs.un.org/fr/S/RES/2725(2024)'
  );
});

test('buildUrl: respects language code in URL', () => {
  const langs = ['ar', 'zh', 'en', 'fr', 'ru', 'es'];
  for (const lang of langs) {
    assert.match(buildUrl('ga', 'pv', 79, 1, lang), new RegExp(`/${lang}/`));
  }
});

// ─── parseArgs ────────────────────────────────────────────────────────────────

function withArgv(args, fn) {
  const saved = process.argv;
  process.argv = ['node', 'fetch-all.js', ...args];
  try { return fn(); } finally { process.argv = saved; }
}

test('parseArgs: defaults with no arguments', () => {
  const result = withArgv([], parseArgs);
  assert.deepEqual(result.langs, ['en']);
  assert.equal(result.body, 'all');
  assert.equal(result.type, 'all');
  assert.equal(result.dryRun, false);
  assert.equal(result.fromSession, null);
  assert.equal(result.toSession, null);
  assert.equal(result.concurrency, 3);
  assert.equal(result.delay, 0);
});

test('parseArgs: --lang= single code', () => {
  assert.deepEqual(withArgv(['--lang=fr'], parseArgs).langs, ['fr']);
});

test('parseArgs: --lang= comma-separated codes', () => {
  assert.deepEqual(withArgv(['--lang=en,fr'], parseArgs).langs, ['en', 'fr']);
});

test('parseArgs: --lang=all expands to all six languages', () => {
  assert.deepEqual(
    withArgv(['--lang=all'], parseArgs).langs,
    ['ar', 'zh', 'en', 'fr', 'ru', 'es']
  );
});

test('parseArgs: --body and --type', () => {
  const result = withArgv(['--body=ga', '--type=pv'], parseArgs);
  assert.equal(result.body, 'ga');
  assert.equal(result.type, 'pv');
});

test('parseArgs: --from-session and --to-session are parsed as integers', () => {
  const result = withArgv(['--from-session=10', '--to-session=20'], parseArgs);
  assert.equal(result.fromSession, 10);
  assert.equal(result.toSession, 20);
});

test('parseArgs: --concurrency and --delay', () => {
  const result = withArgv(['--concurrency=6', '--delay=500'], parseArgs);
  assert.equal(result.concurrency, 6);
  assert.equal(result.delay, 500);
});

test('parseArgs: --dry-run sets dryRun flag', () => {
  assert.equal(withArgv(['--dry-run'], parseArgs).dryRun, true);
});

// ─── parseArgs (un-scraper.js) ────────────────────────────────────────────────

function withArgvScraper(args, fn) {
  const saved = process.argv;
  process.argv = ['node', 'un-scraper.js', ...args];
  try { return fn(); } finally { process.argv = saved; }
}

test('parseArgsScraper: --session-id is returned as an integer', () => {
  const result = withArgvScraper(['--session-id=68'], parseArgsScraper);
  assert.equal(result['session-id'], 68);
  assert.equal(typeof result['session-id'], 'number');
});

test('parseArgsScraper: --doc-id is returned as an integer', () => {
  const result = withArgvScraper(['--doc-id=42'], parseArgsScraper);
  assert.equal(result['doc-id'], 42);
  assert.equal(typeof result['doc-id'], 'number');
});

test('parseArgsScraper: session-id=0 is valid (legacy GA PV sentinel)', () => {
  const result = withArgvScraper(['--session-id=0'], parseArgsScraper);
  assert.equal(result['session-id'], 0);
});

test('parseArgsScraper: string flags remain strings', () => {
  const result = withArgvScraper(['--body=sc', '--type=res', '--lang=fr'], parseArgsScraper);
  assert.equal(result.body, 'sc');
  assert.equal(result.type, 'res');
  assert.equal(result.lang, 'fr');
});

// ─── parseScSymbol ────────────────────────────────────────────────────────────

test('parseScSymbol: SC PV (integer docId)', () => {
  assert.deepEqual(parseScSymbol('S/PV.88'),
    { type: 'pv', sessionId: 1, docId: 88 });
});

test('parseScSymbol: SC PV with resumption suffix (string docId)', () => {
  // The suffix is trimmed before concatenation, so the leading space is dropped.
  assert.deepEqual(parseScSymbol('S/PV.10146 (Resumption 1)'),
    { type: 'pv', sessionId: 1, docId: '10146(Resumption 1)' });
});

test('parseScSymbol: SC PV with closed suffix — no HTML tags in docId', () => {
  assert.deepEqual(parseScSymbol('S/PV.785 (closed)'),
    { type: 'pv', sessionId: 1, docId: '785(closed)' });
});

// ─── parseScListing ───────────────────────────────────────────────────────────

test('parseScListing: strips inline HTML tags from symbol text', () => {
  const html = `<a href="https://undocs.org/S/PV.785">S/PV.785<br> (closed)</a>`;
  const result = parseScListing(html);
  assert.equal(result.length, 1);
  assert.equal(result[0].symbol, 'S/PV.785 (closed)');
});

test('parseScListing: deduplicates symbols', () => {
  const html = `
    <a href="https://undocs.org/S/PV.88">S/PV.88</a>
    <a href="https://undocs.org/S/PV.88">S/PV.88</a>
  `;
  assert.equal(parseScListing(html).length, 1);
});

test('parseScSymbol: SC RES modern format — no space (DHL)', () => {
  assert.deepEqual(parseScSymbol('S/RES/2811(2025)'),
    { type: 'res', sessionId: 2025, docId: 2811 });
});

test('parseScSymbol: SC RES legacy format — space before paren (research.un.org)', () => {
  assert.deepEqual(parseScSymbol('S/RES/15 (1946)'),
    { type: 'res', sessionId: 1946, docId: 15 });
});

test('parseScSymbol: returns null for unknown symbols', () => {
  assert.equal(parseScSymbol('S/INF/2/Rev.1(I)'), null);
  assert.equal(parseScSymbol('S/144'), null);
});

// ─── addLangToUrl ─────────────────────────────────────────────────────────────

test('addLangToUrl: docs.un.org already language-qualified — unchanged', () => {
  assert.equal(
    addLangToUrl('https://docs.un.org/en/S/PV.9800', 'fr'),
    'https://docs.un.org/en/S/PV.9800'
  );
});

test('addLangToUrl: docs.un.org without language — adds language', () => {
  assert.equal(
    addLangToUrl('https://docs.un.org/S/PV.9800', 'en'),
    'https://docs.un.org/en/S/PV.9800'
  );
});

test('addLangToUrl: undocs.org with language prefix — ports to docs.un.org', () => {
  assert.equal(
    addLangToUrl('https://undocs.org/en/S/PV.9800', 'fr'),
    'https://docs.un.org/fr/S/PV.9800'
  );
});

test('addLangToUrl: undocs.org bare symbol (pre-2000 form) — ports to docs.un.org with lang', () => {
  assert.equal(
    addLangToUrl('https://undocs.org/S/PV.88', 'en'),
    'https://docs.un.org/en/S/PV.88'
  );
  assert.equal(
    addLangToUrl('https://undocs.org/S/PV.88', 'fr'),
    'https://docs.un.org/fr/S/PV.88'
  );
});

// ─── parseGAPVUrl ─────────────────────────────────────────────────────────────

test('parseGAPVUrl: legacy A/PV.N → sessionId 0', () => {
  assert.deepEqual(parseGAPVUrl('https://undocs.org/A/PV.48'),
    { sessionId: 0, docId: 48 });
});

test('parseGAPVUrl: modern A/N/PV.N → sessionId = session', () => {
  assert.deepEqual(parseGAPVUrl('https://undocs.org/A/68/PV.109'),
    { sessionId: 68, docId: 109 });
});

test('parseGAPVUrl: docs.un.org form', () => {
  assert.deepEqual(parseGAPVUrl('https://docs.un.org/en/A/79/PV.5'),
    { sessionId: 79, docId: 5 });
});

test('parseGAPVUrl: returns null for non-PV URLs', () => {
  assert.equal(parseGAPVUrl('https://undocs.org/A/RES/1(I)'), null);
});

// ─── parseGAPVListing ─────────────────────────────────────────────────────────

test('parseGAPVListing: extracts legacy A/PV links', () => {
  const html = `
    <a href="https://undocs.org/A/PV.48">A/PV.48</a>
    <a href="https://undocs.org/A/PV.67">A/PV.67</a>
  `;
  const result = parseGAPVListing(html);
  assert.equal(result.length, 2);
  assert.equal(result[0].symbol, 'A/PV.48');
  assert.equal(result[1].symbol, 'A/PV.67');
});

test('parseGAPVListing: extracts modern A/N/PV links', () => {
  const html = `<a href="https://undocs.org/A/68/PV.109">A/68/PV.109</a>`;
  const result = parseGAPVListing(html);
  assert.equal(result.length, 1);
  assert.equal(result[0].symbol, 'A/68/PV.109');
  assert.equal(result[0].rawUrl, 'https://undocs.org/A/68/PV.109');
});

test('parseGAPVListing: deduplicates and strips HTML tags', () => {
  const html = `
    <a href="https://undocs.org/A/PV.48">A/PV.48</a>
    <a href="https://undocs.org/A/PV.48">A/PV.48</a>
  `;
  assert.equal(parseGAPVListing(html).length, 1);
});
