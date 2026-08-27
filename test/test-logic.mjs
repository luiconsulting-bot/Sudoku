/* Prova della logica pura: generatore deterministico, codice partita, codec SDP.
   Gira in node ritagliando dai file solo le parti che non toccano il DOM. */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const REPO = new globalThis.URL('..', import.meta.url).pathname;

const dir = REPO;
const script = readFileSync(dir + 'script.js', 'utf8');

// Estrae dal motore le funzioni indipendenti dal DOM
const upTo = script.indexOf('/* ---------- Persistenza');
const engineSrc = script.slice(script.indexOf('const DIFFICULTY'), upTo);
const engine = new Function(engineSrc + `
  return { DIFFICULTY, generatePuzzle, mulberry32, makeMatchCode, parseMatchCode,
           randomSeed, countSolutions, isValid };
`)();

/* --- 1. Il generatore è deterministico a parità di seed --- */
const a = engine.generatePuzzle(48, 12345);
const b = engine.generatePuzzle(48, 12345);
assert.deepEqual(a.puzzle, b.puzzle, 'stesso seed → stesso puzzle');
assert.deepEqual(a.solution, b.solution, 'stesso seed → stessa soluzione');

const c = engine.generatePuzzle(48, 12346);
assert.notDeepEqual(a.puzzle, c.puzzle, 'seed diverso → puzzle diverso');
console.log('✓ generatore deterministico');

/* --- 2. Il puzzle ha soluzione unica e la soluzione è valida --- */
const clone = a.puzzle.map((r) => r.slice());
assert.equal(engine.countSolutions(clone, 3), 1, 'soluzione unica');
for (let r = 0; r < 9; r++) {
  for (let col = 0; col < 9; col++) {
    const v = a.solution[r][col];
    a.solution[r][col] = 0;
    assert.ok(engine.isValid(a.solution, r, col, v), `soluzione valida in ${r},${col}`);
    a.solution[r][col] = v;
  }
}
console.log('✓ puzzle a soluzione unica, soluzione valida');

/* --- 3. Tutte le difficoltà generano, e il seed sopravvive al giro completo --- */
for (const key of Object.keys(engine.DIFFICULTY)) {
  const seed = engine.randomSeed();
  const code = engine.makeMatchCode(key, seed);
  const parsed = engine.parseMatchCode(code);
  assert.deepEqual(parsed, { difficulty: key, seed }, `codice ${code}`);
  const p = engine.generatePuzzle(engine.DIFFICULTY[key].remove, seed);
  const empties = p.puzzle.flat().filter((v) => v === 0).length;
  assert.ok(empties > 30, `${key}: ${empties} celle vuote`);
}
console.log('✓ codice partita: andata e ritorno su tutte le difficoltà');

/* --- 4. Codici malformati rifiutati senza eccezioni --- */
for (const bad of ['', 'MEDIO', 'PIPPO-1234', 'MEDIO-XYZ!', null, 'medio-', '---']) {
  assert.equal(engine.parseMatchCode(bad), null, `rifiutato: ${JSON.stringify(bad)}`);
}
// minuscolo e spazi sono tollerati
assert.deepEqual(engine.parseMatchCode('  medio - 7f3a2b '), { difficulty: 'medio', seed: 0x7f3a2b });
console.log('✓ codici malformati rifiutati, varianti tollerate');

/* --- 5. Codec SDP: compattamento e ricostruzione --- */
const netSrc = readFileSync(dir + 'net.js', 'utf8');
globalThis.window = {};
globalThis.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
globalThis.atob = (s) => Buffer.from(s, 'base64').toString('binary');
new Function(netSrc)();
const Net = globalThis.window.SudokuNet;

const realOffer = [
  'v=0',
  'o=- 8395475918658219871 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=candidate:1467250027 1 udp 2122260223 9b36eaac-1e2f-4e42-9d3f-1a2b3c4d5e6f.local 58779 typ host generation 0 network-id 1',
  'a=candidate:3373639213 1 udp 1686052607 203.0.113.7 47298 typ srflx raddr 192.168.1.5 rport 47298 generation 0',
  'a=candidate:1467250027 2 udp 2122260222 192.168.1.5 58780 typ host generation 0',
  'a=candidate:9988776655 1 tcp 1518280447 192.168.1.5 9 typ host tcptype active generation 0',
  'a=ice-ufrag:4ZcD',
  'a=ice-pwd:by/PmMA1nUOUXjHXaMHDBGnb',
  'a=ice-options:trickle',
  'a=fingerprint:sha-256 A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90:A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90',
  'a=setup:actpass',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=max-message-size:262144',
].join('\r\n') + '\r\n';

const code = Net.encodeDesc(realOffer, false);
assert.ok(code.startsWith('S1:'), 'prefisso compatto');
assert.ok(code.length < 500, `codice compatto, ${code.length} caratteri`);
console.log(`✓ codice compatto: ${code.length} caratteri (SDP originale: ${realOffer.length})`);

