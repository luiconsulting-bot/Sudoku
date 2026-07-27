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

const MAX_MISTAKES = 3;
const MAX_HINTS = 3;

// Chiavi di localStorage (versionate: cambiare versione invalida i vecchi dati)
const STORAGE = {
  save: 'sudoku.save.v1',
  stats: 'sudoku.stats.v1',
};

/* ---------- Generatore di Sudoku ---------- */

const shuffle = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
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
function fillBoard(board) {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (board[r][c] === 0) {
        const nums = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
        for (const val of nums) {
          if (isValid(board, r, c, val)) {
            board[r][c] = val;
            if (fillBoard(board)) return true;
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

// Genera un puzzle: {puzzle, solution}
function generatePuzzle(remove) {
  const solution = Array.from({ length: 9 }, () => Array(9).fill(0));
  fillBoard(solution);

  const puzzle = cloneBoard(solution);
  const positions = shuffle([...Array(81).keys()]);
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

/* ---------- Stato del gioco ---------- */

const state = {
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
  finished: false,
};

/* ---------- Elementi DOM ---------- */

const $board = document.getElementById('board');
const $numpad = document.getElementById('numpad');
const $timer = document.getElementById('timer');
const $mistakes = document.getElementById('mistakes');
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
const $recordsBody = document.getElementById('records-body');
const $recordsStreak = document.getElementById('records-streak');
const $recordsClose = document.getElementById('records-close');
const $recordsReset = document.getElementById('records-reset');

const idx = (r, c) => r * 9 + c;

/* ---------- Nuova partita ---------- */

function newGame() {
  if (state.busy) return;
  const difficulty = $difficulty.value;

  // La generazione è sincrona e può bloccare il thread per ~1s sui livelli alti:
  // mostriamo prima il velo e generiamo al frame successivo, così la UI reagisce.
  state.busy = true;
  stopTimer();
  $overlay.hidden = true;
  showVeil('⏳', 'Genero il puzzle…', { spin: true });

  setTimeout(() => {
    const { puzzle, solution } = generatePuzzle(DIFFICULTY[difficulty].remove);

    state.difficulty = difficulty;
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

    hideVeil();
    syncHud();
    buildBoard();
    render();
    startTimer(0);
    saveGame();
  }, 30);
}

/* ---------- Ripresa di una partita salvata ---------- */

function saveGame() {
  if (state.finished || state.busy) return;
  writeStore(STORAGE.save, {
    difficulty: state.difficulty,
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
  $hintsLeft.textContent = state.hintsLeft;
  updateMistakes();
  updateBestTime();
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

// Il gioco accetta input solo a partita viva, non in pausa e non durante la generazione
const canPlay = () => !state.finished && !state.paused && !state.busy;

function selectCell(r, c) {
  if (!canPlay()) return;
  state.selected = { r, c };
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
  $hintsLeft.textContent = state.hintsLeft;
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
  $hintsLeft.textContent = state.hintsLeft;

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
  removeStore(STORAGE.save); // la partita è chiusa: niente da riprendere
  const isRecord = recordResult(state.difficulty, won, seconds);
  updateBestTime();
  return { seconds, isRecord };
}

function win() {
  const { seconds, isRecord } = finishGame(true);
  showModal({
    icon: isRecord ? '🏆' : '🎉',
    title: 'Complimenti!',
    message: 'Hai completato il Sudoku senza superare il limite di errori.',
    seconds,
    isRecord,
  });
}

function gameOver() {
  const { seconds } = finishGame(false);
  showModal({
    icon: '💥',
    title: 'Game Over',
    message: 'Hai raggiunto il massimo di errori consentiti. Riprova!',
    seconds,
    isRecord: false,
  });
}

function showModal({ icon, title, message, seconds, isRecord }) {
  const best = loadStats()[state.difficulty].best;
  document.getElementById('modal-icon').textContent = icon;
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-message').textContent = message;
  document.getElementById('modal-time').textContent = formatTime(seconds);
  document.getElementById('modal-diff').textContent = DIFFICULTY[state.difficulty].label;
  document.getElementById('modal-best').textContent = best === null ? '—' : formatTime(best);
  $modalRecord.hidden = !isRecord;
  $overlay.hidden = false;
}

/* ---------- Record e statistiche ---------- */

function openRecords() {
  const stats = loadStats();
  $recordsBody.innerHTML = '';

  for (const [key, cfg] of Object.entries(DIFFICULTY)) {
    const s = stats[key];
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${cfg.label}</td>
      <td class="records__best">${s.best === null ? '—' : formatTime(s.best)}</td>
      <td>${s.won}</td>
      <td>${s.played}</td>`;
    $recordsBody.appendChild(tr);
  }

  const totals = Object.values(stats).reduce(
    (acc, s) => ({ played: acc.played + s.played, won: acc.won + s.won }),
    { played: 0, won: 0 }
  );
  const bestStreak = Math.max(...Object.values(stats).map((s) => s.bestStreak));
  $recordsStreak.textContent = totals.played === 0
    ? 'Nessuna partita completata: gioca la prima!'
    : `${totals.won} vittorie su ${totals.played} partite (${Math.round((totals.won / totals.played) * 100)}%) · miglior serie: ${bestStreak}`;

  $recordsOverlay.hidden = false;
}

function resetStats() {
  if (!confirm('Vuoi davvero azzerare record e statistiche? L’operazione non è reversibile.')) return;
  removeStore(STORAGE.stats);
  updateBestTime();
  openRecords();
  showToast('Statistiche azzerate');
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

  // Con un overlay aperto la tastiera di gioco è disattivata
  if (!$overlay.hidden || !$recordsOverlay.hidden) {
    if (e.key === 'Escape') { $recordsOverlay.hidden = true; }
    return;
  }

  if (e.key >= '1' && e.key <= '9') { inputNumber(Number(e.key)); return; }

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
$records.addEventListener('click', openRecords);
$recordsClose.addEventListener('click', () => { $recordsOverlay.hidden = true; });
$recordsReset.addEventListener('click', resetStats);
$recordsOverlay.addEventListener('click', (e) => {
  if (e.target === $recordsOverlay) $recordsOverlay.hidden = true;
});

// Cambiando difficoltà si aggiorna il record mostrato (la partita in corso resta)
$difficulty.addEventListener('change', updateBestTime);

// Mette in pausa e salva quando la scheda passa in background
document.addEventListener('visibilitychange', () => {
  if (document.hidden && !state.finished && !state.busy) {
    pauseTimer();
    saveGame();
  } else if (!document.hidden && !state.paused && !state.finished && !state.busy) {
    resumeTimer();
  }
});

window.addEventListener('beforeunload', saveGame);

/* ---------- Avvio ---------- */

buildNumpad();
if (restoreGame()) {
  showToast('Partita ripresa da dove l’avevi lasciata');
} else {
  newGame();
}
