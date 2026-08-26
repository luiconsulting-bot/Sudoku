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
  **3 iniziali**, come nei videogiochi da sala. Ogni riga mostra posizione, nome, tempo, errori,
  aiuti e data. A parità di tempo vince chi ha meno penalità totali (errori + aiuti); a ulteriore
  parità è preferito chi ha fatto errori piuttosto che chiesto aiuti — gli **aiuti pesano più degli
  errori**. Una partita senza errori né aiuti è marcata come ✨ perfetta.
- **Statistiche** per difficoltà: partite vinte/giocate, percentuale e miglior serie di vittorie.
- **Pausa** che ferma il timer e nasconde la griglia.
- **Modalità note** (matite) per annotare i candidati in una cella.
- **Evidenziazione intelligente** di riga, colonna, blocco e numeri uguali.
- **Suggerimenti** (3 per partita) e **annulla** mossa.
- **Timer** e **contatore errori** (massimo 3).
- **Duello in due** su dispositivi diversi: stesso puzzle, vince chi finisce primo.
- **Design responsive**, ottimizzato anche per smartphone.

## 👥 Gioca in due

Premi **👥** nella barra in alto. Il duello si gioca su **due dispositivi diversi**
(due PC, due telefoni, PC + telefono): stesso puzzle, due griglie separate,
**vince chi completa per primo**.

Il collegamento è **diretto tra i due browser** (WebRTC): non c'è alcun server, e
nessun dato passa da terzi. In cambio, l'invito va scambiato una volta a mano:

1. Chi crea la partita preme **Crea una partita** e manda il **link** con
   «Condividi» (WhatsApp, Telegram, quello che vuoi).
2. Chi lo riceve **apre il link**: la risposta si prepara da sé, basta
   rimandarla con «Condividi».
3. Il primo la **incolla** e il countdown parte da solo.

Non serve premere nulla oltre a questo: i pulsanti «Genera risposta» e
«Collega» restano come rete di sicurezza, se un incolla non viene rilevato.
Il codice viene riconosciuto anche dentro un link o una frase, con spazi o capi
di riga in mezzo, e con il prefisso in minuscolo — perché le tastiere dei
telefoni lo «correggono» volentieri.

Lo scambio si paga **una volta per sessione**: la **rivincita** riusa lo stesso
collegamento, senza ricominciare da capo.

### Regole del duello

| Aspetto | Regola |
|---|---|
| Puzzle | identico per entrambi |
| Errori | 3 a testa: al terzo hai perso e vince l'altro |
| Aiuti | 3 a testa, indipendenti |
| Tempo | ognuno ha il proprio cronometro, dal via |
| Pausa | disattivata (fermerebbe solo il tuo tempo) |
| Note | private, non vengono trasmesse |

Dell'avversario vedi una **griglia ombra** — quali celle ha riempito, **non quali
cifre** — più tempo, celle completate, errori e aiuti. Se la connessione cade puoi
scegliere tra **vittoria a tavolino** e **finire il puzzle da solo**: una rete
caduta non ti costa la partita.

### Se non si collega

Sotto il codice compare il **referto degli indirizzi** trovati, e dice quale dei
due problemi hai davanti:

- **«nessun indirizzo pubblico»** → il tuo telefono non è raggiungibile da fuori:
  mettetevi sulla **stessa rete Wi-Fi**.
- **indirizzi pubblici presenti, ma nessun collegamento dopo ~25 secondi** → la
  rete non lascia passare il traffico diretto. È il caso tipico della **rete
  mobile**, dove gli operatori usano un NAT che il peer-to-peer non attraversa:
  nessun numero di tentativi lo risolve, serve la Wi-Fi o la sfida con codice.

A fondo pagina c'è la **versione** in uso: deve essere la stessa sui due telefoni.
Se dopo un aggiornamento vedi ancora quella vecchia, il telefono sta servendo una
copia in cache — chiudi e riapri la scheda.

### 🌉 Il ponte (TURN), per la rete mobile

