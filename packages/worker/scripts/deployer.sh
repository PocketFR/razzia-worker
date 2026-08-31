#!/bin/sh
# Déploiement de razzia sur Cloudflare.
#
#   CLOUDFLARE_API_TOKEN=... DOMAINE=quiz.exemple.fr \
#     sh scripts/deployer.sh [chemin/vers/config]
#
# Idempotent : chaque étape constate l'existant avant d'agir, et rien n'est
# écrasé sans le dire. Peut donc être rejoué après un échec en cours de route.
#
# Node 22 au minimum, éprouvé jusqu'à node 26.
#
# Le dossier config/ est facultatif : il ne sert qu'à la reprise initiale des
# quiz et des résultats de l'ancienne installation, et n'est repris qu'une
# fois — un second passage refuserait d'écraser des données déjà en base.
#
# DOMAINE est FACULTATIF. Sans lui, l'application répond sur l'adresse
# workers.dev que Cloudflare fournit gratuitement — ce qui suffit, et n'exige
# pas de posséder un domaine. Avec lui, elle répond sur ce nom, qui doit être
# géré par Cloudflare.
#
# ATTENTION SUR UN COMPTE NEUF : le sous-domaine workers.dev n'existe qu'après
# une première visite à la page Workers du tableau de bord. Aucune API ne le
# crée. Le script le dit s'il tombe dessus, mais autant le savoir avant.
#
# CLOUDFLARE_ACCOUNT_ID est utile dès qu'une machine a déployé sur plusieurs
# comptes : wrangler garde un cache local et vise sinon le mauvais.
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

# La configuration porte le domaine et l'identifiant de base de CETTE
# installation : elle n'est pas versionnée, seul le gabarit l'est.
# Compte les lignes rendues par une requête, en lisant vraiment le JSON.
#
# La version précédente cherchait le motif "n":<chiffres> avec grep. Wrangler
# rend du JSON INDENTÉ — « "n": 9 », avec une espace — donc le motif ne
# correspondait jamais et le compte valait toujours zéro. Silencieusement : la
# reprise des données se croyait devant une base vide alors qu'elle contenait
# neuf quiz. Trouvé en rejouant le script de bout en bout, pas en le relisant.
compter() {
  npx wrangler d1 execute razzia --remote --yes --json --command "$1" 2>/dev/null \
    | node -e 'let e="";process.stdin.on("data",d=>e+=d).on("end",()=>{
        try{const r=JSON.parse(e);const l=(Array.isArray(r)?r[0]:r).results[0]
        process.stdout.write(String(Object.values(l)[0]))}catch{process.stdout.write("")}})' \
    2>/dev/null || true
}

echo "== 1. configuration locale"
if [ ! -f wrangler.jsonc ]; then
  cp wrangler.jsonc.example wrangler.jsonc
  echo "   wrangler.jsonc créé depuis le gabarit"
else
  echo "   wrangler.jsonc déjà présent, on garde l'existant"
fi

echo "== 2. adresse publique"
if grep -q '"routes"' wrangler.jsonc; then
  DOMAINE=$(grep -o '"pattern": "[^"]*"' wrangler.jsonc | head -1 | cut -d'"' -f4)
  echo "   déjà configurée : $DOMAINE"
elif [ -n "$DOMAINE" ]; then
  # On remplace la ligne workers.dev par une route de domaine dédié. Les deux
  # peuvent coexister chez Cloudflare, mais garder l'adresse workers.dev
  # laisserait une seconde porte d'entrée que personne ne surveille.
  sed -i "s|\"workers_dev\": true,|\"routes\": [{ \"pattern\": \"$DOMAINE\", \"custom_domain\": true }],|" wrangler.jsonc
  echo "   $DOMAINE reporté dans wrangler.jsonc"
else
  DOMAINE=""
  echo "   aucun domaine fourni : l'adresse workers.dev de Cloudflare servira"
  echo "   (pour un nom à vous, relancer avec DOMAINE=quiz.exemple.fr)"
fi

echo "== 3. base de données"
if grep -q "REMPLACER_APRES" wrangler.jsonc; then
  # Une base « razzia » peut déjà exister — configuration égarée, dépôt
  # recloné. En créer une seconde donnerait une installation vide à côté des
  # données réelles, ce qui est le pire des résultats : rien n'échoue, tout a
  # disparu. On regarde donc d'abord.
  EXISTANTE=$(npx wrangler d1 list --json 2>/dev/null \
    | node -e 'let e="";process.stdin.on("data",d=>e+=d).on("end",()=>{
        try{const b=JSON.parse(e).find(b=>b.name==="razzia")
        if(b)process.stdout.write(b.uuid)}catch{}})' 2>/dev/null || true)

  if [ -n "$EXISTANTE" ]; then
    sed -i "s/REMPLACER_APRES_wrangler_d1_create/$EXISTANTE/" wrangler.jsonc
    echo "   base razzia déjà présente, réutilisée ($EXISTANTE)"
  else
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
  fi
