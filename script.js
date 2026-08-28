/* ============================================================
   Sudoku — motore di gioco (vanilla JS)
   ============================================================ */

/* ---------- Configurazione ---------- */

// Livelli: numero di celle da rimuovere (su 81)
const DIFFICULTY = {
  facile:    { remove: 40, label: 'Facile' },
  medio:     { remove: 48, label: 'Medio' },
  difficile: { remove: 54, label: 'Difficile' },
  esperto:   { remove: 58, label: 'Esperto' },
};

// Versione mostrata a fondo pagina. Va tenuta uguale al `?v=` dei tag <script>
// e <link> in index.html: quel parametro è ciò che costringe telefoni e proxy a
// riscaricare i file invece di riusare una copia vecchia in cache, e il numero a
// schermo è ciò che permette di sapere quale build sta davvero girando.
const APP_VERSION = '2026.08.27-4';

const MAX_MISTAKES = 3;
const MAX_HINTS = 3;

// Chiavi di localStorage (versionate: cambiare versione invalida i vecchi dati)
// Il multiplayer usa chiavi proprie: una partita in due non deve mai sovrascrivere
// la partita in corso del single player, né finire nella sua classifica.
const STORAGE = {
  save: 'sudoku.save.v1',
  stats: 'sudoku.stats.v1',
  scores: 'sudoku.scores.v1',
  name: 'sudoku.name.v1',
  duelStats: 'sudoku.duel.stats.v1',
};

// Classifica in stile arcade: 3 iniziali, 5 posizioni per difficoltà
const MAX_SCORES = 5;
const NAME_LEN = 3;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/* ---------- Sorgente casuale riproducibile ---------- */

// PRNG deterministico (mulberry32): a parità di seed produce sempre la stessa
// sequenza su qualunque browser. È ciò che rende un puzzle identificabile da un
// codice — indispensabile per far giocare due dispositivi sulla stessa griglia.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Seed a 24 bit: 16 milioni di puzzle per livello, e un codice corto da condividere
const SEED_BITS = 24;
const SEED_HEX = 6;
const randomSeed = () => Math.floor(Math.random() * 2 ** SEED_BITS);

// Codice partita, es. "MEDIO-7F3A2B": identifica difficoltà + puzzle
function makeMatchCode(difficulty, seed) {
  const hex = (seed >>> 0).toString(16).toUpperCase().padStart(SEED_HEX, '0');
  return `${difficulty.toUpperCase()}-${hex}`;
}

function parseMatchCode(code) {
  const m = /^\s*([A-Za-z]+)\s*-\s*([0-9A-Fa-f]{1,8})\s*$/.exec(String(code || ''));
  if (!m) return null;
  const difficulty = m[1].toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(DIFFICULTY, difficulty)) return null;
  const seed = parseInt(m[2], 16);
  if (!Number.isFinite(seed)) return null;
  return { difficulty, seed };
}

/* ---------- Generatore di Sudoku ---------- */

// `rng` è iniettato: in single player si semina a caso, in multiplayer dal seed
// condiviso. Il generatore non chiama mai Math.random direttamente, altrimenti
// due dispositivi con lo stesso seed otterrebbero puzzle diversi.
const shuffle = (arr, rng) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

// Verifica se `val` può stare in board[r][c]
function isValid(board, r, c, val) {
  for (let i = 0; i < 9; i++) {
    if (board[r][i] === val) return false;
    if (board[i][c] === val) return false;
  }
  const br = Math.floor(r / 3) * 3;
  const bc = Math.floor(c / 3) * 3;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      if (board[br + i][bc + j] === val) return false;
  return true;
}

// Riempie una griglia vuota con una soluzione valida completa
function fillBoard(board, rng) {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (board[r][c] === 0) {
        const nums = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rng);
        for (const val of nums) {
          if (isValid(board, r, c, val)) {
            board[r][c] = val;
            if (fillBoard(board, rng)) return true;
            board[r][c] = 0;
          }
        }
        return false;
      }
    }
  }
  return true;
}

// Conta le soluzioni (si ferma a `limit` per efficienza)
function countSolutions(board, limit = 2) {
  let count = 0;
  const solve = () => {
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (board[r][c] === 0) {
          for (let val = 1; val <= 9; val++) {
            if (isValid(board, r, c, val)) {
              board[r][c] = val;
              solve();
              board[r][c] = 0;
              if (count >= limit) return;
            }
          }
          return; // nessun valore possibile → backtrack
        }
      }
    }
    count++; // griglia completa → una soluzione trovata
  };
  solve();
  return count;
}

const cloneBoard = (b) => b.map((row) => row.slice());

// Genera un puzzle: {puzzle, solution}. Deterministico a parità di seed.
function generatePuzzle(remove, seed) {
  const rng = mulberry32(seed);
  const solution = Array.from({ length: 9 }, () => Array(9).fill(0));
  fillBoard(solution, rng);

  const puzzle = cloneBoard(solution);
  const positions = shuffle([...Array(81).keys()], rng);
  let removed = 0;

  for (const pos of positions) {
    if (removed >= remove) break;
    const r = Math.floor(pos / 9);
    const c = pos % 9;
    if (puzzle[r][c] === 0) continue;

    const backup = puzzle[r][c];
    puzzle[r][c] = 0;

    // Mantiene la rimozione solo se la soluzione resta unica
    const test = cloneBoard(puzzle);
    if (countSolutions(test, 2) !== 1) {
      puzzle[r][c] = backup; // ripristina
    } else {
      removed++;
    }
  }

  return { puzzle, solution };
}

/* ---------- Persistenza (localStorage) ---------- */

