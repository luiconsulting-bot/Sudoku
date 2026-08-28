/* Il giro di collegamento come avviene su due telefoni:
   il guest apre il link e la risposta si prepara da sé, l'host incolla e si
   collega da sé — anche se la tastiera ha reso minuscolo il prefisso. */
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

async function device(label) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  p.on('console', (m) => { if (erroreVero(m)) errors.push(`${label} console: ${m.text()}`); });
  await p.goto(URL);
  await p.waitForFunction(() => window.Sudoku && document.querySelectorAll('.cell').length === 81,
    null, { polling: 100 });
  return { ctx, p };
}

const A = await device('host');
const B = await device('guest');

/* --- Host crea --- */
await A.p.click('#duo');
await A.p.selectOption('#duo-difficulty', 'facile');
await A.p.click('#duo-create');
await A.p.waitForFunction(() => document.getElementById('duo-invite').value.includes('#j='),
  null, { polling: 100, timeout: 30000 });
const link = await A.p.inputValue('#duo-invite');
log('✓ host: invito pronto');

/* --- Guest apre il link: la risposta deve prepararsi DA SÉ, senza toccare nulla --- */
await B.p.goto(link);
await B.p.waitForFunction(() => document.getElementById('duo-answer-out').value.length > 20,
  null, { polling: 100, timeout: 30000 });
const answer = await B.p.inputValue('#duo-answer-out');
log('✓ guest: aprendo il link la risposta si genera da sé (nessun pulsante premuto)');

// Il frammento resta nell'URL finché la risposta non è pronta, poi viene ripulito
const hashAfter = await B.p.evaluate(() => location.hash);
assert.equal(hashAfter, '', `URL ripulito dopo l’uso: "${hashAfter}"`);
log('✓ guest: il frammento è stato consumato e poi ripulito');

// Premere «Genera risposta» per abitudine non deve invalidare la risposta già mandata
await B.p.click('#duo-join-go');
await B.p.waitForTimeout(500);
assert.equal(await B.p.inputValue('#duo-answer-out'), answer, 'la risposta non è stata rigenerata');
assert.ok(/già pronta/.test(await B.p.textContent('#duo-guest-status')), 'lo dice chiaramente');
log('✓ guest: ripremere il pulsante non invalida la risposta già inviata');

/* --- Host incolla la risposta con il prefisso rovinato dalla tastiera --- */
const mangled = '  s1' + answer.slice(2) + ' ';  // "S1:" → "s1:", più spazi
assert.notEqual(mangled.trim(), answer, 'il codice è davvero alterato');
await A.p.fill('#duo-answer-in', mangled);
// Nessun click su «Collega»: deve partire da sé
await Promise.all([A.p, B.p].map((p) => p.waitForFunction(
  () => !document.getElementById('duo-count').hidden, null, { polling: 100, timeout: 30000 })));
log('✓ host: codice con prefisso minuscolo accettato e collegamento avviato da sé');

await Promise.all([A.p, B.p].map((p) => p.waitForFunction(
  () => window.Sudoku.getState().mode === 'duel' && !window.Sudoku.getState().waiting,
  null, { polling: 100, timeout: 30000 })));
const seeds = await Promise.all([A.p, B.p].map((p) => p.evaluate(() => window.Sudoku.getState().seed)));
assert.equal(seeds[0], seeds[1], 'stesso puzzle');
log(`✓ duello in corso su entrambi i telefoni (seed ${seeds[0]})`);

/* --- Il pulsante «Collega» resta la rete di sicurezza --- */
// Impostare il valore da codice non genera l'evento `input`, quindi qui
// l'automatismo non scatta: è la situazione in cui il pulsante deve servire.
// Si verifica che il pulsante arrivi ad accettare la risposta — che il codice
// venga cioè applicato senza errori. Il buon fine della negoziazione ICE è già
// coperto dalla coppia precedente: ripeterlo qui dipenderebbe dalla rete
// dell'ambiente di prova, non dal codice.
const D = await device('pulsante');
const E = await device('pulsante-guest');
await D.p.click('#duo');
await D.p.click('#duo-create');
await D.p.waitForFunction(() => document.getElementById('duo-invite').value.includes('#j='),
  null, { polling: 100, timeout: 30000 });
const link2 = await D.p.inputValue('#duo-invite');
await E.p.goto(link2);
await E.p.waitForFunction(() => document.getElementById('duo-answer-out').value.length > 20,
  null, { polling: 100, timeout: 30000 });
const answer2 = await E.p.inputValue('#duo-answer-out');

await D.p.evaluate((v) => { document.getElementById('duo-answer-in').value = v; }, answer2);
await D.p.waitForTimeout(300);
const stBefore = await D.p.textContent('#duo-host-status');
assert.ok(!/Collego/.test(stBefore),
  `senza evento input nulla è ancora partito, stato: "${stBefore}"`);

await D.p.click('#duo-answer-ok');
await D.p.waitForFunction(() => {
  const t = document.getElementById('duo-host-status').textContent;
  return /Collego|collegato/.test(t) || /non valido/.test(t);
}, null, { polling: 100, timeout: 10000 });
const st2 = await D.p.textContent('#duo-host-status');
assert.ok(!/non valido/.test(st2), `il pulsante ha accettato la risposta, stato: "${st2}"`);
log('✓ il pulsante «Collega» accetta la risposta quando l’automatismo non scatta');

/* --- Contro-prova: un testo senza codice dà un errore comprensibile --- */
const C = await device('errore');
await C.p.click('#duo');
await C.p.click('#duo-join');
await C.p.fill('#duo-invite-in', 'ciao, ti mando il codice dopo');
await C.p.click('#duo-join-go');
await C.p.waitForFunction(() => /Incolla il link o il codice/.test(
  document.getElementById('duo-guest-status').textContent), null, { polling: 100, timeout: 5000 });
log('✓ testo senza codice: messaggio comprensibile, non un fallimento muto');

/* --- E un codice dentro una frase di chat funziona --- */
await C.p.fill('#duo-invite-in', 'ecco: ' + link.split('#j=')[1] + ' dai sbrigati');
await C.p.waitForFunction(() => document.getElementById('duo-answer-out').value.length > 20,
  null, { polling: 100, timeout: 30000 });
log('✓ codice incollato dentro una frase: riconosciuto senza corrompersi');

if (errors.length) {
  console.error('\n✗ errori rilevati:\n' + errors.join('\n'));
  await browser.close();
  process.exit(1);
}
log('✓ nessun errore JavaScript');
await browser.close();
log('\nGiro di collegamento: tutte le prove sono passate.');
