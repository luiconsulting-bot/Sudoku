#!/usr/bin/env bash
# Esegue tutte le prove. Serve Node e Playwright con Chromium.
#
#   ./test/run.sh            tutte
#   ./test/run.sh test-duel  una sola (anche senza estensione)
#
# Avvia da sé il server statico e l'endpoint TURN finto, e li chiude alla fine.
set -uo pipefail
cd "$(dirname "$0")/.."

PORT=${PORT:-8099}
MOCK_PORT=${MOCK_PORT:-8123}
export APP_URL="http://127.0.0.1:$PORT/index.html"

# Il progetto non ha dipendenze: Playwright serve solo alle prove. Se non è
# risolvibile si prova a collegare quello installato globalmente, così non si
# scarica nulla e node_modules resta fuori dal repository (vedi .gitignore).
dipendenze() {
  node -e "import('playwright')" >/dev/null 2>&1 && return 0
  npm link playwright >/dev/null 2>&1 && node -e "import('playwright')" >/dev/null 2>&1 && return 0
  cat >&2 <<'FINE'
Playwright non è disponibile. Installalo con uno dei due:
  npm i -D playwright && npx playwright install chromium
  npm i -g playwright        (poi ./test/run.sh lo collega da sé)
FINE
  return 1
}

avvia() {
  npx --yes http-server -p "$PORT" -c-1 --silent >/dev/null 2>&1 &
  SERVER=$!
  node test/turn-mock.mjs >/dev/null 2>&1 &
  MOCK=$!
  for _ in $(seq 30); do
    curl -sf -o /dev/null "$APP_URL" && return 0
    sleep 0.3
  done
  echo "il server statico non risponde su $PORT" >&2
  return 1
}

chiudi() { kill "${SERVER:-}" "${MOCK:-}" 2>/dev/null; }
trap chiudi EXIT

dipendenze || exit 1
avvia || exit 1

if [ $# -gt 0 ]; then
  PROVE="test/${1%.mjs}.mjs"
else
  # Le prove pure prima: sono rapide e, se rompono, il resto non serve
  PROVE="test/test-logic.mjs test/test-relay-wait.mjs test/test-trim.mjs
          test/test-solo.mjs test/test-duel.mjs test/test-duel-paths.mjs
          test/test-connect.mjs test/test-flow.mjs test/test-diag.mjs
          test/test-turn.mjs test/test-turn-down.mjs test/test-messaggi.mjs"
fi

FALLITE=0
TOTALE=0
for p in $PROVE; do
  OUT=$(timeout 300 node "$p" 2>&1)
  N=$(printf '%s' "$OUT" | grep -c '^✓')
  TOTALE=$((TOTALE + N))
  if [ $? -eq 0 ] && ! printf '%s' "$OUT" | grep -q 'Error\|✗'; then
    printf '  \033[32m✓\033[0m %-24s %s prove\n' "$(basename "$p" .mjs)" "$N"
  else
    printf '  \033[31m✗\033[0m %-24s %s prove\n' "$(basename "$p" .mjs)" "$N"
    printf '%s\n' "$OUT" | tail -20 | sed 's/^/      /'
    FALLITE=$((FALLITE + 1))
  fi
done

echo
if [ "$FALLITE" -eq 0 ]; then
  echo "Tutte le prove sono passate ($TOTALE controlli)."
else
  echo "$FALLITE file di prova falliti ($TOTALE controlli riusciti)."
fi
exit "$FALLITE"