// localStorage può non essere disponibile (modalità privata, file:// su alcuni
// browser): tutte le operazioni degradano silenziosamente senza rompere il gioco.
function readStore(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function removeStore(key) {
  try { localStorage.removeItem(key); } catch { /* ignora */ }
}

const emptyStat = () => ({ played: 0, won: 0, best: null, last: null, streak: 0, bestStreak: 0 });

function loadStats() {
  const saved = readStore(STORAGE.stats, {});
  const stats = {};
  for (const key of Object.keys(DIFFICULTY)) {
    stats[key] = { ...emptyStat(), ...(saved && saved[key]) };
  }
  return stats;
}

// Registra il risultato di una partita conclusa. Ritorna true se è un nuovo record.
function recordResult(difficulty, won, seconds) {
  const stats = loadStats();
  const s = stats[difficulty];
  let isRecord = false;

  s.played++;
  if (won) {
    s.won++;
    s.last = seconds;
    s.streak++;
    if (s.streak > s.bestStreak) s.bestStreak = s.streak;
    if (s.best === null || seconds < s.best) {
      s.best = seconds;
      isRecord = true;
    }
  } else {
    s.streak = 0;
  }

  writeStore(STORAGE.stats, stats);
  return isRecord;
}

/* ---------- Classifica (top 5 per difficoltà) ---------- */

const isValidScore = (s) =>
  !!s && typeof s.name === 'string' && typeof s.time === 'number' && isFinite(s.time);

// Normalizza un record: errori/aiuti mancanti (vecchi salvataggi) valgono 0
const normalizeScore = (s) => ({
  name: s.name,
  time: s.time,
  errors: Number.isFinite(s.errors) ? s.errors : 0,
  hints: Number.isFinite(s.hints) ? s.hints : 0,
  date: Number.isFinite(s.date) ? s.date : 0,
});

// Ordinamento della classifica (ritorna < 0 se `a` va PRIMA di `b`):
//   1. tempo più basso;
//   2. a parità, meno penalità totali (errori + aiuti);
//   3. a parità, meno aiuti — cioè un errore è preferito a un aiuto;
//   4. a parità, chi ha ottenuto il tempo prima.
function compareScores(a, b) {
  if (a.time !== b.time) return a.time - b.time;
  const pa = a.errors + a.hints;
  const pb = b.errors + b.hints;
  if (pa !== pb) return pa - pb;
  if (a.hints !== b.hints) return a.hints - b.hints;
  return a.date - b.date;
}

function loadScores() {
  const raw = readStore(STORAGE.scores, {});
  const scores = {};
  for (const key of Object.keys(DIFFICULTY)) {
    const list = (Array.isArray(raw && raw[key]) ? raw[key] : [])
      .filter(isValidScore)
      .map(normalizeScore);
    scores[key] = list.sort(compareScores).slice(0, MAX_SCORES);
  }
  return scores;
}

// Posizione (0-based) che il risultato occuperebbe in classifica, oppure -1 se non entra
function scoreRank(difficulty, seconds, errors, hints) {
  const cand = { time: seconds, errors, hints, date: Date.now() };
  const list = loadScores()[difficulty];
  let pos = 0;
  // la lista è già ordinata: i record migliori o pari fanno scendere il candidato
  for (const s of list) {
    if (compareScores(s, cand) <= 0) pos++;
    else break;
  }
  return pos < MAX_SCORES ? pos : -1;
}

function saveScore(difficulty, name, seconds, errors, hints) {
  const scores = loadScores();
  scores[difficulty].push({ name, time: seconds, errors, hints, date: Date.now() });
  scores[difficulty].sort(compareScores);
  scores[difficulty] = scores[difficulty].slice(0, MAX_SCORES);
  writeStore(STORAGE.scores, scores);
}

const loadLastName = () => {
  const n = readStore(STORAGE.name, null);
  return typeof n === 'string' && n.length === NAME_LEN ? n : 'AAA';
};

/* ---------- Statistiche dei duelli (separate dal single player) ---------- */

const emptyDuelStat = () => ({ played: 0, won: 0, best: null, streak: 0, bestStreak: 0 });

function loadDuelStats() {
  const saved = readStore(STORAGE.duelStats, {});
  const stats = {};
  for (const key of Object.keys(DIFFICULTY)) {
    stats[key] = { ...emptyDuelStat(), ...(saved && saved[key]) };
  }
  return stats;
}

// Registra l'esito di un duello. `seconds` conta solo per le vittorie.
function recordDuel(difficulty, won, seconds) {
  const stats = loadDuelStats();
  const s = stats[difficulty];
  s.played++;
  if (won) {
    s.won++;
    s.streak++;
    if (s.streak > s.bestStreak) s.bestStreak = s.streak;
    if (Number.isFinite(seconds) && (s.best === null || seconds < s.best)) s.best = seconds;
  } else {
    s.streak = 0;
  }
  writeStore(STORAGE.duelStats, stats);
}

/* ---------- Eventi (il multiplayer si aggancia qui) ---------- */

// Emitter minimo: il motore annuncia cosa succede, duo.js decide cosa farne.
// Senza questo il multiplayer dovrebbe duplicare le regole di gioco.
const listeners = new Map();

function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event).delete(fn);
}

function emit(event, payload) {
  const set = listeners.get(event);
  if (!set) return;
  for (const fn of [...set]) {
    try { fn(payload); } catch (err) { console.error(`[sudoku] listener ${event}`, err); }
  }
}

// Fotografia dello stato mostrabile all'avversario: avanzamento, mai le cifre
function getProgress() {
  let filled = 0;
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++)
      if (state.values[r][c] !== 0) filled++;
  return {
    filled,
    errors: state.mistakes,
    hints: MAX_HINTS - state.hintsLeft,
    elapsed: elapsedSeconds(),
    cells: state.values.flat().map((v) => (v !== 0 ? 1 : 0)),
  };
}

/* ---------- Stato del gioco ---------- */

