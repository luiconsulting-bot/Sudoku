/* Quanto traffico muove davvero un duello: si misurano i messaggi reali
   del protocollo, non una stima a occhio. */

// Messaggi come li genera duo.js
const cells = Array.from({ length: 81 }, (_, i) => (i % 3 ? '1' : '0')).join('');
const msgs = {
  progress: { t: 'progress', filled: 47, errors: 1, hints: 0, elapsed: 1234, cells },
  ping: { t: 'ping' },
  pong: { t: 'pong' },
  welcome: { t: 'welcome', proto: 1, name: 'AAA', mode: 'duel', difficulty: 'medio', seed: 12345678 },
  finished: { t: 'finished', won: true, seconds: 754, errors: 1, hints: 0 },
};
const size = (m) => Buffer.byteLength(JSON.stringify(m), 'utf8');

// Sovraccarico per pacchetto: SCTP+DTLS ~ 60 B, incapsulamento TURN ~ 4 B
// (ChannelData) o ~36 B (Send indication), UDP/IP 28 B. Si usa il caso peggiore.
const OVERHEAD = 60 + 36 + 28;

const perSec = size(msgs.progress) + OVERHEAD;          // 1 progress al secondo
const perPing = (size(msgs.ping) + size(msgs.pong) + 2 * OVERHEAD) / 2; // ping ogni 2 s

console.log('Dimensione dei messaggi (JSON):');
for (const [k, m] of Object.entries(msgs)) console.log(`  ${k.padEnd(9)} ${size(m)} B`);
console.log(`\nSovraccarico stimato per pacchetto: ${OVERHEAD} B (caso peggiore)`);

const bytesPerSecPerPlayer = perSec + perPing;
console.log(`\nPer giocatore: ${Math.round(bytesPerSecPerPlayer)} B/s`);

for (const min of [10, 20, 45]) {
  const sec = min * 60;
  // Il TURN inoltra il traffico di entrambi: si contano tutte e due le direzioni
  const totale = bytesPerSecPerPlayer * sec * 2;
  const mb = totale / 1024 / 1024;
  const duelli = (1000 * 1024) / mb; // 1000 GB gratuiti
  console.log(`Duello di ${String(min).padStart(2)} min → ${mb.toFixed(2)} MB relayati`
    + ` → ${Math.round(duelli).toLocaleString('it-IT')} duelli nella soglia gratuita`);
}

// E quanto costerebbe sforare, per avere l'ordine di grandezza
const mb20 = bytesPerSecPerPlayer * 1200 * 2 / 1024 / 1024;
console.log(`\nUn duello da 20 min costa ${(mb20 / 1024 * 0.05).toFixed(5)} $ oltre soglia`
  + ` — servirebbero ${Math.round(1 / (mb20 / 1024 * 0.05)).toLocaleString('it-IT')} duelli per un solo dollaro.`);