const rebuilt = Net.decodeDesc(code);
assert.ok(rebuilt.includes('a=ice-ufrag:4ZcD'), 'ufrag conservato');
assert.ok(rebuilt.includes('a=ice-pwd:by/PmMA1nUOUXjHXaMHDBGnb'), 'password conservata');
assert.ok(rebuilt.includes('a=fingerprint:sha-256 A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90:A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90'), 'impronta conservata');
assert.ok(rebuilt.includes('a=setup:actpass'), 'setup conservato');
assert.ok(rebuilt.includes('9b36eaac-1e2f-4e42-9d3f-1a2b3c4d5e6f.local 58779 typ host'), 'candidato mDNS conservato');
// `raddr` non viaggia più nel codice: per ICE è informativo, allunga il codice
// e nel caso reale esponeva l'indirizzo privato (o l'IPv6 pubblico) di chi
// rispondeva. Si rimette neutro, che è anche ciò che Chrome stesso pubblica.
assert.ok(rebuilt.includes('203.0.113.7 47298 typ srflx raddr 0.0.0.0 rport 0'), 'candidato srflx con raddr neutro');
assert.ok(!rebuilt.includes('192.168.1.5 rport'), 'l’indirizzo privato non viaggia nel codice');
assert.ok(!rebuilt.includes('58780'), 'componente 2 scartata');
assert.ok(!rebuilt.includes('tcp'), 'candidato TCP scartato');
assert.ok(rebuilt.includes('m=application 9 UDP/DTLS/SCTP webrtc-datachannel'), 'sezione media');
assert.ok(rebuilt.endsWith('a=end-of-candidates\r\n'), 'fine dei candidati');
console.log('✓ ricostruzione SDP fedele nei campi che contano');

/* --- 6. setup:active non viene confuso con actpass (risposta del guest) --- */
const answer = realOffer.replace('a=setup:actpass', 'a=setup:active');
assert.ok(Net.decodeDesc(Net.encodeDesc(answer, false)).includes('a=setup:active'), 'setup:active');
console.log('✓ setup della risposta distinto da quello dell’offerta');

/* --- 7. Codice lungo e codici illeggibili --- */
const long = Net.encodeDesc(realOffer, true);
assert.ok(long.startsWith('S1L:'), 'prefisso lungo');
assert.equal(Net.decodeDesc(long), realOffer, 'il codice lungo restituisce l’SDP identico');
for (const bad of ['', 'ciao', 'S2:abc']) {
  assert.throws(() => Net.decodeDesc(bad), `rifiutato: ${JSON.stringify(bad)}`);
}
console.log('✓ codice lungo fedele, codici estranei rifiutati');

/* --- 8. Un SDP senza candidati ripiega sul codice lungo invece di rompersi --- */
const noCand = realOffer.split('\r\n').filter((l) => !l.startsWith('a=candidate')).join('\r\n');
assert.ok(Net.encodeDesc(noCand, false).startsWith('S1L:'), 'ripiego automatico sul codice lungo');
console.log('✓ senza candidati utilizzabili ripiega sul codice lungo');

/* --- 8bis. Famiglie di indirizzi: il caso di due codici che non si incontrano --- */
// IPv4 e IPv6 non si parlano. Il PC a doppia pila che manda solo relay IPv6 e
// il telefono che risponde solo con relay IPv4 non formano nemmeno una coppia
// ICE: nessun tentativo, nessun errore, solo silenzio fino alla scadenza.
{
  const conCandidati = (righe) => [
    'v=0', 'o=- 1 2 IN IP4 127.0.0.1', 's=-', 't=0 0',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
    ...righe,
  ].join('\r\n') + '\r\n';

  const soloV6 = Net.candidateSummary(conCandidati([
    'a=candidate:1 1 udp 33563903 2a06:98c1:31::5 7000 typ relay raddr :: rport 0',
  ]));
  const soloV4 = Net.candidateSummary(conCandidati([
    'a=candidate:1 1 udp 33563903 104.30.147.5 7000 typ relay raddr 0.0.0.0 rport 0',
  ]));
  const doppia = Net.candidateSummary(conCandidati([
    'a=candidate:1 1 udp 33563903 2a06:98c1:31::5 7000 typ relay raddr :: rport 0',
    'a=candidate:2 1 udp 33562000 104.30.147.5 7100 typ relay raddr 0.0.0.0 rport 0',
  ]));
  const soloLocali = Net.candidateSummary(conCandidati([
    'a=candidate:1 1 udp 2122262783 abcd-1234.local 5000 typ host',
  ]));

  assert.deepEqual(Net.routableFamilies(soloV6), ['v6'], 'riconosce il codice solo IPv6');
  assert.deepEqual(Net.routableFamilies(soloV4), ['v4'], 'riconosce il codice solo IPv4');
  assert.deepEqual(Net.routableFamilies(doppia), ['v4', 'v6'], 'riconosce il codice con entrambe');
  assert.deepEqual(Net.routableFamilies(soloLocali), [], 'gli indirizzi locali non escono dalla rete');
  const comune = (a, b) => Net.routableFamilies(a).some((f) => Net.routableFamilies(b).includes(f));
  assert.equal(comune(soloV6, soloV4), false, 'solo IPv6 contro solo IPv4: nessuna coppia possibile');
  assert.equal(comune(doppia, soloV4), true, 'con entrambe le famiglie ci si incontra');
  console.log('✓ famiglie di indirizzi: due codici incompatibili sono riconoscibili');
}

