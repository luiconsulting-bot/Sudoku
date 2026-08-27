/* Endpoint finto che imita la risposta di Cloudflare, per provare il ponte
   senza credenziali vere.

   Lo scambio dei codici, invece, **non è finto**: sotto `/s` gira il codice
   vero del Worker (`turn-worker/worker.js`) su uno SQLite in memoria. Così le
   prove del browser esercitano il servizio che andrà su Cloudflare, non una
   sua imitazione destinata a divergere. */
import { createServer } from 'node:http';
import { scambio } from '../turn-worker/worker.js';
import { creaD1 } from './d1-finto.mjs';

const mode = process.env.MOCK_MODE || 'ok';
const env = { SCAMBIO: creaD1() };

async function serviScambio(req, res, cors) {
  const url = new URL(req.url, 'http://interno');
  const corpo = req.method === 'GET' || req.method === 'HEAD' ? undefined
    : await new Promise((ok) => {
      let dati = '';
      req.on('data', (c) => { dati += c; });
      req.on('end', () => ok(dati));
    });
  const richiesta = new Request('http://interno' + url.pathname, { method: req.method, body: corpo });
  const risposta = await scambio(richiesta, env, cors, url.pathname);
  const testo = await risposta.text();
  res.writeHead(risposta.status, { ...cors, 'Content-Type': 'application/json' });
  res.end(testo);
}

createServer((req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  const percorso = new URL(req.url, 'http://interno').pathname;
  if (percorso === '/s' || percorso.startsWith('/s/')) {
    return serviScambio(req, res, cors).catch((err) => {
      res.writeHead(500, cors);
      res.end(JSON.stringify({ errore: String(err) }));
    });
  }
  if (mode === 'error') { res.writeHead(502, cors); return res.end('{"error":"ko"}'); }
  if (mode === 'garbage') { res.writeHead(200, cors); return res.end('{"nulla":true}'); }
  res.writeHead(200, cors);
  // Forma reale di Cloudflare: iceServers è un OGGETTO, non un array
  res.end(JSON.stringify({
    iceServers: {
      urls: ['stun:turn.example.com:3478', 'turn:turn.example.com:3478?transport=udp'],
      username: 'utente-a-scadenza',
      credential: 'segreto-a-scadenza',
    },
  }));
}).listen(Number(process.env.MOCK_PORT || 8123), () => console.log('mock TURN su ' + (process.env.MOCK_PORT || 8123) + ', modo=' + mode));
