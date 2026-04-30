#!/usr/bin/env node
/**
 * fetch-all.js — Batch downloader for UN documents (PV and Resolutions)
 *
 * Downloads all procès-verbaux and resolutions for the General Assembly
 * and Security Council using un-scraper.js.
 *
 * Usage:
 *   node fetch-all.js [--lang=en,fr] [--body=ga|sc|all] [--type=pv|res|all]
 *                     [--from-session=N] [--to-session=N] [--concurrency=N]
 *                     [--delay=N]
 *
 * Options:
 *   --lang          Comma-separated language codes, or 'all' (default: en).
 *                   Codes: ar, zh, en, fr, ru, es
 *   --body          Limit to ga or sc (default: all)
 *   --type          Limit to pv or res (default: all)
 *   --from-session  Start of the range (GA: session; SC RES: year; SC PV: meeting no.)
 *   --to-session    End of the range (inclusive). Defaults to the built-in ceiling.
 *   --concurrency   Number of parallel scraper processes (default: 3)
 *   --delay         Minimum milliseconds between successive requests (default: 0)
 *   --dry-run       Print what would be downloaded without running the scraper
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { downloadDocument, downloadUrl, BROWSER_LAUNCH_OPTS } from './un-scraper.js';
import { buildUrl } from './lib.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Configuration ────────────────────────────────────────────────────────────

const ALL_LANGS = ['ar', 'zh', 'en', 'fr', 'ru', 'es'];

const GA_MAX_RES_DOC   = 400;  // max resolution doc number to try per session

// Legacy GA PV: globally sequential plenary meetings 1–2444 (1946–1976).
// Fetched via undocs.org using --session-id=0 in un-scraper.js.
const GA_LEGACY_PV_LAST_DOC    = 2444;

// New per-session GA PV numbering begins at session 31 (1976–77 onwards).
const GA_NEW_PV_FIRST_SESSION  = 31;
const GA_MAX_PV_DOC            = 200;  // max PV doc number to try per session

// GA sessions start each September. Session N begins in year 1945+N, so:
//   before September → current session = thisYear - 1946
//   from September   → current session = thisYear - 1945
// (Date.getMonth() is 0-based, so 8 = September)
function currentGASession() {
  const now = new Date();
  return now.getFullYear() - (now.getMonth() >= 8 ? 1945 : 1946);
}

// SC: listing API served by the Dag Hammarskjöld Library.
// Covers 2000–present; returns all PV records and resolutions per calendar year.
const SC_FIRST_YEAR   = 2000;
const SC_LISTING_BASE = 'https://ydsftksff8.execute-api.us-east-1.amazonaws.com/dev/render_meeting';

// Stop after this many consecutive failures within a session/range.
const CONSECUTIVE_FAIL_LIMIT = 5;

// ─── Argument parsing ─────────────────────────────────────────────────────────

export function parseArgs() {
  const args = { langs: ['en'], body: 'all', type: 'all', dryRun: false,
                 fromSession: null, toSession: null, concurrency: 3, delay: 0 };
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--lang=')) {
      const val = arg.split('=')[1];
      args.langs = val === 'all' ? ALL_LANGS : val.split(',');
    }
    if (arg.startsWith('--body='))         args.body        = arg.split('=')[1];
    if (arg.startsWith('--type='))         args.type        = arg.split('=')[1];
    if (arg.startsWith('--from-session=')) args.fromSession = parseInt(arg.split('=')[1]);
    if (arg.startsWith('--to-session='))   args.toSession   = parseInt(arg.split('=')[1]);
    if (arg.startsWith('--concurrency='))  args.concurrency = parseInt(arg.split('=')[1]);
    if (arg.startsWith('--delay='))        args.delay       = parseInt(arg.split('=')[1]);
    if (arg === '--dry-run')               args.dryRun      = true;
    if (arg === '--help') {
      console.log(`
fetch-all.js — Batch downloader for UN PV and Resolutions

Usage: node fetch-all.js [options]

Options:
  --lang=CODE          Comma-separated language codes, or 'all' (default: en)
                       Codes: ar, zh, en, fr, ru, es
  --body=BODY          Limit to 'ga', 'sc', or 'all' (default: all)
  --type=TYPE          Limit to 'pv', 'res', or 'all' (default: all)
  --from-session=N     Start of the range (default: built-in floor)
                       GA: session number; SC: calendar year (2000–present)
  --to-session=N       End of the range, inclusive (default: built-in ceiling)
  --concurrency=N      Parallel scraper processes (default: 3)
  --delay=MS           Minimum milliseconds between successive requests (default: 0)
  --dry-run            Print planned downloads without running the scraper
  --help               Show this message
`);
      process.exit(0);
    }
  }
  return args;
}

// ─── Progress tracking ────────────────────────────────────────────────────────

const PROGRESS_FILE = path.join(__dirname, 'progress.txt');

// In-memory set of completed download keys ("lang/body/sessionId/type/docId").
// Populated at startup from progress.txt, then updated incrementally.
const progress = new Set();

function progressKey(lang, body, sessionId, type, docId) {
  return `${lang}/${body}/${sessionId}/${type}/${docId}`;
}

function loadProgress() {
  if (!fs.existsSync(PROGRESS_FILE)) return;
  const lines = fs.readFileSync(PROGRESS_FILE, 'utf8').split('\n');
  for (const line of lines) {
    const key = line.trim();
    if (key) progress.add(key);
  }
  if (progress.size > 0) console.log(`Resumed: ${progress.size} completed downloads loaded from progress file.`);
}

function recordProgress(lang, body, sessionId, type, docId) {
  const key = progressKey(lang, body, sessionId, type, docId);
  progress.add(key);
  fs.appendFileSync(PROGRESS_FILE, key + '\n');
}

// ─── Rate limiting ────────────────────────────────────────────────────────────

// Tracks when the next request is allowed. Requests reserve slots in call order
// so that concurrent workers are serialised to one request per `delay` ms.
// The first request is never delayed. JS's single-threaded event loop makes the
// slot reservation (everything before the await) atomic across workers.
let nextAllowedAt = 0;

// Accumulates failed download records for the failed.jsonl report written at the end.
const failures = [];

async function throttle(delay) {
  if (delay <= 0) return;
  const waitUntil = nextAllowedAt;
  nextAllowedAt = Math.max(Date.now(), waitUntil) + delay;
  const wait = waitUntil - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function docAlreadyDownloaded(body, sessionId, type, docId, lang) {
  if (progress.has(progressKey(lang, body, sessionId, type, docId))) return true;
  // Fallback for downloads completed before progress tracking was introduced.
  const dir = path.join(__dirname, lang, body, String(sessionId), type);
  if (!fs.existsSync(dir)) return false;
  return fs.readdirSync(dir).some(f => f.startsWith(`document_${docId}.`));
}

async function runScraper(browser, body, type, lang, sessionId, docId, dryRun, delay) {
  const label = `${body.toUpperCase()} ${type.toUpperCase()} session=${sessionId} doc=${docId}`;
  if (dryRun) {
    console.log(`[DRY-RUN] Would fetch: ${label}`);
    return true;
  }
  await throttle(delay);
  return downloadDocument(browser, body, type, lang, sessionId, docId);
}

/**
 * Iterates docIds [startDoc, maxDoc] for a fixed (body, type, sessionId) using
 * up to `concurrency` parallel workers. Stops early after CONSECUTIVE_FAIL_LIMIT
 * failures in a row (evaluated in docId order across workers).
 * Returns the number of documents successfully downloaded.
 */
