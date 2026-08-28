/* Prove sulla schermata di collegamento: il flag "codice lungo" deve avere
   effetto quando viene spuntato, l'avviso "solo rete locale" deve comparire
   quando il codice non contiene un indirizzo pubblico, e l'età dell'invito
   deve essere visibile. In questo ambiente lo STUN è irraggiungibile, quindi
   siamo esattamente nel caso "solo candidati locali". */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

// L'ambiente di prova non ha uscita verso Internet: il tentativo di
// raggiungere il ponte fallisce per forza e il browser lo registra in console.
// È esattamente il caso che l'app deve tollerare, quindi non è un difetto.
const RETE_ASSENTE = /ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_|ERR_INTERNET_DISCONNECTED|ERR_PROXY_CONNECTION_FAILED|ERR_CERT_AUTHORITY_INVALID/;
const erroreVero = (m) => m.type() === 'error' && !RETE_ASSENTE.test(m.text());

const URL = process.env.APP_URL || 'http://127.0.0.1:8099/index.html';
const log = (...a) => console.log(...a);

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const errors = [];
const ctx = await browser.newContext();
const host = await ctx.newPage();
host.on('pageerror', (e) => errors.push(e.message));
host.on('console', (m) => { if (erroreVero(m)) errors.push('console: ' + m.text()); });
await host.goto(URL);
await host.waitForFunction(() => window.Sudoku && window.SudokuNet, null, { polling: 100 });

/* --- Riepilogo dei candidati: distingue locale da pubblico --- */
const summary = await host.evaluate(() => {
  const local = 'a=candidate:1 1 udp 2113937151 abc-def.local 5000 typ host\r\n';
  const pub = 'a=candidate:2 1 udp 1686052607 203.0.113.7 5001 typ srflx raddr 192.168.1.5 rport 5001\r\n';
  return {
    soloLocale: window.SudokuNet.candidateSummary(local),
    conPubblico: window.SudokuNet.candidateSummary(local + pub),
  };
});
assert.equal(summary.soloLocale.routable, 0, 'solo mDNS = nessun indirizzo pubblico');
assert.equal(summary.soloLocale.mdns, 1, 'candidato mDNS riconosciuto');
assert.equal(summary.conPubblico.routable, 1, 'srflx conta come pubblico');
log('✓ riepilogo candidati: distingue indirizzi locali e pubblici');

/* --- L'invito viene generato e l'avviso compare (qui STUN è bloccato) --- */
await host.click('#duo');
await host.click('#duo-create');
await host.waitForFunction(() => document.getElementById('duo-invite').value.includes('#j='),
  null, { polling: 100, timeout: 30000 });
const compact = await host.inputValue('#duo-invite');
assert.ok(compact.includes('#j=S1:'), 'codice compatto per difetto');
log(`✓ invito generato (${compact.split('#j=')[1].length} caratteri, forma compatta)`);

const status = await host.textContent('#duo-host-status');
assert.ok(/stessa rete Wi-Fi/.test(status),
  `l’avviso indica il rimedio, ricevuto: "${status}"`);
assert.ok(/ponte/i.test(status),
  `l’avviso nomina anche lo stato del ponte, ricevuto: "${status}"`);
log(`✓ avviso chiaro su indirizzi e ponte: "${status}"`);

/* --- Il flag "codice lungo" ora agisce sul codice già mostrato --- */
// Sta dentro il pannello «Non si collega?»: è lì che una persona lo cerca
assert.equal(await host.isVisible('#duo-long'), false, 'la casella è ripiegata per difetto');
await host.click('.duo__help > summary');
assert.equal(await host.isVisible('#duo-long'), true, 'aprendo l’aiuto la casella compare');
const helpText = await host.textContent('.duo__help');
assert.ok(/L’invito invecchia/.test(helpText), 'l’aiuto spiega la scadenza dell’invito');
assert.ok(/Wi-Fi/.test(helpText), 'l’aiuto cita la Wi-Fi come rimedio');
assert.ok(/dal ponte/.test(helpText), 'l’aiuto spiega il ruolo del ponte');
assert.ok(/Non cambia nulla se il problema è il collegamento/.test(helpText),
  'l’aiuto chiarisce che il codice lungo non risolve i problemi di collegamento');
log('✓ pannello «Non si collega?»: scadenza, ponte, Wi-Fi e uso del codice lungo');

