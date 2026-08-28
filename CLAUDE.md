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
turn-worker/ il Worker Cloudflare: credenziali TURN e scambio dei codici
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

Il collegamento è **WebRTC**. Invito e risposta viaggiano in due modi:

- **automatico** (predefinito quando il Worker è configurato): chi invita
  deposita l'invito nella cassetta postale del Worker e riceve un codice breve
  tipo `KLZ-56G`; chi risponde lo ritira e deposita la risposta; chi invita la
  raccoglie da sé. Due secondi, e niente da copiare;
- **a mano**, la via di scampo di sempre: link e codice incollati dalle due
  persone. Vale quando il Worker non c'è o non risponde, e il gioco non deve
  mai smettere di funzionare senza.

L'**host è l'autorità** sull'esito, così i due schermi non possono dire cose
diverse.

Il protocollo è in `duo.js` (`hello/welcome/ready/start/progress/finished/
result/rematch/ping`), versionato con `proto: 1`.

### Il ponte (TURN)

Sulla rete mobile il peer-to-peer non passa: gli operatori usano un NAT che non
si attraversa. Il ponte inoltra i pacchetti. Il token TURN non può stare nella
pagina (è pubblica), quindi un Worker Cloudflare conia credenziali a scadenza:
`turn-worker/`, indirizzo in `config.js`.

Quattro punti delicati, tutti già costati un ciclo di prove:

1. **Il candidato `relay` arriva dopo lo `srflx`.** Uscire dall'attesa al primo
   indirizzo pubblico pubblica un codice senza il ponte — attivo e inutile.
   `waitForIce(pc, {needRelay})` aspetta il relay quando il ponte è in uso, e
   riapre l'attesa a ogni relay successivo: arrivano in raffica, non insieme.
2. **Una risposta si applica una volta sola.** Dopo, `signalingState` è `stable`
   e un secondo tentativo dà «Called in wrong state». Incollare avvia il
   collegamento da sé, quindi premere «Collega» dopo è normale: `acceptAnswer`
   restituisce `false` invece di fallire.
3. **I codici vanno snelliti.** Col ponte un telefono produce venti e più
   candidati e il codice supera i mille caratteri: se ne tengono due per tipo
   **e famiglia**, per priorità. `raddr`/`rport` non si trasmettono affatto.
4. **IPv4 e IPv6 sono due reti separate.** È il difetto che ha tenuto fermo il
   duello tra due macchine: un PC a doppia pila raccoglie dieci relay, cinque
   per famiglia, e Chrome dà priorità più alta a quelli IPv6. Tenendo «i due
   migliori» partivano due relay IPv6 mentre il telefono in 5G rispondeva con
   relay IPv4. Candidati di famiglie diverse non formano nemmeno una coppia:
   ICE non prova niente, non registra errori, e il collegamento fallisce *con
   il ponte attivo da entrambe le parti*. Perciò il taglio è per tipo **e**
   famiglia, e il referto le dice sempre entrambe.

### Lo scambio automatico dei codici

Vive sotto `/s` nello stesso Worker del ponte (`turn-worker/worker.js`), su un
database **D1**. Non è stato scelto un Durable Object per una ragione pratica:
le classi Durable Object richiedono `wrangler`, mentre D1 si configura tutto dal
pannello — ed è il percorso che questo progetto documenta.

Perché esiste, al di là della comodità: lo scambio a mano richiede dai trenta ai
novanta secondi, e in quel tempo il varco che il router apre verso l'esterno può
richiudersi. Peggio, la chat dove viaggiano i codici li **accumula**, e
incollare quello del tentativo precedente produce un collegamento che viene
accettato e non si apre mai — il guasto più difficile da riconoscere che questo
progetto abbia incontrato.

C'è un pezzo che va oltre la velocità: **finché nessuno ha ritirato l'invito,
chi invita ne prepara uno nuovo ogni trenta secondi** e lo sostituisce. Così chi
apre il link cinque minuti dopo trova indirizzi appena raccolti. Attenzione alla
corsa: fra il sondaggio e la sostituzione l'avversario può aver ritirato quello
vecchio, ed è quello che conta — perciò il trasporto nuovo si tiene **solo** se
il Worker conferma che nessuno ha ancora ritirato (`rinfrescaInvito` in
`duo.js`).

