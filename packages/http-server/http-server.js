// XXX depend on a dummy ArrayBuffer package
// XXX align names with our http client API
// XXX let the user control what we gzip
// XXX pattern for query string parsing
// XXX http vs https, 80 vs 443 (X-Forwarded-Proto)

(function () {

var Future = __meteor_bootstrap__.require('fibers/future');
// js2-mode AST blows up when parsing 'future.return()', so alias.
Future.prototype.ret = Future.prototype.return;

HttpServer = function () {
  var self = this;

  self._nextListenerId = 1;
  self._listeners = {}; // listener id => listener

  __meteor_bootstrap__.app.use(function (req, res, next) {
    var ids = _.keys(self.listeners);

    for (var i = 0; i < ids.length; i++) {
      var listener = self.listeners[id];
      if (! listener)
        continue;

      // XXX need to test host (they could be sending weird traffic at us..)
      // XXX and need to somehow get port (I guess from PORT)

      if (! listener.urlPattern.test(req.url))
        continue;

      // Found the correct handler. Note that we don't allow the
      // handler to decline the request. That's because in a real
      // deploy, that would potentially involve returning the request
      // to the reverse proxy tier and asking it to redispatch it,
      // which seems unreasonable.

      // XXX need to dispatch inside a thread
      handler(new HttpRequest(req, res));
      return;
    }

    // XXX serve 404?
    next();
  });
};

/**
 * Listen for HTTP requests that match a pattern.
 *
 * @param {String} host The hostname to listen on. It may be a
 * specific host like "mydomain.com" or "site.mydomain.com", or it may
 * be a wildcard that starts with "*.", such as "*.mydomain.com", or
 * "*.site.mydomain.com". Wildcards match exactly one name part, that
 * is, "*.mydomain.com" does not match "subsite.site.mydomain.com". It
 * can also be an IP address, such as "1.1.1.1", to listen to all
 * requests received on a particular IP. When listening on an IP, if a
 * request is received that doesn't include a HTTP/1.1 Host: header,
 * it will be rejected with a 400 error code (Bad Request.) The string
 * host also optionally * contain a port, as in
 * "mydomain.com:1234". If no port is provided it defaults to 80. No
 * IDNA encoding is * performed, so if you want to listen on a
 * hostname that contains * characters other than letters, digits, and
 * hyphens, you will need * to perform the IDNA encoding yourself. No
 * distinction is made between listening for http and for https (this
 * is considered an operational question.)
 *
 * @param {RegExp} urlPattern The URL pattern to listen for. The URL
 * will be formatted as a relative URL beginning with a '/', for
 * example '/' or '/mypage?thing=1'.
 *
 * @param {Function} handler The function to call when a HTTP request
 * is received on `host` for a path matching `pathRegexp`. It receives
 * one argument, the request.
 *
 * @return {Object} A handle for the listener. It is an object with
 * one method `stop`. Call `stop()` to stop listening.
 *
 * This function will throw an exception if the process doesn't have
 * permission to listen to requests on the requested `host`.
 *
 * If the client sends an "Expect: 100-continue" header, the server
 * will automatically respond with "100 Continue" to tell the client
 * to send the rest of the request. In the future, we might provide a
 * hook to let your code reject such a request after looking at the
 * headers, rather than telling the client to send the request body.
 *
 * XXX specify what happens if multiple match (XXX need to solve this
 * so we can server 404's)
 */

HttpServer.prototype.listen = function (host, urlPattern, handler) {
  var self = this;
  var id = self._nextListenerId ++;

  // XXX for now: check to see if host matches where we are
  // listening. if not, throw an exception. (in the future the
  // intention is that this will automatically register this process
  // with your reverse proxy tier, using a credential that this
  // process was given by the deploy tool)

  // XXX process.env.ROOT_URL is 'http(s)://mysite.com:3000'
  // no port if 80 or 443 (as appropriate)
  // or could be 'http://1.1.1.1'
  // need to special-case localhost === 127.0.0.1
  // otherwise, if you're typing an IP in the address bar, you get what you get

  var pattern = new RegExp('^' + urlPattern.pattern,
                           urlPattern.ignoreCase ? 'i' : '');

  self._listeners[id] = {
    host: host,
    urlPattern: pattern,
    handler: handler
  };

  return {
    stop: function () {
      delete self._listeners[id];
    }
  };
};

/**
 * Represents an inbound HTTP request (as delivered by
 * HttpServer.listen.)
 */
HttpRequest = function (req, res) {
  var self = this;

  /**
   * {String} The HTTP verb, such as 'GET' or 'POST'.
   */
  self.method = req.method;

  /**
   * {String} The host where the request was received, possibly
   * including a port, for example "mydomain.com" or
   * "site.mydomain.com:3000". Unlike the 'host' argument to
   * HttpServer.listen, this will never be an IP address and will
   * never contain a "*" wildcard.
   */
  self.host = XXX host;

  /**
   * {String} The URL requested, such as '/' or '/mypage?thing=1'.
   */
  self.url = req.url;

  /**
   * {Boolean} True if the request came in over HTTPS, else
   * false. This is based in part on the X-Forwarded-Proto header. If
   * you need to trust `secure`, then you need to make sure that users
   * can't reach your app without going through a reverse proxy tier
   * that strips out user attempts to set this header.
   */
  self.secure = false; // XXX need to parse X-Forwarded-Proto (http or https)

  /**
   * {String} The HTTP protocol version used for the request, such as
   * '1.1'.
   */
  self.httpVersion = req.httpVersion;

  /**
   * {Object} The request headers, as a map from strings to
   * strings. The complete set of headers may not be available until
   * after all of the request data is read (specifically: if the
   * client uses chunked encoding, then headers will be modified after
   * calling read()/readString() to include any trailers that are sent
   * after the last chunk.)
   */
  self.headers = _.extend({}, req.headers);

  /**
   * {Boolean} True if the "chunked" encoding will be used to send the
   * response data. This will be true for modern (HTTP 1.1) clients,
   * and false for old clients.
   *
   * When chunkedResponse is false, your application code should be
   * sure to (manually) set a Content-Length header. If you do not,
   * Meteor will have to turn off connection keepalive, which for many
   * sites will decrease performance.
   *
   * Also when chunkedResponse is false, it is an error to pass
   * headers ("trailers") to `end`.
   */
  self.chunkedResponse = (self.httpVersion === "1.1");

  /**
   * {Boolean} True if an error occurred (for example, the client
   * dropped the connection) and Meteor has given up on sending a
   * response, meaning that there is no point in calling functions
   * like write().
   */
  self.error = false;

  self._req = req;
  self._res = res;
  self._readCalled = false;

  self._req.pause(); // wait for read() to be called
};

_.extend(HttpRequest.prototype, {
  _readRaw: function (callback, convert, concat) {
    var self = this;
    var parts = [];
    var future = new Future;

    if (self._readCalled)
      throw new Error("read() should only be called once on each HttpRequest");
    self._readCalled = true;

    if (self.error)
      return;

    self._req.on('data', function (data) {
      if (! future)
        return;

      if (callback) {
        if (callback(convert(data)) === false) {
          // we've been asked to stop reading
          self._req.connection.destroy();
          self.error = true;
          future.ret();
        }
      } else
        parts.push(data);
    });

    self._req.on('end', function () {
      if (! future)
        return;

      future.ret();
    });

    // 'close' is called if we lose the TCP connection before we are
    // totally done (before we've called end() on the respone)
    self._req.on('close', function () {
      // can continue to be called after read() has returned
      self.error = true;
      if (future)
        future.ret();
    });

    // run until 'end' or 'close'
    self._req.resume();
    future.wait();
    future = null; // prevent further callbacks (except 'close')

    if (self.error)
      return false;

    if (callback)
      return true;
    else
      return convert(Buffer.concat(parts));
  },

  /**
   * Read the contents of the request body. If no `callback` is
   * provided, the contents of the body are read off of the network
   * into a buffer and returned as an ArrayBuffer. Otherwise,
   * `callback` is synchronously called zero or more times with a
   * single argument, an ArrayBuffer, to deliver the request body in
   * smaller pieces. The function will not return until the entire
   * request body has been read.
   *
   * If the entire request body was not read successfully, then this
   * function returns `false`. Otherwise it return the data (no
   * callback provided) or `true` (if a callbacks was provided.)
   *
   * When using a callback, the callback can return `false` to stop
   * reading the body and drop the HTTP connection (for example, if
   * the client tries to send an unreasonably large amount of data.)
   *
   * XXX we need to provide the ability to set a timeout on how long
   * it can take to read a request, probably in terms of both
   * wallclock time and transfer rate, and give it a reasonable
   * default value
   */
  read: function (callback) {
    var self = this;

    return self._readRaw(
      function (buffer) {
        // XXX we actually have to copy the data from the node.js
        // Buffer into the W3C ArrayBuffer. at some point we'll want
        // to write C code to avoid the copy, if the node guys don't
        // get there first.
        var ret = new ArrayBuffer(buffer.length);
        var retTyped = new Uint8Array(ret);
        var len = buffer.length;
        for (var i = 0; i < len; i++)
          retTyped[i] = buffer[i];
        return ret;
      }
    );
  },

  /**
   * Works just like 'read', but returns the body as a string rather
   * than an ArrayBuffer. The correct character encoding will be
   * automatically determined from the request headers. Specifically,
   * the character encoding will be determined by the 'charset' option
   * to Content-Type header, and if this option isn't present, then
   * the HTTP default of ISO-8859-1 will be used.
   */
  readString: function (callback) {
    var self = this;

    var encoding = /* XXX determine HTTP encoding */;

    // XXX may have to resort to iconv if we actually want to support
    // ISO-8859-1.. but why? can't we just legislate that the client
    // will use utf8?

    return self._readRaw(
      function (buffer) {
        return buffer.toString(/* XXX node encoding */);
      }
    );
  },

  /**
   * Begin sending the response to the request. The only required
   * argument is statusCode.
   *
   * @param {Number} statusCode an HTTP status code, such as 200 or
   * 404
   *
   * @param {String} reasonPhrase a human-readable message to go with
   * statusCode, for example "Not found" for 404. If omitted or set to
   * null, Meteor will supply a default phrase that's appropriate for
   * statusCode.
   *
   * @params {Object} headers HTTP headers to send with the response
   * (a map from strings to strings.)
   *
   * If `error` is true then this method does nothing.
   *
   * In general the headers are sent exactly as supplied, but there is
   * special handling for a few headers:
   *
   * Date: If you do not supply a Date header, then Meteor will supply
   * one with the current server time, as required by the standard.
   *
   * Transfer-Encoding: Do not supply this header. Meteor will choose
   * an appropriate transfer coding and set the header ('chunked' for
   * HTTP/1.1 clients, or no encoding for older clients.)
   *
   * Connection: If you don't supply a Connection header, and
   * `chunkedResponse` is false, and you do not provide a
   * Content-Length header, then Meteor will supply a "Connection:
   * close" header. (But this is probably unnecessary in normal use,
   * since if `chunkedResponse` is false, you are talking to a
   * pre-HTTP/1.1 client and the default is no keepalive. For that
   * reason, this may be removed in the future.)
   */
  begin: function (statusCode, reasonPhrase, headers) {
    var self = this;

    // Make sure the 'close' callback is set up
    if (! self._readCalled)
      self.read();

    // XXX use writeHead
  },

  /**
   * Send the body of the response. This function may be called
   * multiple times to write successive parts of the response.
   *
   * @param {ArrayBuffer} data Response data to send to the client
   *
   * This function may block until buffer space is available. It has
   * no effect if `error` is true (for example, if the remote has
   * dropped the connection.)
   */
  write: function (data) {
  },

  /**
   * Just like `write` but takes a string rather than an
   * `ArrayBuffer`. If the string contains non-ASCII characters they
   * will be automatically encoded (using the encoding specified in
   * the `charset` option on the `Content-Type` response header if
   * provided, or else the HTTP default encoding, ISO-8859-1.)
   */
  writeString: function (data) {
  },

  /**
   * Finish responding to the request. Must be called exactly once,
   * after all of the response body data has been written with
   * `write`.
   *
   * `headers` may be additional HTTP headers to send in the
   * 'trailers' portion of the response. (This is only allowed when
   * `chunkedResponse` is true. If false, and headers are given, an
   * exception is thrown.)
   */
  end: function (headers) {
  }
});

// Singleton
HttpServer = new HttpServer;

})();


/*
request:
 - events: data, end, close
 - attributes: method, url, headers, trailers, httpVersion
 - methods:
   - setEncoding
   - pause, resume
   - connection

The model is that you get the data as a buffer, unless you've called
setEncoding in which case you get it as a string (having been decoded
as instructed.)

response:
 - events: close
 - methods:
   - writeContinue
   - writeHead(statusCode, [reasonPhrase, headers])
     - if you call write() first, we'll write the header for you
     - based on properties you set: statusCode, setHeader
       - date's set for you (sendDate)
       - can modify/read headers before they're sent
   - write, end
     - write returns true if entirely flushed. else, can listen for 'drain'
       event
   - addTrailers

The model is that you can pass in strings, but only if you specify the
encoding. Setting headers correctly to match is up to you.

*/
