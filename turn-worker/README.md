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

Nel pannello Cloudflare: **Realtime → TURN Keys → Create**. Ne escono due valori:

| Valore | Segreto? |
|---|---|
| **Key ID** | no |
| **API Token** | **sì**, non deve mai finire in una pagina web |

## 2. Pubblicare il Worker

```bash
cd turn-worker
npx wrangler deploy

# Il token va messo come segreto, non nel file di configurazione
npx wrangler secret put TURN_KEY_API_TOKEN
```

Il `Key ID` e l'origine del gioco stanno in `wrangler.toml`, che non contiene
nulla di segreto:

```toml
[vars]
TURN_KEY_ID    = "il-tuo-key-id"
ALLOWED_ORIGIN = "https://luiconsulting-bot.github.io"
TTL            = "3600"
```

Al termine `wrangler` stampa l'indirizzo, del tipo
`https://sudoku-turn.tuonome.workers.dev`.

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

## Costi e limiti, detti chiaramente

- Il TURN di Cloudflare ha una **soglia gratuita mensile**, oltre la quale si
  paga a GB. Un duello muove pochissimo — i messaggi sono minuscoli e passano di
  lì solo se il collegamento diretto fallisce — quindi il consumo atteso è
  irrisorio. Ma è la **tua** quota: tienila d'occhio nel pannello Cloudflare.
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
