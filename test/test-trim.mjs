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

console.log('\nSnellimento del codice: tutte le prove sono passate.');
