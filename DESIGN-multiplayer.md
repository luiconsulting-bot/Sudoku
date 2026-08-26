# Progetto: Sudoku in due

Documento di progettazione della modalità a due giocatori su **dispositivi diversi**
(due PC, due telefoni, PC + telefono). Da rivedere e discutere *prima* di scrivere codice.

Stato: **duello realizzato** (fasi 1–4 di §14). Il co-op (§6) resta da fare.
Le decisioni prese durante la realizzazione sono annotate in §16.

---

## 1. Obiettivo e vincoli

Due persone, due dispositivi, due schermi, nello stesso momento. Due modalità:

- **Duello** — 1 contro 1 sullo stesso puzzle, griglie separate, vince chi finisce primo.
- **Co-op** — un solo Sudoku giocato in due sulla stessa griglia.

I vincoli vengono dal progetto così com'è oggi, e non li vogliamo perdere:

| Vincolo attuale | Conseguenza sul progetto |
|---|---|
| Nessuna dipendenza, nessun build | niente librerie di rete, niente bundler |
| Nessun backend, pubblicato su GitHub Pages | il collegamento deve essere **peer-to-peer** |
| Si apre con doppio click (`file://`) | **niente moduli ES**: restiamo su script classici |
| Stato solo in `localStorage`, nulla lascia il dispositivo | il traffico va solo tra i due giocatori |
| Single player funzionante e con classifiche | il multiplayer **non deve regredire** né inquinare il solo |

Il Sudoku in due è la parte facile. La parte difficile è **il collegamento**.

---

## 2. Architettura a livelli

L'idea portante: la logica di gioco non deve sapere *come* arrivano i messaggi.

```
┌─────────────────────────────────────────────┐
│  UI          board, numpad, HUD, overlay    │  ← già esistente, esteso
├─────────────────────────────────────────────┤
│  Gioco       applyMove / applyNotes / …     │  ← mutazioni pure, sorgente-agnostiche
├─────────────────────────────────────────────┤
│  Match       ruoli, regole, esito, resync   │  ← nuovo
├─────────────────────────────────────────────┤
│  Protocollo  messaggi JSON versionati       │  ← nuovo
├─────────────────────────────────────────────┤
│  Transport   connect / send / onMessage     │  ← interfaccia
│              ├─ RTCTransport (WebRTC)       │     implementazione principale
│              └─ LocalTransport (BroadcastCh)│     solo per sviluppo e test
└─────────────────────────────────────────────┘
```

`LocalTransport` non è uno scarto: due schede dello stesso browser permettono di
sviluppare e testare **tutta** la logica multiplayer in mezzo secondo per iterazione,
senza due dispositivi in mano e senza reti di mezzo. È l'ambiente di sviluppo del
multiplayer. `RTCTransport` è ciò che gli utenti usano.

```js
// Interfaccia Transport — entrambe le implementazioni la rispettano
{
  send(msg),            // msg è un oggetto, la serializzazione è interna
  onMessage(fn),
  onStateChange(fn),    // 'connecting' | 'open' | 'closed' | 'failed'
  close(),
}
```

---

## 3. Il collegamento: WebRTC senza server

WebRTC crea un canale dati diretto tra due browser, ma per aprirlo i due peer
devono prima scambiarsi una descrizione della connessione (SDP + candidati ICE).
Normalmente lo fa un server di *signaling*. Noi non ne abbiamo uno: **quello
scambio lo fa l'utente**, una volta per partita.

### Flusso di connessione

```
  HOST (crea la partita)                    GUEST (si unisce)
  ─────────────────────                     ────────────────
  1. sceglie modalità + difficoltà
  2. genera il codice INVITO  ─── link / WhatsApp / QR ──▶  3. apre il link
                                                            4. genera il codice RISPOSTA
  6. incolla la RISPOSTA      ◀────── copia-incolla ──────  5. lo rimanda all'host
  7. canale aperto  ◀═══════════ P2P DataChannel ═══════════▶  canale aperto
  8. host manda il puzzle, entrambi "pronto", countdown 3·2·1, si gioca
```

