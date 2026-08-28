/* Prova capo a capo del duello in un browser vero.
   Due contesti separati (due "dispositivi") si collegano via WebRTC scambiandosi
   i codici come farebbero due persone su WhatsApp, poi giocano fino all'esito. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

// L'ambiente di prova non ha uscita verso Internet: il tentativo di
// raggiungere il ponte fallisce per forza e il browser lo registra in console.
// È esattamente il caso che l'app deve tollerare, quindi non è un difetto.
const RETE_ASSENTE = /ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_|ERR_INTERNET_DISCONNECTED|ERR_PROXY_CONNECTION_FAILED|ERR_CERT_AUTHORITY_INVALID/;
const erroreVero = (m) => m.type() === 'error' && !RETE_ASSENTE.test(m.text());

const URL = process.env.APP_URL || 'http://127.0.0.1:8099/index.html';
const log = (...a) => console.log(...a);

const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--no-sandbox'],
});

// Contesti distinti: localStorage separato, come due dispositivi diversi
const hostCtx = await browser.newContext();
const guestCtx = await browser.newContext();
const host = await hostCtx.newPage();
const guest = await guestCtx.newPage();

const errors = [];
for (const [name, page] of [['host', host], ['guest', guest]]) {
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => {
    if (erroreVero(m)) errors.push(`${name} console: ${m.text()}`);
  });
}

await host.goto(URL);
await guest.goto(URL);
await host.waitForFunction(() => window.Sudoku && document.querySelectorAll('.cell').length === 81);
await guest.waitForFunction(() => window.Sudoku && document.querySelectorAll('.cell').length === 81);
log('✓ entrambe le pagine caricate, single player avviato');

/* --- Il single player non è regredito --- */
const solo = await host.evaluate(() => {
  const st = window.Sudoku.getState();
  return { mode: st.mode, seed: st.seed, given: st.given.flat().filter(Boolean).length, running: st.running };
});
assert.equal(solo.mode, 'solo');
assert.ok(solo.seed > 0, 'la partita solo ha un seed');
assert.ok(solo.running, 'il cronometro gira');
assert.ok(solo.given > 20, `celle iniziali: ${solo.given}`);
log(`✓ partita in solitaria regolare (${solo.given} celle date, cronometro attivo)`);

// Salvataggio solo presente: deve sopravvivere al duello
await host.waitForFunction(() => localStorage.getItem('sudoku.save.v1') !== null);
// Si confronta la griglia, non il blob intero: finché il duello non parte la
// partita in solitaria continua a girare e a salvare il tempo trascorso.
const gridOf = (raw) => {
  const s = JSON.parse(raw);
  return JSON.stringify({ p: s.puzzle, v: s.values, g: s.given, d: s.difficulty, seed: s.seed });
};
const savedBefore = gridOf(await host.evaluate(() => localStorage.getItem('sudoku.save.v1')));

/* --- Lobby: host crea, difficoltà facile per finire in fretta --- */
await host.click('#duo');
await host.selectOption('#duo-difficulty', 'facile');
await host.click('#duo-create');
await host.waitForFunction(
  () => document.getElementById('duo-invite').value.includes('#j='),
  null,
  { timeout: 20000 },
);
const link = await host.inputValue('#duo-invite');
const code = link.split('#j=')[1];
log(`✓ invito generato: codice di ${code.length} caratteri (${code.slice(0, 12)}…)`);
assert.ok(code.startsWith('S1:'), 'codice compatto');

/* --- Il guest apre il link, come farebbe da WhatsApp --- */
await guest.goto(link);
await guest.waitForFunction(() => !document.getElementById('duo-step-guest').hidden);
log('✓ il link di invito apre direttamente la schermata di ingresso');
await guest.waitForFunction(
  () => document.getElementById('duo-invite-in').value.length > 10,
);
// Nessun pulsante da premere: incollare avvia da sé
assert.equal(await guest.isVisible('#duo-join-go'), false,
  'con un codice riconosciuto non c’è niente da premere');
await guest.waitForFunction(
  () => document.getElementById('duo-answer-out').value.startsWith('S1'),
  null,
  { timeout: 20000 },
);
const answer = await guest.inputValue('#duo-answer-out');
log(`✓ risposta generata: ${answer.length} caratteri`);

/* --- L'host incolla la risposta: qui la connessione deve aprirsi davvero --- */
// Incollare basta: il collegamento parte da sé, senza premere «Collega»
await host.fill('#duo-answer-in', answer);

