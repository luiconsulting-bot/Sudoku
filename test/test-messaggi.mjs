/* I messaggi di rete devono corrispondere allo stato reale, non a com'era il
   gioco prima del ponte. Si verificano tutte le combinazioni, e che i tre punti
   che ne parlano dicano la stessa cosa. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const REPO = new globalThis.URL('..', import.meta.url).pathname;

const URL = process.env.APP_URL || 'http://127.0.0.1:8099/index.html';
const log = (...a) => console.log(...a);

/* --- Nessuna affermazione superata è rimasta nei testi --- */
{
  const testi = ['duo.js', 'index.html', 'README.md']
    .map((f) => readFileSync(REPO + f, 'utf8')).join('\n');
  const superate = [
    ["non c'è alcun server", 'il ponte è un server'],
    ['nessun dato passa da terzi', 'col ponte il traffico può passare da Cloudflare'],
    ['non usiamo server intermedi', 'il ponte è un intermediario'],
  ];
  for (const [frase, perche] of superate) {
    assert.ok(!testi.includes(frase), `frase superata ancora presente: "${frase}" (${perche})`);
  }
  log(`✓ nessuna delle ${superate.length} affermazioni superate è rimasta nei testi`);
}

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const errors = [];
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(URL);
await page.waitForFunction(() => window.Sudoku && window.SudokuNet, null, { polling: 100 });

/* --- La diagnosi si verifica da ciò che l'utente legge --- */
// È interna a duo.js, quindi si generano le condizioni reali e si controlla il
// testo a schermo: è anche l'unico modo che garantisce che i tre punti che ne
// parlano restino d'accordo.
await page.click('#duo');
await page.click('#duo-create');
await page.waitForFunction(() => document.getElementById('duo-host-net').textContent.length > 0,
  null, { polling: 100, timeout: 40000 });

const net = await page.textContent('#duo-host-net');
const stato = await page.textContent('#duo-host-status');
log(`  referto: "${net}"`);
log(`  stato:   "${stato}"`);

// Qui: nessun indirizzo pubblico, ponte irraggiungibile (egress bloccato)
assert.ok(/Ponte: non raggiungibile/.test(net), `il referto nomina lo stato del ponte: "${net}"`);
assert.ok(/ponte non risponde/.test(stato), `l’avviso nomina il ponte, non solo la Wi-Fi: "${stato}"`);
assert.ok(!/Sfida con un codice/.test(stato) || /Wi-Fi/.test(stato),
  'il rimedio proposto è coerente');
log('✓ ponte irraggiungibile e nessun indirizzo pubblico: l’avviso nomina entrambi');

/* --- Il pannello di aiuto parla del ponte, non più di «niente server» --- */
await page.click('.duo__help > summary');
const aiuto = await page.textContent('.duo__help');
assert.ok(/dal ponte/.test(aiuto), 'l’aiuto spiega cosa significa «dal ponte»');
assert.ok(/anche mobile/.test(aiuto), 'l’aiuto dice che col ponte la rete mobile funziona');
assert.ok(/TURN Server App/.test(aiuto), 'l’aiuto indirizza al posto giusto quando il ponte non dà indirizzi');
assert.ok(/Indirizzi trovati/.test(aiuto), 'l’aiuto rimanda al referto');
log('✓ pannello «Non si collega?» riscritto per l’epoca del ponte');

/* --- Il testo del referto non si contraddice con lo stato --- */
const coerente = (/non raggiungibile/.test(net) && /ponte non risponde/.test(stato))
  || (/Ponte: attivo/.test(net) && !/ponte non risponde/.test(stato));
assert.ok(coerente, `referto e avviso concordano:\n  ${net}\n  ${stato}`);
log('✓ referto e avviso concordano: una sola diagnosi, non tre');

if (errors.length) {
  console.error('\n✗ errori rilevati:\n' + errors.join('\n'));
  await browser.close();
  process.exit(1);
}
await browser.close();
log('\nMessaggi: tutte le prove sono passate.');
