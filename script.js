/* ============================================================
   Sudoku — motore di gioco (vanilla JS)
   ============================================================ */

/* ---------- Generatore di Sudoku ---------- */

// Livelli: numero di celle da rimuovere (su 81)
const DIFFICULTY = {
  facile:    { remove: 40, label: 'Facile' },
  medio:     { remove: 48, label: 'Medio' },
  difficile: { remove: 54, label: 'Difficile' },
  esperto:   { remove: 58, label: 'Esperto' },
};

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

/* ---------- Stato del gioco ---------- */

const state = {
  puzzle: [],       // griglia iniziale (0 = vuota)
  solution: [],     // soluzione completa
  values: [],       // valori inseriti dal giocatore (include i given)
  notes: [],        // Set di note per cella (81 Set)
  given: [],        // true se cella iniziale (non modificabile)
  selected: null,   // {r, c}
  notesMode: false,
  mistakes: 0,
  maxMistakes: 3,
  hintsLeft: 3,
  difficulty: 'medio',
  history: [],       // per undo
  startTime: null,
  timerId: null,
  finished: false,
};

/* ---------- Elementi DOM ---------- */

const $board = document.getElementById('board');
const $numpad = document.getElementById('numpad');
const $timer = document.getElementById('timer');
const $mistakes = document.getElementById('mistakes');
const $difficulty = document.getElementById('difficulty');
const $newGame = document.getElementById('new-game');
const $undo = document.getElementById('undo');
const $erase = document.getElementById('erase');
const $notes = document.getElementById('notes');
const $notesState = document.getElementById('notes-state');
const $hint = document.getElementById('hint');
const $hintsLeft = document.getElementById('hints-left');
const $overlay = document.getElementById('overlay');
const $modalNew = document.getElementById('modal-new');

/* ---------- Inizializzazione partita ---------- */

function newGame() {
  state.difficulty = $difficulty.value;
  const { remove } = DIFFICULTY[state.difficulty];
  const { puzzle, solution } = generatePuzzle(remove);

  state.puzzle = puzzle;
  state.solution = solution;
  state.values = cloneBoard(puzzle);
  state.given = puzzle.map((row) => row.map((v) => v !== 0));
  state.notes = Array.from({ length: 81 }, () => new Set());
  state.selected = null;
  state.notesMode = false;
  state.mistakes = 0;
  state.hintsLeft = 3;
  state.history = [];
  state.finished = false;

  updateNotesButton();
  $hintsLeft.textContent = state.hintsLeft;
  $mistakes.innerHTML = '0<span class="stat__muted">/3</span>';
  $overlay.hidden = true;

  buildBoard();
  render();
  startTimer();
}

/* ---------- Costruzione della griglia ---------- */

function buildBoard() {
  $board.innerHTML = '';
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.r = r;
      cell.dataset.c = c;
      cell.setAttribute('role', 'gridcell');
      if (r === 3 || r === 6) cell.classList.add(`row-${r}`);
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
    btn.innerHTML = `${n}<span class="numpad__count" data-count="${n}"></span>`;
    btn.addEventListener('click', () => inputNumber(n));
    $numpad.appendChild(btn);
  }
}

/* ---------- Rendering ---------- */

const idx = (r, c) => r * 9 + c;

