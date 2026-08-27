/* Lo scambio automatico visto dal gioco: due dispositivi si collegano **senza
   che nessuno copi o incolli niente**.

   È la prova del giro che sostituisce il copia-incolla, ed è anche l'unica che
   esercita il codice vero del Worker dal browser: sotto `/s` il finto endpoint
   fa girare `turn-worker/worker.js` su uno SQLite in memoria. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const APP = process.env.APP_URL || 'http://127.0.0.1:8099/index.html';
const MOCK = 'http://127.0.0.1:8123';
const URL = `${APP}?turn=${MOCK}`;
const log = (...a) => console.log(...a);

const RETE_ASSENTE = /ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_|ERR_INTERNET_DISCONNECTED|ERR_PROXY_CONNECTION_FAILED|ERR_CERT_AUTHORITY_INVALID/;

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const errors = [];

async function scheda() {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (RETE_ASSENTE.test(m.text())) return;
    // Una stanza inesistente risponde 404 e il browser lo scrive in console:
    // è esattamente il caso che qui sotto si va a provare, non un difetto.
    const dove = (m.location && m.location().url) || '';
    if (/\/s(\/|$)/.test(dove) && /404/.test(m.text())) return;
    errors.push('console: ' + m.text());
  });
  return { ctx, p };
}

const A = await scheda();
const B = await scheda();

/* --- Chi invita riceve un codice breve, non un muro di caratteri --- */
await A.p.goto(URL);
await A.p.waitForFunction(() => window.Sudoku && window.SudokuNet, null, { polling: 100 });
await A.p.click('#duo');
await A.p.click('#duo-create');
await A.p.waitForFunction(
  () => !document.getElementById('duo-room').hidden
    && /^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(document.getElementById('duo-room-code').textContent),
  null, { polling: 100, timeout: 40000 },
);
const stanza = (await A.p.textContent('#duo-room-code')).trim();
const link = await A.p.inputValue('#duo-room-link');
assert.match(stanza, /^[A-Z0-9]{3}-[A-Z0-9]{3}$/, `codice leggibile: ${stanza}`);
assert.ok(link.includes('#j=' + stanza), 'il link porta il codice della stanza');
assert.ok(link.length < 200, `link corto (${link.length} caratteri, prima erano più di 600)`);
log(`✓ codice breve invece del link chilometrico: ${stanza} (${link.length} caratteri)`);

/* --- I due passi manuali spariscono: non c'è più niente da rimandare --- */
assert.ok(await A.p.evaluate(() => document.getElementById('duo-answer-in')
  .closest('.duo__field').hidden), 'il campo «incolla la risposta» è sparito');
log('✓ il passo «incolla il codice di risposta» non c’è più');

/* --- Chi risponde apre il link e non fa altro --- */
// Il link porta già con sé il `?turn=` della pagina che l'ha creato: è la
// stessa cosa che succede sul campo quando si prova un endpoint con `?turn=`.
assert.ok(link.includes(`turn=${MOCK}`), 'il link conserva l’endpoint di prova');
await B.p.goto(link);
await B.p.waitForFunction(
  () => /Risposta mandata|Aspetta il via/.test(document.getElementById('duo-guest-status').textContent),
  null, { polling: 100, timeout: 40000 },
);
log('✓ chi risponde ritira l’invito e deposita la risposta da sé');

/* --- E il duello parte, senza che nessuno abbia copiato niente --- */
await Promise.all([A.p, B.p].map((p) => p.waitForFunction(
  () => !document.getElementById('duo-count').hidden, null, { polling: 100, timeout: 40000 })));
log('✓ COLLEGAMENTO APERTO con zero copia-incolla');

await Promise.all([A.p, B.p].map((p) => p.waitForFunction(
  () => window.Sudoku.getState().mode === 'duel' && !window.Sudoku.getState().waiting,
  null, { polling: 100, timeout: 30000 })));
const semi = await Promise.all([A.p, B.p].map((p) => p.evaluate(() => window.Sudoku.getState().seed)));
assert.equal(semi[0], semi[1], 'stesso puzzle su tutti e due');
log(`✓ duello in corso sullo stesso puzzle (seed ${semi[0]})`);

/* --- La stanza sparisce appena servita: non resta niente in giro --- */
{
  const res = await A.p.evaluate(async (u) => {
    const r = await fetch(u);
    return { status: r.status };
  }, `${MOCK}/s/${stanza}/r`);
  assert.equal(res.status, 404, 'la stanza è stata cancellata dopo la raccolta');
  log('✓ raccolta la risposta, la stanza non esiste più');
}

/* --- Un codice inventato non lascia il giocatore senza spiegazione --- */
{
  const { ctx, p } = await scheda();
  await p.goto(URL);
  await p.waitForFunction(() => window.Sudoku && window.SudokuNet, null, { polling: 100 });
  await p.click('#duo');
  await p.click('#duo-join');
  await p.fill('#duo-invite-in', 'ZZZ-ZZZ');
  await p.click('#duo-join-go');
  await p.waitForFunction(
    () => /non vale più|non riesco/i.test(document.getElementById('duo-guest-status').textContent),
    null, { polling: 100, timeout: 20000 },
  );
  log(`✓ codice inesistente: "${(await p.textContent('#duo-guest-status')).trim()}"`);
  await ctx.close();
}

if (errors.length) {
  console.error('\n✗ errori rilevati:\n' + errors.join('\n'));
  await browser.close();
  process.exit(1);
}
await browser.close();
log('\nScambio automatico dal browser: tutte le prove sono passate.');