const state = {
  mode: 'solo',     // 'solo' | 'duel' — in duello l'esito lo gestisce duo.js
  seed: 0,          // seed del puzzle corrente (per il codice partita)
  puzzle: [],       // griglia iniziale (0 = vuota)
  solution: [],     // soluzione completa
  values: [],       // valori inseriti dal giocatore (include i given)
  notes: [],        // Set di note per cella (81 Set)
  given: [],        // true se cella fissa (iniziale o rivelata da un aiuto)
  selected: null,   // {r, c}
  notesMode: false,
  mistakes: 0,
  hintsLeft: MAX_HINTS,
  difficulty: 'medio',
  history: [],      // per undo
  elapsed: 0,       // secondi accumulati
  tickStart: null,  // timestamp di inizio del segmento corrente
  running: false,
  timerId: null,
  paused: false,
  busy: false,      // true durante la generazione
  waiting: false,   // griglia pronta ma partita non ancora avviata (countdown del duello)
  finished: false,
};

/* ---------- Elementi DOM ---------- */

const $board = document.getElementById('board');
const $numpad = document.getElementById('numpad');
const $timer = document.getElementById('timer');
const $mistakes = document.getElementById('mistakes');
const $filled = document.getElementById('filled');
const $hintsUsed = document.getElementById('hints-used');
const $bestTime = document.getElementById('best-time');
const $difficulty = document.getElementById('difficulty');
const $newGame = document.getElementById('new-game');
const $undo = document.getElementById('undo');
const $erase = document.getElementById('erase');
const $notes = document.getElementById('notes');
const $notesState = document.getElementById('notes-state');
const $hint = document.getElementById('hint');
const $hintsLeft = document.getElementById('hints-left');
const $pause = document.getElementById('pause');
const $veil = document.getElementById('veil');
const $veilIcon = document.getElementById('veil-icon');
const $veilText = document.getElementById('veil-text');
const $veilBtn = document.getElementById('veil-btn');
const $toast = document.getElementById('toast');
const $overlay = document.getElementById('overlay');
const $modalNew = document.getElementById('modal-new');
const $modalRecord = document.getElementById('modal-record');
const $records = document.getElementById('records');
const $recordsOverlay = document.getElementById('records-overlay');
const $recordsTabs = document.getElementById('records-tabs');
const $recordsList = document.getElementById('records-list');
const $recordsSummary = document.getElementById('records-summary');
const $recordsDuel = document.getElementById('records-duel');
const $recordsClose = document.getElementById('records-close');
const $recordsReset = document.getElementById('records-reset');
const $nameOverlay = document.getElementById('name-overlay');
const $nameTitle = document.getElementById('name-title');
const $nameSub = document.getElementById('name-sub');
const $nameSlots = document.getElementById('name-slots');
const $nameOk = document.getElementById('name-ok');

const idx = (r, c) => r * 9 + c;

/* ---------- Nuova partita ---------- */

// Avvia una partita. `seed` assente → puzzle casuale; `mode: 'duel'` delega
// l'esito al multiplayer. `autostart: false` prepara la griglia senza far
// partire il cronometro (il duello attende il countdown).
let genToken = 0;

function startGame({ difficulty, seed, mode = 'solo', autostart = true, onReady } = {}) {
  // Ogni richiesta invalida la precedente: se il duello chiede un puzzle mentre
  // ne stiamo ancora generando un altro, vince la richiesta più recente invece
  // di essere scartata in silenzio.
  const token = ++genToken;
  const diff = Object.prototype.hasOwnProperty.call(DIFFICULTY, difficulty)
    ? difficulty
    : $difficulty.value;
  const s = Number.isFinite(seed) ? seed >>> 0 : randomSeed();

  // La generazione è sincrona e può bloccare il thread per ~1s sui livelli alti:
  // mostriamo prima il velo e generiamo al frame successivo, così la UI reagisce.
  state.busy = true;
  stopTimer();
  $overlay.hidden = true;
  $nameOverlay.hidden = true;
  nameEntry.onDone = null;
  showVeil('⏳', 'Genero il puzzle…', { spin: true });

  setTimeout(() => {
    if (token !== genToken) return; // sostituita da una richiesta più recente
    const { puzzle, solution } = generatePuzzle(DIFFICULTY[diff].remove, s);
    if (token !== genToken) return;

    state.mode = mode;
    state.seed = s;
    state.difficulty = diff;
    state.puzzle = puzzle;
    state.solution = solution;
    state.values = cloneBoard(puzzle);
    state.given = puzzle.map((row) => row.map((v) => v !== 0));
    state.notes = Array.from({ length: 81 }, () => new Set());
    state.selected = null;
    state.notesMode = false;
    state.mistakes = 0;
    state.hintsLeft = MAX_HINTS;
    state.history = [];
    state.finished = false;
    state.paused = false;
    state.busy = false;
    state.waiting = !autostart;

    document.body.classList.toggle('is-duel', mode === 'duel');
    $difficulty.value = diff;
    syncHud();
    buildBoard();
    render();

    if (autostart) {
      hideVeil();
      startTimer(0);
      saveGame();
    } else {
      // Griglia pronta ma coperta: il duello la scopre al countdown
      state.elapsed = 0;
      $timer.textContent = formatTime(0);
      showVeil('⏳', 'In attesa dell’avversario…');
      $veilBtn.hidden = true;
    }

    emit('start', { difficulty: diff, seed: s, mode });
    if (onReady) onReady();
  }, 30);
}

// Scopre la griglia e avvia il cronometro di una partita preparata con autostart: false
function beginPrepared() {
  state.waiting = false;
  hideVeil();
  $veilBtn.hidden = false;
  startTimer(0);
  saveGame();
}

function newGame() {
  if (state.mode === 'duel' && !state.finished) return; // in duello ci pensa duo.js
  startGame({ difficulty: $difficulty.value, mode: 'solo' });
}

/* ---------- Ripresa di una partita salvata ---------- */