await host.check('#duo-long');
await host.waitForFunction(() => document.getElementById('duo-invite').value.includes('#j=S1L:'),
  null, { polling: 100, timeout: 5000 });
const long = await host.inputValue('#duo-invite');
assert.ok(long.length > compact.length, `il codice lungo è più lungo (${long.length} > ${compact.length})`);
log(`✓ flag codice lungo: agisce subito (${compact.length} → ${long.length} caratteri)`);

// E si torna indietro senza rigenerare la connessione
await host.uncheck('#duo-long');
await host.waitForFunction(() => document.getElementById('duo-invite').value.includes('#j=S1:'),
  null, { polling: 100, timeout: 5000 });
assert.equal(await host.inputValue('#duo-invite'), compact, 'togliendo il flag si torna al codice identico');
log('✓ il flag è reversibile e non rinegozia la connessione');

/* --- Un codice lungo è comunque accettato da chi lo riceve --- */
await host.check('#duo-long');
await host.waitForFunction(() => document.getElementById('duo-invite').value.includes('S1L:'), null, { polling: 100 });
const longLink = await host.inputValue('#duo-invite');
const accepted = await host.evaluate((link) => {
  try {
    const sdp = window.SudokuNet.decodeDesc(link.split('#j=')[1]);
    return sdp.includes('m=application') && sdp.includes('a=ice-ufrag:');
  } catch (e) { return 'errore: ' + e.message; }
}, longLink);
assert.equal(accepted, true, `il codice lungo si decodifica: ${accepted}`);
log('✓ il codice lungo si decodifica in un SDP valido');

/* --- Età dell'invito visibile e che invecchia --- */
const age = await host.textContent('#duo-invite-age');
assert.ok(/Invito appena creato/.test(age), `età mostrata: "${age}"`);
assert.ok(await host.evaluate(() => document.getElementById('duo-invite-age').classList.contains('duo__age--fresh')));
log(`✓ età dell’invito mostrata: "${age}"`);

/* --- "Genera un nuovo invito" produce credenziali diverse --- */
const before = await host.inputValue('#duo-invite');
await host.click('#duo-invite-new');
await host.waitForFunction((old) => {
  const v = document.getElementById('duo-invite').value;
  return v.includes('#j=') && v !== old;
}, before, { polling: 100, timeout: 30000 });
const after = await host.inputValue('#duo-invite');
assert.notEqual(after, before, 'nuovo invito, codice diverso');
const ufrags = await host.evaluate(([a, b]) => {
  const u = (link) => /a=ice-ufrag:(.+)/.exec(window.SudokuNet.decodeDesc(link.split('#j=')[1]))[1].trim();
  return [u(a), u(b)];
}, [before, after]);
assert.notEqual(ufrags[0], ufrags[1], `credenziali ICE rinnovate (${ufrags[0]} → ${ufrags[1]})`);
log(`✓ nuovo invito: credenziali ICE rinnovate (${ufrags[0]} → ${ufrags[1]})`);

/* --- L'attesa dei candidati non si ferma più a 3 secondi --- */
const waited = await host.evaluate(async () => {
  const t0 = performance.now();
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  pc.createDataChannel('x');
  await pc.setLocalDescription(await pc.createOffer());
  // stessa attesa usata dal gioco, via il trasporto reale
  const tr = window.SudokuNet.RTCTransport();
  tr.onStateChange(() => {});
  await tr.createInvite(() => {});
  const ms = performance.now() - t0;
  tr.close(); pc.close();
  return Math.round(ms);
});
assert.ok(waited > 5000, `attesa dei candidati estesa: ${waited} ms (prima si fermava a 3000)`);
log(`✓ senza indirizzo pubblico si attende fino in fondo: ${waited} ms`);

/* --- Il guest ha la sua casella per il codice lungo --- */
await host.click('#duo-host-back');
await host.click('#duo-join');
await host.waitForFunction(() => !document.getElementById('duo-step-guest').hidden, null, { polling: 100 });
assert.equal(await host.isVisible('#duo-long-g'), true, 'il guest vede la casella del codice lungo');
log('✓ anche chi si unisce ha la casella del codice lungo (prima non c’era)');

if (errors.length) {
  console.error('\n✗ errori rilevati:\n' + errors.join('\n'));
  await browser.close();
  process.exit(1);
}
log('✓ nessun errore JavaScript');
await browser.close();
log('\nSchermata di collegamento: tutte le prove sono passate.');
