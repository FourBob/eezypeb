/*
 * Eezy-Anbindung (läuft auf dem Handy in PebbleKit JS).
 *
 * Eezy Oyj hat keine öffentliche API. Die Endpunkte unten sind PLATZHALTER
 * und müssen an den tatsächlichen Netzwerkverkehr der Eezy-Talents-App
 * angepasst werden (siehe README, Abschnitt "Eezy-Endpunkte ermitteln").
 * Alles Eezy-Spezifische ist in dieser Datei gekapselt; index.js und der
 * C-Teil müssen dafür nicht angefasst werden.
 *
 * Konfigurierbar über die Einstellungsseite (Clay) auf dem Handy:
 *   baseUrl, email, password, loginPath, clockInPath, clockOutPath, tokenField
 */

var DEFAULTS = {
  baseUrl: 'https://talents.eezy.fi/api',   // ANPASSEN
  loginPath: '/auth/login',                 // ANPASSEN
  clockInPath: '/shifts/current/start',     // ANPASSEN
  clockOutPath: '/shifts/current/end',      // ANPASSEN
  tokenField: 'token'                       // ANPASSEN: Feld mit dem Token in der Login-Antwort
};

var SETTINGS_KEY = 'eezy-settings';
var TOKEN_KEY = 'eezy-token';
var STATE_KEY = 'eezy-logged-in';
var REQUEST_TIMEOUT_MS = 15000;

/* ------------------------------------------------------------------ */
/* Einstellungen und lokaler Zustand                                   */
/* ------------------------------------------------------------------ */

function readJson(key, fallback) {
  try {
    var raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function getSettings() {
  var stored = readJson(SETTINGS_KEY, {});
  var s = {};
  for (var k in DEFAULTS) {
    s[k] = stored[k] || DEFAULTS[k];
  }
  s.email = stored.email || '';
  s.password = stored.password || '';
  return s;
}

function saveSettings(settings) {
  writeJson(SETTINGS_KEY, settings);
  // Neue Zugangsdaten machen ein altes Token ungültig.
  localStorage.removeItem(TOKEN_KEY);
}

function isLoggedIn() {
  return readJson(STATE_KEY, false) === true;
}

function setLoggedIn(flag) {
  writeJson(STATE_KEY, !!flag);
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

function joinUrl(base, path) {
  if (/^https?:\/\//.test(path)) {
    return path;
  }
  return base.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '');
}

function request(method, url, body, token, callback) {
  var xhr = new XMLHttpRequest();
  var done = false;

  function finish(err, status, data) {
    if (done) { return; }
    done = true;
    callback(err, status, data);
  }

  xhr.open(method, url, true);
  xhr.timeout = REQUEST_TIMEOUT_MS;
  xhr.setRequestHeader('Accept', 'application/json');
  if (body !== null && body !== undefined) {
    xhr.setRequestHeader('Content-Type', 'application/json');
  }
  if (token) {
    // ANPASSEN, falls Eezy kein Bearer-Token, sondern z. B. ein Cookie oder
    // einen eigenen Header verwendet.
    xhr.setRequestHeader('Authorization', 'Bearer ' + token);
  }

  xhr.onload = function () {
    var data = null;
    if (xhr.responseText) {
      try { data = JSON.parse(xhr.responseText); } catch (e) { data = xhr.responseText; }
    }
    finish(null, xhr.status, data);
  };
  xhr.onerror = function () { finish(new Error('Netzwerkfehler')); };
  xhr.ontimeout = function () { finish(new Error('Zeitüberschreitung')); };

  console.log('Eezy ' + method + ' ' + url);
  xhr.send(body !== null && body !== undefined ? JSON.stringify(body) : null);
}

/* ------------------------------------------------------------------ */
/* Eezy-Aufrufe                                                        */
/* ------------------------------------------------------------------ */

function extractToken(data, field) {
  if (!data || typeof data !== 'object') { return null; }
  // Unterstützt "token" und verschachtelte Pfade wie "data.accessToken".
  var parts = field.split('.');
  var cur = data;
  for (var i = 0; i < parts.length; i++) {
    if (cur === null || typeof cur !== 'object' || !(parts[i] in cur)) { return null; }
    cur = cur[parts[i]];
  }
  return typeof cur === 'string' ? cur : null;
}

function authenticate(callback) {
  var s = getSettings();
  if (!s.email || !s.password) {
    return callback(new Error('Keine Zugangsdaten. Bitte in der Pebble-App konfigurieren.'));
  }

  // ANPASSEN: Feldnamen des Login-Requests (z. B. "username" statt "email").
  var body = { email: s.email, password: s.password };

  request('POST', joinUrl(s.baseUrl, s.loginPath), body, null, function (err, status, data) {
    if (err) { return callback(err); }
    if (status < 200 || status >= 300) {
      return callback(new Error('Login fehlgeschlagen (' + status + ')'));
    }
    var token = extractToken(data, s.tokenField);
    if (!token) {
      return callback(new Error('Kein Token in Antwort (Feld "' + s.tokenField + '")'));
    }
    writeJson(TOKEN_KEY, { token: token, at: Date.now() });
    callback(null, token);
  });
}

/* Führt fn(token, cb) aus; bei 401 wird einmal neu eingeloggt und wiederholt. */
function withAuth(fn, callback) {
  var cached = readJson(TOKEN_KEY, null);

  function run(token, retry) {
    fn(token, function (err, status, data) {
      if (err) { return callback(err); }
      if ((status === 401 || status === 403) && retry) {
        return authenticate(function (authErr, fresh) {
          if (authErr) { return callback(authErr); }
          run(fresh, false);
        });
      }
      callback(null, status, data);
    });
  }

  if (cached && cached.token) {
    run(cached.token, true);
  } else {
    authenticate(function (err, token) {
      if (err) { return callback(err); }
      run(token, false);
    });
  }
}

function clockIn(callback) {
  var s = getSettings();
  withAuth(function (token, cb) {
    // ANPASSEN: Methode, Pfad und Body für "Schicht beginnen".
    request('POST', joinUrl(s.baseUrl, s.clockInPath), { at: new Date().toISOString() }, token, cb);
  }, function (err, status) {
    if (err) { return callback(err); }
    if (status < 200 || status >= 300) {
      return callback(new Error('Einloggen fehlgeschlagen (' + status + ')'));
    }
    setLoggedIn(true);
    callback(null, 'Eingeloggt');
  });
}

function clockOut(callback) {
  var s = getSettings();
  withAuth(function (token, cb) {
    // ANPASSEN: Methode, Pfad und Body für "Schicht beenden".
    request('POST', joinUrl(s.baseUrl, s.clockOutPath), { at: new Date().toISOString() }, token, cb);
  }, function (err, status) {
    if (err) { return callback(err); }
    if (status < 200 || status >= 300) {
      return callback(new Error('Ausloggen fehlgeschlagen (' + status + ')'));
    }
    setLoggedIn(false);
    callback(null, 'Ausgeloggt');
  });
}

module.exports = {
  DEFAULTS: DEFAULTS,
  getSettings: getSettings,
  saveSettings: saveSettings,
  isLoggedIn: isLoggedIn,
  clockIn: clockIn,
  clockOut: clockOut
};
