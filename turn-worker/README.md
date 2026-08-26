# Il ponte TURN — cosa fa e come si attiva

Sulla rete mobile il collegamento diretto tra due telefoni spesso **non può
riuscire**: gli operatori usano un NAT che il peer-to-peer non attraversa, e
nessun numero di tentativi lo aggira. Un server TURN risolve il problema
inoltrando i pacchetti per conto dei due giocatori.

Questo Worker esiste per un motivo solo: **le credenziali TURN non possono stare
nella pagina del gioco**, che è pubblica e leggibile da chiunque. Il Worker tiene
il token dalla sua parte e restituisce al gioco solo credenziali che scadono.

Senza questo, il gioco funziona come prima — peer-to-peer puro, che va benissimo
sulla stessa Wi-Fi.

---

## 1. Creare la chiave TURN

Nel pannello Cloudflare: **Realtime → TURN Server Apps → Create**.

> La voce è stata rinominata: la documentazione parla ancora di *TURN key*, la
> dashboard di *TURN Server App*. È la stessa cosa, e produce la stessa coppia di
> valori — che a seconda della schermata compaiono come *Token ID* / *API Token*
> oppure *App ID* / *App Secret*.

| Valore | A cosa serve | Segreto? |
|---|---|---|
| **Token ID** (o *App ID*) | finisce nell'indirizzo della richiesta | no |
| **API Token** (o *App Secret*) | autentica la richiesta | **sì**, non deve mai finire in una pagina web |

**Copia il secondo subito**: molte schermate di Cloudflare lo mostrano una volta
sola, alla creazione.

### Verificare la coppia prima di andare avanti

Non serve aver pubblicato niente per sapere se i due valori sono giusti e nel
verso giusto:

```bash
curl -X POST \
  "https://rtc.live.cloudflare.com/v1/turn/keys/IL_TUO_TOKEN_ID/credentials/generate-ice-servers" \
  -H "Authorization: Bearer IL_TUO_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ttl": 3600}'
```

- Risposta con `"iceServers"` e dentro degli indirizzi `turn:` → **la coppia è
  giusta**, prosegui.
- `401` o `403` → il token non è valido, oppure i due valori sono invertiti:
  quello lungo va nell'intestazione `Authorization`, quello corto nell'indirizzo.
- `404` → il Token ID non esiste: probabilmente hai copiato l'identificativo
  sbagliato dalla dashboard.

Su **Windows** il `curl` di PowerShell è un'altra cosa e le virgolette si
comportano diversamente: usa `curl.exe`, oppure la forma nativa —

```powershell
Invoke-RestMethod -Method Post `
  -Uri "https://rtc.live.cloudflare.com/v1/turn/keys/IL_TUO_TOKEN_ID/credentials/generate-ice-servers" `
  -Headers @{ Authorization = "Bearer IL_TUO_API_TOKEN" } `
  -ContentType "application/json" `
  -Body '{"ttl": 3600}'
```

**Senza terminale**: salta questa verifica, pubblica il Worker (passo 2) e apri
il suo indirizzo nel browser. Risponde in JSON, e se qualcosa non va lo dice con
le stesse indicazioni — è la stessa prova, fatta un passo più avanti.

> Il token non va mai incollato in una chat, in un messaggio o in un file del
> progetto. Se dovesse sfuggirti, rigeneralo dalla dashboard: quello vecchio
> smette di valere.

## 2. Pubblicare il Worker

Due strade. Se il progetto non ce l'hai sul computer — perché il gioco vive su
GitHub Pages e basta — la prima è quella giusta: **non serve installare niente**.

### A. Dal pannello Cloudflare, senza terminale

1. **Workers & Pages → Create → Create Worker**. Chiamalo `sudoku-turn` e premi
   **Deploy** (il codice di esempio va bene, lo sostituiamo subito).
2. **Edit code**: cancella tutto e incolla il contenuto di
   [`worker.js`](worker.js) — su GitHub, dal pulsante *Copy raw file*. Poi
   **Deploy**.
3. **Settings → Variables and Secrets**, aggiungi:

   | Nome | Tipo | Valore |
   |---|---|---|
   | `TURN_KEY_ID` | testo | il valore **corto** del passo 1 |
   | `ALLOWED_ORIGIN` | testo | `https://luiconsulting-bot.github.io` |
   | `TTL` | testo | `3600` |
   | `TURN_KEY_API_TOKEN` | **Secret** | il valore **lungo** del passo 1 |

   Il token va aggiunto come *Secret* (cifrato), non come variabile in chiaro:
   è la ragione per cui questo Worker esiste.
4. **Deploy** di nuovo, perché le variabili siano attive.

L'indirizzo è del tipo `https://sudoku-turn.tuonome.workers.dev` ed è scritto in
cima alla pagina del Worker.