function render() {
  const cells = $board.children;
  const sel = state.selected;
  const selVal = sel ? state.values[sel.r][sel.c] : 0;

  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const cell = cells[idx(r, c)];
      const val = state.values[r][c];
      const isGiven = state.given[r][c];

      cell.className = 'cell';
      if (r === 3 || r === 6) cell.classList.add(`row-${r}`);
      if (isGiven) cell.classList.add('cell--given');

      // Evidenziazioni relative alla selezione
      if (sel) {
        const samePeer =
          r === sel.r ||
          c === sel.c ||
          (Math.floor(r / 3) === Math.floor(sel.r / 3) &&
            Math.floor(c / 3) === Math.floor(sel.c / 3));
        if (samePeer && !(r === sel.r && c === sel.c)) cell.classList.add('cell--peer');
        if (selVal !== 0 && val === selVal && !(r === sel.r && c === sel.c))
          cell.classList.add('cell--same');
        if (r === sel.r && c === sel.c) cell.classList.add('cell--selected');
      }

      // Contenuto: valore o note
      if (val !== 0) {
        cell.textContent = val;
        if (!isGiven && val !== state.solution[r][c]) {
          cell.classList.add('cell--error');
        }
      } else {
        const notes = state.notes[idx(r, c)];
        if (notes.size > 0) {
          const grid = document.createElement('div');
          grid.className = 'cell__notes';
          for (let n = 1; n <= 9; n++) {
            const span = document.createElement('span');
            span.className = 'cell__note';
            span.textContent = notes.has(n) ? n : '';
            grid.appendChild(span);
          }
          cell.textContent = '';
          cell.appendChild(grid);
        } else {
          cell.textContent = '';
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
    const countEl = btn.querySelector('.numpad__count');
    countEl.textContent = remaining > 0 ? remaining : '';
    btn.classList.toggle('numpad__btn--done', remaining <= 0);
  }
}

/* ---------- Interazione ---------- */

function selectCell(r, c) {
  if (state.finished) return;
  state.selected = { r, c };
  render();
}

function pushHistory() {
  state.history.push({
    values: cloneBoard(state.values),
    notes: state.notes.map((s) => new Set(s)),
    mistakes: state.mistakes,
  });
  if (state.history.length > 100) state.history.shift();
}

function inputNumber(n) {
  const sel = state.selected;
  if (!sel || state.finished) return;
  const { r, c } = sel;
  if (state.given[r][c]) return;

  pushHistory();

  if (state.notesMode) {
    // Le note hanno senso solo su celle vuote
    if (state.values[r][c] !== 0) { state.history.pop(); return; }
    const notes = state.notes[idx(r, c)];
    notes.has(n) ? notes.delete(n) : notes.add(n);
    render();
    return;
  }

  // Inserimento valore definitivo
  if (state.values[r][c] === n) {
    // Ri-tocco stesso numero → cancella
    state.values[r][c] = 0;
    render();
    return;
  }

  state.values[r][c] = n;
  state.notes[idx(r, c)].clear();

  // Rimuove la nota `n` dai peer
  removeNoteFromPeers(r, c, n);

  // Controllo errore
  if (n !== state.solution[r][c]) {
    registerMistake();
  }

  render();
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
  $mistakes.innerHTML = `${state.mistakes}<span class="stat__muted">/${state.maxMistakes}</span>`;
  if (state.mistakes >= state.maxMistakes) {
    gameOver();
  }
}

function eraseCell() {
  const sel = state.selected;
  if (!sel || state.finished) return;
  const { r, c } = sel;
  if (state.given[r][c]) return;
  if (state.values[r][c] === 0 && state.notes[idx(r, c)].size === 0) return;

  pushHistory();
  state.values[r][c] = 0;
  state.notes[idx(r, c)].clear();
  render();
}

function undo() {
  if (state.finished || state.history.length === 0) return;
  const prev = state.history.pop();
  state.values = prev.values;
  state.notes = prev.notes;
  state.mistakes = prev.mistakes;
  $mistakes.innerHTML = `${state.mistakes}<span class="stat__muted">/${state.maxMistakes}</span>`;
  render();
}

function toggleNotes() {
  state.notesMode = !state.notesMode;
  updateNotesButton();
}

function updateNotesButton() {
  $notes.setAttribute('aria-pressed', String(state.notesMode));
  $notesState.textContent = state.notesMode ? 'ON' : 'OFF';
}

function useHint() {
  const sel = state.selected;
  if (state.finished || state.hintsLeft <= 0) return;

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
  const cell = $board.children[idx(r, c)];
  cell.classList.add('cell--hint');
  checkWin();
}

/* ---------- Timer ---------- */

function startTimer() {
  clearInterval(state.timerId);
  state.startTime = Date.now();
  $timer.textContent = '00:00';
  state.timerId = setInterval(() => {
    $timer.textContent = formatTime(elapsedSeconds());
  }, 1000);
}

const elapsedSeconds = () => Math.floor((Date.now() - state.startTime) / 1000);

function formatTime(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function stopTimer() { clearInterval(state.timerId); }

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

function win() {
  state.finished = true;
  stopTimer();
  showModal({
    icon: '🎉',
    title: 'Complimenti!',
    message: 'Hai completato il Sudoku senza superare il limite di errori.',
  });
}

function gameOver() {
  state.finished = true;
  stopTimer();
  showModal({
    icon: '💥',
    title: 'Game Over',
    message: 'Hai raggiunto il massimo di errori consentiti. Riprova!',
  });
}

function showModal({ icon, title, message }) {
  document.getElementById('modal-icon').textContent = icon;
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-message').textContent = message;
  document.getElementById('modal-time').textContent = formatTime(elapsedSeconds());
  document.getElementById('modal-diff').textContent = DIFFICULTY[state.difficulty].label;
  $overlay.hidden = false;
}

/* ---------- Tastiera ---------- */

document.addEventListener('keydown', (e) => {
  if (e.key >= '1' && e.key <= '9') { inputNumber(Number(e.key)); return; }

  switch (e.key.toLowerCase()) {
    case 'backspace':
    case 'delete':
    case '0':
      eraseCell(); break;
    case 'n': toggleNotes(); break;
    case 'h': useHint(); break;
    case 'z': if (e.ctrlKey || e.metaKey || true) undo(); break;
    case 'arrowup': moveSelection(-1, 0); e.preventDefault(); break;
    case 'arrowdown': moveSelection(1, 0); e.preventDefault(); break;
    case 'arrowleft': moveSelection(0, -1); e.preventDefault(); break;
    case 'arrowright': moveSelection(0, 1); e.preventDefault(); break;
  }
});

function moveSelection(dr, dc) {
  if (state.finished) return;
  let { r, c } = state.selected || { r: 0, c: 0 };
  if (!state.selected) { selectCell(0, 0); return; }
  r = (r + dr + 9) % 9;
  c = (c + dc + 9) % 9;
  selectCell(r, c);
}

/* ---------- Event listener globali ---------- */

$newGame.addEventListener('click', newGame);
$modalNew.addEventListener('click', newGame);
$undo.addEventListener('click', undo);
$erase.addEventListener('click', eraseCell);
$notes.addEventListener('click', toggleNotes);
$hint.addEventListener('click', useHint);

/* ---------- Avvio ---------- */

buildNumpad();
newGame();