async function fetchDocRange(body, type, lang, sessionId, startDoc, maxDoc, dryRun, concurrency, browser, delay) {
  let downloaded = 0;
  // stopAt is reduced when consecutive-fail threshold is reached; workers check it
  // before claiming each new docId (JS is single-threaded so no lock needed).
  let stopAt = maxDoc;
  let nextDoc = startDoc;

  // Track results in docId order so consecutive-fail counting is deterministic.
  const settled = new Map(); // docId -> boolean (true = ok or skip)
  let checkFrom = startDoc;
  let consecutiveFails = 0;

  function processSettled() {
    while (settled.has(checkFrom)) {
      const ok = settled.get(checkFrom);
      if (ok) {
        consecutiveFails = 0;
      } else {
        consecutiveFails++;
        if (consecutiveFails >= CONSECUTIVE_FAIL_LIMIT) {
          process.stdout.write(
            `[STOP] ${CONSECUTIVE_FAIL_LIMIT} consecutive failures at doc=${checkFrom} ` +
            `(session=${sessionId}), moving on\n`
          );
          stopAt = checkFrom;
          break;
        }
      }
      checkFrom++;
    }
  }

  async function worker() {
    while (true) {
      if (nextDoc > stopAt) break;
      const docId = nextDoc++;

      if (docAlreadyDownloaded(body, sessionId, type, docId, lang)) {
        process.stdout.write(`[SKIP] ${body.toUpperCase()} ${type.toUpperCase()} session=${sessionId} doc=${docId}\n`);
        settled.set(docId, true);
        processSettled();
        continue;
      }

      const ok = await runScraper(browser, body, type, lang, sessionId, docId, dryRun, delay);
      if (ok) {
        downloaded++;
        if (!dryRun) recordProgress(lang, body, sessionId, type, docId);
      } else if (!dryRun) {
        failures.push({ ts: new Date().toISOString(), lang, body, type, sessionId, docId,
                        url: buildUrl(body, type, sessionId, docId, lang) });
      }
      settled.set(docId, ok);
      processSettled();
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return downloaded;
}

// ─── Download routines ────────────────────────────────────────────────────────

// Legacy GA PV: globally-numbered plenary meetings on undocs.org (A/PV.1–2444).
// un-scraper.js interprets --session-id=0 as the legacy URL trigger.
// from/to are interpreted as meeting (doc) numbers.
async function fetchGAPVLegacy(lang, dryRun, from, to, concurrency, browser, delay) {
  const startDoc = from ?? 1;
  const endDoc   = to   ?? GA_LEGACY_PV_LAST_DOC;
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`General Assembly — Procès-verbaux legacy (A/PV.${startDoc}–${endDoc}, pre-1976)`);
  console.log('─'.repeat(60));
  await fetchDocRange('ga', 'pv', lang, 0, startDoc, endDoc, dryRun, concurrency, browser, delay);
}

async function fetchGA(type, lang, dryRun, from, to, concurrency, browser, delay) {
  const label = type === 'pv' ? 'Procès-verbaux' : 'Resolutions';
  const maxDoc = type === 'pv' ? GA_MAX_PV_DOC : GA_MAX_RES_DOC;
  // PV: new per-session numbering starts at session 31 (1976–77).
  // RES: sessions 1–30 use Roman numeral URLs (handled by un-scraper.js); start from 1.
  const defaultFirst = type === 'pv' ? GA_NEW_PV_FIRST_SESSION : 1;
  const firstSession = from ?? defaultFirst;
  const lastSession  = to   ?? currentGASession();

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`General Assembly — ${label} (sessions ${firstSession}–${lastSession})`);
  console.log('─'.repeat(60));

  let emptySessionStreak = 0;

  for (let session = firstSession; session <= lastSession; session++) {
    console.log(`\n[GA ${type.toUpperCase()}] Session ${session}`);
    const n = await fetchDocRange('ga', type, lang, session, 1, maxDoc, dryRun, concurrency, browser, delay);
    if (n === 0) {
      emptySessionStreak++;
      if (emptySessionStreak >= 3) {
        console.log(`[STOP] No new documents in 3 consecutive GA sessions, stopping.`);
        break;
      }
    } else {
      emptySessionStreak = 0;
    }
  }
}

