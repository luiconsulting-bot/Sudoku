/* ============================================================
   Ponte TURN per il duello — Cloudflare Worker
   ============================================================

   Perché esiste: le credenziali TURN non possono stare nella pagina del gioco,
   che è pubblica. Questo Worker le chiede a Cloudflare per conto del giocatore
   e restituisce solo credenziali *a scadenza*, tenendo il token segreto dalla
   propria parte.

   Restituisce la stessa forma che si aspetta net.js: { "iceServers": ... }

   Variabili richieste (vedi README.md):
     TURN_KEY_ID         — id della chiave TURN (non segreto)
     TURN_KEY_API_TOKEN  — token della chiave TURN  ← segreto
     ALLOWED_ORIGIN      — origine del gioco, es. https://tuonome.github.io
     TTL                 — durata delle credenziali in secondi (default 3600)
   ============================================================ */

const CF_API = 'https://rtc.live.cloudflare.com/v1/turn/keys';

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const percorso = new URL(request.url).pathname;

    // `Origin` contiene solo schema e dominio, mai il percorso: un
    // ALLOWED_ORIGIN scritto come "https://tizio.github.io/Sudoku" non
    // combacerebbe mai e rifiuterebbe tutto con un 403 difficile da capire.
    // Si normalizza invece di punire una svista prevedibile.
    const allowed = normalizeOrigin(env.ALLOWED_ORIGIN);

    // Un'origine dichiarata è un filtro utile contro l'uso casuale da altri
    // siti, non una barriera di sicurezza: l'intestazione Origin la manda il
    // browser e chi usa strumenti da riga di comando la scrive come vuole. La
    // difesa vera è che le credenziali durano poco e la quota è sorvegliata.
    const cors = {
      'Access-Control-Allow-Origin': allowed || '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (allowed && origin && origin !== allowed) {
      return json({ error: 'origine non ammessa' }, 403, cors);
    }

    // Lo scambio dei codici vive sotto /s: è un servizio a sé, che non c'entra
    // con le credenziali TURN e non deve poterle disturbare. Tutto il resto
    // risponde come prima, quindi un Worker aggiornato continua a servire i
    // giochi che ancora non lo usano.
    if (percorso === '/s' || percorso.startsWith('/s/')) {
      try {
        return await scambio(request, env, cors, percorso);
      } catch (err) {
        return json({ errore: 'scambio non riuscito', dettaglio: String(err).slice(0, 300) }, 500, cors);
      }
    }

    if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) {
      return json({ error: 'ponte non configurato: mancano TURN_KEY_ID o TURN_KEY_API_TOKEN' }, 500, cors);
    }

    const ttl = Math.max(600, Math.min(86400, Number(env.TTL) || 3600));

    try {
      const res = await fetch(
        `${CF_API}/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ttl }),
        },
      );

      if (!res.ok) {
        const detail = await res.text();
        // I due errori più probabili hanno una causa banale e una diagnosi
        // precisa: meglio dirla che lasciare un numero nudo.
        const hint = res.status === 401 || res.status === 403
          ? 'token rifiutato: controlla TURN_KEY_API_TOKEN, o che i due valori non siano invertiti'
          : res.status === 404
            ? 'TURN_KEY_ID inesistente: è l’identificativo corto, non il token'
            : '';
        return json({
          error: `Cloudflare ha risposto ${res.status}`,
          hint,
          detail: detail.slice(0, 300),
        }, 502, cors);
      }

      const data = await res.json();
      // Si inoltra così com'è: net.js accetta sia l'oggetto sia l'array
      return json(data, 200, {
        ...cors,
        // Le credenziali scadono: non vanno messe in cache più a lungo di così
        'Cache-Control': `private, max-age=${Math.floor(ttl / 2)}`,
      });
    } catch (err) {
      return json({ error: 'ponte irraggiungibile', detail: String(err).slice(0, 300) }, 502, cors);
    }
  },
};

// "https://tizio.github.io/Sudoku/" → "https://tizio.github.io"
function normalizeOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).origin;
  } catch {
    return raw.replace(/\/+$/, ''); // non è un URL intero: si toglie solo la barra
  }
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

// Quanto vive una stanza. Oltre questo un invito non vale più comunque: gli
// indirizzi che contiene sono vecchi.
/* ============================================================
   Lo scambio automatico dei codici — parte del Worker
   ============================================================

   Perché esiste: invito e risposta se li scambiavano i due giocatori a mano,
   copiando e incollando in una chat. Fra copia, invio, incolla, generazione
   della risposta e reinvio passano dai trenta ai novanta secondi — e in quel
   tempo il varco che il router apre verso l'esterno può richiudersi. Peggio:
   una chat *accumula* i codici, e incollare quello del tentativo precedente
   produce un collegamento che viene accettato e non si apre mai.

   Qui il giro diventa: chi invita deposita l'invito e riceve un codice breve;
   chi risponde lo ritira, deposita la risposta; chi invita la raccoglie da sé.
   Due secondi invece di novanta, e niente da copiare.

   Non è un server di gioco: non vede le partite, non tiene niente di
   personale, e le stanze durano una manciata di minuti.
   ============================================================ */

const STANZA_TTL_MS = 15 * 60 * 1000;

// Il codice della stanza si legge ad alta voce e si scrive a mano, quindi
// niente 0/O e 1/I. Trentadue simboli per sei posizioni: un miliardo di
// combinazioni, che con stanze da un quarto d'ora bastano e avanzano.
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LUNGHEZZA = 6;

// Un codice compatto sta in 600 caratteri, uno lungo in 3000. Oltre non è più
// un codice di questo gioco.
const MAX_CODICE = 8000;

function nuovoCodice() {
  const b = new Uint8Array(LUNGHEZZA);
  crypto.getRandomValues(b);
  let s = '';
  for (const n of b) s += ALFABETO[n % ALFABETO.length];
  return s.slice(0, 3) + '-' + s.slice(3);
}

// La tabella si crea da sé: così chi pubblica il Worker non deve aprire la
// console SQL, che è un passo in più dove sbagliare.
let tabellaPronta = false;
async function prepara(db) {
  if (tabellaPronta) return;
  await db.exec('CREATE TABLE IF NOT EXISTS stanze ('
    + 'codice TEXT PRIMARY KEY, '
    + 'invito TEXT NOT NULL, '
    + 'risposta TEXT, '
    + 'ritirato INTEGER NOT NULL DEFAULT 0, '
    + 'creata INTEGER NOT NULL)');
  tabellaPronta = true;
}

const scaduta = (riga) => !riga || Date.now() - riga.creata > STANZA_TTL_MS;

async function leggiCodice(request, campo) {
  let dati;
  try {
    dati = await request.json();
  } catch {
    return { errore: 'corpo della richiesta illeggibile' };
  }
  const valore = dati && dati[campo];
  if (typeof valore !== 'string' || !valore) return { errore: `manca "${campo}"` };
  if (valore.length > MAX_CODICE) return { errore: 'codice troppo lungo' };
  // Non si interpreta il contenuto: al Worker non serve sapere cosa c'è
  // dentro, e non saperlo è la ragione per cui questo pezzo resta piccolo.
  if (!/^S1L?:[A-Za-z0-9_-]+$/.test(valore)) return { errore: 'non è un codice del gioco' };
  return { valore };
}

/* ---------- Le quattro operazioni ---------- */

// Percorsi: /s               stato del servizio (per verificare dal browser)
//           /s/nuova         POST  deposita l'invito, restituisce il codice
//           /s/<codice>      GET   ritira l'invito · PUT ne deposita uno nuovo
//           /s/<codice>/r    POST  deposita la risposta · GET la ritira
// Esportato per le prove: dentro un Worker un export in più viene ignorato,
// e poterlo eseguire fuori dal browser è ciò che rende questo pezzo provabile.
export async function scambio(request, env, cors, percorso) {
  const risposta = (corpo, status = 200) => new Response(JSON.stringify(corpo), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...cors,
    },
  });

  const db = env.SCAMBIO;
  if (!db) {
    return risposta({
      errore: 'scambio non configurato',
      dettaglio: 'manca il collegamento al database D1 chiamato SCAMBIO: '
        + 'vedi turn-worker/README.md, sezione «Lo scambio automatico»',
    }, 501);
  }

  await prepara(db);

  const parti = percorso.split('/').filter(Boolean).slice(1); // toglie "s"
  const metodo = request.method;

  // Stato del servizio: si apre nel browser e si vede se il database risponde
  if (parti.length === 0) {
    const { results } = await db.prepare(
      'SELECT COUNT(*) AS n FROM stanze WHERE creata > ?',
    ).bind(Date.now() - STANZA_TTL_MS).all();
    return risposta({ ok: true, servizio: 'scambio', stanze_attive: results[0].n });
  }

  // Deposita un invito nuovo e conia il codice della stanza
  if (parti[0] === 'nuova' && metodo === 'POST') {
    const { valore, errore } = await leggiCodice(request, 'invito');
    if (errore) return risposta({ errore }, 400);

    // Pulizia alla creazione: nessun lavoro periodico da sorvegliare
    await db.prepare('DELETE FROM stanze WHERE creata < ?')
      .bind(Date.now() - STANZA_TTL_MS).run();

    const codice = nuovoCodice();
    await db.prepare('INSERT OR REPLACE INTO stanze (codice, invito, creata) VALUES (?, ?, ?)')
      .bind(codice, valore, Date.now()).run();
    return risposta({ stanza: codice, dura_ms: STANZA_TTL_MS });
  }

  const codice = String(parti[0] || '').toUpperCase();
  if (!/^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(codice)) {
    return risposta({ errore: 'codice della stanza non valido' }, 400);
  }

  const riga = await db.prepare('SELECT * FROM stanze WHERE codice = ?').bind(codice).first();

  // Ritira l'invito, e segna che qualcuno l'ha preso: da quel momento chi
  // invita smette di rinfrescarlo, perché la risposta sta per arrivare.
  if (parti.length === 1 && metodo === 'GET') {
    if (scaduta(riga)) return risposta({ errore: 'stanza scaduta o inesistente' }, 404);
    await db.prepare('UPDATE stanze SET ritirato = 1 WHERE codice = ?').bind(codice).run();
    return risposta({ invito: riga.invito });
  }

  // Rinfresca l'invito finché nessuno l'ha ritirato. È il motivo per cui
  // questo servizio esiste: un invito raccolto due minuti dopo è già vecchio,
  // e così chi arriva trova sempre indirizzi appena nati.
  if (parti.length === 1 && metodo === 'PUT') {
    if (scaduta(riga)) return risposta({ errore: 'stanza scaduta o inesistente' }, 404);
    if (riga.ritirato) return risposta({ ritirato: true });
    const { valore, errore } = await leggiCodice(request, 'invito');
    if (errore) return risposta({ errore }, 400);
    await db.prepare('UPDATE stanze SET invito = ?, creata = ? WHERE codice = ?')
      .bind(valore, Date.now(), codice).run();
    return risposta({ ritirato: false });
  }

  if (parti[1] === 'r') {
    if (scaduta(riga)) return risposta({ errore: 'stanza scaduta o inesistente' }, 404);

    if (metodo === 'POST') {
      const { valore, errore } = await leggiCodice(request, 'risposta');
      if (errore) return risposta({ errore }, 400);
      await db.prepare('UPDATE stanze SET risposta = ? WHERE codice = ?')
        .bind(valore, codice).run();
      return risposta({ ok: true });
    }

    // Chi invita interroga finché la risposta non c'è. Quando l'ha presa la
    // stanza non serve più: sparisce subito, invece di aspettare la scadenza.
    if (metodo === 'GET') {
      if (!riga.risposta) return risposta({ atteso: true, ritirato: !!riga.ritirato });
      await db.prepare('DELETE FROM stanze WHERE codice = ?').bind(codice).run();
      return risposta({ risposta: riga.risposta });
    }
  }

  return risposta({ errore: 'operazione sconosciuta' }, 404);
}