function saveGame() {
  if (state.finished || state.busy) return;
  // Un duello non si riprende: ricaricando la pagina il canale con l'avversario
  // è perduto e non c'è modo di riaprirlo senza rifare lo scambio dei codici.
  // Meglio non salvare che proporre una ripresa che non può funzionare.
  if (state.mode === 'duel') return;
  writeStore(STORAGE.save, {
    difficulty: state.difficulty,
    seed: state.seed,
    puzzle: state.puzzle,
    solution: state.solution,
    values: state.values,
    given: state.given,
    notes: state.notes.map((s) => [...s]),
    mistakes: state.mistakes,
    hintsLeft: state.hintsLeft,
    elapsed: elapsedSeconds(),
  });
}

// Controlla che il salvataggio abbia la forma attesa prima di fidarsene
function isValidSave(s) {
  const grid = (g) => Array.isArray(g) && g.length === 9 && g.every((r) => Array.isArray(r) && r.length === 9);
  return !!s
    && Object.prototype.hasOwnProperty.call(DIFFICULTY, s.difficulty)
    && grid(s.puzzle) && grid(s.solution) && grid(s.values) && grid(s.given)
    && Array.isArray(s.notes) && s.notes.length === 81;
}

function restoreGame() {
  const saved = readStore(STORAGE.save, null);
  if (!isValidSave(saved)) return false;

  state.mode = 'solo';
  state.seed = Number.isFinite(saved.seed) ? saved.seed : 0;
  state.difficulty = saved.difficulty;
  state.puzzle = saved.puzzle;
  state.solution = saved.solution;
  state.values = saved.values;
  state.given = saved.given;
  state.notes = saved.notes.map((arr) => new Set(arr));
  state.mistakes = saved.mistakes || 0;
  state.hintsLeft = typeof saved.hintsLeft === 'number' ? saved.hintsLeft : MAX_HINTS;
  state.selected = null;
  state.notesMode = false;
  state.history = [];
  state.finished = false;
  state.paused = false;
  state.busy = false;

  $difficulty.value = state.difficulty;
  syncHud();
  buildBoard();
  render();
  startTimer(saved.elapsed || 0);
  return true;
}

/* ---------- HUD ---------- */

function syncHud() {
  updateNotesButton();
  updateHints();
  updateMistakes();
  updateFilled();
  updateBestTime();
}

// Gli aiuti si contano in due modi: quanti ne restano (sul pulsante) e quanti
// ne hai usati (nella riga del duello, come li manda l'avversario). Stanno in
// una funzione sola perché sono lo stesso numero visto dai due lati.
function updateHints() {
  $hintsLeft.textContent = state.hintsLeft;
  if ($hintsUsed) {
    $hintsUsed.innerHTML = `${MAX_HINTS - state.hintsLeft}<span class="stat__muted">/${MAX_HINTS}</span>`;
  }
}

// Quante celle sono piene. In duello è il confronto più immediato con
// l'avversario, che lo stesso numero lo manda a ogni secondo.
function updateFilled() {
  if (!$filled) return;
  let n = 0;
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++)
      if (state.values[r][c] !== 0) n++;
  $filled.innerHTML = `${n}<span class="stat__muted">/81</span>`;
}

function updateMistakes() {
  $mistakes.innerHTML = `${state.mistakes}<span class="stat__muted">/${MAX_MISTAKES}</span>`;
}

function updateBestTime() {
  const best = loadStats()[state.difficulty].best;
  $bestTime.textContent = best === null ? '—' : formatTime(best);
}

/* ---------- Costruzione della griglia ---------- */

// Classi di base di una cella (bordi dei blocchi 3x3 inclusi)
function baseCellClass(r, c) {
  let cls = 'cell';
  if (r === 2 || r === 5) cls += ' cell--block-bottom';
  return cls;
}

function buildBoard() {
  $board.innerHTML = '';
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const cell = document.createElement('div');
      cell.className = baseCellClass(r, c);
      cell.dataset.r = r;
      cell.dataset.c = c;
      cell.setAttribute('role', 'gridcell');
      cell.addEventListener('click', () => selectCell(r, c));
      $board.appendChild(cell);
    }
  }
}

function buildNumpad() {
  $numpad.innerHTML = '';
  for (let n = 1; n <= 9; n++) {
    const btn = document.createElement('button');
    btn.className = 'numpad__btn';
    btn.dataset.n = n;
    btn.innerHTML = `${n}<span class="numpad__count"></span>`;
    btn.addEventListener('click', () => inputNumber(n));
    $numpad.appendChild(btn);
  }
}

/* ---------- Rendering ---------- */

function render() {
  const cells = $board.children;
  if (cells.length !== 81) return;

  const sel = state.selected;
  const selVal = sel ? state.values[sel.r][sel.c] : 0;

  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const cell = cells[idx(r, c)];
      const val = state.values[r][c];
      const isGiven = state.given[r][c];

      cell.className = baseCellClass(r, c);
      if (isGiven) cell.classList.add('cell--given');

      // Evidenziazioni relative alla selezione
      if (sel) {
        const isSel = r === sel.r && c === sel.c;
        const isPeer =
          r === sel.r ||
          c === sel.c ||
          (Math.floor(r / 3) === Math.floor(sel.r / 3) &&
            Math.floor(c / 3) === Math.floor(sel.c / 3));
        if (isPeer && !isSel) cell.classList.add('cell--peer');
        if (selVal !== 0 && val === selVal && !isSel) cell.classList.add('cell--same');
        if (isSel) cell.classList.add('cell--selected');
      }

      // Contenuto: valore o note
      if (val !== 0) {
        cell.textContent = val;
        if (!isGiven && val !== state.solution[r][c]) cell.classList.add('cell--error');
      } else {
        const notes = state.notes[idx(r, c)];
        cell.textContent = '';
        if (notes.size > 0) {
          const grid = document.createElement('div');
          grid.className = 'cell__notes';
          for (let n = 1; n <= 9; n++) {
            const span = document.createElement('span');
            span.className = 'cell__note';
            span.textContent = notes.has(n) ? n : '';
            grid.appendChild(span);
          }
          cell.appendChild(grid);
        }
      }
    }
  }

  updateNumpadCounts();
  updateFilled();
}