// ─── SC listing helpers ───────────────────────────────────────────────────────

// Fetch the DHL meeting table for one SC year; return all S/PV and S/RES entries.
async function fetchScListing(year) {
  const res = await fetch(`${SC_LISTING_BASE}/scmeetings_${year}/EN`);
  if (!res.ok) return [];
  const html = await res.text();

  const docs = new Map(); // symbol → rawUrl (deduplicate)
  const re = /href="(https?:\/\/(?:(?:www\.)?undocs\.org|docs\.un\.org)[^"]*)"[^>]*>\s*(S\/(?:PV|RES)\S*(?:\s*\([^)]+\))?)\s*<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const symbol = m[2].trim();
    if (!docs.has(symbol)) docs.set(symbol, m[1].trim());
  }
  return [...docs.entries()].map(([symbol, rawUrl]) => ({ symbol, rawUrl }));
}

// Parse an SC symbol into { type, sessionId, docId }.  Returns null for unknown types.
function parseScSymbol(symbol) {
  // S/PV.10146  or  S/PV.10146 (Resumption 1)
  const pv = symbol.match(/^S\/PV\.(\d+)(.*)?$/);
  if (pv) {
    const suffix = (pv[2] || '').trim();
    return { type: 'pv', sessionId: 1, docId: suffix ? `${pv[1]}${suffix}` : parseInt(pv[1]) };
  }
  // S/RES/2811(2025)
  const res = symbol.match(/^S\/RES\/(\d+)\((\d+)\)$/);
  if (res) return { type: 'res', sessionId: parseInt(res[2]), docId: parseInt(res[1]) };
  return null;
}