// Il countdown parte solo se il canale dati si è aperto e l'handshake è andato.
// Le due attese vanno in parallelo: il countdown dura pochi secondi.
await Promise.all([host, guest].map((p) => p.waitForFunction(
  () => !document.getElementById('duo-count').hidden, null, { timeout: 30000, polling: 100 })));
log('✓ CANALE WEBRTC APERTO — SDP ricostruito accettato dal browser');
log('✓ countdown su entrambi gli schermi');

/* --- Via: entrambi in gioco sullo stesso puzzle --- */
await host.waitForFunction(() => document.getElementById('duo-count').hidden, null, { timeout: 15000 });
await host.waitForFunction(() => window.Sudoku.getState().running);
await guest.waitForFunction(() => window.Sudoku.getState().running);

const [hp, gp] = await Promise.all([
  host.evaluate(() => { const s = window.Sudoku.getState(); return { seed: s.seed, mode: s.mode, sol: s.solution.flat().join('') }; }),
  guest.evaluate(() => { const s = window.Sudoku.getState(); return { seed: s.seed, mode: s.mode, sol: s.solution.flat().join('') }; }),
]);
assert.equal(hp.seed, gp.seed, 'stesso seed');
assert.equal(hp.sol, gp.sol, 'stesso puzzle su entrambi i dispositivi');
assert.equal(hp.mode, 'duel');
assert.equal(gp.mode, 'duel');
log(`✓ stesso puzzle su entrambi (seed ${hp.seed})`);

/* --- La pausa è disattivata e la difficoltà nascosta --- */
await host.keyboard.press('p'); // il pulsante è nascosto: resta la scorciatoia
assert.equal(await host.evaluate(() => window.Sudoku.getState().paused), false, 'pausa disattivata in duello');
assert.ok(await host.evaluate(() => document.body.classList.contains('is-duel')));
assert.equal(await host.isVisible('#difficulty'), false, 'difficoltà nascosta in duello');
assert.equal(await host.isVisible('#pause'), false, 'pulsante pausa nascosto in duello');
assert.equal(await host.isVisible('#new-game'), false, 'nuova partita nascosta in duello');
const toast = await host.textContent('#toast');
assert.ok(/pausa è disattivata/.test(toast), `avviso mostrato: ${toast}`);
log('✓ pausa disattivata (con avviso) e comandi del solo nascosti');

/* --- I tuoi dati stanno sotto quelli dell'avversario, incolonnati uguali --- */
// Sul telefono, mentre si gioca, la griglia ombra dell'avversario è fuori dal
// campo visivo: due righe vicine e incolonnate sono l'unico modo di capire chi
// è avanti senza smettere di giocare.
{
  const disposizione = await guest.evaluate(() => {
    // I nascosti vanno esclusi: in duello «Record» è ancora nel DOM, ma non
    // occupa nessuna colonna.
    const sinistre = (sel) => [...document.querySelectorAll(sel)]
      .filter((n) => !n.hidden)
      .map((n) => Math.round(n.getBoundingClientRect().left));
    const mine = document.querySelector('.toolbar__stats');
    const hud = document.getElementById('duo-hud');
    return {
      corniceVisibile: !document.getElementById('duo-mine').hidden,
      spostati: mine.parentElement.id === 'duo-mine-slot',
      celleVisibili: !document.getElementById('stat-filled').hidden,
      sottoAvversario: mine.getBoundingClientRect().top > hud.getBoundingClientRect().top,
      sopraGriglia: mine.getBoundingClientRect().bottom
        <= Math.ceil(document.getElementById('board').getBoundingClientRect().top),
      colonneAvversario: sinistre('.duo-hud__stats .stat'),
      colonneMie: sinistre('.duo-mine__body .stat'),
      etichette: [...document.querySelectorAll('.duo-mine__body .stat')]
        .filter((n) => !n.hidden)
        .map((n) => n.querySelector('.stat__label').textContent),
      etichetteAvversario: [...document.querySelectorAll('.duo-hud__stats .stat__label')]
        .map((n) => n.textContent),
    };
  });
  assert.ok(disposizione.corniceVisibile, 'in duello compare la riga «Tu»');
  assert.ok(disposizione.spostati, 'i dati sono spostati, non duplicati');
  assert.ok(disposizione.celleVisibili, '«Celle» compare in duello');
  assert.ok(disposizione.sottoAvversario, 'stanno sotto l’avversario');
  assert.ok(disposizione.sopraGriglia, 'e sopra la griglia');
  assert.deepEqual(disposizione.etichette, ['Tempo', 'Celle', 'Errori', 'Aiuti'],
    'le quattro etichette sono identiche a quelle dell’avversario');
  assert.deepEqual(disposizione.etichette, disposizione.etichetteAvversario,
    'e nello stesso ordine');
  assert.deepEqual(disposizione.colonneMie, disposizione.colonneAvversario,
    `le due righe sono incolonnate: ${JSON.stringify(disposizione)}`);
  log(`✓ dati del giocatore sotto quelli dell'avversario, colonne allineate `
    + `(${disposizione.colonneMie.join(', ')})`);
}

