# un-scraper - a scrapping tool to download documents from the United Nations Website

## Install

git clone or download the code

```
$ npm install -g casperjs phantomjs
```

## Usage

  Usage: casperjs un-scraper.js [options]

  Options:

    --type        Specify the type of document. Possible values are ``pv`` and
                  ``res``. The default value is ``pv``.
    --session-id  The session identifier. The default value is 1.
    --doc-id      The document identifier. The default value is 1.

  Any other options are passed to casperjs (see `casperjs --help`)

  Examples:

    $ casperjs un-scraper.js --type=res --session-id=48 --doc-id=20
    $ casperjs un-scraper.js --type=pv --session-id=68 --doc-id=192