// Mostra quante cifre restano da piazzare per ciascun numero
function updateNumpadCounts() {
  const counts = Array(10).fill(0);
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++)
      if (state.values[r][c] !== 0) counts[state.values[r][c]]++;

  for (const btn of $numpad.children) {
    const n = Number(btn.dataset.n);
    const remaining = 9 - counts[n];
    btn.querySelector('.numpad__count').textContent = remaining > 0 ? remaining : '';
    btn.classList.toggle('numpad__btn--done', remaining <= 0);
  }
}

/* ---------- Interazione ---------- */

// Il gioco accetta input solo a partita viva, non in pausa, non durante la
// generazione e non prima del via (il countdown del duello)
const canPlay = () => !state.finished && !state.paused && !state.busy && !state.waiting;

function selectCell(r, c) {
  if (!canPlay()) return;
  state.selected = { r, c };
  render();
}

function deselect() {
  if (!state.selected) return;
  state.selected = null;
  render();
}

function pushHistory() {
  state.history.push({
    values: cloneBoard(state.values),
    notes: state.notes.map((s) => new Set(s)),
    given: cloneBoard(state.given),
    mistakes: state.mistakes,
    hintsLeft: state.hintsLeft,
  });
  if (state.history.length > 100) state.history.shift();
}

function inputNumber(n) {
  const sel = state.selected;
  if (!sel || !canPlay()) return;
  const { r, c } = sel;
  if (state.given[r][c]) return;

  if (state.notesMode) {
    // Le note hanno senso solo su celle vuote
    if (state.values[r][c] !== 0) return;
    pushHistory();
    const notes = state.notes[idx(r, c)];
    notes.has(n) ? notes.delete(n) : notes.add(n);
    render();
    saveGame();
    return;
  }

  pushHistory();

  // Ri-tocco dello stesso numero → cancella
  if (state.values[r][c] === n) {
    state.values[r][c] = 0;
    render();
    saveGame();
    return;
  }

  state.values[r][c] = n;
  state.notes[idx(r, c)].clear();
  removeNoteFromPeers(r, c, n);

  if (n !== state.solution[r][c]) registerMistake();

  render();
  saveGame();
  checkWin();
}

function removeNoteFromPeers(r, c, n) {
  for (let i = 0; i < 9; i++) {
    state.notes[idx(r, i)].delete(n);
    state.notes[idx(i, c)].delete(n);
  }
  const br = Math.floor(r / 3) * 3;
  const bc = Math.floor(c / 3) * 3;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      state.notes[idx(br + i, bc + j)].delete(n);
}

function registerMistake() {
  state.mistakes++;
  updateMistakes();
  if (state.mistakes >= MAX_MISTAKES) gameOver();
}

function eraseCell() {
  const sel = state.selected;
  if (!sel || !canPlay()) return;
  const { r, c } = sel;
  if (state.given[r][c]) return;
  if (state.values[r][c] === 0 && state.notes[idx(r, c)].size === 0) return;

  pushHistory();
  state.values[r][c] = 0;
  state.notes[idx(r, c)].clear();
  render();
  saveGame();
}

function undo() {
  if (!canPlay() || state.history.length === 0) return;
  const prev = state.history.pop();
  state.values = prev.values;
  state.notes = prev.notes;
  state.given = prev.given;
  state.mistakes = prev.mistakes;
  state.hintsLeft = prev.hintsLeft;
  updateMistakes();
  updateHints();
  render();
  saveGame();
}

function toggleNotes() {
  if (!canPlay()) return;
  state.notesMode = !state.notesMode;
  updateNotesButton();
}

function updateNotesButton() {
  $notes.setAttribute('aria-pressed', String(state.notesMode));
  $notesState.textContent = state.notesMode ? 'ON' : 'OFF';
}

function useHint() {
  if (!canPlay() || state.hintsLeft <= 0) return;
  const sel = state.selected;

  // Cella target: quella selezionata (se vuota/errata) o la prima disponibile
  let target = null;
  if (sel && !state.given[sel.r][sel.c] &&
      state.values[sel.r][sel.c] !== state.solution[sel.r][sel.c]) {
    target = sel;
  } else {
    outer:
    for (let r = 0; r < 9; r++)
      for (let c = 0; c < 9; c++)
        if (state.values[r][c] !== state.solution[r][c]) { target = { r, c }; break outer; }
  }
  if (!target) return;

  pushHistory();
  const { r, c } = target;
  state.values[r][c] = state.solution[r][c];
  state.notes[idx(r, c)].clear();
  removeNoteFromPeers(r, c, state.solution[r][c]);
  state.given[r][c] = true; // il suggerimento diventa fisso
  state.selected = { r, c };
  state.hintsLeft--;
  updateHints();

  render();
  $board.children[idx(r, c)].classList.add('cell--hint');
  saveGame();
  checkWin();
}

/* ---------- Timer (con pausa) ---------- */

function startTimer(fromSeconds) {
  stopTimer();
  state.elapsed = fromSeconds || 0;
  $timer.textContent = formatTime(state.elapsed);
  resumeTimer();
}

function resumeTimer() {
  if (state.running || state.finished) return;
  state.tickStart = Date.now();
  state.running = true;
  state.timerId = setInterval(() => {
    const sec = elapsedSeconds();
    $timer.textContent = formatTime(sec);
    if (sec % 10 === 0) saveGame(); // persiste il tempo anche senza mosse
  }, 1000);
}

function pauseTimer() {
  if (!state.running) return;
  state.elapsed = elapsedSeconds();
  state.running = false;
  clearInterval(state.timerId);
}

function stopTimer() {
  pauseTimer();
  clearInterval(state.timerId);
}