Lo scambio è **bidirezionale per forza**: è così che funziona WebRTC senza server.
Non possiamo ridurlo a un solo passaggio, ma possiamo renderlo indolore:

- il codice invito viaggia come **link** `index.html#j=<codice>` — l'host preme
  "Condividi" (`navigator.share` su mobile, copia negli appunti altrimenti) e lo
  manda su WhatsApp; il guest tocca il link e la schermata di join è già compilata;
- il codice risposta è **più corto** dell'invito e ha un pulsante "Copia";
- entrambi i codici sono in un font monospaziato, selezionabili con un tap.

### Formato del codice

Un SDP completo è ~1,5 kB: in base64 diventa un muro di 2000 caratteri.
Trasmettiamo invece solo ciò che serve, e ricostruiamo l'SDP dall'altra parte:

```
{ ufrag, pwd, fingerprint, setup, candidati[] }  →  JSON compatto  →  base64url
```

Attesa: **200–400 caratteri**, condivisibili senza imbarazzo. Il codice porta un
prefisso di versione (`S1:`) così una versione vecchia dell'app riconosce un codice
che non sa leggere e lo dice, invece di fallire in modo opaco.

> Se la ricostruzione dell'SDP si rivelasse fragile tra browser diversi, il piano B
> è il base64 dell'SDP integrale: codice bruttissimo ma robusto, e il resto del
> progetto non cambia di una riga. Decidiamo con una prova su Chrome + Safari iOS.

### Dettagli che fanno la differenza tra "funziona" e "non funziona"

- **ICE non-trickle:** aspettiamo `icegatheringstate === 'complete'` prima di
  mostrare il codice, con un tetto di 3 secondi (su alcune reti il gathering non
  si chiude mai). Serve perché il codice deve contenere *tutti* i candidati: non
  c'è un canale per mandarne altri dopo.
- **STUN:** `stun:stun.l.google.com:19302` per scoprire l'indirizzo pubblico.
  È l'unica chiamata verso l'esterno che l'app farà mai, e serve solo durante
  l'apertura del canale. **Sulla stessa rete Wi-Fi funziona anche senza**, con i
  soli candidati locali.
- **Nessun TURN:** significa che alcune combinazioni di rete non si collegheranno
  (NAT simmetrico, certe reti mobili, alcune Wi-Fi aziendali). Vedi §11.
- **Scadenza:** un codice invito vale ~10 minuti, poi si rigenera. Un codice
  scaduto dà un errore comprensibile, non un timeout muto.

---

## 4. Codice partita e puzzle riproducibile

Oggi `shuffle` usa `Math.random` (`script.js:33`), quindi ogni puzzle è irripetibile.
Iniettando un PRNG seminato (mulberry32, 6 righe) in `shuffle`/`generatePuzzle`
(`script.js:103`), un puzzle diventa identificato da **`difficoltà + seed`**:

```
MEDIO-7F3A2B
```

Due usi, entrambi utili:

1. **Duello:** l'host manda il seed, non la griglia. Payload minuscolo e la
   certezza matematica che i due puzzle siano identici.
2. **Sfida asincrona** (bonus quasi gratuito): ti mando il codice via messaggio,
   giochiamo lo stesso puzzle quando ci pare, confrontiamo i tempi. **Nessuna
   connessione, nessun WebRTC, funziona sempre.** È anche la rete di sicurezza
   quando il P2P non si collega.

Il generatore resta deterministico a parità di seed su qualunque browser: dipende
solo dal PRNG, non da `Math.random` né da API di piattaforma.

---

## 5. Modalità Duello (prima consegna)

Stesso puzzle, **due griglie indipendenti**. Nessun attacco, nessun sabotaggio,
nessun potere speciale: è una corsa. (Il perché in §13.)

### Regole

