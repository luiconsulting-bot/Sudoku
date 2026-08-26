/* Il ponte che non risponde, risponde male o non esiste non deve mai impedire
   un tentativo diretto: il gioco deve proseguire, dicendolo. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const URL = process.env.APP_URL || 'http://127.0.0.1:8099/index.html';
const log = (...a) => console.log(...a);
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const errors = [];

async function conPonte(endpoint) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${URL}?turn=${encodeURIComponent(endpoint)}`);
  await p.waitForFunction(() => window.Sudoku && window.SudokuNet, null, { polling: 100 });
  return { ctx, p };
}

/* --- Ponte spento: si prosegue senza --- */
{
  const { ctx, p } = await conPonte('http://127.0.0.1:8199'); // nessuno in ascolto
  const ice = await p.evaluate(() => window.SudokuNet.iceConfig());
  assert.equal(ice.bridge, 'error', `errore segnalato: ${JSON.stringify(ice)}`);
  assert.equal(ice.servers.length, 2, 'restano gli STUN: il gioco può ancora provarci');
  log(`✓ ponte spento: si prosegue in diretta, con avviso ("${ice.error}")`);

  await p.click('#duo');
  await p.click('#duo-create');
  await p.waitForFunction(() => document.getElementById('duo-invite').value.includes('#j='),
    null, { polling: 100, timeout: 40000 });
  const net = await p.textContent('#duo-host-net');
  assert.ok(/non raggiungibile/.test(net), `il referto lo dice: "${net}"`);
  log(`✓ l’invito si crea comunque; referto: "${net}"`);
  await ctx.close();
}

/* --- Ponte che risponde spazzatura --- */
{
  const proc = spawn('node', ['turn-mock.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, MOCK_MODE: 'garbage', MOCK_PORT: '8199' },
    detached: true,
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 1500));
  const { ctx, p } = await conPonte('http://127.0.0.1:8199');
  const ice = await p.evaluate(() => window.SudokuNet.iceConfig());
  assert.equal(ice.bridge, 'error', 'risposta senza iceServers = errore');
  assert.equal(ice.servers.length, 2, 'si prosegue con gli STUN');
  log('✓ ponte che risponde male: trattato come assente, non come rottura');
  await ctx.close();
  try { process.kill(-proc.pid); } catch { /* già chiuso */ }
  await new Promise((r) => setTimeout(r, 500));
}

/* --- Un endpoint inesistente non blocca l'apertura del gioco --- */
{
  const t0 = Date.now();
  const { ctx, p } = await conPonte('https://ponte-che-non-esiste.invalid');
  const ice = await p.evaluate(() => window.SudokuNet.iceConfig());
  const ms = Date.now() - t0;
  assert.equal(ice.bridge, 'error');
  assert.ok(ms < 20000, `nessuna attesa infinita: ${ms} ms`);
  assert.equal(await p.evaluate(() => window.Sudoku.getState().running), true, 'il gioco gira');
  log(`✓ indirizzo inesistente: nessun blocco (${ms} ms) e il single player funziona`);
  await ctx.close();
}

if (errors.length) {
  console.error('\n✗ errori rilevati:\n' + errors.join('\n'));
  await browser.close();
  process.exit(1);
}
await browser.close();
log('\nPonte assente o guasto: tutte le prove sono passate.');