function elapsedSeconds() {
  const extra = state.running ? (Date.now() - state.tickStart) / 1000 : 0;
  return Math.floor(state.elapsed + extra);
}

function formatTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/* ---------- Pausa ---------- */

function togglePause() {
  if (state.finished || state.busy) return;
  // In duello la pausa sarebbe un vantaggio: fermerebbe solo il proprio cronometro
  if (state.mode === 'duel') { showToast('In duello la pausa è disattivata'); return; }
  state.paused ? resumeGame() : pauseGame();
}

function pauseGame() {
  if (state.paused) return;
  state.paused = true;
  pauseTimer();
  saveGame();
  showVeil('⏸', 'Partita in pausa');
}

function resumeGame() {
  if (!state.paused) return;
  state.paused = false;
  hideVeil();
  resumeTimer();
}

function showVeil(icon, text, opts = {}) {
  $veilIcon.textContent = icon;
  $veilIcon.classList.toggle('veil__icon--spin', !!opts.spin);
  $veilText.textContent = text;
  $veilBtn.hidden = !!opts.spin; // durante la generazione non c'è nulla da riprendere
  $veil.hidden = false;
}

function hideVeil() { $veil.hidden = true; }

/* ---------- Fine partita ---------- */

function isComplete() {
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++)
      if (state.values[r][c] !== state.solution[r][c]) return false;
  return true;
}

function checkWin() {
  if (isComplete()) win();
}

function finishGame(won) {
  const seconds = elapsedSeconds();
  state.finished = true;
  stopTimer();
  if (state.mode === 'solo') {
    removeStore(STORAGE.save); // la partita è chiusa: niente da riprendere
    recordResult(state.difficulty, won, seconds);
    updateBestTime();
  }
  return { seconds };
}

function win() {
  // errori e aiuti usati nella partita (catturati prima che finishGame resetti nulla)
  const errors = state.mistakes;
  const hints = MAX_HINTS - state.hintsLeft;
  const { seconds } = finishGame(true);

  // In duello non c'è un vincitore finché non si sa cosa ha fatto l'altro:
  // l'esito lo dichiara duo.js dopo il confronto con l'avversario.
  if (state.mode === 'duel') {
    emit('complete', { won: true, seconds, errors, hints });
    return;
  }

  const rank = scoreRank(state.difficulty, seconds, errors, hints);

  // Se il risultato entra in classifica, prima si inseriscono le iniziali
  if (rank >= 0) {
    askName(state.difficulty, seconds, rank, errors, hints, (name) => {
      saveScore(state.difficulty, name, seconds, errors, hints);
      lastScore = { difficulty: state.difficulty, name, time: seconds, errors, hints };
      showWinModal(seconds, rank);
    });
  } else {
    showWinModal(seconds, -1);
  }
}

function showWinModal(seconds, rank) {
  showModal({
    icon: rank === 0 ? '🏆' : '🎉',
    title: 'Complimenti!',
    message: 'Hai completato il Sudoku senza superare il limite di errori.',
    seconds,
    rank,
  });
}

function gameOver() {
  const errors = state.mistakes;
  const hints = MAX_HINTS - state.hintsLeft;
  const { seconds } = finishGame(false);

  if (state.mode === 'duel') {
    emit('complete', { won: false, seconds, errors, hints });
    return;
  }

  showModal({
    icon: '💥',
    title: 'Game Over',
    message: 'Hai raggiunto il massimo di errori consentiti. Riprova!',
    seconds,
    rank: -1,
  });
}

function showModal({ icon, title, message, seconds, rank }) {
  const best = loadStats()[state.difficulty].best;
  document.getElementById('modal-icon').textContent = icon;
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-message').textContent = message;
  document.getElementById('modal-time').textContent = formatTime(seconds);
  document.getElementById('modal-diff').textContent = DIFFICULTY[state.difficulty].label;
  document.getElementById('modal-best').textContent = best === null ? '—' : formatTime(best);

  if (rank === 0) {
    $modalRecord.textContent = '🏆 Nuovo record personale!';
    $modalRecord.hidden = false;
  } else if (rank > 0) {
    $modalRecord.textContent = `🏅 ${rank + 1}° posto in classifica`;
    $modalRecord.hidden = false;
  } else {
    $modalRecord.hidden = true;
  }

  $overlay.hidden = false;
}

/* ---------- Inserimento iniziali (stile arcade) ---------- */

