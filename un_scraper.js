var casper = require('casper').create({
  verbose: true,
  logLevel: 'debug',
  pageSettings: {
    webSecurityEnabled: false
  }
});

casper.start();

casper.then(function() {
  var sessionBegin = 0;
  var sessionEnd = 70;
  var meetingBegin = 1;
  var meetingEnd = 200;

  if (casper.cli.has('session-begin'))
    sessionBegin = casper.cli.get('session-begin');
  if (casper.cli.has('session-end'))
    sessionEnd = casper.cli.get('session-end');
  if (casper.cli.has('meeting-begin'))
    meetingBegin = casper.cli.get('meeting-begin');
  if (casper.cli.has('meeting-end'))
    meetingEnd = casper.cli.get('meeting-end');

  for (var i = sessionBegin; i <= sessionEnd; i++) {
    for (var j = meetingBegin; j <= meetingEnd; j++) {
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
              var content = self.getElementAttribute('meta[http-equiv="refresh"]', 'content');
              if (content === null)
                return;
              var url = content.split('; ')[1].split('=')[1];
              var filename = './' + sessionId + '/' + url.replace(/^.*[\\\/]/, '').split('?')[0];
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
      })('http://www.un.org/en/ga/search/view_doc.asp?symbol=A/' + i + '/PV.' + j, i);
    }
  }
});

casper.run(function() {
  this.echo('Done.').exit();
});
