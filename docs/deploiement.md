# Déploiement

Tout passe par `packages/worker/scripts/deployer.sh`. Le script est idempotent :
chaque étape constate l'existant avant d'agir, rien n'est écrasé sans le dire, et
il se rejoue sans dommage après un échec en cours de route.

## La commande

```sh
cd packages/worker

CLOUDFLARE_API_TOKEN=<jeton> \
DOMAINE=quiz.exemple.fr \
sh scripts/deployer.sh [chemin/vers/config]
```

| Variable                | Rôle                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Obligatoire. Modèle « Modifier les Workers de Cloudflare » **plus** la permission « D1 : Modifier », qui n'est pas incluse dans le modèle.  |
| `CLOUDFLARE_ACCOUNT_ID` | Facultatif : déduit du jeton. À fournir seulement si le jeton voit plusieurs comptes — le script le dit alors, et les liste.                |
| `DOMAINE`               | Facultatif. Sans lui, l'adresse `workers.dev` sert. Le domaine doit être géré par Cloudflare.                                               |
| `[chemin/vers/config]`  | Facultatif, et à usage unique : reprend les quiz et résultats d'une ancienne installation Razzia. Ignoré si la base contient déjà des quiz. |

**Node 22 au minimum**, éprouvé jusqu'à node 26.

C'est **wrangler seul** qui impose ce plancher, et il ne s'en accommode pas :
son script d'entrée refuse de se lancer sous une version plus ancienne.

```
Wrangler requires at least Node.js v22.0.0. You are using v20.19.2.
```

Le reste de la chaîne se contenterait de node 20.19 — vite, oxlint, vitest et
typescript l'acceptent — mais sans wrangler il n'y a ni déploiement, ni
`wrangler dev`, ni administration de la base.

**Debian stable n'est donc pas suffisante en l'état** : Trixie livre nodejs
20.19, et l'application ne se déploiera pas avec.

### Installer node et pnpm sur Debian Trixie

Le paquet `nodejs` de Debian reste en 20.19 ; on prend donc node chez
NodeSource, qui n'entre pas en conflit avec lui.

```sh
sudo apt-get install -y curl ca-certificates
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

node -v   # doit afficher v22.x ou plus
```

`setup_24.x` fonctionne aussi ; la CI éprouve node 22 et node 26.

Puis pnpm. **Corepack n'est plus livré avec node** — il a été retiré des
distributions officielles —, donc on passe par npm, qui lui est toujours là :

```sh
sudo npm install -g pnpm

pnpm -v   # 9 ou plus : le verrou du dépôt est en lockfileVersion 9
```

**Sans rien installer sur la machine**, un conteneur suffit pour les seules
commandes qui exigent node :

```sh
docker run --rm -v "$PWD":/w -w /w node:22 sh -c "npm i -g pnpm && pnpm install"
```

## Les neuf étapes

1. **Configuration locale** — `wrangler.jsonc` est créé depuis
   `wrangler.jsonc.example` s'il n'existe pas. Ce fichier porte le domaine et
   l'identifiant de base d'**une** installation : il n'est pas versionné.
2. **Adresse publique** — `workers.dev` par défaut, ou la route de domaine
   dédié si `DOMAINE` est fourni.
3. **Base de données** — cherche d'abord une base D1 nommée `razzia` avant d'en
   créer une. Ce garde-fou compte : sans lui, une configuration égarée donnait
   une installation vide à côté des données réelles, sans qu'aucune erreur ne
   le signale.
4. **Schéma** — `schema.sql`, en `CREATE TABLE IF NOT EXISTS`.
5. **Reprise des données** — seulement si un dossier config est fourni et que la
   base est vide.
6. **Clé maîtresse** — `RAZZIA_MASTER_KEY`, 32 octets aléatoires, posée en
   secret Worker. **La changer rendrait illisibles les clés API enregistrées et
   invaliderait le mot de passe animateur** : le script vérifie donc d'abord.
7. **Mot de passe animateur** — tiré au hasard et **affiché une seule fois**, si
   aucun n'existe. Sans cette étape, une installation neuve serait murée :
   l'écran animateur exige un mot de passe, et le changer exige d'être déjà
   connecté.
8. **Build du frontend**.
9. **Déploiement**.

## Ce qui peut coincer

