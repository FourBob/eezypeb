# Eezy für Pebble

Eine Pebble-Watchapp, die dich bei **Eezy** (Eezy Oyj, finnischer Personaldienstleister,
App „Eezy Talents") ein- und ausloggt. Zwei Menüpunkte auf der Uhr, der Rest passiert
auf dem Handy in PebbleKit JS.

## Aufbau

| Datei | Läuft auf | Aufgabe |
|---|---|---|
| `src/c/main.c` | Uhr | Menü „Einloggen / Ausloggen / Status", Statuszeile, AppMessage |
| `src/pkjs/index.js` | Handy | Nimmt Befehle der Uhr entgegen, meldet Ergebnis zurück, Einstellungsseite |
| `src/pkjs/eezy.js` | Handy | **Die gesamte Eezy-Anbindung** (Login, Token, Einloggen, Ausloggen) |
| `src/pkjs/config.js` | Handy | Clay-Konfigurationsseite (E-Mail, Passwort, Endpunkte) |

Ablauf: Uhr sendet `CMD` (1 = Einloggen, 2 = Ausloggen, 3 = Status) → JS holt bei Bedarf
ein Token per Login → ruft den Eezy-Endpunkt auf → sendet `STATUS` (Text) und
`LOGGED_IN` (0/1) an die Uhr zurück. Die Uhr vibriert kurz und zeigt den Text an.

## Wichtig: Eezy hat keine öffentliche API

Die Endpunkte in `src/pkjs/eezy.js` (`DEFAULTS`) und die Vorgabewerte in `config.js`
sind **Platzhalter**. Alle Stellen, die angepasst werden müssen, sind im Code mit
`ANPASSEN` markiert:

1. Basis-URL und Pfade für Login, Einloggen, Ausloggen
2. Feldnamen im Login-Request (`email`/`password` oder z. B. `username`)
3. Name des Token-Felds in der Login-Antwort (`tokenField`, auch verschachtelt wie `data.accessToken`)
4. Art der Authentifizierung (aktuell `Authorization: Bearer <token>`)
5. Request-Body für Einloggen/Ausloggen (aktuell `{ "at": "<ISO-Zeit>" }`)

### Eezy-Endpunkte ermitteln

Nur mit dem eigenen Konto und unter Beachtung der Eezy-Nutzungsbedingungen:

- **Web-Login**: <https://eezy.fi/en/eezy-talents-login/> im Browser öffnen, Entwicklertools
  → Netzwerk, einloggen und eine Schicht buchen. Als HAR exportieren.
- **Android-App** `fi.eezy.talent`: Verkehr mit mitmproxy oder HTTP Toolkit mitschneiden
  (bei Certificate Pinning: Emulator oder gerootetes Gerät).

Aus dem Mitschnitt ergeben sich Basis-URL, Login-Request/-Antwort und die Aufrufe für
Schichtbeginn und -ende. Diese Werte in `eezy.js` bzw. auf der Einstellungsseite eintragen.

## Bauen

Benötigt das Pebble/Rebble-SDK (`pebble` CLI, siehe <https://developer.rebble.io/>).

```sh
npm install            # holt pebble-clay
pebble build
pebble install --phone <IP>        # oder: pebble install --emulator basalt
pebble logs --phone <IP>           # zeigt die console.log-Ausgaben des JS-Teils
```

Einstellungen: in der Pebble-App auf dem Handy die Watchapp auswählen → Einstellungen.
Die Zugangsdaten bleiben im localStorage des Handys und gehen nicht an die Uhr.

## Stand

- Uhr-Teil und JS-Teil vollständig, Syntax geprüft (C gegen Stub-Header, JS mit Node).
- Noch nicht gegen das echte Eezy-Backend getestet, da die Endpunkte unbekannt sind.
- Ein echter `pebble build` steht aus, da das SDK in der Entwicklungsumgebung nicht
  installierbar war.
