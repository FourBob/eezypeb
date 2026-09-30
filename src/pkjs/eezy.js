/*
 * eezy.nrw-Anbindung (läuft auf dem Handy in PebbleKit JS).
 *
 * eezy.nrw ist der Check-in/Check-out-Tarif (CiBo) der NRW-Verkehrsverbünde.
 * Backend und App-Bibliothek (CiBo-Lib) kommen von MENTZ GmbH; eine öffentliche
 * API gibt es nicht. Die Endpunkte unten sind PLATZHALTER und müssen an den
 * mitgeschnittenen Netzwerkverkehr der VRR App (mentz.com.vrr_cibo_app)
 * angepasst werden – siehe README, Abschnitt "Endpunkte ermitteln".
 * Alles Backend-Spezifische ist in dieser Datei gekapselt.
 *
 * Konfigurierbar über die Einstellungsseite (Clay) auf dem Handy:
 *   baseUrl, email, password, loginPath, checkinPath, checkoutPath,
 *   ticketPath, tokenField
 */

var DEFAULTS = {
  baseUrl: 'https://cibo.vrr.de/api',      // ANPASSEN
  loginPath: '/auth/login',                // ANPASSEN
  checkinPath: '/trips/checkin',           // ANPASSEN
  checkoutPath: '/trips/checkout',         // ANPASSEN
  ticketPath: '/trips/current/ticket',     // ANPASSEN
  tokenField: 'token'                      // ANPASSEN: Feld mit dem Token in der Login-Antwort
};

var SETTINGS_KEY = 'eezy-settings';
var TOKEN_KEY = 'eezy-token';
var STATE_KEY = 'eezy-checked-in';
var TICKET_KEY = 'eezy-ticket';
var REQUEST_TIMEOUT_MS = 15000;
var POSITION_TIMEOUT_MS = 10000;

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

function isCheckedIn() {
  return readJson(STATE_KEY, false) === true;
}

function setCheckedIn(flag) {
  writeJson(STATE_KEY, !!flag);
  if (!flag) {
    localStorage.removeItem(TICKET_KEY);
  }
}

function getCachedTicket() {
  return readJson(TICKET_KEY, null);
}

/* ------------------------------------------------------------------ */
/* HTTP und Standort                                                   */
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
    // ANPASSEN, falls das Backend kein Bearer-Token, sondern z. B. ein Cookie,
    // einen API-Key oder eine Geräte-ID im Header erwartet.
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

  console.log('eezy ' + method + ' ' + url);
  xhr.send(body !== null && body !== undefined ? JSON.stringify(body) : null);
}

/* Check-in und Check-out brauchen die Position (Luftlinientarif). */
function getPosition(callback) {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return callback(new Error('Kein Standort verfügbar'));
  }
  navigator.geolocation.getCurrentPosition(function (pos) {
    callback(null, {
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      timestamp: new Date(pos.timestamp || Date.now()).toISOString()
    });
  }, function (err) {
    callback(new Error('Standort fehlt: ' + (err && err.message ? err.message : err)));
  }, { enableHighAccuracy: true, timeout: POSITION_TIMEOUT_MS, maximumAge: 5000 });
}

/* ------------------------------------------------------------------ */
/* Backend-Aufrufe                                                     */
/* ------------------------------------------------------------------ */

function extractField(data, field) {
  if (!data || typeof data !== 'object') { return null; }
  // Unterstützt "token" und verschachtelte Pfade wie "data.accessToken".
  var parts = field.split('.');
  var cur = data;
  for (var i = 0; i < parts.length; i++) {
    if (cur === null || typeof cur !== 'object' || !(parts[i] in cur)) { return null; }
    cur = cur[parts[i]];
  }
  return cur;
}

