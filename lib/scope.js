var path            = require('path')
  , fs              = require('fs')
  , globalIntercept = require('./intercept')
  , mixin           = require('./mixin')
  , assert          = require('assert')

var noop = function() {};

function isStream(obj) {
  return (typeof obj !== 'undefined') && (typeof a !== 'string') && (! Buffer.isBuffer(obj)) && (typeof obj.setEncoding == 'function');
}

function startScope(basePath, options) {
  var interceptors = {},
      scope,
      transformPathFunction,
      transformRequestBodyFunction,
      matchHeaders = [],
      logger = noop,
      scopeOptions = options || {};
  
  function add(key, interceptor) {
    if (! interceptors.hasOwnProperty(key)) {
      interceptors[key] = [];
    }
    interceptors[key].push(interceptor);
    globalIntercept(basePath, interceptor);
  }
  
  function remove(key, interceptor) {
    var arr = interceptors[key];
    if (arr) {
      arr.splice(arr.indexOf(interceptor), 1);
      if (arr.length === 0) { delete interceptors[key]; }
    }
  }
  
  function intercept(uri, method, requestBody, interceptorOptions) {
    var interceptorMatchHeaders = [];
    var key = method.toUpperCase() + ' ' + basePath + uri;
    if (typeof(requestBody) != 'undefined' && typeof(requestBody) !== 'string') {
      try {
        requestBody = JSON.stringify(requestBody);
      } catch(err) {
        throw new Error('Error encoding request body into JSON');
      }
    }
    
    if (requestBody) { key += (' ' + requestBody); } 
    
    function reply(statusCode, body, headers) {
      this.statusCode = statusCode;

      this.options = interceptorOptions || {};
      for(var opt in scopeOptions) {
        if(typeof this.options[opt] === 'undefined') {
          this.options[opt] = scopeOptions[opt];
        }
      }

      if (typeof(body) === 'function') {
        body = body.call(this, uri, requestBody);
      }

      if (typeof(body) !== 'string' && !Buffer.isBuffer(body) && !isStream(body)) {
        try {
          body = JSON.stringify(body);
        } catch(err) {
          throw new Error('Error encoding response body into JSON');
        }
      }

      if (scope._defaultReplyHeaders) {
        headers || (headers = {});
        headers = mixin(scope._defaultReplyHeaders, headers);
      }

      if (headers !== undefined) {
        this.headers = {};

        // makes sure all keys in headers are in lower case
        for (var key2 in headers) {
          if (headers.hasOwnProperty(key2)) {
            this.headers[key2.toLowerCase()] = headers[key2];
          }
        }
      }

      this.body = body;
      add(key, this);
      return scope;
    }
    
    function replyWithFile(statusCode, filePath, headers) {
      var readStream = fs.createReadStream(filePath);
      readStream.pause();
      return reply.call(this, statusCode, readStream, headers);
    }
    
    function match(options, body) {
      var method = options.method || 'GET'
        , path = options.path
        , matches
        , proto = options.proto;
        
      if (transformPathFunction) { path = transformPathFunction(path); }
      if (typeof(body) !== 'string') {
        body = body.toString();
      }
      if (transformRequestBodyFunction) { body = transformRequestBodyFunction(body); }


      var checkHeaders = function(header) {
        return options.getHeader(header.name) === header.value;
      };
      if (!matchHeaders.every(checkHeaders) ||
          !interceptorMatchHeaders.every(checkHeaders)) {
        return false;
      }

      var matchKey = method + ' ' + proto + '://' + options.host + path;
      if (body) { matchKey += (' ' + body); }
      matches = matchKey === this._key;
      logger('matching ' + matchKey + ' to ' + this._key + ': ' + matches);
      return matches;
    }

    function matchIndependentOfBody(options) {
      var method = options.method || 'GET'
        , path = options.path
        , matches
        , proto = options.proto;
        
      if (transformPathFunction) { path = transformPathFunction(path); }

      var checkHeaders = function(header) {
        return options.getHeader && options.getHeader(header.name) === header.value;
      };
      if (!matchHeaders.every(checkHeaders) ||
          !interceptorMatchHeaders.every(checkHeaders)) {
        return false;
      }

      var matchKey = method + ' ' + proto + '://' + options.host + path;
      return this._key === matchKey
    }
    
    function filteringPath() {
      if (typeof arguments[0] === 'function') {
        this.transformFunction = arguments[0];
      }
      return this;
    }
    
    function discard() {
      remove(this._key, this);
    }

    function matchHeader(name, value) {
      interceptorMatchHeaders.push({ name: name, value: value });
      return this;
    }

    var interceptor = {
        _key: key
      , reply: reply
      , replyWithFile: replyWithFile
      , discard: discard
      , match: match
      , matchIndependentOfBody: matchIndependentOfBody
      , filteringPath: filteringPath
      , matchHeader: matchHeader
    };
    
    return interceptor;
  }

  function get(uri, requestBody, options) {
    return intercept(uri, 'GET', requestBody, options);
  }
  
  function post(uri, requestBody, options) {
    return intercept(uri, 'POST', requestBody, options);
  }

  function put(uri, requestBody, options) {
    return intercept(uri, 'PUT', requestBody, options);
  }

  function _delete(uri, requestBody, options) {
    return intercept(uri, 'DELETE', requestBody, options);
  }
  
  function pendingMocks() {
    return Object.keys(interceptors);
  }
  
  function isDone() {
    var keys = Object.keys(interceptors);
    if (keys.length === 0) {
      return true;
    } else {
      var doneHostCount = 0;

      keys.forEach(function(key) {
        var doneInterceptorCount = 0;

        interceptors[key].forEach(function(interceptor) {
          var isDefined = (typeof interceptor.options.requireDone !== 'undefined');
          if (isDefined && interceptor.options.requireDone === false) {
            doneInterceptorCount += 1;
          }
        });

        if( doneInterceptorCount === interceptors[key].length ) {
          doneHostCount += 1;
        }
      });
      return (doneHostCount === keys.length);
    }
  }
  
  function done() {
    assert.ok(isDone(), "Mocks not yet satisfied:\n" + pendingMocks().join("\n"));
  }
  
  function filteringPath() {
    var filteringArguments = arguments;
    
    if (arguments[0] instanceof RegExp) {
      transformPathFunction = function(path) {
        if (path) {
          path = path.replace(filteringArguments[0], filteringArguments[1]);
        }
        return path;
      }
    } else {
      if (typeof (arguments[0]) === 'function') {
        transformPathFunction = arguments[0];
      } else {
        throw new Error('Invalid arguments: filtering path should be a function or a regular expression');
      }
    }
    return this;
  }
  
  function filteringRequestBody() {
    var filteringArguments = arguments;
    
    if (arguments[0] instanceof RegExp) {
      transformRequestBodyFunction = function(path) {
        if (path) {
          path = path.replace(filteringArguments[0], filteringArguments[1]);
        }
        return path;
      }
    } else {
      if (typeof (arguments[0]) === 'function') {
        transformRequestBodyFunction = arguments[0];
      } else {
        throw new Error('Invalid arguments: filtering request body should be a function or a regular expression');
      }
    }
    return this;
  }

  function matchHeader(name, value) {
    matchHeaders.push({ name: name, value: value });
    return this;
  }

  function defaultReplyHeaders(headers) {
    this._defaultReplyHeaders = headers;
    return this;
  }
  
  function log(newLogger) {
    logger = newLogger;
    return this;
  }

  function clear() {
    interceptors = {};
    return this;
  }
  
  scope = {
      get: get
    , post: post
    , delete: _delete
    , put: put
    , intercept: intercept
    , done: done
    , isDone: isDone
    , filteringPath: filteringPath
    , filteringRequestBody: filteringRequestBody
    , matchHeader: matchHeader
    , defaultReplyHeaders: defaultReplyHeaders
    , log: log
    , clear: clear
  };

  return scope;
}

function cleanAll() {
  globalIntercept.removeAll();
  return module.exports;
}

module.exports = startScope;

module.exports.cleanAll = cleanAll;
