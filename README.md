<p align="center">
  <img width="450" height="120" align="center" src=".github/logo.svg">
</p>

## Ce que c'est

Une plateforme de quiz temps réel — blind test, culture générale — où l'animateur
projette les questions et les joueurs répondent depuis leur téléphone, sans rien
installer.

C'est un **fork de [Razzia](https://github.com/Ralex91/Razzia)** (MIT), porté du
serveur Node d'origine vers **Cloudflare Workers et Durable Objects**. Le portage
a refait trois choses — le transport, le stockage, l'ordonnancement des manches —
et laissé le reste aussi proche de l'amont que possible.

Ce que ce fork ajoute :

- **Hébergement sur le plan gratuit de Cloudflare.** Une soirée consomme quelques
  pour cent des quotas journaliers ; l'hibernation fait qu'un objet ne coûte que
  les secondes où il travaille vraiment.
- **Génération de quiz par IA** à partir d'une phrase, avec les morceaux résolus
  sur Spotify et les questions de culture générale sourcées.
- **Lecture Spotify** intégrée côté animateur, via le Web Playback SDK.
- **Apparence modifiable depuis l'interface** : nom, couleurs, police, logo,
  fond — sans redéployer.
- **Clés API saisies dans le navigateur**, chiffrées au repos. Le secret Spotify
  expire tous les 180 jours : le renouveler ne doit pas demander la ligne de
  commande.

## Prérequis

- Un compte **Cloudflare** (le plan gratuit suffit).
- **Node 22** et **pnpm 10**. Pas node 26 : wrangler y part en erreur de
  segmentation dès le premier appel à l'API.
- Un **jeton d'API Cloudflare** : modèle « Modifier les Workers de Cloudflare »,
  auquel il faut **ajouter** la permission « D1 : Modifier » — elle n'y est pas
  incluse, et c'est l'oubli le plus fréquent.
- Facultatif : un domaine géré par Cloudflare. Sans lui, l'adresse
  `workers.dev` fournie gratuitement fait l'affaire.

## Déploiement

```sh
git clone <votre-fork> razzia && cd razzia
pnpm install

cd packages/worker
CLOUDFLARE_API_TOKEN=<jeton> \
CLOUDFLARE_ACCOUNT_ID=<id du compte> \
DOMAINE=quiz.exemple.fr \
sh scripts/deployer.sh
```

Le script est idempotent : il constate l'existant à chaque étape et se rejoue
sans dommage après un échec. Il crée la base, applique le schéma, pose la clé
maîtresse, **tire un mot de passe animateur au hasard et l'affiche une seule
fois**, construit le frontend et déploie.

Détails, options et pièges : [docs/deploiement.md](docs/deploiement.md).

## Après le déploiement

1. Déclarer `https://<votre-domaine>/spotify/callback` dans les *Redirect URIs*
   de votre application Spotify. Cette adresse est comparée à l'identique ;
   sans elle la connexion échoue sans message exploitable.
2. Ouvrir `/manager`, se connecter avec le mot de passe affiché par le script,
   puis saisir les clés Mistral et Spotify dans l'onglet **Paramètres** — et
   changer le mot de passe au passage.
3. Créer un quiz, à la main ou par IA, dans l'onglet **Quiz**.
4. Lancer une partie : les joueurs rejoignent par QR code ou code à 6 chiffres.

## Documentation

- [Déploiement](docs/deploiement.md) — la procédure complète, et ce qui peut coincer.
- [Configuration](docs/configuration.md) — mot de passe animateur, clés API, où vit quoi.
- [Quiz](docs/quiz.md) — éditeur, génération par IA, import/export, format JSON.
- [Apparence](docs/branding.md) — nom, couleurs, police, images.
- [Protocole WebSocket](docs/protocole-websocket.md) — pour écrire son propre client, un buzzer physique par exemple.

## Licence

MIT, comme l'amont. La mention de copyright de Ralex est conservée dans
[LICENSE](LICENSE), comme la licence l'exige.

Les questions de culture générale proviennent de l'[Open Trivia
Database](https://opentdb.com/), sous licence CC BY-SA 4.0.
