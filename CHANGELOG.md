# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `TODO.md` tracking potential improvements to the repository
- `fetch-all.js` batch downloader documentation section in README
- `fetch-all.js`: batch downloader for GA and SC documents (PV and resolutions)
- `fetch-all.js`: `--lang` now accepts a comma-separated list of codes or `all` (e.g. `--lang=fr,es`, `--lang=all`)
- `fetch-all.js`: `--from-session` and `--to-session` flags to target a sub-range without editing source constants (GA: session; SC RES: year; SC PV: meeting number)
- Support for legacy GA PV globally-numbered meetings (A/PV.1–2444, pre-1976) via `--session-id=0`
- Support for GA resolution Roman-numeral URLs (sessions 1–30, e.g. `A/RES/103(I)`)

## [2.0.0] - 2026-03-05

### Changed
- **BREAKING**: Migrated from CasperJS/PhantomJS to Puppeteer for modern, maintained browser automation
- **BREAKING**: Refactored entire codebase to use async/await instead of callbacks
- **BREAKING**: Changed from global CLI tool to local Node.js script (use `node un-scraper.js` instead of `casperjs un-scraper.js`)
- **BREAKING**: Changed to ESM module system - requires Node.js 18.0.0+
- Updated package.json with proper versioning and metadata
- Improved help text and usage examples

### Added
- Comprehensive error handling with try-catch blocks
- Automatic retry logic for failed downloads (3 attempts with exponential backoff)
- Input validation for all CLI parameters (type, language, session ID, doc ID)
- Improved logging system with info/error/success/debug levels
- Configuration constants for URLs, timeouts, and retry settings
- Support for `--help` flag
- DEBUG environment variable support for verbose logging
- .gitignore file for common ignores
- Detailed CHANGELOG.md documentation

### Fixed
- Fixed silent failures - now provides clear error messages
- Fixed deeply nested callback code (now uses async/await)
- Fixed magic strings and hardcoded values
- Fixed missing timeout handling
- Fixed no validation on CLI arguments

### Improved
- Better code readability and maintainability
- Clear separation of concerns (configuration, validation, logging, scraping)
- More informative user feedback during execution
- Proper exit codes (0 for success, 1 for failure)
- Better organized output directories by session

## [1.0.0] - Legacy

- Initial version using CasperJS/PhantomJS
- Basic document scraping functionality
- Support for multiple document types and languages