/* --- Il contatore delle celle segue la griglia in tempo reale --- */
{
  const prima = await guest.evaluate(() => ({
    mostrato: document.getElementById('filled').textContent,
    vere: window.Sudoku.getState().values.flat().filter((v) => v !== 0).length,
  }));
  assert.equal(prima.mostrato, `${prima.vere}/81`, 'il contatore parte giusto');

  await guest.evaluate(() => {
    const s = window.Sudoku.getState();
    for (let r = 0; r < 9; r++)
      for (let c = 0; c < 9; c++)
        if (s.values[r][c] === 0) {
          document.querySelectorAll('.cell')[r * 9 + c].click();
          document.querySelectorAll('.numpad__btn')[s.solution[r][c] - 1].click();
          return;
        }
  });
  const dopo = await guest.textContent('#filled');
  assert.equal(dopo, `${prima.vere + 1}/81`, `una cella in più: ${dopo}`);
  log(`✓ celle riempite in tempo reale: ${prima.mostrato} → ${dopo}`);
}

/* --- Anche gli aiuti si contano come li conta l'avversario --- */
{
  assert.equal(await guest.textContent('#hints-used'), '0/3', 'si parte da zero aiuti');
  await guest.click('#hint');
  await guest.waitForFunction(() => document.getElementById('hints-used').textContent === '1/3',
    null, { polling: 100, timeout: 5000 });
  log('✓ aiuti usati contati in tempo reale: 0/3 → 1/3');
}

/* --- L'avanzamento dell'avversario arriva --- */
await guest.evaluate(() => {
  // il guest riempie qualche cella corretta
  const s = window.Sudoku.getState();
  let done = 0;
  for (let r = 0; r < 9 && done < 6; r++)
    for (let c = 0; c < 9 && done < 6; c++)
      if (s.values[r][c] === 0) {
        document.querySelectorAll('.cell')[r * 9 + c].click();
        document.querySelectorAll('.numpad__btn')[s.solution[r][c] - 1].click();
        done++;
      }
});
await host.waitForFunction(
  () => document.querySelectorAll('#duo-shadow .shadow__cell--on').length > 0,
  null,
  { timeout: 8000 },
);
const shadowOn = await host.evaluate(() => document.querySelectorAll('#duo-shadow .shadow__cell--on').length);
const oppName = await host.textContent('#duo-opp-name');
assert.ok(shadowOn >= 6, `griglia ombra aggiornata: ${shadowOn} celle`);
log(`✓ griglia ombra dell'avversario aggiornata (${shadowOn} celle piene, nome ${oppName})`);

// Le cifre dell'avversario non compaiono da nessuna parte nel pannello
const hudText = await host.textContent('#duo-hud');
assert.ok(!/[1-9]{2,}/.test(hudText.replace(/\d+\/\d+|\d\d:\d\d/g, '')), 'nessuna cifra del puzzle avversario');
log('✓ del rivale si vede l’avanzamento, non le cifre');

/* --- Il guest completa il puzzle e deve vincere --- */
await guest.evaluate(() => {
  const s = window.Sudoku.getState();
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++)
      if (s.values[r][c] !== s.solution[r][c]) {
        document.querySelectorAll('.cell')[r * 9 + c].click();
        document.querySelectorAll('.numpad__btn')[s.solution[r][c] - 1].click();
      }
});

await guest.waitForFunction(() => !document.getElementById('duo-result').hidden, null, { timeout: 20000 });
await host.waitForFunction(() => !document.getElementById('duo-result').hidden, null, { timeout: 20000 });

const gTitle = await guest.textContent('#duo-result-title');
const hTitle = await host.textContent('#duo-result-title');
log(`  guest: "${gTitle}"   host: "${hTitle}"`);
assert.equal(gTitle, 'Hai vinto!', 'chi completa vince');
assert.equal(hTitle, 'Hai perso', 'l’altro perde');
log('✓ esito coerente sui due schermi: un solo verdetto');

const hMsg = await host.textContent('#duo-result-msg');
assert.ok(/ha completato il puzzle prima di te/.test(hMsg), `messaggio host: ${hMsg}`);