// Insert a language code into a docs.un.org or undocs.org URL.
function addLangToUrl(rawUrl, lang) {
  if (/^https?:\/\/docs\.un\.org\/[a-z]{2}\//.test(rawUrl)) return rawUrl;
  if (rawUrl.startsWith('https://docs.un.org/'))
    return rawUrl.replace('https://docs.un.org/', `https://docs.un.org/${lang}/`);
  // (www.)undocs.org/en/… → undocs.org/{lang}/…
  return rawUrl.replace(/^(https?:\/\/(?:www\.)?undocs\.org)\/[a-z]{2}\//, `$1/${lang}/`);
}

// ─── SC download routine ──────────────────────────────────────────────────────

async function fetchSC(type, lang, dryRun, from, to, concurrency, browser, delay) {
  const doPV  = type === 'all' || type === 'pv';
  const doRes = type === 'all' || type === 'res';
  const firstYear = from ?? SC_FIRST_YEAR;
  const lastYear  = to   ?? new Date().getFullYear();

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Security Council — PV & Resolutions (${firstYear}–${lastYear})`);
  console.log('─'.repeat(60));

  for (let year = firstYear; year <= lastYear; year++) {
    const listing = await fetchScListing(year);
    const work = listing.filter(({ symbol }) =>
      (doPV  && symbol.startsWith('S/PV.'))  ||
      (doRes && symbol.startsWith('S/RES/'))
    );

    if (work.length === 0) {
      console.log(`\n[SC] ${year}: no documents in listing`);
      continue;
    }
    console.log(`\n[SC] ${year}: ${work.length} documents`);

    let idx = 0;
    let downloaded = 0;

    const worker = async () => {
      while (idx < work.length) {
        const { symbol, rawUrl } = work[idx++];
        const parsed = parseScSymbol(symbol);
        if (!parsed) continue;
        const { type: docType, sessionId, docId } = parsed;

        if (docAlreadyDownloaded('sc', sessionId, docType, docId, lang)) {
          process.stdout.write(`[SKIP] ${symbol}\n`);
          continue;
        }
        if (dryRun) {
          console.log(`[DRY-RUN] Would fetch: ${symbol}`);
          continue;
        }

        await throttle(delay);
        const ok = await downloadUrl(browser, addLangToUrl(rawUrl, lang),
                                     'sc', docType, lang, sessionId, docId);
        if (ok) {
          downloaded++;
          recordProgress(lang, 'sc', sessionId, docType, docId);
        } else {
          failures.push({ ts: new Date().toISOString(), lang, body: 'sc', type: docType,
                          sessionId, docId, url: addLangToUrl(rawUrl, lang) });
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, worker));
    if (!dryRun) console.log(`[SC] ${year}: ${downloaded} new documents downloaded`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { langs, body, type, dryRun, fromSession, toSession, concurrency, delay } = parseArgs();

  loadProgress();
  console.log(`fetch-all.js — UN document batch downloader`);
  console.log(`Languages  : ${langs.join(', ')}`);
  console.log(`Body       : ${body}`);
  console.log(`Type       : ${type}`);
  console.log(`Concurrency: ${concurrency}`);
  console.log(`Delay      : ${delay} ms`);
  if (fromSession !== null) console.log(`From       : ${fromSession}`);
  if (toSession   !== null) console.log(`To         : ${toSession}`);
  if (dryRun) console.log(`Mode       : DRY RUN`);

  const doGA = body === 'all' || body === 'ga';
  const doSC = body === 'all' || body === 'sc';
  const doPV = type === 'all' || type === 'pv';
  const doRes = type === 'all' || type === 'res';

  // One shared browser for the entire run; pages are opened/closed per document.
  let browser = null;
  if (!dryRun) {
    console.log('Launching browser...');
    browser = await puppeteer.launch(BROWSER_LAUNCH_OPTS);
  }

  try {
    for (const lang of langs) {
      if (langs.length > 1) console.log(`\n${'═'.repeat(60)}\nLanguage: ${lang}\n${'═'.repeat(60)}`);
      if (doGA && doPV)  await fetchGAPVLegacy(lang, dryRun, fromSession, toSession, concurrency, browser, delay);
      if (doGA && doPV)  await fetchGA('pv',  lang, dryRun, fromSession, toSession, concurrency, browser, delay);
      if (doGA && doRes) await fetchGA('res', lang, dryRun, fromSession, toSession, concurrency, browser, delay);
      if (doSC) await fetchSC(type, lang, dryRun, fromSession, toSession, concurrency, browser, delay);
    }
  } finally {
    if (browser) await browser.close();
  }

  if (!dryRun && failures.length > 0) {
    const failPath = path.join(__dirname, 'failed.jsonl');
    fs.writeFileSync(failPath, failures.map(r => JSON.stringify(r)).join('\n') + '\n');
    console.log(`\n${failures.length} failed download(s) logged to ${failPath}`);
  }

  console.log('\nAll done.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error(`[FATAL] ${err.message}`);
    process.exit(1);
  });
}
