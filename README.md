# eezy.nrw für Pebble

Eine Pebble-Watchapp für **eezy.nrw**, den Check-in/Check-out-Tarif für Bus und Bahn in
Nordrhein-Westfalen (VRR, VRS/go.Rheinland, NWL). Von der Uhr aus einchecken, auschecken,
den Ticket-Barcode zeigen. Der Rest läuft auf dem Handy in PebbleKit JS.

## Was eezy.nrw ist

- **Tarif**: Vor dem Einsteigen an der Haltestelle in der App einchecken, nach dem Aussteigen
  auschecken. Der Preis ist Grundpreis plus Luftlinienkilometer zwischen Start und Ziel und
  wird nachträglich abgebucht. Tagesdeckel und Mitnahme von Personen/Fahrrad sind möglich.
- **Ticket**: Nach dem Check-in zeigt die App einen Barcode (Aztec nach VDV-KA-Standard), der
  bei der Kontrolle gescannt wird.
- **Technik**: Das System heißt CiBo (Check-in/Be-out) und wurde von der **MENTZ GmbH** (München)
  für VRR, NWL und NVR gebaut. Backend ist der MENTZ Service Host mit CiBo-Backend; die Apps
  binden die **CiBo-Lib** ein, die Positionsdaten sammelt und ans Backend meldet. Der Preis
  wird beim Check-out im Backend berechnet.
- **Apps**, die eezy können (alle Mentz-basiert, außer VRS):
  - VRR App: Android `mentz.com.vrr_cibo_app`, iOS 1491339288. Hat eine **Apple-Watch-App**
    mit Check-in per Klick und vergrößertem Barcode auf der Uhr.
  - mobil.nrw: `com.mentz.mobilnrw_cibo_app`
  - eezyZÄPP Essen (Ruhrbahn): `com.mentz.ruhrbahn_essen_cibo_app`
  - DB NRWay: `com.mentz.bvr_cibo_app`
  - Rheinbahn App (iOS 1583017950), VER eTarif (iOS 1613353847)
  - VRS eezy.nrw (KVB, Cubic): `koeln.kvb.ticket.vrseezy`
- **Smartwatch-Regel** laut FAQ: Bei der Kontrolle wird der Barcode auf der Uhr gescannt.
  Klappt das nicht, muss das gekoppelte Smartphone mit gültiger Fahrtberechtigung gezeigt werden.
  Das Handy muss also weiter dabei sein; die Uhr ist Komfort, kein Ersatz.
- **Keine öffentliche API.** Weder VRR noch Mentz dokumentieren die CiBo-Schnittstelle für Dritte.

## Aufbau

| Datei | Läuft auf | Aufgabe |
|---|---|---|
| `src/c/main.c` | Uhr | Menü „Check-in / Check-out / Ticket / Status", Statuszeile, Barcode-Fenster |
| `src/pkjs/index.js` | Handy | Befehle der Uhr entgegennehmen, Ergebnis zurückmelden, Einstellungsseite |
| `src/pkjs/eezy.js` | Handy | **Die gesamte Backend-Anbindung** (Login, Token, Standort, Check-in/-out, Ticket) |
| `src/pkjs/barcode.js` | Handy | Barcode-Matrix erzeugen und in Stücken an die Uhr schicken |
| `src/pkjs/config.js` | Handy | Clay-Konfigurationsseite (E-Mail, Passwort, Endpunkte) |

Ablauf: Uhr sendet `CMD` (1 Check-in, 2 Check-out, 3 Ticket, 4 Status) → JS holt die
Position, bei Bedarf ein Token, ruft das Backend auf → bei aktivem Ticket wird der Barcode
als gepackte Bitmatrix (`BC_SIZE`, `BC_OFFSET`/`BC_DATA` in 200-Byte-Stücken, `BC_DONE`)
übertragen und auf der Uhr mit ganzzahligem Faktor skaliert angezeigt → `STATUS` (Text) und
`CHECKED_IN` (0/1) schließen ab, die Uhr vibriert kurz.

## Was noch fehlt

