# Sudoku

Web app per giocare a **Sudoku** direttamente dal browser, con più livelli di difficoltà.
Realizzata in **HTML, CSS e JavaScript puro** — nessuna dipendenza, nessun build: apri e gioca.

## 🎮 Come giocare

Apri `index.html` in un browser (doppio click) oppure visita la versione pubblicata.

- Seleziona una cella e inserisci un numero con il **tastierino** o con i tasti **1–9**.
- Ogni riga, colonna e blocco 3×3 deve contenere i numeri da 1 a 9 senza ripetizioni.
- Hai a disposizione **3 errori**: al terzo la partita termina.

## ✨ Funzionalità

- **4 livelli di difficoltà**: Facile, Medio, Difficile, Esperto.
- **Generatore a soluzione unica**: ogni puzzle ha una e una sola soluzione.
- **Salvataggio automatico**: chiudi il browser e riprendi esattamente da dove eri, tempo incluso.
- **Classifica in stile arcade**: quando entri nei 5 migliori tempi di un livello inserisci le tue
  **3 iniziali**, come nei videogiochi da sala. Tabella con posizione, nome, tempo e data.
- **Statistiche** per difficoltà: partite vinte/giocate, percentuale e miglior serie di vittorie.
- **Pausa** che ferma il timer e nasconde la griglia.
- **Modalità note** (matite) per annotare i candidati in una cella.
- **Evidenziazione intelligente** di riga, colonna, blocco e numeri uguali.
- **Suggerimenti** (3 per partita) e **annulla** mossa.
- **Timer** e **contatore errori** (massimo 3).
- **Design responsive**, ottimizzato anche per smartphone.

## ⌨️ Scorciatoie da tastiera

| Tasto | Azione |
|-------|--------|
| `1`–`9` | Inserisci numero |
| `Backspace` / `Canc` / `0` | Cancella cella |
| `N` | Attiva/disattiva modalità note |
| `H` | Suggerimento |
| `Z` | Annulla ultima mossa |
| `P` | Pausa / riprendi |
| `↑ ↓ ← →` | Sposta la selezione |
| `Esc` | Deseleziona la cella |

Per deselezionare una cella basta anche **cliccare fuori dalla griglia**.
Nella schermata delle iniziali si digitano le 3 lettere, oppure si usano le frecce
(`↑ ↓` cambiano lettera, `← →` cambiano posizione) e `Invio` per confermare.

## 💾 Dati salvati

Tutto resta **in locale nel browser** (`localStorage`), nessun dato lascia il dispositivo:

| Chiave | Contenuto |
|--------|-----------|
| `sudoku.save.v1` | Partita in corso (griglia, note, errori, aiuti, tempo). Rimossa a fine partita. |
| `sudoku.stats.v1` | Statistiche per difficoltà (giocate, vinte, serie). Azzerabili dal pannello 🏆. |
| `sudoku.scores.v1` | Classifica: i 5 migliori tempi per difficoltà con iniziali e data. |
| `sudoku.name.v1` | Ultime iniziali usate, per proporle già compilate la volta dopo. |

Se `localStorage` non è disponibile (es. navigazione privata) il gioco funziona
comunque: salvataggio e record vengono semplicemente ignorati.

## 📁 Struttura del progetto

```
Sudoku/
├── index.html   # struttura della pagina
├── style.css    # stile e layout responsive
└── script.js    # motore di gioco (generatore, stato, interazione)
```

## 🚀 Pubblicazione (GitHub Pages)

1. Vai in **Settings → Pages** del repository.
2. Seleziona il branch e la cartella `/root`.
3. La web app sarà raggiungibile all'URL indicato da GitHub.
