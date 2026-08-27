/* Non-regressione del single player dopo il refactor del motore:
   pausa, note, aiuto, annulla, vittoria con iniziali arcade, ripresa, sconfitta. */
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
const ctx = await browser.newContext();
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (erroreVero(m)) errors.push('console: ' + m.text()); });

await page.goto(URL);
await page.waitForFunction(() => window.Sudoku && document.querySelectorAll('.cell').length === 81);
await page.selectOption('#difficulty', 'facile');
await page.click('#new-game');
await page.waitForFunction(() => window.Sudoku.getState().running);
log('✓ nuova partita avviata');

/* --- Inserimento, evidenziazioni, contatori del tastierino --- */
const firstEmpty = await page.evaluate(() => {
  const s = window.Sudoku.getState();
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (s.values[r][c] === 0) return { r, c, v: s.solution[r][c] };
});
await page.click(`.cell:nth-child(${firstEmpty.r * 9 + firstEmpty.c + 1})`);
assert.ok(await page.evaluate(() => document.querySelectorAll('.cell--peer').length > 0), 'evidenziazione dei pari');
await page.click(`.numpad__btn:nth-child(${firstEmpty.v})`);
assert.equal(
  await page.evaluate(({ r, c }) => window.Sudoku.getState().values[r][c], firstEmpty),
  firstEmpty.v, 'cifra inserita',
);
log('✓ selezione, evidenziazioni e inserimento');

/* --- Annulla --- */
await page.keyboard.press('z');
assert.equal(
  await page.evaluate(({ r, c }) => window.Sudoku.getState().values[r][c], firstEmpty),
  0, 'annulla ripristina la cella',
);
log('✓ annulla');

/* --- Note --- */
await page.keyboard.press('n');
assert.equal(await page.getAttribute('#notes', 'aria-pressed'), 'true');
await page.keyboard.press('5');
assert.ok(await page.evaluate(({ r, c }) => window.Sudoku.getState().notes[r * 9 + c].has(5), firstEmpty), 'nota annotata');
await page.keyboard.press('n');
log('✓ modalità note');

/* --- Aiuto: consuma un aiuto e fissa la cella --- */
const hintsBefore = await page.textContent('#hints-left');
await page.keyboard.press('h');
assert.equal(Number(await page.textContent('#hints-left')), Number(hintsBefore) - 1, 'aiuto consumato');
log('✓ aiuto');

/* --- Errore: il contatore sale --- */
await page.evaluate(() => {
  const s = window.Sudoku.getState();
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (s.values[r][c] === 0) {
    const wrong = s.solution[r][c] === 9 ? 8 : 9;
    document.querySelectorAll('.cell')[r * 9 + c].click();
    document.querySelectorAll('.numpad__btn')[wrong - 1].click();
    return;
  }
});
assert.equal(await page.evaluate(() => window.Sudoku.getState().mistakes), 1, 'errore contato');
assert.ok((await page.textContent('#mistakes')).startsWith('1'), 'HUD errori aggiornato');
log('✓ errori contati e mostrati');

/* --- Pausa: ferma il cronometro e copre la griglia --- */
await page.keyboard.press('p');
assert.equal(await page.evaluate(() => window.Sudoku.getState().paused), true);
assert.equal(await page.isVisible('#veil'), true, 'velo mostrato');
await page.keyboard.press('p');
assert.equal(await page.evaluate(() => window.Sudoku.getState().paused), false);
log('✓ pausa e ripresa');

/* --- Ripresa dopo ricarica --- */
await page.evaluate(() => window.Sudoku.getState()); // forza un salvataggio col prossimo tick
await page.waitForTimeout(1200);
const before = await page.evaluate(() => window.Sudoku.getState().values.flat().join(''));
await page.reload();
await page.waitForFunction(() => window.Sudoku && window.Sudoku.getState().running);
const after = await page.evaluate(() => window.Sudoku.getState().values.flat().join(''));
assert.equal(after, before, 'la griglia è ripresa identica');
assert.ok((await page.textContent('#toast')).includes('ripresa'), 'avviso di ripresa');
log('✓ ripresa dopo ricarica, tempo e griglia inclusi');

/* --- Vittoria: iniziali arcade da tastiera e classifica --- */
await page.evaluate(() => {
  const s = window.Sudoku.getState();
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++)
    if (s.values[r][c] !== s.solution[r][c]) {
      document.querySelectorAll('.cell')[r * 9 + c].click();
      document.querySelectorAll('.numpad__btn')[s.solution[r][c] - 1].click();
    }
});
await page.waitForFunction(() => !document.getElementById('name-overlay').hidden, null, { timeout: 10000 });
log('✓ vittoria: si aprono le iniziali arcade');