// Widget riutilizzabile: le 3 iniziali in stile cabinato. Serve nell'overlay dei
// record e, identico, nella lobby del multiplayer.
function createSlots(container) {
  const st = { letters: ['A', 'A', 'A'], pos: 0 };
  const api = { onEnter: null };

  function renderSlots() {
    for (const slot of container.children) {
      const i = Number(slot.dataset.i);
      slot.querySelector('.slot__letter').textContent = st.letters[i];
      slot.classList.toggle('slot--active', i === st.pos);
    }
  }

  function cycle(dir) {
    const cur = ALPHABET.indexOf(st.letters[st.pos]);
    st.letters[st.pos] = ALPHABET[(cur + dir + ALPHABET.length) % ALPHABET.length];
    renderSlots();
  }

  function move(step) {
    st.pos = Math.min(NAME_LEN - 1, Math.max(0, st.pos + step));
    renderSlots();
  }

  container.innerHTML = '';
  for (let i = 0; i < NAME_LEN; i++) {
    const slot = document.createElement('div');
    slot.className = 'slot';
    slot.dataset.i = i;
    slot.innerHTML = `
      <button class="slot__arrow" data-dir="1" aria-label="Lettera successiva">▲</button>
      <div class="slot__letter"></div>
      <button class="slot__arrow" data-dir="-1" aria-label="Lettera precedente">▼</button>`;

    slot.querySelector('.slot__letter').addEventListener('click', () => {
      st.pos = i;
      renderSlots();
    });
    for (const arrow of slot.querySelectorAll('.slot__arrow')) {
      arrow.addEventListener('click', () => {
        st.pos = i;
        cycle(Number(arrow.dataset.dir));
      });
    }
    container.appendChild(slot);
  }

  api.setValue = (v) => {
    const letters = String(v || '').toUpperCase().padEnd(NAME_LEN, 'A').slice(0, NAME_LEN).split('');
    st.letters = letters.map((ch) => (ALPHABET.includes(ch) ? ch : 'A'));
    st.pos = 0;
    renderSlots();
  };
  api.getValue = () => st.letters.join('');

  // Ritorna true se il tasto è stato consumato dal widget
  api.handleKey = (e) => {
    if (/^[a-zA-Z]$/.test(e.key)) {
      e.preventDefault();
      st.letters[st.pos] = e.key.toUpperCase();
      move(1);
      return true;
    }
    switch (e.key) {
      case 'ArrowUp': e.preventDefault(); cycle(1); return true;
      case 'ArrowDown': e.preventDefault(); cycle(-1); return true;
      case 'ArrowLeft': e.preventDefault(); move(-1); return true;
      case 'ArrowRight': e.preventDefault(); move(1); return true;
      case 'Backspace': e.preventDefault(); st.letters[st.pos] = 'A'; move(-1); return true;
      case 'Enter': e.preventDefault(); if (api.onEnter) api.onEnter(); return true;
    }
    return false;
  };

  api.setValue('AAA');
  return api;
}

const nameEntry = { slots: null, onDone: null };

function askName(difficulty, seconds, rank, errors, hints, onDone) {
  if (!nameEntry.slots) {
    nameEntry.slots = createSlots($nameSlots);
    nameEntry.slots.onEnter = confirmName;
  }
  nameEntry.slots.setValue(loadLastName());
  nameEntry.onDone = onDone;

  $nameTitle.textContent = rank === 0 ? 'Nuovo record!' : 'Sei in classifica!';
  $nameSub.textContent =
    `${rank + 1}° posto · ${DIFFICULTY[difficulty].label} · ${formatTime(seconds)} · ${penaltyLabel(errors, hints)}`;

  $nameOverlay.hidden = false;
}

// Etichetta compatta per errori e aiuti (o "senza sbavature" se zero di entrambi)
function penaltyLabel(errors, hints) {
  if (errors === 0 && hints === 0) return '✨ perfetto';
  return `❌ ${errors} · 💡 ${hints}`;
}

function confirmName() {
  const name = nameEntry.slots.getValue();
  writeStore(STORAGE.name, name); // prefill per la prossima volta
  $nameOverlay.hidden = true;
  const done = nameEntry.onDone;
  nameEntry.onDone = null;
  if (done) done(name);
}

const handleNameKey = (e) => nameEntry.slots && nameEntry.slots.handleKey(e);

/* ---------- Record e statistiche ---------- */

let recordsTab = 'medio';
let lastScore = null; // punteggio appena inserito, evidenziato in classifica

function openRecords() {
  recordsTab = state.difficulty;
  buildRecordTabs();
  renderRecords();
  $recordsOverlay.hidden = false;
}

function buildRecordTabs() {
  $recordsTabs.innerHTML = '';
  for (const [key, cfg] of Object.entries(DIFFICULTY)) {
    const tab = document.createElement('button');
    tab.className = 'tab';
    tab.dataset.key = key;
    tab.textContent = cfg.label;
    tab.setAttribute('role', 'tab');
    tab.addEventListener('click', () => { recordsTab = key; renderRecords(); });
    $recordsTabs.appendChild(tab);
  }
}

function renderRecords() {
  for (const tab of $recordsTabs.children) {
    const active = tab.dataset.key === recordsTab;
    tab.classList.toggle('tab--active', active);
    tab.setAttribute('aria-selected', String(active));
  }

  const list = loadScores()[recordsTab];
  $recordsList.innerHTML = '';

  if (list.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'scores__empty';
    empty.textContent = 'Nessun tempo registrato. Vinci una partita per entrare in classifica!';
    $recordsList.appendChild(empty);
  } else {
    list.forEach((s, i) => {
      const li = document.createElement('li');
      li.className = 'score' + (i === 0 ? ' score--first' : '');
      if (lastScore && recordsTab === lastScore.difficulty &&
          s.time === lastScore.time && s.name === lastScore.name) {
        li.classList.add('score--new');
      }
      const date = s.date
        ? new Date(s.date).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' })
        : '';
      const perfect = s.errors === 0 && s.hints === 0;
      const pen = perfect
        ? '<span class="score__perfect" title="Nessun errore né aiuto">✨</span>'
        : `<span class="score__pen" title="${s.errors} errori · ${s.hints} aiuti">❌${s.errors} 💡${s.hints}</span>`;
      li.innerHTML = `
        <span class="score__rank">${i + 1}</span>
        <span class="score__name">${s.name}</span>
        <span class="score__time">${formatTime(s.time)}</span>
        ${pen}
        <span class="score__date">${date}</span>`;
      $recordsList.appendChild(li);
    });
  }

  const st = loadStats()[recordsTab];
  const stats = st.played === 0
    ? 'Nessuna partita completata a questo livello.'
    : `${st.won} vittorie su ${st.played} partite (${Math.round((st.won / st.played) * 100)}%) · miglior serie: ${st.bestStreak}`;
  const legend = list.length > 0
    ? ' — a parità di tempo conta chi ha meno ❌ e 💡 (gli aiuti pesano più degli errori).'
    : '';
  $recordsSummary.textContent = stats + legend;

  // I duelli hanno una riga a parte: non entrano nella classifica del single player
  const d = loadDuelStats()[recordsTab];
  if (d.played === 0) {
    $recordsDuel.textContent = '⚔️ Nessun duello giocato a questo livello.';
  } else {
    const best = d.best === null ? '—' : formatTime(d.best);
    $recordsDuel.textContent =
      `⚔️ Duelli: ${d.won} vinti su ${d.played} · miglior tempo ${best} · miglior serie ${d.bestStreak}`;
  }
}

