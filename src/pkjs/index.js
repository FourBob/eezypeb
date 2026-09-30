/*
 * Einstieg des PebbleKit-JS-Teils (läuft auf dem Handy).
 * Nimmt Befehle von der Uhr entgegen, ruft eezy.js auf und meldet
 * STATUS (Text) und LOGGED_IN (0/1) zurück.
 */
var Clay = require('pebble-clay');
var clayConfig = require('./config');
var eezy = require('./eezy');

var CMD_LOGIN = 1;
var CMD_LOGOUT = 2;
var CMD_STATUS = 3;

var clay = new Clay(clayConfig, null, { autoHandleEvents: false });

function reply(statusText) {
  var msg = {
    STATUS: String(statusText).substring(0, 80),
    LOGGED_IN: eezy.isLoggedIn() ? 1 : 0
  };
  Pebble.sendAppMessage(msg, function () {
    console.log('An Uhr gesendet: ' + msg.STATUS);
  }, function (e) {
    console.log('Senden an Uhr fehlgeschlagen: ' + JSON.stringify(e));
  });
}

function handleCommand(cmd) {
  switch (cmd) {
    case CMD_LOGIN:
      eezy.clockIn(function (err, text) { reply(err ? err.message : text); });
      break;
    case CMD_LOGOUT:
      eezy.clockOut(function (err, text) { reply(err ? err.message : text); });
      break;
    case CMD_STATUS:
      reply(eezy.isLoggedIn() ? 'Eingeloggt' : 'Ausgeloggt');
      break;
    default:
      reply('Unbekannter Befehl ' + cmd);
  }
}

Pebble.addEventListener('ready', function () {
  console.log('Eezy PebbleKit JS bereit');
  // Beim Start den lokal bekannten Zustand an die Uhr schicken.
  Pebble.sendAppMessage({ LOGGED_IN: eezy.isLoggedIn() ? 1 : 0 });
});

Pebble.addEventListener('appmessage', function (e) {
  var cmd = e.payload && e.payload.CMD;
  if (typeof cmd !== 'number') { return; }
  handleCommand(cmd);
});

Pebble.addEventListener('showConfiguration', function () {
  // Vorbelegen mit den gespeicherten Werten.
  var s = eezy.getSettings();
  clay.setSettings('EMAIL', s.email);
  clay.setSettings('PASSWORD', s.password);
  clay.setSettings('BASE_URL', s.baseUrl);
  clay.setSettings('LOGIN_PATH', s.loginPath);
  clay.setSettings('CLOCK_IN_PATH', s.clockInPath);
  clay.setSettings('CLOCK_OUT_PATH', s.clockOutPath);
  clay.setSettings('TOKEN_FIELD', s.tokenField);
  Pebble.openURL(clay.generateUrl());
});

Pebble.addEventListener('webviewclosed', function (e) {
  if (!e || !e.response) { return; }
  // getSettings() legt die geglätteten Werte unter 'clay-settings' ab.
  clay.getSettings(e.response, false);
  var v = {};
  try { v = JSON.parse(localStorage.getItem('clay-settings')) || {}; } catch (err) { v = {}; }
  eezy.saveSettings({
    email: v.EMAIL || '',
    password: v.PASSWORD || '',
    baseUrl: v.BASE_URL || eezy.DEFAULTS.baseUrl,
    loginPath: v.LOGIN_PATH || eezy.DEFAULTS.loginPath,
    clockInPath: v.CLOCK_IN_PATH || eezy.DEFAULTS.clockInPath,
    clockOutPath: v.CLOCK_OUT_PATH || eezy.DEFAULTS.clockOutPath,
    tokenField: v.TOKEN_FIELD || eezy.DEFAULTS.tokenField
  });
  console.log('Einstellungen gespeichert');
});
