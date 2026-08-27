/* Lo scambio automatico dei codici, provato fuori dal browser.

   È il pezzo che toglie di mezzo il copia-incolla: chi invita deposita
   l'invito e riceve un codice breve, chi risponde lo ritira e deposita la
   risposta, chi invita la raccoglie da sé. Qui si verifica il giro completo
   e i modi in cui può andare storto — compresi quelli che sul campo sono
   costati un pomeriggio: un invito vecchio, una stanza inesistente, un
   codice che non è un codice. */
import assert from 'node:assert/strict';
import { scambio } from '../turn-worker/worker.js';
import { creaD1 } from './d1-finto.mjs';

const log = (...a) => console.log(...a);
const CORS = { 'Access-Control-Allow-Origin': '*' };

const env = { SCAMBIO: creaD1() };

async function chiama(metodo, percorso, corpo) {
  const req = new Request('https://esempio.workers.dev' + percorso, {
    method: metodo,
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    headers: corpo === undefined ? {} : { 'Content-Type': 'application/json' },
  });
  const res = await scambio(req, env, CORS, percorso);
  return { status: res.status, corpo: await res.json() };
}

const INVITO = 'S1:' + 'a'.repeat(300);
const INVITO2 = 'S1:' + 'b'.repeat(300);
const RISPOSTA = 'S1:' + 'c'.repeat(280);

/* --- 1. Lo stato si legge dal browser, ed è la prova che il database c'è --- */
{
  const r = await chiama('GET', '/s');
  assert.equal(r.status, 200);
  assert.equal(r.corpo.ok, true, 'il servizio risponde');
  assert.equal(r.corpo.stanze_attive, 0, 'nessuna stanza all’inizio');
  log('✓ stato del servizio leggibile: dice che il database risponde');
}

/* --- 2. Il giro completo: deposita, ritira, rispondi, raccogli --- */
let stanza;
{
  const creata = await chiama('POST', '/s/nuova', { invito: INVITO });
  assert.equal(creata.status, 200);
  stanza = creata.corpo.stanza;
  assert.match(stanza, /^[A-Z0-9]{3}-[A-Z0-9]{3}$/, `codice leggibile: ${stanza}`);

  const ritiro = await chiama('GET', `/s/${stanza}`);
  assert.equal(ritiro.corpo.invito, INVITO, 'chi risponde ritira l’invito giusto');

  const deposito = await chiama('POST', `/s/${stanza}/r`, { risposta: RISPOSTA });
  assert.equal(deposito.corpo.ok, true);

  const raccolta = await chiama('GET', `/s/${stanza}/r`);
  assert.equal(raccolta.corpo.risposta, RISPOSTA, 'chi invita raccoglie la risposta');
  log(`✓ giro completo con la stanza ${stanza}: invito → ritiro → risposta → raccolta`);
}

/* --- 3. Raccolta la risposta, la stanza sparisce --- */
{
  const dopo = await chiama('GET', `/s/${stanza}/r`);
  assert.equal(dopo.status, 404, 'la stanza non esiste più');
  log('✓ la stanza sparisce appena la risposta è stata raccolta');
}

/* --- 4. Finché nessuno ritira, l'invito si rinfresca --- */
// È il motivo per cui questo servizio esiste: un invito raccolto due minuti
// dopo porta indirizzi già vecchi, e chi arriva non si collega più.
{
  const { corpo } = await chiama('POST', '/s/nuova', { invito: INVITO });
  const s2 = corpo.stanza;

  const rinfresco = await chiama('PUT', `/s/${s2}`, { invito: INVITO2 });
  assert.equal(rinfresco.corpo.ritirato, false, 'nessuno l’ha ancora ritirato');
  assert.equal((await chiama('GET', `/s/${s2}`)).corpo.invito, INVITO2,
    'chi arriva trova l’invito più recente');

  const dopoRitiro = await chiama('PUT', `/s/${s2}`, { invito: INVITO });
  assert.equal(dopoRitiro.corpo.ritirato, true, 'ritirato: da qui non si tocca più');
  assert.equal((await chiama('GET', `/s/${s2}`)).corpo.invito, INVITO2,
    'l’invito che l’avversario ha in mano resta quello');
  log('✓ l’invito si rinfresca finché nessuno lo ritira, poi si congela');
}

/* --- 5. Quello che può arrivare di storto --- */
{
  const casi = [
    ['stanza inesistente', () => chiama('GET', '/s/ZZZ-ZZZ'), 404],
    ['codice di stanza malformato', () => chiama('GET', '/s/pippo'), 400],
    ['invito mancante', () => chiama('POST', '/s/nuova', { altro: 1 }), 400],
    ['invito che non è un codice', () => chiama('POST', '/s/nuova', { invito: 'ciao' }), 400],
    ['invito enorme', () => chiama('POST', '/s/nuova', { invito: 'S1:' + 'a'.repeat(9000) }), 400],
    ['operazione sconosciuta', () => chiama('DELETE', '/s/ABC-123'), 404],
  ];
  for (const [nome, fn, atteso] of casi) {
    const r = await fn();
    assert.equal(r.status, atteso, `${nome}: atteso ${atteso}, ottenuto ${r.status}`);
    assert.ok(r.corpo.errore, `${nome}: l’errore è scritto in chiaro`);
  }
  log(`✓ ${casi.length} richieste malformate rifiutate, ognuna con il suo motivo`);
}

/* --- 6. Senza database il Worker lo dice, invece di rompersi --- */
{
  const req = new Request('https://esempio.workers.dev/s', { method: 'GET' });
  const res = await scambio(req, {}, CORS, '/s');
  assert.equal(res.status, 501);
  const corpo = await res.json();
  assert.match(corpo.dettaglio, /D1/, 'spiega cosa manca');
  log('✓ senza il collegamento a D1 risponde spiegando cosa manca');
}

/* --- 7. Il traffico non finisce nelle cache --- */
{
  const req = new Request('https://esempio.workers.dev/s', { method: 'GET' });
  const res = await scambio(req, env, CORS, '/s');
  assert.match(res.headers.get('Cache-Control') || '', /no-store/,
    'i codici non devono restare in nessuna cache');
  log('✓ le risposte dello scambio non sono memorizzabili');
}

log('\nScambio dei codici: tutte le prove sono passate.');