function resetStats() {
  if (!confirm('Vuoi davvero azzerare record e statistiche? L’operazione non è reversibile.')) return;
  removeStore(STORAGE.stats);
  removeStore(STORAGE.scores);
  removeStore(STORAGE.duelStats);
  updateBestTime();
  renderRecords();
  showToast('Record e statistiche azzerati');
}

/* ---------- Toast ---------- */

let toastId = null;
function showToast(text) {
  $toast.textContent = text;
  $toast.hidden = false;
  clearTimeout(toastId);
  toastId = setTimeout(() => { $toast.hidden = true; }, 2600);
}

/* ---------- Tastiera ---------- */

document.addEventListener('keydown', (e) => {
  // Non intercettare i tasti quando il focus è su un controllo di form
  const tag = e.target.tagName;
  if (tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA') return;

  // L'inserimento delle iniziali cattura la tastiera finché è aperto
  if (!$nameOverlay.hidden) { handleNameKey(e); return; }

  // Con un overlay aperto (fine partita, record, lobby del multiplayer…) la
  // tastiera di gioco è disattivata: chi ha aperto l'overlay gestisce i suoi tasti.
  if (document.querySelector('.overlay:not([hidden])')) {
    if (e.key === 'Escape') $recordsOverlay.hidden = true;
    return;
  }

  if (e.key >= '1' && e.key <= '9') { inputNumber(Number(e.key)); return; }

  if (e.key === 'Escape') { deselect(); return; }

  switch (e.key.toLowerCase()) {
    case 'backspace':
    case 'delete':
    case '0':
      e.preventDefault(); eraseCell(); break;
    case 'n': toggleNotes(); break;
    case 'h': useHint(); break;
    case 'z': undo(); break;
    case 'p': togglePause(); break;
    case 'arrowup': e.preventDefault(); moveSelection(-1, 0); break;
    case 'arrowdown': e.preventDefault(); moveSelection(1, 0); break;
    case 'arrowleft': e.preventDefault(); moveSelection(0, -1); break;
    case 'arrowright': e.preventDefault(); moveSelection(0, 1); break;
  }
});

function moveSelection(dr, dc) {
  if (!canPlay()) return;
  if (!state.selected) { selectCell(0, 0); return; }
  const r = (state.selected.r + dr + 9) % 9;
  const c = (state.selected.c + dc + 9) % 9;
  selectCell(r, c);
}

/* ---------- Event listener globali ---------- */

$newGame.addEventListener('click', newGame);
$modalNew.addEventListener('click', newGame);
$undo.addEventListener('click', undo);
$erase.addEventListener('click', eraseCell);
$notes.addEventListener('click', toggleNotes);
$hint.addEventListener('click', useHint);
$pause.addEventListener('click', togglePause);
$veilBtn.addEventListener('click', resumeGame);
$records.addEventListener('click', () => openRecords());
$recordsClose.addEventListener('click', () => { $recordsOverlay.hidden = true; });
$recordsReset.addEventListener('click', resetStats);
$recordsOverlay.addEventListener('click', (e) => {
  if (e.target === $recordsOverlay) $recordsOverlay.hidden = true;
});
$nameOk.addEventListener('click', confirmName);

// Un clic fuori dalla griglia deseleziona la cella. I comandi di gioco
// (tastierino, pulsanti, toolbar) sono esclusi: lì la selezione deve restare.
document.addEventListener('click', (e) => {
  if (!state.selected) return;
  if (e.target.closest('.board, .controls, .toolbar, .overlay, .veil')) return;
  deselect();
});

// Cambiando difficoltà si aggiorna il record mostrato (la partita in corso resta)
$difficulty.addEventListener('change', updateBestTime);

// Mette in pausa e salva quando la scheda passa in background.
// In duello no: il cronometro dell'avversario continua a correre, quindi anche il
// nostro deve farlo — mettere in pausa cambiando scheda sarebbe un vantaggio.
document.addEventListener('visibilitychange', () => {
  if (state.mode === 'duel') return;
  if (document.hidden && !state.finished && !state.busy) {
    pauseTimer();
    saveGame();
  } else if (!document.hidden && !state.paused && !state.finished && !state.busy) {
    resumeTimer();
  }
});

window.addEventListener('beforeunload', saveGame);

/* ---------- Avvio ---------- */

const $version = document.getElementById('app-version');
if ($version) $version.textContent = APP_VERSION;

buildNumpad();
if (restoreGame()) {
  showToast('Partita ripresa da dove l’avevi lasciata');
} else {
  newGame();
}

/* ---------- Interfaccia per il multiplayer (duo.js) ---------- */

window.Sudoku = {
  APP_VERSION,
  DIFFICULTY,
  MAX_MISTAKES,
  MAX_HINTS,
  startGame,
  beginPrepared,
  // Ferma la partita senza registrare nulla: serve a chi perde un duello
  // mentre stava ancora giocando.
  abortGame: () => {
    if (state.finished) return;
    state.finished = true;
    stopTimer();
  },
  // Un duello abbandonato dall'avversario può proseguire come partita in
  // solitaria: da qui in poi vale tutto ciò che vale nel single player.
  convertToSolo: () => {
    state.mode = 'solo';
    document.body.classList.remove('is-duel');
    saveGame();
  },
  getProgress,
  getState: () => state,
  isFinished: () => state.finished,
  recordDuel,
  loadDuelStats,
  loadLastName,
  saveLastName: (name) => writeStore(STORAGE.name, name),
  createSlots,
  makeMatchCode,
  parseMatchCode,
  randomSeed,
  formatTime,
  showToast,
  showVeil,
  hideVeil,
  on,
};
