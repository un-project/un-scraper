# TODO

Potential improvements for this repository.

## Performance

- [x] **Parallelise downloads** — `fetch-all.js` runs each scraper invocation serially.
  Launching a small pool of concurrent workers (e.g. with `p-limit`) would cut total
  runtime substantially for large batches.
- [x] **Reuse browser instance** — `un-scraper.js` launches and closes a full Chromium
  browser for every single document. Sharing one browser (or a pool of pages) across
  calls from `fetch-all.js` would eliminate the per-document startup overhead.
- [x] **Rate limiting / polite delay** — add a configurable delay between requests to avoid
  hammering the UN servers and triggering throttling.

## Reliability

- [x] **SC PV upper bound** — `SC_PV_LAST_DOC` is hard-coded to 3000; SC meetings are now
  well past that number. Either raise the cap or derive it dynamically.
- [x] **SC RES year ranges** — the 2024 upper bound is marked "extend if needed" and years
  before 2008 are commented out. Restore or auto-detect the full range.
- [ ] **GA session cap** — `GA_LAST_SESSION` must be updated manually each year.
  Consider deriving the current session from the current date automatically.
- [ ] **Error logging** — failed documents are only reported to stdout and then forgotten.
  Writing a machine-readable log (e.g. `failed.jsonl`) would make it easy to retry
  only what failed without re-running the full batch.
- [ ] **Resume / progress file** — currently `docAlreadyDownloaded` checks the filesystem
  on every iteration. A lightweight progress file would be faster and would also
  survive accidental deletion of partial output.

## Code quality

- [ ] **Tests** — `package.json` has `"test": "echo Error: no test specified"`. Add at
  least unit tests for `buildUrl`, `toRoman`, and `parseArgs` (no network required).
- [ ] **Split responsibilities** — `un-scraper.js` mixes CLI parsing, URL construction,
  filesystem I/O, and browser automation in one file. Extracting `buildUrl` and
  `ensureDir` into a shared module would let `fetch-all.js` import them directly
  instead of spawning a child process per document.
- [ ] **`--session-id` / `--doc-id` passed as strings** — `parseInt` is called in
  `validateArgs` but the raw string values are still passed to `spawn` in
  `fetch-all.js`; no harm today, but making the types consistent would prevent
  future surprises.
- [ ] **`response.buffer()` deprecation** — Puppeteer ≥ 21 removed `Response.buffer()`;
  the call at line 211 of `un-scraper.js` should use `response.bytes()` instead.

## Features

- [x] **`--from-session` / `--to-session` flags** for `fetch-all.js** — let users target
  a sub-range without editing the source constants.
- [x] **Multiple languages in one run** — currently `--lang` accepts only one code;
  accepting a comma-separated list (or `--lang=all`) would simplify bulk multilingual
  downloads.
- [ ] **Output format options** — some users may want a flat directory or a different
  naming convention; make the output path template configurable.
- [ ] **ECONC / HRC bodies** — the UN has other bodies (Economic and Social Council,
  Human Rights Council, etc.) whose documents follow similar URL patterns.