| Aspetto | Regola |
|---|---|
| Puzzle | identico per entrambi, dal seed dell'host |
| Errori | 3 a testa, come in single player; al 3° **hai perso**, l'altro vince |
| Aiuti | 3 a testa, indipendenti; costano in classifica come oggi |
| Vittoria | primo a completare la griglia |
| Tempo | ognuno misura il **proprio** cronometro, dal countdown |
| Pausa | **disabilitata** in duello (sarebbe un vantaggio); resta il velo se la scheda va in background, ma il tempo continua a correre e lo si dice chiaramente |
| Note | private, non trasmesse |

### Cosa vedi dell'avversario

Una **mini-griglia "ombra"** accanto alla tua: quadratini pieni/vuoti, **senza le
cifre** — vedi che avanza, non *cosa* scrive. Più una riga di contatori:

```
   ANNA    ⏱ 04:12    ▦ 47/81    ❌ 1/3    💡 0/3
```

Aggiornata circa una volta al secondo con un messaggio `progress`. È abbastanza
per sentire il fiato sul collo, troppo poco per copiare.

### Assegnazione dell'esito

L'**host è l'autorità**. Chi finisce manda `finished {elapsed, errors, hints}`;
l'host confronta e trasmette un `result` che entrambi mostrano. Confronto:
tempo minore; a parità esatta di secondo, chi è arrivato prima all'host.
Un unico verdetto, mai due schermi che dicono cose diverse.

### Macchina a stati della partita

```
lobby → connecting → ready → countdown(3) → playing → finished → [rivincita]
                        ↑                        │
                        └──── rivincita ─────────┘   (il canale resta aperto)
```

La **rivincita** è la cosa più importante dopo il collegamento: senza, ogni partita
ricomincia dal copia-incolla. Il DataChannel sopravvive alla fine della partita:
`rematch` → accettazione → nuovo seed → countdown. Costo quasi nullo, valore alto.

### Se l'altro sparisce

Heartbeat `ping/pong` ogni 2 s; dopo 6 s di silenzio: velo *"Connessione con ANNA
persa, riprovo…"*. Dopo 20 s scegli tu:

- **Vinci a tavolino** — la partita si chiude come vittoria.
- **Continua da solo** — diventa una normale partita single player, con il tempo
  che continua da dov'era, e come tale entra nelle classifiche.

Nessun risultato viene perso perché è caduta una rete.

---

## 6. Modalità Co-op (consegna successiva)

Una griglia condivisa, mosse visibili in tempo reale. Riusa tutto: trasporto,
protocollo, lobby, rivincita. Cambia la gestione dello stato condiviso.

- **Presenza:** la cella selezionata dall'altro ha un bordo colorato (tu indaco,
  l'altro verde-acqua). È il dettaglio che fa sentire l'altro *presente*.
- **Conflitti** (entrambi scrivono nella stessa cella): *last-write-wins* per cella
  con clock logico (contatore Lamport, id giocatore come spareggio). In due è
  abbondantemente sufficiente e sta in poche righe.
- **Attribuzione:** ogni cifra prende una sfumatura del colore di chi l'ha inserita.
  Errori attribuiti nell'HUD: `❌ 2/3 — 1 tuo, 1 di ANNA`.
- **Errori e aiuti condivisi:** 3 e 3 per la squadra. Un puzzle, una squadra.
- **Annulla:** ognuno annulla **solo la propria ultima mossa**, e solo se nessuno ha
  toccato quella cella dopo. Un undo globale in co-op è una fabbrica di litigi.
- **Pausa mutua:** chi mette in pausa ferma entrambi i timer, con etichetta
  *"ANNA ha messo in pausa"*. Riprende chiunque dei due.
- **Note condivise:** sono uno strumento di collaborazione, quindi sincronizzate
  (last-write-wins per cella, come i valori).
- **Timer:** l'host è l'orologio autorevole e lo trasmette; il guest lo mostra.
  Due cronometri indipendenti divergerebbero e in co-op il tempo è uno solo.

---

## 7. Protocollo

JSON, un campo `t` per il tipo, `proto: 1` nell'handshake.

