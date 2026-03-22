#!/usr/bin/env node
/**
 * fetch-all.js — Batch downloader for UN documents (PV and Resolutions)
 *
 * Downloads all procès-verbaux and resolutions for the General Assembly
 * and Security Council using un-scraper.js.
 *
 * Usage:
 *   node fetch-all.js [--lang=en,fr] [--body=ga|sc|all] [--type=pv|res|all]
 *
 * Options:
 *   --lang   Comma-separated language codes, or 'all' (default: en).
 *            Codes: ar, zh, en, fr, ru, es
 *   --body   Limit to ga or sc (default: all)
 *   --type   Limit to pv or res (default: all)
 *   --dry-run  Print what would be downloaded without running the scraper
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Configuration ────────────────────────────────────────────────────────────

const ALL_LANGS = ['ar', 'zh', 'en', 'fr', 'ru', 'es'];

const GA_LAST_SESSION  = 79;   // update as new sessions begin
const GA_MAX_RES_DOC   = 400;  // max resolution doc number to try per session

// Legacy GA PV: globally sequential plenary meetings 1–2444 (1946–1976).
// Fetched via undocs.org using --session-id=0 in un-scraper.js.
const GA_LEGACY_PV_LAST_DOC    = 2444;

// New per-session GA PV numbering begins at session 31 (1976–77 onwards).
const GA_NEW_PV_FIRST_SESSION  = 31;
const GA_MAX_PV_DOC            = 200;  // max PV doc number to try per session

// SC PV meetings are numbered globally (not per year).
const SC_PV_FIRST_DOC  = 1000;
const SC_PV_LAST_DOC   = 3000;

/**
 * Approximate year→[firstRes, lastRes] ranges for SC resolutions.
 * Resolution numbers are globally sequential starting from 1 in 1946.
 * The upper bound of each year is the lower bound of the next minus 1.
 */
const SC_RES_YEAR_RANGES = {
  /*1946: [1,   15],
  1947: [16,  25],
  1948: [26,  35],
  1949: [36,  43],
  1950: [44,  56],
  1951: [57,  61],
  1952: [62,  65],
  1953: [66,  76],
  1954: [77,  88],
  1955: [89,  99],
  1956: [100, 113],
  1957: [114, 122],
  1958: [123, 132],
  1959: [133, 141],
  1960: [142, 157],
  1961: [158, 175],
  1962: [176, 192],
  1963: [193, 200],
  1964: [201, 208],
  1965: [209, 222],
  1966: [223, 233],
  1967: [234, 248],
  1968: [249, 259],
  1969: [260, 274],
  1970: [275, 287],
  1971: [288, 306],
  1972: [307, 325],
  1973: [326, 344],
  1974: [345, 363],
  1975: [364, 384],
  1976: [385, 409],
  1977: [410, 438],
  1978: [439, 460],
  1979: [461, 476],
  1980: [477, 498],
  1981: [499, 515],
  1982: [516, 526],
  1983: [527, 543],
  1984: [544, 557],
  1985: [558, 578],
  1986: [579, 601],
  1987: [602, 621],
  1988: [622, 641],
  1989: [642, 658],
  1990: [659, 678],
  1991: [679, 716],
  1992: [717, 790],
  1993: [791, 893],
  1994: [894, 970],
  1995: [971, 1037],
  1996: [1038, 1097],
  1997: [1098, 1144],
  1998: [1145, 1204],
  1999: [1205, 1285],
  2000: [1286, 1341],
  2001: [1342, 1384],
  2002: [1385, 1462],
  2003: [1463, 1526],
  2004: [1527, 1590],
  2005: [1591, 1660],
  2006: [1661, 1729],
  2007: [1730, 1790],*/
  2008: [1791, 1853],
  2009: [1854, 1906],
  2010: [1907, 1975],
  2011: [1976, 2041],
  2012: [2042, 2119],
  2013: [2120, 2188],
  2014: [2189, 2249],
  2015: [2250, 2337],
  2016: [2338, 2397],
  2017: [2398, 2452],
  2018: [2453, 2513],
  2019: [2514, 2573],
  2020: [2574, 2626],
  2021: [2627, 2689],
  2022: [2690, 2733],
  2023: [2734, 2769],
  2024: [2770, 2840],  // extend if needed
};

// Stop after this many consecutive failures within a session/range.
const CONSECUTIVE_FAIL_LIMIT = 5;

// ─── Argument parsing ─────────────────────────────────────────────────────────

function parseArgs() {
  const args = { langs: ['en'], body: 'all', type: 'all', dryRun: false };
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--lang=')) {
      const val = arg.split('=')[1];
      args.langs = val === 'all' ? ALL_LANGS : val.split(',');
    }
    if (arg.startsWith('--body='))   args.body   = arg.split('=')[1];
    if (arg.startsWith('--type='))   args.type   = arg.split('=')[1];
    if (arg === '--dry-run')         args.dryRun = true;
    if (arg === '--help') {
      console.log(`
fetch-all.js — Batch downloader for UN PV and Resolutions

Usage: node fetch-all.js [options]

Options:
  --lang=CODE   Comma-separated language codes, or 'all' (default: en)
                Codes: ar, zh, en, fr, ru, es
  --body=BODY   Limit to 'ga', 'sc', or 'all' (default: all)
  --type=TYPE   Limit to 'pv', 'res', or 'all' (default: all)
  --dry-run     Print planned downloads without running the scraper
  --help        Show this message
`);
      process.exit(0);
    }
  }
  return args;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function docAlreadyDownloaded(body, sessionId, type, docId, lang) {
  const dir = path.join(__dirname, lang, body, String(sessionId), type);
  if (!fs.existsSync(dir)) return false;
  return fs.readdirSync(dir).some(f => f.startsWith(`document_${docId}.`));
}