Le stanze durano quindici minuti e spariscono appena la risposta è stata
raccolta. Il Worker non sa cosa contengono i codici.

### Il referto tecnico

Da qui l'attraversamento NAT vero non si prova, quindi un fallimento sul campo
non lascia niente da leggere. «Referto tecnico» (nella lobby, sotto i due passi)
raccoglie ciò che serve a capirlo da lontano: candidati **spediti** e
**ricevuti** per tipo e famiglia, gli `icecandidateerror` con codice e URL del
server (401 = credenziali rifiutate, 701 = server irraggiungibile), le coppie
ICE con il loro stato, e la cronologia degli stati. Si apre da sé quando il
collegamento fallisce. **Va chiesto a entrambi i dispositivi**: il guasto tipico
si vede solo confrontando i due elenchi.

Attenzione alla differenza tra *raccolti* e *spediti*: il taglio può ridurre
dieci candidati dal ponte a quattro, e prima il referto mostrava i raccolti —
rassicurando («10 dal ponte») su indirizzi che all'avversario non arrivavano.

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

Avvia da sé il server statico e un endpoint TURN finto — dentro il quale, sotto
`/s`, gira il **codice vero** del Worker su uno SQLite in memoria: le prove
esercitano il servizio che va su Cloudflare, non una sua imitazione. Serve Playwright con
Chromium; se non è risolvibile lo script lo dice e spiega come installarlo.

Cosa coprono, in ordine di rapidità:

| File | Copre |
|---|---|
| `test-logic` | generatore deterministico, codice partita, codec SDP, codici come li mandano i telefoni, famiglie di indirizzi, più codici nello stesso incollaggio |
| `test-scambio` | la cassetta postale del Worker, provata fuori dal browser su SQLite vero |
| `test-relay-wait` | l'attesa dei candidati aspetta il ponte, e ne aspetta la raffica |
| `test-trim` | molti candidati non gonfiano il codice, ma nessuna famiglia sparisce |
| `test-solo` | non-regressione del single player, barra dei dati compresa |
| `test-duel` | duello capo a capo con **WebRTC reale** tra due contesti, e le due righe di dati incolonnate |
| `test-duel-paths` | errori esauriti, connessione persa, vittoria a tavolino, protocollo incompatibile |
| `test-connect` | schermata di collegamento, codice lungo, età dell'invito |
| `test-flow` | il giro completo senza premere pulsanti |
| `test-scambio-web` | duello capo a capo **senza copiare niente**, con il codice vero del Worker |
| `test-diag` | versione coerente, referto di rete e referto tecnico, sorvegliante del collegamento |
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

Un'ultima stranezza, per non farla riscoprire da capo: nella suite completa
capita — un giro su tre o quattro — che una prova con WebRTC reale (`test-duel`,
`test-flow`, `test-scambio-web`) scada sull'apertura del canale. Eseguita da
sola passa sempre. Qui il collegamento può contare solo su candidati mDNS, e la
loro risoluzione in questa sandbox è ballerina quando molte istanze di Chromium
si sono già succedute. **Prima di dare la colpa all'ambiente, però, eseguire la
prova isolata**: se fallisce anche così, è il codice.

## Stato e obiettivo aperto

Funziona: single player, duello tra due schede dello stesso browser, duello sulla
stessa Wi-Fi. Il ponte è configurato e fornisce indirizzi (referto: «N dal
ponte»).

**Da verificare sul campo**: due telefoni in 5G, e telefono contro PC su due
Wi-Fi diverse. È il caso per cui il ponte esiste; l'architettura lo prevede, ma
non è ancora stato confermato da una prova reale.

La prova PC-in-Wi-Fi contro telefono-in-5G del 26/08/2026 è fallita con il ponte
attivo da entrambe le parti: la causa più probabile è il punto 4 qui sopra (le
due famiglie di indirizzi), corretta nella `2026.08.26-1`. Se si ripete, il
referto tecnico dei due dispositivi dice se lo era davvero.

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