```
hello     {name, proto, mode}                    guest → host
welcome   {matchId, mode, difficulty, seed, role} host → guest
ready     {}                                     entrambi
start     {}                                     host → guest   (avvia il countdown)
progress  {filled, errors, hints, elapsed}       duello, ~1/s
move      {cell, value, clock}                   co-op
notes     {cell, digits[], clock}                co-op
select    {cell|null}                            co-op, throttle 100 ms
hint      {cell, value, hintsLeft, clock}        co-op
pause     {on, by}                               co-op
finished  {elapsed, errors, hints, won}          → host
result    {winner, mine, theirs}                 host → entrambi
rematch   {seed?}                                entrambi
resync    {}  /  snapshot {stato completo}       recupero
ping / pong                                      ogni 2 s
```

**Compatibilità:** `proto` diverso ⇒ messaggio esplicito *"L'altro giocatore ha una
versione diversa del gioco: aggiornate la pagina."* Un messaggio con `t` sconosciuto
viene **ignorato**, non è un errore fatale: le versioni future possono aggiungere
tipi senza rompere le vecchie.

**Recupero:** alla riconnessione il guest manda `resync`, l'host risponde con uno
`snapshot` completo e si riparte allineati. L'host è sempre la sorgente di verità.

---

## 8. Refactor del codice esistente

Tre modifiche obbligate, tutte piccole ma strutturali. Il single player deve
continuare a comportarsi **esattamente** come oggi.

1. **PRNG iniettabile** — `shuffle` (`script.js:33`) e `generatePuzzle`
   (`script.js:103`) ricevono un `rng`. In single player si semina da
   `Math.random()`: comportamento identico a oggi.

2. **Separare intento e mutazione** — oggi `inputNumber` (`script.js:569`) fa
   controlli, mutazione, render, salvataggio e `checkWin` in un unico blocco.
   Va spezzato in tre:

   ```
   intent  (locale: permessi, canPlay, turno)
     → applyMove({cell, value, source})   ← mutazione pura, testabile
       → effetti (render, save, broadcast, checkWin)
   ```

   Le mosse remote entrano dal livello intermedio. Senza questo, ogni regola
   esisterebbe in due copie che divergono al primo bug.

3. **Avvio pilotato** — ora il gioco parte al caricamento (`script.js:1140`).
   Serve un `boot()` che possa cedere il passo a una sessione multiplayer (per
   esempio quando la pagina è aperta da un link `#j=…`).

**Persistenza separata:** `sudoku.save.v1` resta **solo** del single player. Il
multiplayer usa `sudoku.duo.v1`. Nessuna migrazione, nessun rischio di
sovrascrivere una partita in corso.

**Classifiche:** i risultati in due **non entrano** in `sudoku.scores.v1`. Nuove
chiavi `sudoku.scores.duo.v1` / `sudoku.stats.duo.v1`, con tab dedicati nel
pannello 🏆 e le iniziali di entrambi i giocatori. La classifica del single
player mantiene il significato che ha oggi.

---

## 9. Organizzazione dei file

I moduli ES romperebbero l'apertura con doppio click (`file://` blocca gli
`import`), e il README lo promette esplicitamente. Restiamo su script classici:

```
index.html      + pannello "Gioca in 2", mini-griglia, schermate di collegamento
style.css       + stili lobby, ombra avversario, colori giocatore
script.js         motore esistente, refactor §8
net.js          ← nuovo: Transport, WebRTC, codifica del codice — zero DOM
duo.js          ← nuovo: match, protocollo, UI multiplayer
```

`net.js` non tocca il DOM: si prova dalla console e si ragiona senza pensare alla UI.
Il pannello riusa il **widget arcade delle 3 iniziali** già esistente
(`script.js:884`) per il nome del giocatore: coerenza visiva gratis.

---

## 10. Schermate

1. **Toolbar** — un pulsante `👥 In due` accanto a 🏆.
2. **Lobby** — «Crea partita» / «Unisciti»; modalità e difficoltà; le 3 iniziali.
3. **Collegamento (host)** — codice invito, pulsanti Condividi/Copia, campo per la
   risposta, stato in chiaro (*"in attesa di ANNA…"*).
