/*
 * Barcode-Erzeugung und Übertragung an die Uhr.
 *
 * eezy.nrw-Tickets werden als VDV-KA-Barcode (Aztec) kontrolliert. Das Backend
 * liefert den Barcode-Inhalt; daraus muss hier eine Aztec-Matrix erzeugt werden.
 * Der eigentliche Aztec-Encoder ist noch NICHT eingebaut (ANPASSEN: encode()).
 * Bis dahin liefert encode() ein Testmuster, damit Übertragung und Anzeige auf
 * der Uhr geprüft werden können.
 *
 * Matrixformat zur Uhr: quadratisch, zeilenweise gepackt, MSB zuerst, 1 = schwarz.
 */

var CHUNK_BYTES = 200;

/* Liefert { size: Module pro Seite, bits: Array von Bytes } */
function encode(payload) {
  // ANPASSEN: hier den Aztec-Encoder aufrufen, z. B. mit dem dekodierten
  // Base64-Inhalt aus dem Ticket. Ergebnis in packMatrix() geben.
  return testPattern(37);
}

function packMatrix(size, isBlack) {
  var stride = Math.ceil(size / 8);
  var bits = new Array(stride * size);
  for (var i = 0; i < bits.length; i++) { bits[i] = 0; }
  for (var y = 0; y < size; y++) {
    for (var x = 0; x < size; x++) {
      if (isBlack(x, y)) {
        bits[y * stride + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }
  return { size: size, bits: bits };
}

/* Schachbrett mit Rahmen und Aztec-ähnlichem Zentrum, nur zum Testen. */
function testPattern(size) {
  var c = Math.floor(size / 2);
  return packMatrix(size, function (x, y) {
    if (x === 0 || y === 0 || x === size - 1 || y === size - 1) { return true; }
    var d = Math.max(Math.abs(x - c), Math.abs(y - c));
    if (d <= 5) { return d % 2 === 0; }
    return ((x * 7 + y * 13) % 5) < 2;
  });
}

/* Schickt die Matrix in Stücken an die Uhr; callback(err) am Ende. */
function sendToWatch(matrix, callback) {
  var offset = 0;

  function sendNext() {
    if (offset >= matrix.bits.length) {
      return Pebble.sendAppMessage({ BC_DONE: 1 }, function () { callback(null); }, fail);
    }
    var chunk = matrix.bits.slice(offset, offset + CHUNK_BYTES);
    var msg = { BC_OFFSET: offset, BC_DATA: chunk };
    if (offset === 0) { msg.BC_SIZE = matrix.size; }
    Pebble.sendAppMessage(msg, function () {
      offset += chunk.length;
      sendNext();
    }, fail);
  }

  function fail(e) {
    callback(new Error('Barcode-Übertragung fehlgeschlagen: ' + JSON.stringify(e)));
  }

  sendNext();
}

module.exports = {
  encode: encode,
  packMatrix: packMatrix,
  sendToWatch: sendToWatch
};
