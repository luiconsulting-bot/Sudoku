/* Percorsi del duello che non passano da WebRTC:
   modalità "due schede", sconfitta per errori esauriti, connessione perduta.
   Usa il trasporto locale (BroadcastChannel), che è più rapido da pilotare. */
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

async function pair(label) {
  // BroadcastChannel parla tra schede della stessa origine: stesso contesto
  const ctx = await browser.newContext();
  const a = await ctx.newPage();
  const b = await ctx.newPage();
  for (const [n, p] of [[`${label}/A`, a], [`${label}/B`, b]]) {
    p.on('pageerror', (e) => errors.push(`${n}: ${e.message}`));
    p.on('console', (m) => { if (erroreVero(m)) errors.push(`${n} console: ${m.text()}`); });
    await p.goto(URL);
    await p.waitForFunction(() => window.Sudoku && document.querySelectorAll('.cell').length === 81, null, { polling: 100 });
  }
  // A crea, B si unisce, entrambi in modalità di prova locale
  for (const p of [a, b]) {
    await p.click('#duo');
    await p.click('#duo-local');
    assert.equal(await p.getAttribute('#duo-local', 'aria-pressed'), 'true');
    assert.equal(await p.isVisible('#duo-local-note'), true, 'nota della prova locale visibile');
  }
  await a.selectOption('#duo-difficulty', 'facile');
  await a.click('#duo-create');
  await b.click('#duo-join');
  // In parallelo: il countdown dura pochi secondi e aspettarlo una scheda alla
  // volta lo farebbe perdere sulla seconda.
  await Promise.all([a, b].map((p) => p.waitForFunction(
    () => !document.getElementById('duo-count').hidden, null, { timeout: 30000, polling: 100 })));
  await Promise.all([a, b].map((p) => p.waitForFunction(
    () => window.Sudoku.getState().running, null, { timeout: 15000, polling: 100 })));
  return { ctx, a, b };
}

/* ============ 1. Due schede: il duello parte senza scambio di codici ============ */
{
  const { ctx, a, b } = await pair('locale');
  const seeds = await Promise.all([a, b].map((p) => p.evaluate(() => window.Sudoku.getState().seed)));
  assert.equal(seeds[0], seeds[1], 'stesso puzzle nelle due schede');
  log(`✓ modalità due schede: duello avviato senza codici (seed ${seeds[0]})`);

  /* --- B esaurisce i 3 errori: A deve vincere, anche se stava ancora giocando --- */
  await b.evaluate(() => {
    const s = window.Sudoku.getState();
    let done = 0;
    for (let r = 0; r < 9 && done < 3; r++) for (let c = 0; c < 9 && done < 3; c++)
      if (s.values[r][c] === 0) {
        const wrong = s.solution[r][c] === 9 ? 8 : 9;
        document.querySelectorAll('.cell')[r * 9 + c].click();
        document.querySelectorAll('.numpad__btn')[wrong - 1].click();
        done++;
      }
  });
  for (const p of [a, b]) {
    await p.waitForFunction(() => !document.getElementById('duo-result').hidden, null, { timeout: 20000, polling: 100 });
  }
  assert.equal(await a.textContent('#duo-result-title'), 'Hai vinto!', 'chi è ancora in gioco vince');
  assert.equal(await b.textContent('#duo-result-title'), 'Hai perso');
  assert.ok(/ha esaurito gli errori/.test(await a.textContent('#duo-result-msg')));
  assert.ok(/Hai esaurito gli errori/.test(await b.textContent('#duo-result-msg')));
  log('✓ chi esaurisce i 3 errori perde, l’altro vince pur non avendo finito');

  // Le due schede condividono il localStorage: una partita di prova non può
  // essere contemporaneamente vittoria e sconfitta per lo stesso profilo, quindi
  // in modalità di prova non si registra nulla.
  const st = await a.evaluate(() => localStorage.getItem('sudoku.duel.stats.v1'));
  assert.equal(st, null, 'i duelli di prova non entrano nelle statistiche');
  log('✓ modalità di prova: nessuna statistica falsata');

  // Il pannello mostra dove era arrivato chi non ha finito
  const mineLine = await a.textContent('#duo-result-mine');
  assert.ok(/non completato/.test(mineLine), `riga del vincitore incompleto: ${mineLine}`);
  log('✓ il pannello esito mostra i progressi di chi non ha concluso');

  /* --- Chiudere l'esito riporta al single player --- */
  await a.click('#duo-result-close');
  await a.waitForFunction(() => document.getElementById('duo-hud').hidden, null, { polling: 100 });
  assert.equal(await a.evaluate(() => window.Sudoku.getState().mode), 'solo');
  assert.equal(await a.isVisible('#difficulty'), true, 'comandi del solo tornati visibili');
  log('✓ chiuso l’esito, si torna al single player');
  await ctx.close();
}