4. **Collegamento (guest)** — precompilato dal link, mostra la risposta da rimandare.
5. **Countdown** — 3 · 2 · 1 · via, su entrambi gli schermi.
6. **Partita** — griglia come oggi + ombra avversario + contatori.
7. **Esito** — vinto/perso, tempi a confronto, `Rivincita` e `Chiudi`.

Ogni schermata di errore dice **cosa è andato storto e cosa fare**: mai uno
spinner infinito.

---

## 11. Rischi e limiti dichiarati

| Rischio | Mitigazione |
|---|---|
| **Senza TURN alcune reti non si collegano** (NAT simmetrico, certe reti mobili/aziendali) | messaggio esplicito con il suggerimento *"provate sulla stessa rete Wi-Fi"*, più la **sfida asincrona** (§4) che funziona sempre. Un TURN pubblico gratuito esiste e si può aggiungere dopo senza toccare il resto: vedi §12 |
| **Il guest riceve il seed, quindi può calcolare la soluzione** dai devtools | tradeoff accettato: è già così in single player (la soluzione sta in `localStorage`). In una partita tra amici il baro non è la minaccia principale. Nessun anti-cheat serio è possibile senza un server autorevole |
| **Il copia-incolla del codice è attrito reale** | link condivisibile + pulsanti Copia/Condividi + rivincita che riusa il canale (si paga una volta per sessione, non per partita) |
| **Compatibilità WebRTC tra browser** (Safari iOS è il caso delicato) | prova su Chrome desktop, Safari iOS e Firefox come criterio di accettazione della fase 3, non come verifica finale |
| **Il codice compatto potrebbe non ricostruirsi** su qualche browser | piano B già individuato: base64 dell'SDP integrale, nessun impatto sul resto |
| **Regressioni nel single player** dovute al refactor | il refactor precede il multiplayer e si valida da solo: dopo la fase 1 il gioco deve comportarsi in modo indistinguibile da oggi |

---

## 12. Costi

**Il progetto qui descritto non costa nulla e non richiede alcun account.**
Il traffico di gioco viaggia direttamente tra i due dispositivi: non c'è niente da
pagare perché non c'è niente in mezzo.

| Cosa | Costo | Note |
|---|---|---|
| **GitHub Pages** | gratis | per repository pubblici; già in uso oggi |
| **STUN** (`stun.l.google.com:19302`) | gratis, senza account | *best effort*, nessuna garanzia di servizio; serve solo per aprire il canale, non durante la partita. Sulla stessa Wi-Fi è superfluo |
| **Traffico WebRTC** | gratis | P2P: consuma la connessione dei due giocatori, ~250 kB per una partita di 20 minuti |
| **Sfida asincrona** (§4) | gratis | nessuna rete coinvolta |

### Se un giorno servisse un TURN (per le reti che non si collegano)

Esistono TURN gratuiti: l'**Open Relay Project** di Metered offre 20 GB di relay
al mese senza costi, su porte 80/443 con UDP/TCP/TLS — utile proprio dietro i
firewall restrittivi. Per dare una scala: un duello di 20 minuti muove ~250 kB,
quindi 20 GB sono circa **80.000 partite al mese**. Il limite non è il problema.

Due avvertenze vere, che non sono di prezzo:

- le credenziali TURN dentro una pagina statica pubblica sono **leggibili da
  chiunque**, quindi la quota è di fatto condivisa con il mondo. Per un relay
  pubblico e gratuito è accettabile; per uno a pagamento sarebbe un rubinetto
  aperto;
- il traffico passa da un server terzo. Cifrato (DTLS), ma non è più
  strettamente peer-to-peer, e va detto nel README per coerenza con la promessa
  «nessun dato lascia il dispositivo».

Il TURN è una **riga di configurazione** in più negli `iceServers`: si può
aggiungere in qualsiasi momento, dopo, se e solo se i fallimenti di connessione
si dimostrano un problema reale nell'uso quotidiano.

### Se un giorno servisse un relay (join con codice a 4 cifre)