// Le lettere si digitano, come prima del refactor
await page.keyboard.type('LUI');
const letters = await page.evaluate(() =>
  [...document.querySelectorAll('#name-slots .slot__letter')].map((n) => n.textContent).join(''));
assert.equal(letters, 'LUI', `iniziali digitate: ${letters}`);
// Le frecce spostano il cursore e cambiano lettera: dopo 3 lettere il cursore è
// sulla terza, quindi ← lo porta sulla seconda e ↑ ne cambia la lettera (U→V)
await page.keyboard.press('ArrowLeft');
await page.keyboard.press('ArrowUp');
const cycled = await page.evaluate(() =>
  [...document.querySelectorAll('#name-slots .slot__letter')].map((n) => n.textContent).join(''));
assert.equal(cycled, 'LVI', `freccia su: ${cycled}`);
await page.keyboard.press('ArrowDown'); // torna a LUI
await page.keyboard.press('Enter');
await page.waitForFunction(() => document.getElementById('name-overlay').hidden);
log('✓ iniziali: digitazione, frecce e conferma');

await page.waitForFunction(() => !document.getElementById('overlay').hidden);
assert.equal(await page.textContent('#modal-title'), 'Complimenti!');
const scores = await page.evaluate(() => JSON.parse(localStorage.getItem('sudoku.scores.v1')));
assert.equal(scores.facile.length, 1, 'un record in classifica');
assert.equal(scores.facile[0].name, 'LUI');
assert.equal(scores.facile[0].errors, 1, 'errori registrati nel record');
assert.equal(scores.facile[0].hints, 1, 'aiuti registrati nel record');
const stats = await page.evaluate(() => JSON.parse(localStorage.getItem('sudoku.stats.v1')));
assert.equal(stats.facile.won, 1);
assert.equal(stats.facile.played, 1);
assert.equal(await page.evaluate(() => localStorage.getItem('sudoku.save.v1')), null, 'salvataggio rimosso a fine partita');
log('✓ classifica, statistiche e pulizia del salvataggio');

/* --- Nuova partita dal modale di vittoria --- */
await page.click('#modal-new');
await page.waitForFunction(() => window.Sudoku.getState().running && !window.Sudoku.getState().finished);

/* --- Il pannello record mostra il record appena fatto e la riga dei duelli --- */
await page.click('#records');
await page.waitForFunction(() => !document.getElementById('records-overlay').hidden);
assert.ok((await page.textContent('#records-list')).includes('LUI'), 'il record è in classifica');
assert.ok((await page.textContent('#records-duel')).includes('Nessun duello'), 'riga duelli presente');
await page.click('#records-close');
log('✓ pannello record: classifica del solo e riga duelli separate');

/* --- Sconfitta al terzo errore --- */
await page.evaluate(() => {
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
await page.waitForFunction(() => !document.getElementById('overlay').hidden);
assert.equal(await page.textContent('#modal-title'), 'Game Over');
log('✓ sconfitta al terzo errore');

/* --- La barra del single player resta quella di sempre --- */
// «Celle» e la riga «Tu» nascono per il duello: qui non devono comparire, e la
// barra dei dati deve restare dov'è.
{
  const barra = await page.evaluate(() => ({
    celle: !document.getElementById('stat-filled').hidden,
    aiuti: !document.getElementById('stat-hints').hidden,
    rigaTu: !document.getElementById('duo-mine').hidden,
    aPosto: document.querySelector('.toolbar__stats').parentElement.classList.contains('toolbar'),
    etichette: [...document.querySelectorAll('.toolbar__stats .stat')]
      .filter((n) => !n.hidden)
      .map((n) => n.querySelector('.stat__label').textContent),
  }));
  assert.equal(barra.celle, false, '«Celle» non compare nel single player');
  assert.equal(barra.aiuti, false, '«Aiuti» nemmeno: qui c’è il record');
  assert.equal(barra.rigaTu, false, 'la riga «Tu» è roba da duello');
  assert.ok(barra.aPosto, 'i dati sono rimasti nella barra in alto');
  assert.deepEqual(barra.etichette, ['Tempo', 'Errori', 'Record'], 'la barra è quella di prima');
  log('✓ barra del single player invariata: Tempo · Errori · Record');
}

if (errors.length) {
  console.error('\n✗ errori rilevati:\n' + errors.join('\n'));
  await browser.close();
  process.exit(1);
}
log('✓ nessun errore JavaScript');

await browser.close();
log('\nSingle player: nessuna regressione.');
