# un-scraper

A modern web scraper for downloading documents from the United Nations Website. Built with Puppeteer for reliable, efficient scraping.

## Features

- 🚀 Modern async/await implementation with error handling
- 🔄 Automatic retry logic for failed downloads
- 🌍 Support for 6 languages (Arabic, Chinese, English, French, Russian, Spanish)
- 📄 Downloads both Procès-verbal (PV) and Resolution (RES) documents
- 📊 Clear status logging and progress reporting
- ✨ Uses Puppeteer (maintained, modern browser automation)

## Requirements

- Node.js 18.0.0 or higher
- npm or yarn

## Installation

```bash
git clone https://github.com/un-project/un-scraper.git
cd un-scraper
npm install
```

## Usage

```bash
node un-scraper.js [options]
```

### Options

- `--body` - UN body: `ga` (General Assembly) or `sc` (Security Council). Default: `ga`
- `--type` - Document type: `pv` (Procès-verbal) or `res` (Resolution). Default: `pv`
- `--lang` - Language code: `ar` (Arabic), `zh` (Chinese), `en` (English), `fr` (French), `ru` (Russian), `es` (Spanish). Default: `en`
- `--session-id` - Session/Year identifier. Default: `1`
- `--doc-id` - Document identifier. Default: `1`
- `--help` - Show help message

### Examples

```bash
# General Assembly (default)
node un-scraper.js --type=res --session-id=48 --doc-id=20
node un-scraper.js --type=pv --lang=fr --session-id=68 --doc-id=70
node un-scraper.js --type=res --lang=es --session-id=48 --doc-id=20
node un-scraper.js --session-id=48 --doc-id=15

# Security Council
node un-scraper.js --body=sc --type=res --session-id=2016 --doc-id=2314
node un-scraper.js --body=sc --type=pv --doc-id=7851
node un-scraper.js --body=sc --type=pv --lang=fr --doc-id=7851
```

## Batch downloading

`fetch-all.js` wraps `un-scraper.js` to download large swaths of the UN document
archive in one go.

```bash
node fetch-all.js [options]
```

### Options

- `--lang=CODE` — comma-separated language codes, or `all` (default: `en`). Codes: `ar`, `zh`, `en`, `fr`, `ru`, `es`
- `--body=BODY` — limit to `ga`, `sc`, or `all` (default: `all`)
- `--type=TYPE` — limit to `pv`, `res`, or `all` (default: `all`)
- `--dry-run` — print what would be downloaded without actually running the scraper

### Examples

```bash
# Download all English documents for both bodies
node fetch-all.js

# Download General Assembly resolutions in French and Spanish
node fetch-all.js --body=ga --type=res --lang=fr,es

# Download all documents in all six UN languages
node fetch-all.js --lang=all

# Preview what a Security Council PV run would fetch
node fetch-all.js --body=sc --type=pv --dry-run
```

The script skips documents that have already been downloaded (by checking the output
directory), so it is safe to interrupt and resume.

## Output

Downloaded documents are organized by language, UN body, session ID, and document type in a nested directory structure:
```
English (en):
  ./en/ga/48/res/document_20.pdf      # GA Resolution 48/20
  ./en/ga/68/pv/document_70.pdf       # GA Procès-verbal 68/70
  ./en/ga/48/pv/document_15.pdf       # GA Procès-verbal 48/15
  ./en/sc/2016/res/document_2314.pdf  # SC Resolution 2314(2016)
  ./en/sc/1/pv/document_7851.pdf      # SC Procès-verbal 7851

French (fr):
  ./fr/ga/68/pv/document_70.pdf       # GA Procès-verbal 68/70
  ./fr/sc/1/pv/document_7851.pdf      # SC Procès-verbal 7851

Spanish (es):
  ./es/ga/48/res/document_20.pdf      # GA Resolution 48/20
```

## What's New (v2.0.0)

- ✅ Migrated from CasperJS/PhantomJS to Puppeteer
- ✅ Refactored with async/await (no more callback hell)
- ✅ Added comprehensive error handling and retry logic
- ✅ Improved logging and user feedback
- ✅ Input validation for all parameters
- ✅ Modern Node.js module system (ESM)
- ✅ Better code organization with configuration constants

## Development

To enable debug logging, set the DEBUG environment variable:

```bash
DEBUG=1 node un-scraper.js --session-id=1 --doc-id=1
```

## License

MIT