L'opzione scartata in §1 resta gratuita se ce ne fosse bisogno:
**Cloudflare Workers + Durable Objects** include WebSocket nel piano gratuito, con
100.000 richieste al giorno e i messaggi in ingresso conteggiati 20:1 (quelli in
uscita e i ping sono gratis) — per due giocatori è un consumo irrilevante.
Da evitare invece gli hosting che **spengono il servizio per inattività**
(Render gratuito si sospende dopo 15 minuti, con 30–60 s di riavvio a freddo):
un giocatore che apre un invito e aspetta un minuto pensa che l'app sia rotta.
Il piano gratuito di Fly.io non esiste più per i nuovi account.

Resta comunque fuori scope: un relay significa un servizio da mantenere,
aggiornare e sorvegliare — il costo vero è quello, non la fattura.

---

## 13. Fuori scope (per ora, e volutamente)

- Attacchi, sabotaggi, penalità inviate all'avversario. È la via più breve al
  feature creep, e prima serve sapere se una corsa pulita è già divertente.
- Più di due giocatori: il modello host/guest a due è molto più semplice di una
  topologia a N.
- Chat testuale.
- Matchmaking, account, partite pubbliche: richiedono un server.
- Spettatori.

---

## 14. Fasi di consegna

| # | Contenuto | Consegnabile visibile |
|---|---|---|
| # | Contenuto | Stato |
|---|---|---|
| 1 | PRNG seminato, refactor intento/mutazione, avvio pilotato, codice partita | ✅ fatto |
| 2 | `Transport` + `LocalTransport`, protocollo, match, **Duello** completo, ombra avversario, esito, rivincita | ✅ fatto |
| 3 | `RTCTransport`: WebRTC, codifica del codice, lobby, link di invito | ✅ fatto |
| 4 | Statistiche dei duelli, rifiniture, README | ✅ fatto |
| 5 | **Co-op** sulla stessa infrastruttura (§6) | da fare |

Il co-op riusa tutto ciò che c'è: trasporto, protocollo, lobby, countdown,
rivincita. Cambia solo la gestione dello stato condiviso descritta in §6.

---

## 15. Scelte fatte durante la realizzazione

Confermato dal progetto:

- WebRTC P2P senza server, con scambio manuale dell'invito; codice compatto di
  **~235 caratteri** in pratica (stima di §3: 200–400), condiviso come link.
- Host autorevole sull'esito: un solo verdetto, mai due schermi in disaccordo.
- Statistiche dei duelli separate (`sudoku.duel.stats.v1`); la classifica del
  single player non viene toccata.

Deciso strada facendo, sui punti che erano rimasti aperti:

1. **Note in duello: private.** Non vengono trasmesse in alcuna forma.
2. **Nessun tetto di tempo.** Un duello dura quanto serve.
3. **Difficoltà fissa per sessione.** La rivincita usa la stessa difficoltà; per
   cambiarla si torna in lobby.
4. **Sfida asincrona esposta nella UI**, come terza voce del pannello: è la via
   che funziona sempre quando il P2P non si collega, quindi deve essere visibile.

Deciso per necessità, emerso solo scrivendo il codice:

5. **Un duello non si salva.** Ricaricando la pagina il canale è perduto e non
   riapribile senza rifare lo scambio: proporre una ripresa impossibile sarebbe
   peggio che non proporla. La partita in solitaria resta intatta a parte —
   *finché* il duello resta un duello: se lo si abbandona o lo si prosegue da
   soli, quella griglia diventa la partita in corso e prende il posto del
   salvataggio precedente. È la conseguenza voluta di «continua da solo», ma va
   detta: il Sudoku che era in pausa prima del duello in quel caso si perde.
6. **Chi è ancora in gioco batte chi è già fuori.** Se l'avversario esaurisce i 3
   errori si vince anche senza aver completato la griglia — ma senza registrare un
   "miglior tempo", che spetta solo a chi finisce il puzzle.
7. **L'invito funziona anche a gioco già aperto.** Aprire un link `#j=…` con la
   pagina viva cambia solo il frammento e non ricarica nulla: l'evento
   `hashchange` va intercettato, altrimenti il secondo giocatore resta fermo.
