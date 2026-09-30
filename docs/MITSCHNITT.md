# Netzwerkverkehr der VRR App mitschneiden

Ziel: herausfinden, welche HTTP-Aufrufe die VRR App (`mentz.com.vrr_cibo_app`) für
Login, Check-in, Ticketabruf und Check-out an das Mentz-CiBo-Backend schickt. Daraus
werden die Endpunkte in `src/pkjs/eezy.js` und die Barcode-Form in `src/pkjs/barcode.js`.

Nur mit dem eigenen Konto. Die Nutzungsbedingungen von VRR/eezy.nrw vorher lesen;
automatisierte Zugriffe können dort ausgeschlossen sein.

## Empfohlener Weg: Android + HTTP Toolkit

HTTP Toolkit (<https://httptoolkit.com>, kostenlos, Windows/macOS/Linux) richtet Proxy,
Zertifikat und ADB-Verbindung selbst ein und bringt einen Frida-basierten Bypass für
Certificate Pinning mit. Das ist der Weg mit den wenigsten Handgriffen.

### Variante 1: Echtes Android-Handy (ohne Root)

1. Auf dem Handy die Entwickleroptionen und USB-Debugging aktivieren, per USB an den PC.
2. HTTP Toolkit starten → „Android device via ADB". Es installiert die HTTP-Toolkit-App
   und das CA-Zertifikat als Nutzerzertifikat.
3. Die VRR App im HTTP Toolkit als Ziel auswählen (Menü „Intercept only these apps").
4. In der VRR App: einloggen, ein Ticket einchecken, den Barcode ansehen, auschecken.
5. Ohne Root sieht man nur Apps, die Nutzerzertifikate akzeptieren. Neuere Apps tun das
   meist nicht; dann bleiben die Requests leer oder brechen mit TLS-Fehler ab → Variante 2
   oder 3.

### Variante 2: Gepatchte APK (ohne Root, meist erfolgreich)

`apk-mitm` baut die App so um, dass sie Nutzerzertifikate akzeptiert und gängiges
Pinning (OkHttp, TrustManager, Network Security Config) entfernt ist.

```sh
npm install -g apk-mitm
# APK der VRR App besorgen (z. B. per adb vom eigenen Handy):
adb shell pm path mentz.com.vrr_cibo_app
adb pull /data/app/.../base.apk vrr.apk         # ggf. auch split_*.apk mitziehen
apk-mitm vrr.apk                                # erzeugt vrr-patched.apk
adb uninstall mentz.com.vrr_cibo_app
adb install vrr-patched.apk
```

Danach wie in Variante 1 mit HTTP Toolkit oder mitmproxy mitschneiden. Bei Split-APKs
(`split_config.*.apk`) `apk-mitm` auf das Bundle anwenden oder alle Teile mit
`adb install-multiple` einspielen.

Risiko: Die App ist danach anders signiert. Wenn das Backend eine Play-Integrity- oder
Signaturprüfung macht, schlägt schon der Login fehl. Dann Variante 3.

### Variante 3: Emulator oder gerootetes Gerät + Frida (robust)

1. Android-Emulator (Android Studio, Image *ohne* „Google Play", damit `adb root` geht)
   oder ein gerootetes Zweitgerät.
2. HTTP Toolkit → „Android device via ADB": auf gerooteten Geräten installiert es das
   Zertifikat als Systemzertifikat, damit sehen alle Apps es als vertrauenswürdig.
3. Wenn die App trotzdem pinnt: HTTP Toolkit → „Android" → „Frida"-Modus, oder manuell
   `frida-server` starten und mit `frida -U -f mentz.com.vrr_cibo_app -l unpinning.js`
   (Skript „frida-multiple-unpinning" von codeshare.frida.re) laufen lassen.
4. Play-Services-Apps laufen im Image ohne Play Store teils nicht; dann ein Image mit
   Play Store nehmen und mit `rootAVD` rooten.

## Alternative: mitmproxy statt HTTP Toolkit

```sh
pip install mitmproxy
mitmweb --listen-port 8080          # Weboberfläche auf http://127.0.0.1:8081
```

Handy ins gleiche WLAN, Proxy in den WLAN-Einstellungen auf `<PC-IP>:8080` setzen,
auf dem Handy <http://mitm.it> öffnen und das Zertifikat installieren. Speichern mit
`File → Save` als `.mitm`-Flow oder HAR-Export (mitmproxy ≥ 10: `mitmdump -w` bzw.
`export.har`).

## Ergänzend: APK statisch lesen

Auch ohne Mitschnitt liefert die APK Hinweise. `jadx-gui vrr.apk` und dann nach
`cibo`, `checkin`, `checkout`, `ticket`, `barcode`, `aztec`, `https://` suchen. Die
Mentz-CiBo-Lib liegt als eigenes Paket (`com.mentz…`) darin; dort stehen Basis-URLs,
Pfade und die Namen der JSON-Felder. Das hilft, den Mitschnitt zu deuten.

## Was aufgezeichnet werden soll

Bitte in dieser Reihenfolge, jeweils mit Uhrzeit notiert:

| Schritt | Worauf achten |
|---|---|
| App starten, eingeloggt | Token-Refresh, Geräte-ID, Header wie `Authorization`, `X-Device-…` |
| Ausloggen und neu einloggen | Login-Request und -Antwort, Name des Token-Felds |
| Check-in | Request mit Position, Antwort mit Fahrt-/Ticket-ID |
| Ticket/Barcode ansehen | Liefert die Antwort ein Bild (PNG/SVG, Base64) oder Rohdaten für Aztec? |
| Kurze Fahrt oder 5 Minuten warten | Standortmeldungen während der Fahrt (Intervall, Pfad) |
| Check-out | Request und Antwort mit Preis |
| Fahrtenhistorie öffnen | Optional, Aufbau von Fahrt-Objekten |

Zusätzlich ein Screenshot des Barcodes aus der App, damit Größe (Modulanzahl) und
Typ (Aztec) sichtbar sind.

## Export und Weitergabe

- HTTP Toolkit: „Export" → HAR. mitmproxy: Flow-Datei oder HAR.
- Vor der Weitergabe Passwort, Token, Geräte-ID und persönliche Daten durch Platzhalter
  ersetzen, aber die **Struktur** unverändert lassen (z. B. `"token": "<TOKEN>"`). Für
  die Anpassung des Codes zählen Feldnamen, Pfade, Methoden und Header, nicht die Werte.

## iPhone statt Android

Ohne Jailbreak lässt sich nur der Verkehr von Apps ohne Pinning lesen (mitmproxy oder
Proxyman mit installiertem Profil). Bei Pinning hilft nur ein Jailbreak mit „SSL Kill
Switch". Ein Android-Zweitgerät oder Emulator ist deutlich einfacher.
