/* Il ponte: viene interrogato, i suoi server entrano nella connessione, e se
   non risponde il gioco prosegue lo stesso senza. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const URL = process.env.APP_URL || 'http://127.0.0.1:8099/index.html';
const MOCK = 'http://127.0.0.1:8123';
const log = (...a) => console.log(...a);
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const errors = [];

async function fresh() {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  return { ctx, p };
}

/* --- normalizeIceServers accetta le forme che i servizi usano davvero --- */
{
  const { ctx, p } = await fresh();
  await p.goto(URL);
  await p.waitForFunction(() => window.SudokuNet, null, { polling: 100 });
  const forms = await p.evaluate(() => {
    const n = window.SudokuNet.normalizeIceServers;
    return {
      oggetto: n({ iceServers: { urls: ['turn:x:3478'], username: 'u', credential: 'c' } }).length,
      array: n({ iceServers: [{ urls: 'turn:x:3478' }, { urls: 'stun:y' }] }).length,
      nudo: n([{ urls: 'turn:x:3478' }]).length,
      vuoto: n({}).length,
      spazzatura: n({ iceServers: [{ nulla: 1 }] }).length,
    };
  });
  assert.deepEqual(forms, { oggetto: 1, array: 2, nudo: 1, vuoto: 0, spazzatura: 0 });
  log('✓ la risposta del ponte è accettata sia come oggetto sia come array');
  await ctx.close();
}

/* --- config.js collega il ponte di produzione --- */
{
  const { ctx, p } = await fresh();
  await p.goto(URL);
  await p.waitForFunction(() => window.SudokuNet, null, { polling: 100 });
  const endpoint = await p.evaluate(() => window.SudokuNet.turnEndpoint());
  assert.equal(endpoint, 'https://sudoku1v1.lui-consulting.workers.dev',
    `config.js indica il ponte: ${endpoint}`);
  log(`✓ config.js collega il ponte: ${endpoint}`);

  // Da questo ambiente il Worker non è raggiungibile (egress bloccato), quindi
  // si verifica ciò che conta di più: il gioco non si blocca e resta con i suoi
  // STUN, pronto a tentare comunque il collegamento diretto.
  const ice = await p.evaluate(() => window.SudokuNet.iceConfig());
  assert.ok(ice.bridge === 'on' || ice.bridge === 'error', `stato noto: ${ice.bridge}`);
  assert.ok(ice.servers.length >= 2, 'gli STUN ci sono comunque');
  log(`✓ ponte irraggiungibile da qui (${ice.bridge}): il gioco resta utilizzabile`);
  await ctx.close();
}

/* --- Con ?turn=: l'endpoint viene interrogato e i suoi server usati --- */
{
  const { ctx, p } = await fresh();
  await p.goto(`${URL}?turn=${encodeURIComponent(MOCK)}`);
  await p.waitForFunction(() => window.SudokuNet, null, { polling: 100 });
  const ice = await p.evaluate(() => window.SudokuNet.iceConfig());
  assert.equal(ice.bridge, 'on', `ponte attivo, ricevuto: ${JSON.stringify(ice)}`);
  assert.equal(ice.servers.length, 3, 'due STUN più il ponte');
  const turn = ice.servers[2];
  assert.ok(String(turn.urls).includes('turn:'), 'c’è un URL TURN');
  assert.equal(turn.username, 'utente-a-scadenza', 'credenziali a scadenza passate');
  log('✓ ponte interrogato: le sue credenziali entrano nella connessione');

  // L'indirizzo resta memorizzato: non va rimesso a ogni apertura
  await p.goto(URL);
  await p.waitForFunction(() => window.SudokuNet, null, { polling: 100 });
  assert.equal(await p.evaluate(() => window.SudokuNet.turnEndpoint()), MOCK, 'memorizzato');
  const again = await p.evaluate(() => window.SudokuNet.iceConfig());
  assert.equal(again.bridge, 'on', 'ancora attivo senza ripetere il parametro');
  log('✓ l’indirizzo del ponte resta memorizzato sul telefono');

  // E si può togliere
  await p.goto(`${URL}?turn=`);
  await p.waitForFunction(() => window.SudokuNet, null, { polling: 100 });
  assert.equal(await p.evaluate(() => window.SudokuNet.turnEndpoint()),
    'https://sudoku1v1.lui-consulting.workers.dev',
    'tolto l’override si torna a quello di config.js');
  log('✓ «?turn=» vuoto rimuove l’override e riporta a quello di config.js');
  await ctx.close();
}

/* --- Il referto lo dice, e il gioco funziona lo stesso --- */
{
  const { ctx, p } = await fresh();
  await p.goto(`${URL}?turn=${encodeURIComponent(MOCK)}`);
  await p.waitForFunction(() => window.Sudoku, null, { polling: 100 });
  await p.click('#duo');
  await p.click('#duo-create');
  await p.waitForFunction(() => document.getElementById('duo-host-net').textContent.includes('Ponte'),
    null, { polling: 100, timeout: 30000 });
  const net = await p.textContent('#duo-host-net');
  assert.ok(/Ponte: attivo/.test(net), `referto: "${net}"`);
  log(`✓ referto con ponte attivo: "${net}"`);
  await ctx.close();
}

if (errors.length) {
  console.error('\n✗ errori rilevati:\n' + errors.join('\n'));
  await browser.close();
  process.exit(1);
}
await browser.close();
log('\nPonte TURN: tutte le prove sono passate.');
