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
- **Record e statistiche** per difficoltà: miglior tempo, partite vinte/giocate e serie di vittorie.
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

## 💾 Dati salvati

Tutto resta **in locale nel browser** (`localStorage`), nessun dato lascia il dispositivo:

| Chiave | Contenuto |
|--------|-----------|
| `sudoku.save.v1` | Partita in corso (griglia, note, errori, aiuti, tempo). Rimossa a fine partita. |
| `sudoku.stats.v1` | Record e statistiche per difficoltà. Azzerabili dal pannello 🏆. |

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
