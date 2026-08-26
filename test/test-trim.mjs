/* Il codice non deve gonfiarsi quando il ponte produce molti candidati, e una
   risposta non deve poter essere applicata due volte. */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const REPO = new globalThis.URL('..', import.meta.url).pathname;
globalThis.window = {};
globalThis.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
globalThis.atob = (s) => Buffer.from(s, 'base64').toString('binary');
new Function(readFileSync(REPO + 'net.js', 'utf8'))();
const Net = globalThis.window.SudokuNet;

// SDP come quello osservato: 12 pubblici, 2 locali, 10 dal ponte
const righe = [
  'v=0', 'o=- 1 2 IN IP4 127.0.0.1', 's=-', 't=0 0',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
  'a=ice-ufrag:4ZcD', 'a=ice-pwd:by/PmMA1nUOUXjHXaMHDBGnb',
  'a=fingerprint:sha-256 ' + Array(32).fill('AB').join(':'),
  'a=setup:actpass',
];
for (let i = 0; i < 2; i++) righe.push(`a=candidate:${i} 1 udp ${2000000 + i} host-${i}.local ${5000 + i} typ host`);
for (let i = 0; i < 12; i++) righe.push(`a=candidate:s${i} 1 udp ${1600000 + i} 203.0.113.${i} ${6000 + i} typ srflx raddr 10.0.0.1 rport ${6000 + i}`);
for (let i = 0; i < 10; i++) righe.push(`a=candidate:r${i} 1 udp ${40000 + i} 104.30.147.${i} ${7000 + i} typ relay raddr 0.0.0.0 rport 0`);
const sdp = righe.join('\r\n') + '\r\n';

const prima = Net.candidateSummary(sdp);
assert.equal(prima.srflx, 12); assert.equal(prima.relay, 10); assert.equal(prima.host, 2);
const code = Net.encodeDesc(sdp, false);
const dopo = Net.candidateSummary(Net.decodeDesc(code));
console.log(`  candidati: ${prima.host + prima.srflx + prima.relay} → ${dopo.host + dopo.srflx + dopo.relay}`);
console.log(`  codice: ${code.length} caratteri`);

assert.ok(dopo.relay >= 1, 'il ponte resta rappresentato');
assert.ok(dopo.srflx >= 1, 'l’indirizzo pubblico resta');
assert.ok(dopo.host >= 1, 'l’indirizzo locale resta');
assert.ok(dopo.host + dopo.srflx + dopo.relay <= 6, `al massimo due per tipo: ${JSON.stringify(dopo)}`);
assert.ok(code.length < 600, `codice tornato maneggevole: ${code.length} caratteri`);
console.log('✓ molti candidati: si tengono i migliori di ogni tipo, il codice resta corto');

// I candidati tenuti sono quelli a priorità più alta
const rebuilt = Net.decodeDesc(code);
assert.ok(/203\.0\.113\.11 /.test(rebuilt), 'tenuto lo srflx a priorità massima');
assert.ok(/104\.30\.147\.9 /.test(rebuilt), 'tenuto il relay a priorità massima');
console.log('✓ si tengono i candidati a priorità più alta, non i primi che capitano');

/* --- Il caso del campo: PC con IPv4 e IPv6, telefono in 5G --- */
// È il difetto che ha tenuto fermo il duello tra due macchine. Un PC a doppia
// pila raccoglie dieci candidati dal ponte, cinque per famiglia, e Chrome dà
// priorità più alta a quelli IPv6. Tenendo «i due migliori» partivano due relay
// IPv6; il telefono, dall'altra parte, mandava relay IPv4. Candidati di
// famiglie diverse non formano nemmeno una coppia: ICE non prova niente e il
// collegamento fallisce pur avendo il ponte attivo da entrambe le parti.
const doppiaPila = [
  'v=0', 'o=- 1 2 IN IP4 127.0.0.1', 's=-', 't=0 0',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
  'a=ice-ufrag:4ZcD', 'a=ice-pwd:by/PmMA1nUOUXjHXaMHDBGnb',
  'a=fingerprint:sha-256 ' + Array(32).fill('AB').join(':'),
  'a=setup:actpass',
  'a=candidate:h1 1 udp 2122262783 aaaa-1111.local 5001 typ host',
  'a=candidate:h2 1 udp 2122194687 aaaa-2222.local 5002 typ host',
  'a=candidate:s1 1 udp 1685790463 2a09:bac1:1::1f:2 6001 typ srflx',
  'a=candidate:s2 1 udp 1685921535 93.45.12.80 6002 typ srflx',
];
// L'IPv6 ha priorità più alta dell'IPv4, come fa Chrome
for (let i = 0; i < 5; i++) {
  doppiaPila.push(`a=candidate:r6${i} 1 udp ${33563903 - i} 2a06:98c1:31::${i} ${7000 + i} typ relay`);
}
for (let i = 0; i < 5; i++) {
  doppiaPila.push(`a=candidate:r4${i} 1 udp ${33562000 - i} 104.30.147.${i} ${7100 + i} typ relay`);
}
const sdp2 = doppiaPila.join('\r\n') + '\r\n';

const code2 = Net.encodeDesc(sdp2, false);
const spediti = Net.candidateSummary(Net.decodeDesc(code2));
console.log(`  raccolti: ${Net.summaryDetail(Net.candidateSummary(sdp2))}`);
console.log(`  spediti:  ${Net.summaryDetail(spediti)}`);
console.log(`  codice:   ${code2.length} caratteri`);

assert.ok(spediti.fam['relay/v4'] >= 1, `almeno un relay IPv4 nel codice: ${JSON.stringify(spediti.fam)}`);
assert.ok(spediti.fam['relay/v6'] >= 1, `almeno un relay IPv6 nel codice: ${JSON.stringify(spediti.fam)}`);
assert.ok(spediti.fam['srflx/v4'] >= 1 && spediti.fam['srflx/v6'] >= 1, 'entrambe le famiglie fra i pubblici');
assert.ok(code2.length < 800, `codice ancora maneggevole: ${code2.length} caratteri`);
console.log('✓ doppia pila: nel codice restano entrambe le famiglie, non solo quella a priorità più alta');

// E il taglio continua a servire: senza, sarebbero quattordici candidati
assert.ok(spediti.host + spediti.srflx + spediti.relay <= 8,
  `il taglio è ancora in vigore: ${spediti.host + spediti.srflx + spediti.relay}`);
console.log('✓ il taglio resta: due per tipo e famiglia, non tutti');

console.log('\nSnellimento del codice: tutte le prove sono passate.');
