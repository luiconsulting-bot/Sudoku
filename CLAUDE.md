# Note per chi lavora su questo progetto

Sudoku nel browser, **senza dipendenze e senza build**: si apre `index.html` e si
gioca. Pubblicato su GitHub Pages a
`https://luiconsulting-bot.github.io/Sudoku/` (attenzione: **S maiuscola**).

## Vincoli da non violare

Sono i motivi per cui il codice ha la forma che ha:

| Vincolo | Conseguenza pratica |
|---|---|
| Nessuna dipendenza, nessun build | niente librerie a runtime, niente bundler |
| Si apre con doppio click (`file://`) | **niente moduli ES**: script classici, in ordine |
| Il single player non deve regredire | ha una suite dedicata (`test-solo`), tenerla verde |
| Dati del duello separati dal solo | chiavi `localStorage` distinte, mai mescolarle |

## I file

```
index.html   struttura, tutti gli overlay, i tag <script> con ?v=
style.css    stile e layout responsive
config.js    ← unica configurazione: indirizzo del ponte TURN
net.js       trasporto: WebRTC, ponte, codifica dei codici. Nessun DOM
script.js    motore di gioco: generatore, stato, interazione, single player
duo.js       duello in due: protocollo, regole, interfaccia
turn-worker/ il Worker Cloudflare che conia le credenziali TURN
test/        la suite, si esegue con ./test/run.sh
```

Ordine di caricamento: `config.js → net.js → script.js → duo.js`. `duo.js` usa
`window.Sudoku` (esportato da `script.js`) e `window.SudokuNet`.

## Disciplina della versione — importante

`APP_VERSION` in `script.js` **deve coincidere** con i `?v=` di `index.html`.
Quel parametro è ciò che costringe i telefoni a riscaricare i file invece di
servire una copia vecchia, e il numero mostrato a fondo pagina è l'unico modo per
sapere quale build sta girando su un dispositivo lontano.

**Ogni modifica a JS o CSS richiede di alzare la versione in entrambi i posti**,
altrimenti chi prova resta sulla versione precedente e la correzione sembra non
aver funzionato. È già successo, ed è costato diversi giri a vuoto.
`test-diag` fallisce se i due valori divergono.

## Come funziona il duello

Stesso puzzle, due griglie separate, vince chi finisce primo. Il puzzle è
identificato da **difficoltà + seed** (PRNG mulberry32 deterministico): l'host
manda il seed, non la griglia.

Il collegamento è **WebRTC senza server di signaling**: l'invito e la risposta se
li scambiano le due persone a mano (link e codice). L'**host è l'autorità**
sull'esito, così i due schermi non possono dire cose diverse.

Il protocollo è in `duo.js` (`hello/welcome/ready/start/progress/finished/
result/rematch/ping`), versionato con `proto: 1`.

### Il ponte (TURN)

Sulla rete mobile il peer-to-peer non passa: gli operatori usano un NAT che non
si attraversa. Il ponte inoltra i pacchetti. Il token TURN non può stare nella
pagina (è pubblica), quindi un Worker Cloudflare conia credenziali a scadenza:
`turn-worker/`, indirizzo in `config.js`.

Tre punti delicati, tutti già costati un ciclo di prove:

1. **Il candidato `relay` arriva dopo lo `srflx`.** Uscire dall'attesa al primo
   indirizzo pubblico pubblica un codice senza il ponte — attivo e inutile.
   `waitForIce(pc, {needRelay})` aspetta il relay quando il ponte è in uso.
2. **Una risposta si applica una volta sola.** Dopo, `signalingState` è `stable`
   e un secondo tentativo dà «Called in wrong state». Incollare avvia il
   collegamento da sé, quindi premere «Collega» dopo è normale: `acceptAnswer`
   restituisce `false` invece di fallire.
3. **I codici vanno snelliti.** Col ponte un telefono produce venti e più
   candidati e il codice supera i mille caratteri: se ne tengono due per tipo,
   per priorità.

