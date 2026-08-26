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
    const allowed = env.ALLOWED_ORIGIN || '';

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
        return json({ error: `Cloudflare ha risposto ${res.status}`, detail: detail.slice(0, 300) }, 502, cors);
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

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}