else
  echo "   déjà configurée, on garde l'existant"
fi

echo "== 4. schéma"
npx wrangler d1 execute razzia --remote --yes --file schema.sql >/dev/null
echo "   tables créées ou déjà présentes"

echo "== 5. reprise des données"
DEJA=$(compter "SELECT count(*) AS n FROM quizz")

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

echo "== 6. clé maîtresse"
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

# SANS CETTE ÉTAPE, UNE INSTALLATION NEUVE EST DÉFINITIVEMENT VERROUILLÉE.
# L'écran animateur exige un mot de passe, et le changer exige d'être déjà
# connecté : sans première valeur, il n'y a aucune porte. Elle n'arrivait
# jusqu'ici que par la reprise d'un ancien config/game.json, que personne
# d'autre n'a.
#
# Le mot de passe est écrit EN CLAIR, comme le faisait l'amont : la première
# connexion réussie le convertit en empreinte à clé. C'est le même chemin de
# migration que pour les installations reprises.
echo "== 7. mot de passe animateur"
DEJA_MDP=$(compter "SELECT count(*) AS n FROM settings WHERE key = 'managerPassword'")

if [ "${DEJA_MDP:-0}" -gt 0 ]; then
  echo "   déjà défini, on n'y touche pas"
else
  # Alphabet sans caractère ambigu ni guillemet : la valeur part dans une
  # requête SQL, et se lit à voix haute au moment de la première connexion.
  MDP=$(node -e 'const a="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    process.stdout.write(Array.from(crypto.getRandomValues(new Uint8Array(16)),
      o => a[o % a.length]).join(""))')

  # ON CONFLICT DO NOTHING plutôt qu'un INSERT nu : si le comptage se trompait
  # encore, cette requête ne pourrait toujours pas écraser un mot de passe en
  # place — elle ne ferait rien. Perdre l'accès à une installation vivante
  # serait bien pire que d'afficher un mot de passe inutile.
  npx wrangler d1 execute razzia --remote --yes \
    --command "INSERT INTO settings (key, value, encrypted, updated_at)
               VALUES ('managerPassword', '$MDP', 0, $(date +%s)000)
               ON CONFLICT(key) DO NOTHING" >/dev/null

  echo "   mot de passe initial tiré au hasard :"
  echo
  echo "       $MDP"
  echo
  echo "   Il ne sera plus affiché. Le changer depuis /manager, onglet"
  echo "   « Paramètres », une fois connecté."
fi

echo "== 8. build du frontend"
(cd ../.. && pnpm --filter @razzia/web build >/dev/null)
echo "   dist prêt"

echo "== 9. déploiement"
SORTIE_DEPLOI=$(npx wrangler deploy 2>&1) || {
  echo "$SORTIE_DEPLOI" >&2

  # Sur un compte tout neuf, le sous-domaine workers.dev n'existe pas encore,
  # et il ne se crée QUE par une visite au tableau de bord. Rien dans l'API ne
  # permet de le provoquer. Le message de Cloudflare est correct mais noyé
  # dans la sortie ; on le remonte, parce que c'est le seul obstacle qui
  # demande une action humaine et qu'il tombe à la toute dernière étape.
  if echo "$SORTIE_DEPLOI" | grep -q "workers.dev subdomain"; then
    echo >&2
    echo "! Ce compte Cloudflare n'a pas encore de sous-domaine workers.dev." >&2
    echo "  Il se crée en ouvrant UNE FOIS la page Workers du tableau de bord :" >&2
    echo "      https://dash.cloudflare.com/ -> Compute (Workers)" >&2
    echo "  Puis relancer ce script : tout le reste est déjà en place." >&2
    echo >&2
    echo "  Ou, pour éviter cette étape, utiliser un domaine à vous :" >&2
    echo "      DOMAINE=quiz.exemple.fr sh scripts/deployer.sh" >&2
  fi

  exit 1
}
echo "$SORTIE_DEPLOI"

# Sans domaine à soi, l'adresse n'est connue qu'ici : c'est Cloudflare qui la
# compose à partir du nom du compte.
if [ -z "$DOMAINE" ]; then
  DOMAINE=$(echo "$SORTIE_DEPLOI" \
    | grep -oE '[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev' | head -1)
fi

cat <<FIN

== Il reste UNE chose, et elle casse Spotify en silence si on l'oublie

Dans le tableau de bord développeur Spotify, ajouter aux « Redirect URIs » :

    https://$DOMAINE/spotify/callback

Cette adresse est comparée à l'identique par Spotify, qui refuse
l'autorisation sans même rediriger si elle n'y figure pas — et l'échec ne
donne aucun message exploitable.

Puis, dans /manager, onglet « Paramètres », saisir la clé Mistral et les
identifiants Spotify. C'est le premier essai grandeur nature de cet écran.
FIN