### La diagnosi è una sola funzione

`networkDiagnosis()` in `duo.js` produce sia l'avviso mostrato prima di
condividere il codice sia la spiegazione dopo un tentativo fallito. **Non
duplicarla**: prima esisteva in tre punti separati e sono invecchiati ognuno per
conto suo, arrivando a dire «non usiamo server intermedi» mentre il ponte era in
funzione. `test-messaggi` fallisce se quelle frasi ricompaiono.

## Le prove

```bash
./test/run.sh              # tutte (103 controlli, ~4 minuti)
./test/run.sh test-duel    # una sola
```

Avvia da sé il server statico e un endpoint TURN finto. Serve Playwright con
Chromium; se non è risolvibile lo script lo dice e spiega come installarlo.

Cosa coprono, in ordine di rapidità:

| File | Copre |
|---|---|
| `test-logic` | generatore deterministico, codice partita, codec SDP, codici come li mandano i telefoni |
| `test-relay-wait` | l'attesa dei candidati aspetta il ponte quando serve |
| `test-trim` | molti candidati non gonfiano il codice |
| `test-solo` | non-regressione del single player |
| `test-duel` | duello capo a capo con **WebRTC reale** tra due contesti |
| `test-duel-paths` | errori esauriti, connessione persa, vittoria a tavolino, protocollo incompatibile |
| `test-connect` | schermata di collegamento, codice lungo, età dell'invito |
| `test-flow` | il giro completo senza premere pulsanti |
| `test-diag` | versione coerente, referto di rete, sorvegliante del collegamento |
| `test-turn` / `test-turn-down` | il ponte, e il ponte guasto |
| `test-messaggi` | i testi corrispondono allo stato reale |

## Limiti dell'ambiente di sviluppo

Da qui **non si esce su Internet**: niente STUN, niente TURN, `github.io` e
`developers.cloudflare.com` sono bloccati dal proxy. Conseguenze:

- si raccolgono solo candidati mDNS `.local`, quindi il caso «nessun indirizzo
  pubblico» è l'unico riproducibile;
- il ponte risulta sempre `non raggiungibile`: le prove lo simulano con
  `test/turn-mock.mjs`;
- il browser registra errori di rete in console — le prove li filtrano
  (`RETE_ASSENTE`), non sono difetti;
- **l'attraversamento NAT reale non è verificabile qui.** L'unico modo è provare
  sui dispositivi veri, ed è per questo che il gioco mostra il referto degli
  indirizzi: serve a farsi raccontare cosa è successo da lontano.

Il server statico avviato in background **muore tra un turno e l'altro**:
`./test/run.sh` lo riavvia ogni volta.

## Stato e obiettivo aperto

Funziona: single player, duello tra due schede dello stesso browser, duello sulla
stessa Wi-Fi. Il ponte è configurato e fornisce indirizzi (referto: «N dal
ponte»).

**Da verificare sul campo**: due telefoni in 5G, e telefono contro PC su due
Wi-Fi diverse. È il caso per cui il ponte esiste; l'architettura lo prevede, ma
non è ancora stato confermato da una prova reale.

Non fatto: la **modalità co-op** (un solo Sudoku giocato in due sulla stessa
griglia), progettata in `DESIGN-multiplayer.md` §6. Riusa trasporto, protocollo,
lobby, countdown e rivincita: cambia solo la gestione dello stato condiviso.

## Come si lavora qui

- Si scrive e si commenta **in italiano**, come tutto il resto del progetto.
- I messaggi di commit sono in inglese.
- Prima di dire che qualcosa funziona, **eseguire le prove**. Diverse correzioni
  di questo progetto sono nate da un difetto che una prova ha trovato e che a
  occhio sembrava a posto.
- Quando una prova fallisce, chiedersi **prima** se ha ragione lei: è successo
  spesso che l'errore fosse nell'aspettativa, e altrettanto spesso che fosse nel
  codice.