/* --- Le statistiche del duello sono separate da quelle del solo --- */
const stats = await guest.evaluate(() => ({
  duel: JSON.parse(localStorage.getItem('sudoku.duel.stats.v1') || '{}'),
  soloScores: localStorage.getItem('sudoku.scores.v1'),
  soloStats: JSON.parse(localStorage.getItem('sudoku.stats.v1') || '{}'),
}));
assert.equal(stats.duel.facile.won, 1, 'duello vinto registrato');
assert.equal(stats.duel.facile.played, 1);
assert.equal(stats.soloScores, null, 'la classifica del single player resta vuota');
assert.ok(!stats.soloStats.facile || stats.soloStats.facile.played === 0,
  'le statistiche del solo non contano il duello');
log('✓ statistiche del duello separate: la classifica del solo non è toccata');

/* --- Il salvataggio solo dell'host è sopravvissuto al duello --- */
const savedAfter = gridOf(await host.evaluate(() => localStorage.getItem('sudoku.save.v1')));
assert.equal(savedAfter, savedBefore, 'la griglia della partita in solitaria salvata è intatta');
log('✓ la partita in solitaria salvata non è stata sovrascritta dal duello');

/* --- Rivincita: entrambi accettano e riparte senza riscambiare codici --- */
await host.click('#duo-rematch');
assert.ok((await host.textContent('#duo-rematch')).includes('In attesa'), 'attende l’altro');
await guest.click('#duo-rematch');
await Promise.all([host, guest].map((p) => p.waitForFunction(
  () => !document.getElementById('duo-count').hidden, null, { timeout: 20000, polling: 100 })));
const seeds = await Promise.all([
  host.evaluate(() => window.Sudoku.getState().seed),
  guest.evaluate(() => window.Sudoku.getState().seed),
]);
assert.equal(seeds[0], seeds[1], 'stesso puzzle anche nella rivincita');
assert.notEqual(seeds[0], hp.seed, 'puzzle nuovo, non quello di prima');
log(`✓ rivincita senza riscambio di codici (nuovo seed ${seeds[0]})`);

/* --- Sfida asincrona: lo stesso codice dà lo stesso puzzle --- */
const third = await browser.newContext();
const solo2 = await third.newPage();
solo2.on('pageerror', (e) => errors.push(`solo2: ${e.message}`));
await solo2.goto(URL);
await solo2.waitForFunction(() => window.Sudoku && document.querySelectorAll('.cell').length === 81);
await solo2.click('#duo');
await solo2.click('#duo-challenge');
await solo2.fill('#duo-code-in', 'DIFFICILE-0ABCDE');
await solo2.click('#duo-code-go');
await solo2.waitForFunction(() => window.Sudoku.getState().seed === 0x0abcde, null, { timeout: 20000 });
const chall = await solo2.evaluate(() => {
  const s = window.Sudoku.getState();
  return { diff: s.difficulty, mode: s.mode, sol: s.solution.flat().join('') };
});
assert.equal(chall.diff, 'difficile');
assert.equal(chall.mode, 'solo', 'la sfida con codice è una partita in solitaria');

// Lo stesso codice su un quarto "dispositivo" deve dare un puzzle identico
const fourth = await browser.newContext();
const solo3 = await fourth.newPage();
solo3.on('pageerror', (e) => errors.push(`solo3: ${e.message}`));
await solo3.goto(URL);
await solo3.waitForFunction(() => window.Sudoku && document.querySelectorAll('.cell').length === 81);
await solo3.click('#duo');
await solo3.click('#duo-challenge');
await solo3.fill('#duo-code-in', 'difficile-0abcde'); // minuscolo: deve funzionare uguale
await solo3.click('#duo-code-go');
await solo3.waitForFunction(() => window.Sudoku.getState().seed === 0x0abcde, null, { timeout: 20000 });
const chall2 = await solo3.evaluate(() => window.Sudoku.getState().solution.flat().join(''));
assert.equal(chall2, chall.sol, 'stesso codice → stesso puzzle su un altro dispositivo');
log('✓ sfida con codice: DIFFICILE-0ABCDE dà lo stesso puzzle su due dispositivi');

/* --- Nessun errore JavaScript in tutta la sessione --- */
if (errors.length) {
  console.error('\n✗ errori rilevati:\n' + errors.join('\n'));
  await browser.close();
  process.exit(1);
}
log('✓ nessun errore JavaScript');

await browser.close();
log('\nDuello capo a capo: tutte le prove sono passate.');