/* --- 8ter. Un incollaggio con più codici: vince il più recente --- */
// Il caso vero, ed è il più insidioso di tutti: i codici si scambiano in una
// chat o in una bozza di posta, che li accumula. Prendendo il primo che si
// incontra si applica il codice del tentativo *precedente*: viene accettato
// senza errori e poi non si collega mai, senza che nulla lo dica.
{
  const conUfrag = (u, setup) => [
    'v=0', 'o=- 1 2 IN IP4 127.0.0.1', 's=-', 't=0 0',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
    'a=candidate:1 1 udp 2122262783 1.2.3.4 5000 typ host',
    `a=ice-ufrag:${u}`, 'a=ice-pwd:by/PmMA1nUOUXjHXaMHDBGnb',
    'a=fingerprint:sha-256 ' + Array(32).fill('AB').join(':'),
    `a=setup:${setup}`,
  ].join('\r\n') + '\r\n';

  const mioInvito = Net.encodeDesc(conUfrag('MIOO', 'actpass'), false);
  const rispostaVecchia = Net.encodeDesc(conUfrag('VECC', 'active'), false);
  const rispostaNuova = Net.encodeDesc(conUfrag('NUOV', 'active'), false);

  const bozza = `Sudoku, ecco il link:\nhttps://esempio.it/Sudoku/#j=${mioInvito}\n\n`
    + `risposta:\n${rispostaVecchia}\n\nnon andava, riprovo:\n${rispostaNuova}\n`;

  assert.equal(Net.countCodes(bozza), 3, 'li conta tutti e tre');
  const scelto = Net.decodeDesc(bozza);
  assert.ok(scelto.includes('a=ice-ufrag:NUOV'),
    'dà retta all’ultimo codice, non al primo che incontra');
  console.log('✓ incollaggio con tre codici: si applica il più recente, non il più vecchio');

  // E il proprio codice non deve mai essere scambiato per quello dell'avversario
  const soloIlMio = `ecco il mio invito: https://esempio.it/Sudoku/#j=${mioInvito}`;
  assert.throws(() => Net.decodeDesc(soloIlMio, { notUfrag: 'MIOO' }),
    /è il tuo codice/, 'riconosce il proprio codice incollato al posto di quello altrui');
  // ma se nell'incollato c'è anche quello giusto, lo trova
  assert.ok(Net.decodeDesc(`${mioInvito}\n${rispostaNuova}`, { notUfrag: 'MIOO' })
    .includes('a=ice-ufrag:NUOV'), 'scarta il proprio e tiene quello dell’avversario');
  console.log('✓ il proprio codice viene riconosciuto e scartato, con un errore che lo dice');
}

/* --- 9. Codici come arrivano davvero dai telefoni --- */
// Il caso osservato: la tastiera dell'iPhone ha reso minuscolo il prefisso,
// e il codice veniva rifiutato con "non sembra un invito di questo gioco".
const good = Net.encodeDesc(realOffer, false);
const payload = good.slice(3);

const varianti = {
  'prefisso minuscolo (caso reale)': 's1:' + payload,
  'prefisso maiuscolo/minuscolo misto': 'S1:' + payload,
  'con spazi attorno': '   ' + good + '  \n',
  'spezzato su più righe': good.slice(0, 40) + '\n' + good.slice(40),
  'spazio dopo i due punti': 'S1: ' + payload,
  'link intero': 'https://esempio.github.io/Sudoku/#j=' + good,
  'link con prefisso minuscolo': 'https://esempio.github.io/Sudoku/#j=s1:' + payload,
  'dentro un messaggio di chat': 'ecco il codice: ' + good + ' fammi sapere!',
  'codice lungo minuscolo': 's1l:' + Net.encodeDesc(realOffer, true).slice(4),
};
for (const [nome, testo] of Object.entries(varianti)) {
  const sdp = Net.decodeDesc(testo);
  assert.ok(sdp.includes('a=ice-ufrag:4ZcD'), `variante rifiutata: ${nome}`);
}
console.log(`✓ codice riconosciuto in ${Object.keys(varianti).length} forme diverse (prefisso minuscolo incluso)`);

// Il payload invece resta sensibile alle maiuscole: se lo si stravolge, si deve
// fallire con un errore, non produrre un SDP sbagliato in silenzio.
assert.throws(() => Net.decodeDesc('S1:' + payload.toLowerCase()), 'payload stravolto');
assert.throws(() => Net.decodeDesc('ciao come stai'), 'testo senza codice');
assert.throws(() => Net.decodeDesc(''), 'vuoto');
assert.equal(Net.extractCode('S1:abc'), null, 'payload troppo corto per essere un codice');
console.log('✓ testo senza codice e payload corrotto rifiutati con un errore');

console.log('\nTutte le prove della logica pura sono passate.');
