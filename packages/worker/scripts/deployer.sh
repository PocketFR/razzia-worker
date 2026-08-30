#!/bin/sh
# Déploiement de razzia sur Cloudflare.
#
#   CLOUDFLARE_API_TOKEN=... sh scripts/deployer.sh [chemin/vers/config]
#
# Idempotent : chaque étape constate l'existant avant d'agir, et rien n'est
# écrasé sans le dire. Peut donc être rejoué après un échec en cours de route.
#
# Le dossier config/ est facultatif : il ne sert qu'à la reprise initiale des
# quiz et des résultats de l'ancienne installation, et n'est repris qu'une
# fois — un second passage refuserait d'écraser des données déjà en base.
set -e

CONFIG_SOURCE="$1"
ICI=$(dirname "$0")
cd "$ICI/.."

if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
  echo "! CLOUDFLARE_API_TOKEN manquant." >&2
  echo "  Créer un jeton avec le modèle « Modifier les Workers de Cloudflare »," >&2
  echo "  auquel il faut AJOUTER la permission « D1 : Modifier » — elle n'y est pas." >&2
  exit 1
fi

echo "== 1. base de données"
if grep -q "REMPLACER_APRES" wrangler.jsonc; then
  echo "   création de la base razzia"
  SORTIE=$(npx wrangler d1 create razzia 2>&1) || {
    echo "$SORTIE" >&2
    echo "! création impossible. Si la base existe déjà, récupérer son id avec" >&2
    echo "  « npx wrangler d1 list » et le reporter dans wrangler.jsonc." >&2
    exit 1
  }
  ID=$(echo "$SORTIE" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)

  if [ -z "$ID" ]; then
    echo "$SORTIE" >&2
    echo "! identifiant introuvable dans la réponse. À reporter à la main." >&2
    exit 1
  fi

  sed -i "s/REMPLACER_APRES_wrangler_d1_create/$ID/" wrangler.jsonc
  echo "   id $ID reporté dans wrangler.jsonc"
else
  echo "   déjà configurée, on garde l'existant"
fi

echo "== 2. schéma"
npx wrangler d1 execute razzia --remote --yes --file schema.sql >/dev/null
echo "   tables créées ou déjà présentes"

echo "== 3. reprise des données"
DEJA=$(npx wrangler d1 execute razzia --remote --yes --json \
  --command "SELECT count(*) AS n FROM quizz" 2>/dev/null \
  | grep -oE '"n":[0-9]+' | grep -oE '[0-9]+' | head -1)

if [ "${DEJA:-0}" -gt 0 ]; then
  echo "   $DEJA quiz déjà en base : reprise ignorée"
elif [ -n "$CONFIG_SOURCE" ]; then
  node scripts/seed-from-config.mjs "$CONFIG_SOURCE" > seed.sql
  npx wrangler d1 execute razzia --remote --yes --file seed.sql >/dev/null
  rm -f seed.sql
  echo "   données reprises depuis $CONFIG_SOURCE"
else
  echo "   aucun dossier config fourni : base laissée vide"
fi

echo "== 4. clé maîtresse"
# Elle chiffre les clés API et signe les sessions. La CHANGER rendrait
# illisibles les clés déjà enregistrées et invaliderait le mot de passe
# animateur converti — d'où la vérification préalable.
if npx wrangler secret list 2>/dev/null | grep -q RAZZIA_MASTER_KEY; then
  echo "   déjà posée, on n'y touche pas"
else
  node -e 'process.stdout.write(
    Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64"))' \
    | npx wrangler secret put RAZZIA_MASTER_KEY
  echo "   clé aléatoire de 32 octets posée"
fi

echo "== 5. build du frontend"
(cd ../.. && pnpm --filter @razzia/web build >/dev/null)
echo "   dist prêt"

echo "== 6. déploiement"
npx wrangler deploy

cat <<'FIN'

== Il reste UNE chose, et elle casse Spotify en silence si on l'oublie

Dans le tableau de bord développeur Spotify, ajouter aux « Redirect URIs » :

    https://quiz.exemple.fr/ia/spotify-callback

L'URL est dérivée de location.origin : sans cette déclaration, la connexion
échoue sans message exploitable.

Puis, dans /manager/config, onglet « Clés API », saisir la clé Mistral et les
identifiants Spotify — c'est le premier essai grandeur nature de l'écran.
FIN