function authenticate(callback) {
  var s = getSettings();
  if (!s.email || !s.password) {
    return callback(new Error('Keine Zugangsdaten. Bitte in der Pebble-App konfigurieren.'));
  }

  // ANPASSEN: Feldnamen des Login-Requests des VRR-Kontos.
  var body = { email: s.email, password: s.password };

  request('POST', joinUrl(s.baseUrl, s.loginPath), body, null, function (err, status, data) {
    if (err) { return callback(err); }
    if (status < 200 || status >= 300) {
      return callback(new Error('Login fehlgeschlagen (' + status + ')'));
    }
    var token = extractField(data, s.tokenField);
    if (typeof token !== 'string' || !token) {
      return callback(new Error('Kein Token in Antwort (Feld "' + s.tokenField + '")'));
    }
    writeJson(TOKEN_KEY, { token: token, at: Date.now() });
    callback(null, token);
  });
}

/* Führt fn(token, cb) aus; bei 401/403 wird einmal neu eingeloggt und wiederholt. */
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

function ok(status) {
  return status >= 200 && status < 300;
}

/*
 * Normalisiert die Ticketantwort des Backends auf
 *   { id, validFrom, validTo, barcode }
 * wobei barcode der Inhalt des VDV-KA-Aztec-Codes ist (Base64 oder Rohstring).
 * ANPASSEN: Feldnamen an die echte Antwort anpassen.
 */
function normalizeTicket(data) {
  if (!data || typeof data !== 'object') { return null; }
  var t = data.ticket || data;
  var barcode = t.barcode || t.aztec || t.barcodeData || null;
  if (!barcode) { return null; }
  return {
    id: t.id || t.ticketId || null,
    validFrom: t.validFrom || null,
    validTo: t.validTo || null,
    barcode: barcode
  };
}

function checkIn(callback) {
  var s = getSettings();
  getPosition(function (posErr, pos) {
    if (posErr) { return callback(posErr); }
    withAuth(function (token, cb) {
      // ANPASSEN: Methode, Pfad und Body für den Check-in.
      request('POST', joinUrl(s.baseUrl, s.checkinPath), { position: pos }, token, cb);
    }, function (err, status, data) {
      if (err) { return callback(err); }
      if (!ok(status)) { return callback(new Error('Check-in fehlgeschlagen (' + status + ')')); }
      setCheckedIn(true);
      var ticket = normalizeTicket(data);
      if (ticket) { writeJson(TICKET_KEY, ticket); }
      callback(null, 'Eingecheckt', ticket);
    });
  });
}

function checkOut(callback) {
  var s = getSettings();
  getPosition(function (posErr, pos) {
    if (posErr) { return callback(posErr); }
    withAuth(function (token, cb) {
      // ANPASSEN: Methode, Pfad und Body für den Check-out.
      request('POST', joinUrl(s.baseUrl, s.checkoutPath), { position: pos }, token, cb);
    }, function (err, status, data) {
      if (err) { return callback(err); }
      if (!ok(status)) { return callback(new Error('Check-out fehlgeschlagen (' + status + ')')); }
      setCheckedIn(false);
      // ANPASSEN: Feldname des Fahrpreises in der Antwort.
      var price = data && (data.price || data.fare);
      callback(null, price ? 'Ausgecheckt, ' + price + ' EUR' : 'Ausgecheckt');
    });
  });
}

function fetchTicket(callback) {
  var s = getSettings();
  withAuth(function (token, cb) {
    // ANPASSEN: Pfad, der das aktive Ticket inkl. Barcode liefert.
    request('GET', joinUrl(s.baseUrl, s.ticketPath), null, token, cb);
  }, function (err, status, data) {
    if (err) { return callback(err); }
    if (status === 404) {
      setCheckedIn(false);
      return callback(new Error('Kein aktives Ticket'));
    }
    if (!ok(status)) { return callback(new Error('Ticketabruf fehlgeschlagen (' + status + ')')); }
    var ticket = normalizeTicket(data);
    if (!ticket) { return callback(new Error('Antwort enthält keinen Barcode')); }
    setCheckedIn(true);
    writeJson(TICKET_KEY, ticket);
    callback(null, ticket);
  });
}

module.exports = {
  DEFAULTS: DEFAULTS,
  getSettings: getSettings,
  saveSettings: saveSettings,
  isCheckedIn: isCheckedIn,
  getCachedTicket: getCachedTicket,
  checkIn: checkIn,
  checkOut: checkOut,
  fetchTicket: fetchTicket
};