function runScraper(body, type, lang, sessionId, docId, dryRun) {
  const label = `${body.toUpperCase()} ${type.toUpperCase()} session=${sessionId} doc=${docId}`;
  if (dryRun) {
    console.log(`[DRY-RUN] Would fetch: ${label}`);
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const child = spawn('node', [
      'un-scraper.js',
      `--body=${body}`,
      `--type=${type}`,
      `--lang=${lang}`,
      `--session-id=${sessionId}`,
      `--doc-id=${docId}`,
    ], { cwd: __dirname, stdio: 'inherit' });
    child.on('close', code => resolve(code === 0));
  });
}

/**
 * Iterates docIds [startDoc, maxDoc] for a fixed (body, type, sessionId).
 * Stops early after CONSECUTIVE_FAIL_LIMIT failures in a row.
 * Returns the number of documents successfully downloaded.
 */
async function fetchDocRange(body, type, lang, sessionId, startDoc, maxDoc, dryRun) {
  let consecutiveFails = 0;
  let downloaded = 0;

  for (let docId = startDoc; docId <= maxDoc; docId++) {
    if (docAlreadyDownloaded(body, sessionId, type, docId, lang)) {
      process.stdout.write(`[SKIP] ${body.toUpperCase()} ${type.toUpperCase()} session=${sessionId} doc=${docId}\n`);
      consecutiveFails = 0;
      continue;
    }

    const ok = await runScraper(body, type, lang, sessionId, docId, dryRun);
    if (ok) {
      downloaded++;
      consecutiveFails = 0;
    } else {
      consecutiveFails++;
      if (consecutiveFails >= CONSECUTIVE_FAIL_LIMIT) {
        process.stdout.write(
          `[STOP] ${CONSECUTIVE_FAIL_LIMIT} consecutive failures at doc=${docId} ` +
          `(session=${sessionId}), moving on\n`
        );
        break;
      }
    }
  }

  return downloaded;
}

// ─── Download routines ────────────────────────────────────────────────────────

// Legacy GA PV: globally-numbered plenary meetings on undocs.org (A/PV.1–2444).
// un-scraper.js interprets --session-id=0 as the legacy URL trigger.
async function fetchGAPVLegacy(lang, dryRun) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`General Assembly — Procès-verbaux legacy (A/PV.1–${GA_LEGACY_PV_LAST_DOC}, pre-1976)`);
  console.log('─'.repeat(60));
  await fetchDocRange('ga', 'pv', lang, 0, 1, GA_LEGACY_PV_LAST_DOC, dryRun);
}

async function fetchGA(type, lang, dryRun) {
  const label = type === 'pv' ? 'Procès-verbaux' : 'Resolutions';
  const maxDoc = type === 'pv' ? GA_MAX_PV_DOC : GA_MAX_RES_DOC;
  // PV: new per-session numbering starts at session 31 (1976–77).
  // RES: sessions 1–30 use Roman numeral URLs (handled by un-scraper.js); start from 1.
  const firstSession = type === 'pv' ? GA_NEW_PV_FIRST_SESSION : 1;

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`General Assembly — ${label}${type === 'pv' ? ` (sessions ${firstSession}–${GA_LAST_SESSION})` : ''}`);
  console.log('─'.repeat(60));

  let emptySessionStreak = 0;

  for (let session = firstSession; session <= GA_LAST_SESSION; session++) {
    console.log(`\n[GA ${type.toUpperCase()}] Session ${session}`);
    const n = await fetchDocRange('ga', type, lang, session, 1, maxDoc, dryRun);
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

async function fetchSCPV(lang, dryRun) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Security Council — Procès-verbaux`);
  console.log('─'.repeat(60));
  // SC PV uses sessionId=1 and a globally incrementing docId.
  await fetchDocRange('sc', 'pv', lang, 1, SC_PV_FIRST_DOC, SC_PV_LAST_DOC, dryRun);
}

async function fetchSCRes(lang, dryRun) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Security Council — Resolutions`);
  console.log('─'.repeat(60));

  for (const [yearStr, [firstDoc, lastDoc]] of Object.entries(SC_RES_YEAR_RANGES)) {
    const year = parseInt(yearStr);
    console.log(`\n[SC RES] Year ${year} (docs ${firstDoc}–${lastDoc})`);
    await fetchDocRange('sc', 'res', lang, year, firstDoc, lastDoc, dryRun);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { langs, body, type, dryRun } = parseArgs();

  console.log(`fetch-all.js — UN document batch downloader`);
  console.log(`Languages: ${langs.join(', ')}`);
  console.log(`Body     : ${body}`);
  console.log(`Type     : ${type}`);
  if (dryRun) console.log(`Mode     : DRY RUN`);

  const doGA = body === 'all' || body === 'ga';
  const doSC = body === 'all' || body === 'sc';
  const doPV = type === 'all' || type === 'pv';
  const doRes = type === 'all' || type === 'res';

  for (const lang of langs) {
    if (langs.length > 1) console.log(`\n${'═'.repeat(60)}\nLanguage: ${lang}\n${'═'.repeat(60)}`);
    if (doGA && doPV)  await fetchGAPVLegacy(lang, dryRun);
    if (doGA && doPV)  await fetchGA('pv',  lang, dryRun);
    if (doGA && doRes) await fetchGA('res', lang, dryRun);
    if (doSC && doPV)  await fetchSCPV(lang, dryRun);
    if (doSC && doRes) await fetchSCRes(lang, dryRun);
  }

  console.log('\nAll done.');
}

main().catch(err => {
  console.error(`[FATAL] ${err.message}`);
  process.exit(1);
});