Sulla rete mobile il collegamento diretto **non può riuscire**: gli operatori
usano un NAT che il peer-to-peer non attraversa. Un server TURN inoltra i
pacchetti per conto dei due giocatori e risolve il problema.

È **disattivato di serie**: senza configurarlo il gioco resta peer-to-peer puro,
come è sempre stato. Per attivarlo servono un account Cloudflare e cinque minuti:
il procedimento è in **[`turn-worker/README.md`](turn-worker/README.md)**, e
l'indirizzo del ponte si mette in [`config.js`](config.js).

Due cose da sapere prima di attivarlo:

- **con il ponte il traffico può passare da un server di Cloudflare** — cifrato,
  ma non più strettamente da dispositivo a dispositivo. È il punto in cui la
  promessa «nessun dato lascia il dispositivo» smette di valere alla lettera;
- Cloudflare chiede un metodo di pagamento per attivare Realtime, ma la soglia
  gratuita è **1.000 GB al mese**. Un duello di venti minuti ne consuma **circa
  1 MB**: oltre un milione di duelli al mese starebbero dentro la soglia. I
  conti per esteso sono in [`turn-worker/README.md`](turn-worker/README.md).

Il referto sotto il codice dice sempre se il ponte è `attivo`, `non configurato`
o `non raggiungibile`. Se non risponde, il gioco prova comunque in diretta.

### 🎯 Sfida con un codice (senza collegamento)

Se il collegamento diretto non riesce — succede su alcune reti mobili o aziendali,
perché non usiamo server intermedi — resta la via che **funziona sempre**: in
**👥 → Sfida con un codice** trovi il codice della tua partita, per esempio
`MEDIO-7F3A2B`. Mandalo a chi vuoi: aprendolo giocherà **lo stesso puzzle**, quando
gli fa comodo, e poi vi confrontate i tempi. Nessuna connessione, nessuna attesa.

> Prima di avere due dispositivi sotto mano puoi provare tutto con **«Prova su due
> schede di questo browser»**: apri il gioco in una seconda scheda, premi «Crea»
> in una e «Unisciti» nell'altra, senza codici da scambiare. Le due schede
> condividono gli stessi dati salvati, quindi i duelli di prova **non vengono
> registrati** nelle statistiche: la stessa partita non può essere insieme una
> vittoria e una sconfitta.

I risultati dei duelli **non entrano nella classifica del single player**: hanno una
riga a parte nel pannello 🏆.

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
| `sudoku.duel.stats.v1` | Duelli per difficoltà (giocati, vinti, miglior tempo, serie). |

Un duello **non** viene salvato: ricaricando la pagina il collegamento con
l'avversario è perduto e non si può riaprire senza rifare lo scambio dei codici.
La partita in solitaria, invece, resta intatta: un duello non la sovrascrive.

Se `localStorage` non è disponibile (es. navigazione privata) il gioco funziona
comunque: salvataggio e record vengono semplicemente ignorati.

## 📁 Struttura del progetto

```
Sudoku/
├── index.html   # struttura della pagina
├── style.css    # stile e layout responsive
├── config.js    # indirizzo del ponte TURN (unica cosa da configurare)
├── net.js       # trasporto: WebRTC, ponte e codici di collegamento (nessun DOM)
├── script.js    # motore di gioco (generatore, stato, interazione)
├── duo.js       # duello in due: protocollo, regole, interfaccia
└── turn-worker/ # il ponte TURN: Worker Cloudflare + istruzioni
```

Il puzzle è generato da un **seed**: a parità di seed la griglia è identica su
qualunque browser, ed è ciò che permette a due dispositivi di giocare lo stesso
Sudoku scambiandosi solo un numero. Il progetto della modalità in due, con le
scelte e i limiti dichiarati, è in [`DESIGN-multiplayer.md`](DESIGN-multiplayer.md).

## 🚀 Pubblicazione (GitHub Pages)

1. Vai in **Settings → Pages** del repository.
2. Seleziona il branch e la cartella `/root`.
3. La web app sarà raggiungibile all'URL indicato da GitHub.
