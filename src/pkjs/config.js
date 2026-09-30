/*
 * Clay-Konfigurationsseite. Wird auf dem Handy in der Pebble-App unter
 * "Einstellungen" angezeigt. Die Werte landen NICHT auf der Uhr, sondern
 * im localStorage des JS-Teils (siehe index.js / eezy.js).
 */
module.exports = [
  {
    type: 'heading',
    defaultValue: 'Eezy für Pebble'
  },
  {
    type: 'text',
    defaultValue: 'Zugangsdaten deines Eezy-Talents-Kontos. Sie bleiben auf dem Handy.'
  },
  {
    type: 'section',
    items: [
      { type: 'heading', defaultValue: 'Zugang' },
      { type: 'input', messageKey: 'EMAIL', label: 'E-Mail',
        attributes: { type: 'email', placeholder: 'name@example.com' } },
      { type: 'input', messageKey: 'PASSWORD', label: 'Passwort',
        attributes: { type: 'password' } }
    ]
  },
  {
    type: 'section',
    items: [
      { type: 'heading', defaultValue: 'Endpunkte (Platzhalter, anpassen)' },
      { type: 'input', messageKey: 'BASE_URL', label: 'Basis-URL',
        defaultValue: 'https://talents.eezy.fi/api', attributes: { type: 'url' } },
      { type: 'input', messageKey: 'LOGIN_PATH', label: 'Login-Pfad',
        defaultValue: '/auth/login' },
      { type: 'input', messageKey: 'CLOCK_IN_PATH', label: 'Pfad Einloggen',
        defaultValue: '/shifts/current/start' },
      { type: 'input', messageKey: 'CLOCK_OUT_PATH', label: 'Pfad Ausloggen',
        defaultValue: '/shifts/current/end' },
      { type: 'input', messageKey: 'TOKEN_FIELD', label: 'Token-Feld in Login-Antwort',
        defaultValue: 'token' }
    ]
  },
  {
    type: 'submit',
    defaultValue: 'Speichern'
  }
];
