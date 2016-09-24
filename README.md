# un-scraper - a scrapping tool to download documents from the United Nations Website

## Install

git clone or download the code

```
$ npm install -g casperjs phantomjs
```

## Usage

  Usage: casperjs un-scraper.js [options]

  Options:

    --type        Specify the type of document. Possible values are ``pv``
                  (Procès-verbal), and ``res`` (Resolution). The default value
                  is ``pv``.
    --lang        Specify the language. Possible values are ``A`` (Arabic),
                  ``C`` (Mandarin Chinese), ``E`` (English), ``F`` (French),
                  ``R`` (Russian), and ``S`` (Spanish). The default value is
                  ``E``.
    --session-id  Specify the session identifier. The default value is 1.
    --doc-id      Specify the document identifier. The default value is 1.

  Any other options are passed to casperjs (see `casperjs --help`)

  Examples:

    $ casperjs un-scraper.js --type=res --session-id=48 --doc-id=20
    $ casperjs un-scraper.js --type=pv --session-id=68 --doc-id=192
    $ casperjs un-scraper.js --type=pv --lang=F --session-id=68 --doc-id=192
