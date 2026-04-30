import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { toRoman, buildUrl, ensureDir } from './lib.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const BROWSER_LAUNCH_OPTS = {
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
};

// Configuration
const CONFIG = {
  bodies: {
    ga: {
      name: 'General Assembly',
      documentTypes: {
        pv:  { name: 'Procès-verbal' },
        res: { name: 'Resolution' },
      }
    },
    sc: {
      name: 'Security Council',
      documentTypes: {
        pv:  { name: 'Procès-verbal' },
        res: { name: 'Resolution' },
      }
    }
  },
  languages: {
    ar: { name: 'Arabic' },
    zh: { name: 'Mandarin Chinese' },
    en: { name: 'English' },
    fr: { name: 'French' },
    ru: { name: 'Russian' },
    es: { name: 'Spanish' }
  },
  timeout: 30000,
  retries: 3
};

// Logging utilities
const log = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`),
  success: (msg) => console.log(`[SUCCESS] ✓ ${msg}`),
  debug: (msg) => process.env.DEBUG && console.log(`[DEBUG] ${msg}`)
};

// Parse command-line arguments
function parseArgs() {
  const args = {};
  
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith('--')) {
      const [key, value] = arg.substring(2).split('=');
      args[key] = value || true;
    }
  }
  
  return args;
}

// Validate arguments
function validateArgs(args) {
  if (Object.keys(args).length === 0) {
    showUsage();
    process.exit(1);
  }
  
  const body = args.body || 'ga';
  const type = args.type || 'pv';
  const lang = args.lang || 'en';
  const sessionId = parseInt(args['session-id'] || '1');
  const docId = parseInt(args['doc-id'] || '1');
  
  if (!CONFIG.bodies[body]) {
    log.error(`Invalid body: ${body}. Use ga (General Assembly) or sc (Security Council).`);
    process.exit(1);
  }
  
  if (!CONFIG.bodies[body].documentTypes[type]) {
    log.error(`Invalid document type: ${type}. Use 'pv' or 'res'.`);
    process.exit(1);
  }
  
  if (!CONFIG.languages[lang]) {
    log.error(`Invalid language: ${lang}. Use ar, zh, en, fr, ru, or es.`);
    process.exit(1);
  }
  
  // sessionId=0 is the sentinel for legacy GA PV (A/PV.1–2444, pre-1976)
  const minSessionId = (body === 'ga' && type === 'pv') ? 0 : 1;
  if (isNaN(sessionId) || sessionId < minSessionId) {
    log.error(`Invalid session-id: ${sessionId}`);
    process.exit(1);
  }
  
  if (isNaN(docId) || docId < 1) {
    log.error(`Invalid doc-id: ${docId}`);
    process.exit(1);
  }
  
  return { body, type, lang, sessionId, docId };
}


// Download file with retry logic
async function downloadFile(url, filename, retryCount = 0) {
  try {
    const response = await fetch(url, {
      timeout: CONFIG.timeout,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const buffer = await response.arrayBuffer();
    fs.writeFileSync(filename, Buffer.from(buffer));
    log.success(`Downloaded: ${filename}`);
    return true;
  } catch (error) {
    if (retryCount < CONFIG.retries) {
      log.info(`Retry ${retryCount + 1}/${CONFIG.retries} for ${url}`);
      await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
      return downloadFile(url, filename, retryCount + 1);
    }
    throw error;
  }
}

// Scrape document.
// If `browser` is provided the caller manages its lifecycle; otherwise a temporary
// browser is launched and closed within this call.
async function scrapeDocument(baseUrl, sessionId, docId, type, lang, body, browser = null) {
  const ownBrowser = browser === null;
  let page;

  try {
    if (ownBrowser) {
      log.info(`Opening browser...`);
      browser = await puppeteer.launch(BROWSER_LAUNCH_OPTS);
    }

    page = await browser.newPage();
    await page.setViewport({ width: 1024, height: 768 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    const downloadPath = path.join(__dirname, lang, body, String(sessionId), type);
    ensureDir(downloadPath);

    log.info(`Navigating to: ${baseUrl}`);
    const response = await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: CONFIG.timeout });

    log.debug(`Response status: ${response.status()}`);

    // Check if the page itself is a PDF
    const contentType = response.headers()['content-type'] || '';
    if (contentType.includes('pdf')) {
      log.info('Page is a PDF, downloading directly');
      const filename = `document_${docId}.pdf`;
      const filepath = path.join(downloadPath, filename);

      const buffer = await response.buffer();
      fs.writeFileSync(filepath, buffer);
      log.success(`Downloaded: ${filepath}`);
      return true;
    }

    // Try to find PDF link on page
    const pdfUrl = await page.evaluate(() => {
      // Look for direct PDF links
      const links = document.querySelectorAll('a[href*=".pdf"], a[href*="PDF"]');
      if (links.length > 0) {
        return links[0].href;
      }

      // Look for download button or link
      const buttons = document.querySelectorAll('a, button');
      for (let btn of buttons) {
        const text = btn.textContent.toLowerCase();
        const href = btn.getAttribute('href');
        if ((text.includes('download') || text.includes('pdf')) && href) {
          return href;
        }
      }

      // Look for iframe sources
      const iframes = document.querySelectorAll('iframe');
      if (iframes.length > 0) {
        const src = iframes[0].src;
        if (src) return src;
      }

      return null;
    });

    if (pdfUrl) {
      log.info(`Found PDF URL on page: ${pdfUrl}`);
      const urlWithoutQuery = pdfUrl.split('?')[0];
      let filename = urlWithoutQuery.split('/').pop() || `document_${docId}.pdf`;
      if (!filename.endsWith('.pdf')) {
        filename = `document_${docId}.pdf`;
      }
      const filepath = path.join(downloadPath, filename);

      await downloadFile(pdfUrl, filepath);
      return true;
    }

    log.error('Could not find document URL on page');
    log.debug(`Page title: ${await page.title()}`);
    log.debug(`Page URL: ${page.url()}`);
    return false;
  } catch (error) {
    log.error(`Scraping failed: ${error.message}`);
    return false;
  } finally {
    if (page) try { await page.close(); } catch {}
    if (ownBrowser && browser) try { await browser.close(); } catch {}
  }
}

// Build URL, scrape, and retry with (OR) suffix on first failure.
// Accepts an externally-managed browser so the caller can share one instance
// across many downloads; pass null to use a temporary per-call browser.
export async function downloadDocument(browser, body, type, lang, sessionId, docId) {
  const url = buildUrl(body, type, sessionId, docId, lang);
  return downloadUrl(browser, url, body, type, lang, sessionId, docId);
}

// Like downloadDocument but takes a pre-built URL instead of constructing one.
// Useful when the caller already knows the exact URL (e.g. from a listing API).
export async function downloadUrl(browser, url, body, type, lang, sessionId, docId) {
  let ok = await scrapeDocument(url, sessionId, docId, type, lang, body, browser);
  if (!ok && !url.endsWith('(OR)')) {
    const orUrl = url + '(OR)';
    log.info(`Trying (OR) fallback: ${orUrl}`);
    ok = await scrapeDocument(orUrl, sessionId, docId, type, lang, body, browser);
  }
  return ok;
}

// Show usage
function showUsage() {
  console.log(`