**Sur un compte Cloudflare neuf, il n'y a pas de sous-domaine `workers.dev`.**
Il ne se crée qu'en ouvrant une fois la page Workers du tableau de bord ; aucune
API ne le provoque. Le déploiement échoue alors à la toute dernière étape. Le
script remonte ce cas explicitement. Fournir `DOMAINE` évite complètement le
problème : une route de domaine dédié n'a pas besoin de `workers.dev`.

**Le jeton sans la permission D1** échoue à l'étape 3 sur une erreur
d'authentification laconique.

**Wrangler garde un cache de compte** dans `.wrangler`. Sur une machine ayant
déjà déployé ailleurs, il visait le compte précédent et rendait une erreur
d'authentification sans rapport visible avec la cause. Le script pose
maintenant `CLOUDFLARE_ACCOUNT_ID` lui-même, ce qui tranche la question pour
toutes les commandes qui suivent.

**Une copie de travail vaut une installation.** `wrangler.jsonc` n'étant pas
versionné et ne décrivant qu'un déploiement, en gérer deux depuis le même
dossier demande de le mettre de côté entre deux passages, ou de garder un
fichier par compte et de le passer à wrangler avec `-c`.

## Après le déploiement

Le script rappelle les dernières actions, qui ne peuvent pas être
automatisées :

1. Saisir la clé Mistral dans `/manager`, onglet **Paramètres**. Elle suffit à
   générer des quiz : à défaut de clés Spotify, la musique passe par Deezer,
   qui ne demande ni compte ni configuration.
2. Pour employer Spotify plutôt que Deezer : déclarer
   `https://<domaine>/spotify/callback` dans les _Redirect URIs_ de
   l'application Spotify — comparée à l'identique, elle refuse l'autorisation
   sans même rediriger si elle n'y figure pas — puis saisir ses deux clés.

Voir [Configuration](configuration.md).

## Sans domaine : ce qui change

L'application fonctionne sur l'adresse `workers.dev` que Cloudflare fournit,
et c'est un déploiement légitime. Une seule chose y est différente, et elle est
invisible : **l'API Cache n'y opère pas**. Cloudflare ne l'accorde qu'aux
Workers déployés sur un domaine personnalisé.

Le thème de branding est donc reconstruit à chaque affichage — trois requêtes
D1 au lieu d'une, sur le chemin du premier rendu de chaque joueur. Rien ne
casse, rien ne le signale non plus. C'est une raison de plus de brancher un
domaine, sans en être une obligation. Voir [Quotas](quotas.md).

## Mettre à jour

Un simple redéploiement suffit ; le schéma et les données ne bougent pas.

```sh
cd packages/worker && sh scripts/deployer.sh
```

Retour au [sommaire](README.md).

## Plusieurs installations : attention aux migrations

La liste `migrations` de `wrangler.jsonc` décrit **l'histoire d'une
installation**, pas le code. Cloudflare y applique les tags que cette
installation n'a pas encore vus.

Dériver la configuration d'une instance pour en déployer une autre — en
changeant seulement l'identifiant D1 et le domaine — lui fait donc rejouer des
migrations qui ne la concernent pas. Si l'une d'elles est un
`deleted_classes`, **l'espace de noms de la seconde instance et tout son
stockage sont détruits**, sans retour. C'est arrivé.

**Un fichier par installation**, donc, et jamais une modification au vol du
fichier de l'autre :

```sh
cd packages/worker
wrangler deploy                          # l'installation principale
wrangler deploy -c wrangler.ccpda.jsonc  # une autre, avec sa propre base
```

Tous les `wrangler.*.jsonc` sont ignorés par git — ils portent le domaine et
l'identifiant de base de chaque installation. Seul `wrangler.jsonc.example`
est versionné.

Avant tout déploiement sur une instance qu'on ne déploie pas tous les jours,
**relever son tag courant** et le comparer au dernier de la liste :

```sh
curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$ID/workers/services/razzia" \
  | jq -r .result.default_environment.script.migration_tag
```

S'ils sont égaux, le déploiement n'applique aucune migration. S'ils diffèrent,
lire ce qui sera rejoué **avant** de lancer quoi que ce soit.

Une installation neuve n'a besoin que de `v1`. Vérifiez la liste avant chaque
déploiement vers une instance qui n'est pas celle d'où vient le fichier.