1. **Echte Endpunkte.** Alle Backend-Details in `src/pkjs/eezy.js` (`DEFAULTS`, Login-Body,
   Auth-Header, Check-in/-out-Body, Ticketfelder) sind Platzhalter und mit `ANPASSEN` markiert.
2. **Aztec-Encoder.** `barcode.js` liefert bislang ein Testmuster. Sobald bekannt ist, in welcher
   Form das Backend den Barcode-Inhalt liefert (fertiges Bild, Base64-Payload für Aztec),
   wird `encode()` ersetzt. Ein reiner JS-Aztec-Encoder ist der geplante Weg.
3. **Lesbarkeit auf der Uhr.** VDV-KA-Aztec-Codes haben oft 80 bis 100+ Module. Auf 144 px
   Breite bleibt nur 1 px pro Modul, das ist für Scanner grenzwertig. Auf Pebble Time 2 /
   Emery (200 px) geht mehr. Ob es reicht, zeigt erst ein Test mit einem Prüfgerät; der
   offizielle Fallback ist das Handy (siehe Smartwatch-Regel).

## Endpunkte ermitteln

Nur mit dem eigenen Konto und unter Beachtung der Nutzungsbedingungen von VRR/eezy.nrw.
Automatisierte Zugriffe können dort ausgeschlossen sein; das ist vor dem Einsatz zu prüfen.

- **Android-App mitschneiden**: VRR App (`mentz.com.vrr_cibo_app`) auf einem Testgerät oder
  Emulator mit mitmproxy oder HTTP Toolkit. Die CiBo-Lib nutzt vermutlich Certificate Pinning
  und eine Gerätebindung; dann sind ein gerootetes Gerät bzw. Frida nötig.
- **Was gebraucht wird**: Basis-URL, Login (Request/Antwort, Tokenfeld), Check-in (Body mit
  Position), Check-out, Abruf des aktiven Tickets samt Barcode-Inhalt, Standortmeldungen
  während der Fahrt (falls das Backend sie für den Check-out verlangt).
- Die Apple-Watch-Variante der VRR App ist ein guter Hinweis darauf, dass das Backend einen
  „dünnen" Client mit Check-in per Knopfdruck bereits unterstützt.

## Bauen

Benötigt das Pebble/Rebble-SDK (`pebble` CLI, siehe <https://developer.rebble.io/>).

```sh
npm install                          # holt pebble-clay
pebble build
pebble install --phone <IP>          # oder: pebble install --emulator basalt
pebble logs --phone <IP>             # console.log-Ausgaben des JS-Teils
```

Einstellungen: in der Pebble-App auf dem Handy die Watchapp auswählen → Einstellungen.
Zugangsdaten bleiben im localStorage des Handys und gehen nicht an die Uhr.

## Stand

- Uhr-Teil und JS-Teil vollständig, Syntax geprüft (C gegen Stub-Header, JS mit Node),
  Barcode-Übertragung mit Testmuster im Node-Test durchgespielt.
- Noch nicht gegen das echte Backend getestet, da die Endpunkte unbekannt sind.
- Ein echter `pebble build` steht aus, da das SDK in der Entwicklungsumgebung nicht
  installierbar war.

## Quellen

- VRR: <https://www.vrr.de/de/tickets-tarife/eezy-nrw/> und FAQ <https://www.vrr.de/de/tickets-tarife/eezy-nrw/faq/>
- eezy.nrw: <https://eezy.nrw/hilfe/so-funktioniert-eezy-nrw>
- Vergabe an Mentz: <https://www.vrs.de/presse/artikel/landesweites-check-in-be-out-system-kommt>
- Mentz Magazin (CiBo-Backend, CiBo-Lib): <https://www.mentz.net/wp-content/uploads/sites/2/2023/01/MENTZ_Magazin-2022-01-DE.pdf>
- Apple-Watch-Check-in in der VRR App: <https://www.appgefahren.de/vrr-app-check-in-fuer-das-eezy-ticket-auf-der-apple-watch-moeglich-355895.html>
- VDV-KA-Barcode: <https://community.kde.org/KDE_PIM/KItinerary/Barcode_Formats>