un-scraper - Download documents from the United Nations Website

Usage: node un-scraper.js [options]

Options:
  --body        Body: 'ga' (General Assembly) or 'sc' (Security Council)
                Default: ga
  --type        Document type: 'pv' (Procès-verbal) or 'res' (Resolution)
                Default: pv
  --lang        Language: ar (Arabic), zh (Chinese), en (English), fr (French),
                ru (Russian), es (Spanish). Default: en
  --session-id  Session identifier. Default: 1
                GA PV: use 0 for legacy globally-numbered meetings (A/PV.1–2444,
                pre-1976). Use 1+ for per-session numbering (session 31 onwards).
                GA RES: sessions 1–30 automatically use Roman numeral URLs
                (e.g. A/RES/103(I)); sessions 31+ use the standard format.
  --doc-id      Document identifier. Default: 1
  --help        Show this message

Examples:
  # General Assembly — modern format
  node un-scraper.js --type=res --session-id=48 --doc-id=20
  node un-scraper.js --type=pv --lang=fr --session-id=68 --doc-id=70

  # General Assembly — legacy formats
  node un-scraper.js --type=res --session-id=1 --doc-id=103   # → A/RES/103(I)
  node un-scraper.js --type=pv  --session-id=0 --doc-id=49   # → undocs.org/A/PV.49

  # Security Council
  node un-scraper.js --body=sc --type=res --session-id=2016 --doc-id=2314
  node un-scraper.js --body=sc --type=pv --doc-id=7851
  `);
}

// Main function
async function main() {
  const argv = parseArgs();

  if (argv.help) {
    showUsage();
    process.exit(0);
  }

  const { body, type, lang, sessionId, docId } = validateArgs(argv);

  log.info(`Starting download:`);
  log.info(`  Body: ${CONFIG.bodies[body].name}`);
  log.info(`  Type: ${CONFIG.bodies[body].documentTypes[type].name}`);
  log.info(`  Language: ${CONFIG.languages[lang].name}`);
  log.info(`  Session: ${sessionId}`);
  log.info(`  Document: ${docId}`);

  // Pass null so downloadDocument manages its own browser lifecycle.
  const success = await downloadDocument(null, body, type, lang, sessionId, docId);

  if (success) {
    log.success('Download completed!');
    process.exit(0);
  } else {
    log.error('Download failed!');
    process.exit(1);
  }
}

if (process.argv[1] === __filename) {
  main().catch(error => {
    log.error(error.message);
    process.exit(1);
  });
}
