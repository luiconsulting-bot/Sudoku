/* L'attesa dei candidati deve aspettare il ponte quando il ponte c'è.
   Si simula l'ordine reale: lo STUN risponde subito, il TURN un attimo dopo —
   e con il vecchio comportamento il relay restava fuori dal codice. */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const REPO = new globalThis.URL('..', import.meta.url).pathname;

globalThis.window = {};
globalThis.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
globalThis.atob = (s) => Buffer.from(s, 'base64').toString('binary');
new Function(readFileSync(REPO + 'net.js', 'utf8'))();
const Net = globalThis.window.SudokuNet;

// Finta RTCPeerConnection: emette candidati con le tempistiche indicate
function fakePc(eventi) {
  const listeners = {};
  const pc = {
    iceGatheringState: 'gathering',
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
    removeEventListener: (t, fn) => {
      listeners[t] = (listeners[t] || []).filter((f) => f !== fn);
    },
  };
  for (const [ms, tipo] of eventi) {
    setTimeout(() => {
      const cand = tipo === null ? null
        : { candidate: `candidate:1 1 udp 100 1.2.3.4 5000 typ ${tipo}` };
      for (const fn of listeners.icecandidate || []) fn({ candidate: cand });
    }, ms);
  }
  return pc;
}

const ordineReale = [[100, 'host'], [300, 'srflx'], [1500, 'relay'], [1600, null]];

/* --- Senza ponte: si esce presto, allo srflx --- */
{
  const visti = [];
  const t0 = Date.now();
  await Net.waitForIce(fakePc(ordineReale), { onProgress: (t) => visti.push(t) });
  const ms = Date.now() - t0;
  assert.ok(ms < 1200, `uscita rapida senza ponte: ${ms} ms`);
  assert.ok(!visti.includes('relay'), 'il relay non fa in tempo, ed è giusto così');
  console.log(`✓ senza ponte: si esce allo STUN dopo ${ms} ms (${visti.join(', ')})`);
}

/* --- Con il ponte: si aspetta il relay, altrimenti resterebbe fuori --- */
{
  const visti = [];
  const t0 = Date.now();
  await Net.waitForIce(fakePc(ordineReale), { needRelay: true, onProgress: (t) => visti.push(t) });
  const ms = Date.now() - t0;
  assert.ok(visti.includes('relay'), `il relay è stato raccolto: ${visti.join(', ')}`);
  assert.ok(ms >= 1500, `si è atteso il relay: ${ms} ms`);
  assert.ok(ms < 4000, `senza attese inutili: ${ms} ms`);
  console.log(`✓ con ponte: si attende il relay, raccolto dopo ${ms} ms (${visti.join(', ')})`);
}

/* --- Ponte configurato ma che non produce relay: non si resta appesi --- */
{
  const t0 = Date.now();
  await Net.waitForIce(fakePc([[100, 'host'], [300, 'srflx']]), {
    needRelay: true, maxMs: 2000,
  });
  const ms = Date.now() - t0;
  assert.ok(ms >= 2000 && ms < 3000, `si arrende al tetto: ${ms} ms`);
  console.log(`✓ ponte che non risponde: si desiste al tetto (${ms} ms) invece di bloccarsi`);
}

/* --- Fine raccolta dichiarata: si esce subito, in ogni caso --- */
{
  const t0 = Date.now();
  await Net.waitForIce(fakePc([[100, 'host'], [200, null]]), { needRelay: true, maxMs: 9000 });
  const ms = Date.now() - t0;
  assert.ok(ms < 1000, `la fine dichiarata chiude l’attesa: ${ms} ms`);
  console.log(`✓ raccolta conclusa dal browser: si esce subito (${ms} ms)`);
}

/* --- La raffica del ponte non va troncata al primo candidato --- */
// Cloudflare offre cinque indirizzi e un dispositivo a doppia pila ne alloca
// uno per famiglia su ciascuno: i relay arrivano in fila, non insieme. Se
// l'attesa si chiudesse al primo, dal codice sparirebbe una famiglia intera —
// e due elenchi di famiglie diverse non formano nemmeno una coppia ICE.
{
  const visti = [];
  const t0 = Date.now();
  await Net.waitForIce(
    fakePc([[100, 'host'], [300, 'srflx'], [1500, 'relay'], [1900, 'relay'], [2300, 'relay']]),
    { needRelay: true, onProgress: (t) => visti.push(t) },
  );
  const ms = Date.now() - t0;
  const relay = visti.filter((t) => t === 'relay').length;
  assert.equal(relay, 3, `raccolti tutti i relay della raffica, non solo il primo: ${relay}`);
  assert.ok(ms < 4000, `senza attendere il tetto: ${ms} ms`);
  console.log(`✓ raffica dal ponte: raccolti tutti e ${relay} i relay in ${ms} ms`);
}

console.log('\nAttesa dei candidati: tutte le prove sono passate.');