8. **Ripiego automatico sul codice lungo.** Se un SDP non ha candidati utilizzabili
   la codifica compatta non è affidabile: si emette direttamente il codice lungo
   invece di produrne uno rotto. Resta anche la casella per forzarlo a mano.
9. **Il codice va letto con tolleranza, l'attesa dei candidati con pazienza.**
   Da una prova reale tra due telefoni sono emersi due errori di progetto miei.
   Il primo: l'attesa dei candidati ICE si fermava a 3 secondi, e la misura dice
   che su molte reti la raccolta non è ancora finita — anzi `iceGatheringState`
   spesso non diventa mai `complete`. Allo scadere veniva pubblicato un codice
   con soli candidati mDNS `.local`, inservibile tra dispositivi diversi: un
   invito nato morto. Ora si esce appena c'è un indirizzo pubblico, altrimenti si
   attende molto più a lungo, e se alla fine non c'è nulla di raggiungibile lo si
   dice invece di far fallire il collegamento in silenzio.
   Il secondo: il prefisso del codice era confrontato con `startsWith('S1:')`,
   sensibile alle maiuscole. La tastiera dell'iPhone lo aveva reso `s1:` e il
   codice veniva rifiutato con un messaggio fuorviante. Il payload è base64url e
   resta sensibile alle maiuscole, ma tutto il resto ora è tollerante: prefisso
   in qualunque caso, spazi e capi di riga, codice dentro un link o dentro una
   frase. Con una precedenza importante: prima il codice come token a sé, poi il
   ripiego a spazi rimossi — invertendole, un codice incollato dentro una frase
   si incollerebbe alle parole vicine e si corromperebbe.
10. **Il ponte c'è, ma spento di serie.** Tre prove reali tra due telefoni hanno
   confermato ciò che §11 dava per rischio: sulla rete mobile il peer-to-peer non
   passa, e nessuna correzione al codice lo aggira. Il TURN è quindi stato
   aggiunto — ma non come si era ipotizzato in §12: il TURN gratuito di Metered
   non ha più credenziali pubbliche statiche, e in ogni caso una credenziale in
   una pagina pubblica è una credenziale regalata. La forma giusta è un piccolo
   Worker che conia credenziali a scadenza tenendo il token dalla propria parte
   (`turn-worker/`), con l'indirizzo in `config.js`. Resta **disattivato in
   assenza di configurazione**, così il comportamento predefinito e la promessa
   sulla riservatezza non cambiano per chi non lo attiva; e se il ponte non
   risponde si prova comunque in diretta, perché un ponte guasto non deve mai
   valere meno di nessun ponte.
11. **Nessuna statistica nella prova su due schede.** Le due schede condividono il
   `localStorage`: la stessa partita verrebbe contata sia come vittoria sia come
   sconfitta, e la seconda scrittura cancellerebbe la prima. In modalità di prova
   non si registra nulla, e la nota nella lobby lo dice. Su due dispositivi reali
   il problema non esiste, perché ognuno ha i suoi dati.

## 16. Verifiche

Provato su Chromium con due contesti separati (due "dispositivi"):

- collegamento WebRTC reale con l'SDP ricostruito dal codice compatto — è la
  verifica che conta, perché dice che la ricostruzione di §3 regge davvero;
- stesso puzzle su entrambi, countdown, ombra avversario, esito coerente sui due
  schermi, rivincita senza riscambio di codici;
- sconfitta per errori esauriti, connessione perduta con le due vie d'uscita,
  vittoria a tavolino, protocollo incompatibile;
- sfida con codice: lo stesso codice dà lo stesso puzzle su dispositivi diversi;
- non-regressione del single player: note, aiuti, annulla, pausa, ripresa dopo
  ricarica, iniziali arcade, classifica, sconfitta al terzo errore.

Resta da provare **Safari iOS**, che è il browser dove la ricostruzione dell'SDP
ha più probabilità di fare storie (§11).