**Verifica subito**: apri quell'indirizzo nel browser. Deve rispondere con un
JSON contenente `iceServers` e degli indirizzi `turn:`. Se invece compare un
messaggio d'errore, lo dice in chiaro cosa non va — di solito i due valori del
passo 1 invertiti.

### B. Da riga di comando, se hai il progetto in locale

```bash
cd turn-worker
npx wrangler deploy

# Il token va messo come segreto, non nel file di configurazione
npx wrangler secret put TURN_KEY_API_TOKEN
```

Il Token ID e l'origine del gioco stanno in `wrangler.toml`, che non contiene
nulla di segreto:

```toml
[vars]
TURN_KEY_ID    = "il-tuo-token-id"
ALLOWED_ORIGIN = "https://luiconsulting-bot.github.io"
TTL            = "3600"
```

## 3. Collegarlo al gioco

Due modi.

**Per provare subito**, senza ripubblicare niente: apri il gioco aggiungendo
l'indirizzo all'URL, una volta sola per telefono —

```
https://luiconsulting-bot.github.io/Sudoku/?turn=https://sudoku-turn.tuonome.workers.dev
```

L'impostazione resta memorizzata su quel telefono. Per toglierla: `?turn=`
(vuoto).

**Per renderlo definitivo**, metti lo stesso indirizzo in `config.js` alla radice
del progetto e pubblica:

```js
window.SUDOKU_CONFIG = {
  turnEndpoint: 'https://sudoku-turn.tuonome.workers.dev',
};
```

## 4. Verificare che funzioni

Apri **👥 → Crea una partita** e guarda il referto sotto il codice:

- `Ponte: attivo` e, tra gli indirizzi trovati, dei **relay** → il ponte funziona.
- `Ponte: non raggiungibile` → il Worker non risponde: controlla l'indirizzo e
  che `ALLOWED_ORIGIN` corrisponda esattamente all'origine da cui apri il gioco.
- `Ponte: non configurato` → il gioco non sa dove chiedere: rivedi il punto 3.

---

## Quanto può costare

Cloudflare chiede un metodo di pagamento per attivare Realtime, ma la soglia
gratuita è **1.000 GB al mese** e oltre quella si paga **$0,05/GB**. La domanda
vera è quanto consuma un duello. Misurato sui messaggi reali del protocollo:

| Messaggio | Dimensione |
|---|---|
| `progress` (una volta al secondo) | 156 byte |
| `ping` / `pong` (ogni 2 secondi) | 12 byte |

Con il sovraccarico di rete nel caso peggiore (SCTP + DTLS + TURN + UDP/IP,
~124 byte a pacchetto) si arriva a **~416 byte al secondo per giocatore**:

| Durata del duello | Traffico inoltrato | Duelli nella soglia gratuita |
|---|---|---|
| 10 minuti | 0,5 MB | ~2.150.000 |
| 20 minuti | 1,0 MB | ~1.075.000 |
| 45 minuti | 2,1 MB | ~478.000 |

**Un duello da venti minuti costa cinque centesimi di millesimo di dollaro**, e
solo se fossi già oltre soglia: servirebbero **oltre ventimila duelli** per un
singolo dollaro. Giocando ogni giorno per tutta la vita non ti avvicineresti al
limite.

E c'è dell'altro: il relay viene usato **solo quando il collegamento diretto
fallisce**. Su Wi-Fi ICE preferisce il percorso diretto e dal ponte non passa
praticamente nulla.

L'unico modo realistico di spendere è che **qualcun altro** usi il tuo Worker per
il proprio traffico. Per questo:

- tieni `ALLOWED_ORIGIN` valorizzato (è già così in `wrangler.toml`);
- imposta una **notifica di spesa** nel pannello Cloudflare: è la rete di
  sicurezza vera, perché ti avvisa prima che il conto salga;
- se qualcosa andasse storto, l'interruttore è immediato: **elimina la chiave
  TURN** o svuota `turnEndpoint`. Il gioco torna al collegamento diretto e
  continua a funzionare — il ponte non è mai indispensabile.
- **L'indirizzo del Worker è pubblico.** `ALLOWED_ORIGIN` scoraggia l'uso da
  altri siti ma non è una barriera: l'intestazione `Origin` la manda il browser
  e chi usa strumenti da riga di comando può scrivere ciò che vuole. Le difese
  reali sono la **scadenza breve** delle credenziali e il fatto che la quota è
  sorvegliata. Se un giorno servisse di più, Cloudflare offre limitazione di
  frequenza sul Worker.
- **Con il ponte attivo il traffico può passare da un server di Cloudflare.**
  Resta cifrato, ma non è più strettamente da dispositivo a dispositivo: se per
  te conta la promessa «nessun dato lascia il dispositivo», questo è il punto in
  cui cambia, e va detto anche nel README principale.