/* ============ 2. Connessione perduta: si sceglie, non si perde ============ */
{
  const { ctx, a, b } = await pair('caduta');
  log('✓ secondo duello avviato');

  // La scheda dell'avversario sparisce di colpo
  await b.close();
  // Prima l'avviso di instabilità...
  await a.waitForFunction(
    () => document.getElementById('duo-link').classList.contains('duo__link--warn'),
    null, { timeout: 15000, polling: 100 },
  );
  log('✓ dopo pochi secondi di silenzio: "connessione instabile"');

  // ...poi la scelta su cosa fare
  await a.waitForFunction(() => !document.getElementById('duo-result').hidden, null, { timeout: 40000, polling: 100 });
  assert.equal(await a.textContent('#duo-result-title'), 'Connessione perduta');
  assert.equal(await a.textContent('#duo-rematch'), 'Vinci a tavolino');
  assert.equal(await a.textContent('#duo-result-close'), 'Continua da solo');
  log('✓ scelta offerta: vittoria a tavolino oppure continuare da solo');

  // Sceglie di continuare da solo: la partita prosegue come single player
  await a.click('#duo-result-close');
  await a.waitForFunction(() => document.getElementById('duo-hud').hidden, null, { polling: 100 });
  assert.equal(await a.evaluate(() => window.Sudoku.getState().mode), 'solo');
  assert.equal(await a.evaluate(() => window.Sudoku.getState().finished), false, 'la partita continua');
  assert.ok(await a.evaluate(() => localStorage.getItem('sudoku.save.v1') !== null),
    'da qui in poi la partita si salva come in solitaria');
  log('✓ "continua da solo": la partita prosegue e ricomincia a salvarsi');
  await ctx.close();
}

/* ============ 3. Vittoria a tavolino ============ */
{
  const { ctx, a, b } = await pair('tavolino');
  await b.close();
  await a.waitForFunction(() => !document.getElementById('duo-result').hidden, null, { timeout: 40000, polling: 100 });
  await a.click('#duo-rematch'); // "Vinci a tavolino"
  await a.waitForFunction(() => document.getElementById('duo-result').hidden, null, { polling: 100 });
  assert.equal(await a.evaluate(() => window.Sudoku.getState().mode), 'solo');
  assert.equal(await a.evaluate(() => window.Sudoku.getState().finished), true, 'la partita è chiusa');
  assert.ok((await a.textContent('#toast')).includes('tavolino'), 'esito comunicato');
  log('✓ vittoria a tavolino: duello chiuso e comunicato');
  await ctx.close();
}

/* ============ 4. Un invito con versione di protocollo diversa viene rifiutato ============ */
{
  const ctx = await browser.newContext();
  const a = await ctx.newPage();
  a.on('pageerror', (e) => errors.push(`proto: ${e.message}`));
  await a.goto(URL);
  await a.waitForFunction(() => window.Sudoku && document.querySelectorAll('.cell').length === 81, null, { polling: 100 });
  await a.click('#duo');
  await a.click('#duo-local');
  await a.click('#duo-create');
  await a.waitForFunction(() => !document.getElementById('duo-step-host').hidden, null, { polling: 100 });
  // Un "avversario" con protocollo futuro
  await a.evaluate(() => {
    const ch = new BroadcastChannel('sudoku.duo.local');
    ch.postMessage({ t: 'hello', proto: 99, name: 'XXX' });
  });
  await a.waitForFunction(
    () => /versione diversa/.test(document.getElementById('duo-host-status').textContent),
    null, { timeout: 10000, polling: 100 },
  );
  log('✓ protocollo incompatibile: messaggio chiaro invece di un blocco muto');
  await ctx.close();
}

if (errors.length) {
  console.error('\n✗ errori rilevati:\n' + errors.join('\n'));
  await browser.close();
  process.exit(1);
}
log('✓ nessun errore JavaScript');

await browser.close();
log('\nPercorsi del duello: tutte le prove sono passate.');
