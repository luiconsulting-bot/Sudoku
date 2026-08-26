/* Il timbro di versione e il referto di rete: servono a rendere osservabile
   quello che finora si poteva solo indovinare da fuori. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const REPO = new globalThis.URL('..', import.meta.url).pathname;

// L'ambiente di prova non ha uscita verso Internet: il tentativo di
// raggiungere il ponte fallisce per forza e il browser lo registra in console.
// È esattamente il caso che l'app deve tollerare, quindi non è un difetto.
const RETE_ASSENTE = /ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_|ERR_INTERNET_DISCONNECTED|ERR_PROXY_CONNECTION_FAILED|ERR_CERT_AUTHORITY_INVALID/;
const erroreVero = (m) => m.type() === 'error' && !RETE_ASSENTE.test(m.text());

const URL = process.env.APP_URL || 'http://127.0.0.1:8099/index.html';
const log = (...a) => console.log(...a);

/* --- La versione in script.js e i ?v= in index.html devono coincidere --- */
const html = readFileSync(REPO + 'index.html', 'utf8');
const js = readFileSync(REPO + 'script.js', 'utf8');
const declared = /APP_VERSION = '([^']+)'/.exec(js)[1];
const busted = [...html.matchAll(/(?:src|href)="(?:net|script|duo)\.js\?v=([^"]+)"|href="style\.css\?v=([^"]+)"/g)]
  .map((m) => m[1] || m[2]);
assert.ok(busted.length >= 4, `tutti i file hanno il ?v=: trovati ${busted.length}`);
for (const v of busted) {
  assert.equal(v, declared, `?v=${v} non coincide con APP_VERSION ${declared}`);
}
log(`✓ versione coerente in tutti i riferimenti: ${declared}`);

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const errors = [];
const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (erroreVero(m)) errors.push('console: ' + m.text()); });
await page.goto(URL);
await page.waitForFunction(() => window.Sudoku, null, { polling: 100 });

/* --- La versione è leggibile a schermo, senza console --- */
assert.equal(await page.textContent('#app-version'), declared, 'versione a fondo pagina');
log(`✓ versione visibile a fondo pagina: ${declared}`);

/* --- Il referto di rete dice cosa è stato trovato --- */
await page.click('#duo');
await page.click('#duo-create');
await page.waitForFunction(() => document.getElementById('duo-host-net').textContent.length > 0,
  null, { polling: 100, timeout: 30000 });
const net = await page.textContent('#duo-host-net');
// In questo ambiente lo STUN è irraggiungibile: solo indirizzi locali mDNS
assert.ok(/Indirizzi nel codice/.test(net), `referto presente: "${net}"`);
assert.ok(/local/.test(net) && /mDNS/.test(net), `riconosce il caso mDNS: "${net}"`);
assert.ok(!/pubblic/.test(net), `nessun pubblico, correttamente: "${net}"`);
assert.ok(await page.evaluate(() => document.getElementById('duo-host-net').classList.contains('duo__net--warn')),
  'evidenziato come problema');
log(`✓ referto di rete: "${net}"`);

/* --- La versione compare anche nel pannello di aiuto --- */
await page.click('.duo__help > summary');
assert.equal(await page.textContent('#duo-version'), declared, 'versione nel pannello aiuto');
log('✓ versione ripetuta nel pannello «Non si collega?»');

/* --- «Collego…» non resta appeso: dopo il tempo dice cosa non è andato --- */
// Il caso da riprodurre è il più insidioso: una risposta *valida* ma calcolata
// su un altro invito. Viene accettata senza errori e poi non si collega mai —
// esattamente ciò che accade quando la rete non lascia passare il traffico.
const other = await browser.newPage();
other.on('pageerror', (e) => errors.push('other: ' + e.message));
await other.goto(URL);
await other.waitForFunction(() => window.Sudoku, null, { polling: 100 });
await other.click('#duo');
await other.click('#duo-create');
await other.waitForFunction(() => document.getElementById('duo-invite').value.includes('#j='),
  null, { polling: 100, timeout: 30000 });
const otherLink = await other.inputValue('#duo-invite');

const joiner = await browser.newPage();
joiner.on('pageerror', (e) => errors.push('joiner: ' + e.message));
await joiner.goto(otherLink);
await joiner.waitForFunction(() => document.getElementById('duo-answer-out').value.length > 20,
  null, { polling: 100, timeout: 30000 });
const foreignAnswer = await joiner.inputValue('#duo-answer-out');

// Accorcia l'attesa del sorvegliante per non tenere in piedi la prova 25 secondi
await page.evaluate(() => {
  const orig = window.setTimeout;
  window.setTimeout = (fn, ms) => orig(fn, ms === 25000 ? 800 : ms);
});
await page.fill('#duo-answer-in', foreignAnswer);
await page.waitForFunction(() => /Collego|Nessun collegamento/.test(
  document.getElementById('duo-host-status').textContent), null, { polling: 100, timeout: 8000 });
assert.ok(!/non valido/.test(await page.textContent('#duo-host-status')),
  'la risposta è stata accettata: il problema non è il codice');
await page.waitForFunction(() => /Nessun collegamento/.test(
  document.getElementById('duo-host-status').textContent), null, { polling: 100, timeout: 15000 });
const diag = await page.textContent('#duo-host-status');
assert.ok(/stessa rete Wi-Fi/.test(diag), `spiega cosa fare: "${diag}"`);
log('✓ risposta accettata ma collegamento mai aperto: diagnosi invece di attesa infinita');
log(`   → "${diag}"`);

/* --- Il referto tecnico: la sola traccia che si può farsi mandare da lontano --- */
// Un collegamento fallito sul campo non lascia niente da leggere: qui non si
// attraversano NAT veri, quindi senza referto la diagnosi resta un'ipotesi.
assert.ok(await page.evaluate(() => {
  const box = document.getElementById('duo-report-box');
  return box && !box.hidden && box.open;
}), 'il referto si apre da sé quando il collegamento fallisce');
const referto = await page.inputValue('#duo-report');
log('  referto:\n' + referto.split('\n').map((r) => '    ' + r).join('\n'));
for (const atteso of ['spediti:', 'ricevuti:', 'errori ICE', 'coppie:', 'stati:', declared]) {
  assert.ok(referto.includes(atteso), `il referto dice "${atteso}":\n${referto}`);
}
// Quello che conta davvero: tipo *e* famiglia, i due elenchi a confronto
assert.ok(/spediti: .*(host|srflx|relay)/.test(referto), 'il referto elenca i candidati spediti per tipo');
log('✓ referto tecnico compilato e copiabile');

if (errors.length) {
  console.error('\n✗ errori rilevati:\n' + errors.join('\n'));
  await browser.close();
  process.exit(1);
}
log('✓ nessun errore JavaScript');
await browser.close();
log('\nDiagnostica: tutte le prove sono passate.');
