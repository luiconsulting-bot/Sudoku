/* Endpoint finto che imita la risposta di Cloudflare, per provare il ponte
   senza credenziali vere. */
import { createServer } from 'node:http';
const mode = process.env.MOCK_MODE || 'ok';
createServer((req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
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
