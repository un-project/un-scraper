var casper = require('casper').create({
  verbose: true,
  logLevel: 'debug',
  pageSettings: {
    webSecurityEnabled: false
  }
});

casper.start();

casper.then(function() {
  var sessionId = 1;
  var docId = 1;
  var sep1 = '/';
  var sep2 = '/PV.';
  var lang = 'E';
  var urlPrefix = 'http://www.un.org/en/ga/search/view_doc.asp?symbol=A';

  casper.cli.drop("cli");
  casper.cli.drop("casper-path");
  if (casper.cli.args.length === 0 &&
      Object.keys(casper.cli.options).length === 0) {
    this.echo("No arg nor option passed").exit();
  }

  if (casper.cli.has('lang')) {
    lang = casper.cli.get('lang');
  }

  if (casper.cli.has('type') && casper.cli.get('type') !== 'pv') {
    if (casper.cli.get('type') === 'res') {
      sep1 = '/RES/';
      sep2 = '/';
    }
  }

  if (casper.cli.has('session-id'))
    sessionId = casper.cli.get('session-id');
  if (casper.cli.has('doc-id'))
    docId = casper.cli.get('doc-id');

  (function(url, sessionId) {
    casper.thenOpen(url, function() {
      this.echo('casper.async: ' + url);
    });

    casper.withFrame('mainFrame', function() {
      this.echo('casper.getCurrentUrl: ' + this.getCurrentUrl());
      (function(self, frameUrl, sessionId) {
        casper.thenOpen(frameUrl, function () {
          self.echo('open ' + frameUrl);
        });

        casper.waitFor(function check() {
          var content = self.getElementAttribute(
              'meta[http-equiv="refresh"]', 'content');
          if (content === null)
            return;
          var url = content.split('; ')[1].split('=')[1];
          var filename = './' + sessionId + '/' +
            url.replace(/^.*[\\\/]/, '').split('?')[0];
          self.echo('download ' + url);
          self.echo('to ' + filename);
          return self.download(url, filename);
        }, function then() {
          self.echo('then');
        }, function timeout() {
          self.echo('timeout');
        });
      })(this, this.getCurrentUrl(), sessionId);
    });
  })(urlPrefix + sep1 + sessionId + sep2 + docId + '&Lang=' + lang, sessionId);
});

casper.run(function() {
  this.echo('Done.').exit();
});
