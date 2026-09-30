/*
 * Clay-Konfigurationsseite. Wird auf dem Handy in der Pebble-App unter
 * "Einstellungen" angezeigt. Die Werte landen NICHT auf der Uhr, sondern
 * im localStorage des JS-Teils (siehe index.js / eezy.js).
 */
module.exports = [
  {
    type: 'heading',
    defaultValue: 'eezy.nrw für Pebble'
  },
  {
    type: 'text',
    defaultValue: 'Zugangsdaten deines VRR-App-Kontos, mit dem du eezy nutzt. Sie bleiben auf dem Handy.'
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
        defaultValue: 'https://cibo.vrr.de/api', attributes: { type: 'url' } },
      { type: 'input', messageKey: 'LOGIN_PATH', label: 'Login-Pfad',
        defaultValue: '/auth/login' },
      { type: 'input', messageKey: 'CHECKIN_PATH', label: 'Pfad Check-in',
        defaultValue: '/trips/checkin' },
      { type: 'input', messageKey: 'CHECKOUT_PATH', label: 'Pfad Check-out',
        defaultValue: '/trips/checkout' },
      { type: 'input', messageKey: 'TICKET_PATH', label: 'Pfad aktives Ticket',
        defaultValue: '/trips/current/ticket' },
      { type: 'input', messageKey: 'TOKEN_FIELD', label: 'Token-Feld in Login-Antwort',
        defaultValue: 'token' }
    ]
  },
  {
    type: 'submit',
    defaultValue: 'Speichern'
  }
];
