# Configuration

Il n'y a plus de dossier `config/`. Tout vit dans la base **D1** de
l'installation, et tout se règle depuis l'écran `/manager`.

## Mot de passe animateur

Il garde l'accès à la configuration, à l'édition des quiz et au lancement des
parties. Le script de déploiement en tire un au hasard au premier passage et
l'affiche **une seule fois**.

Il se change ensuite dans `/manager`, onglet **Paramètres**. Le mot de passe
actuel est exigé même si la session est valide : un écran laissé ouvert ne doit
pas suffire à verrouiller quelqu'un hors de chez lui.

Il n'est jamais stocké en clair au-delà de la première connexion. La valeur
initiale est convertie en empreinte à clé (`hmac$…`) dès qu'elle sert, sur le
même chemin que celui qui reprenait un ancien `config/game.json`.

**Perdu ?** Écrivez le nouveau **en clair** dans la base. La première
connexion réussie le convertira en empreinte, et le clair disparaîtra.

```sh
npx wrangler d1 execute razzia --remote \
  --command "UPDATE settings SET value = 'MonNouveauMotDePasse'
             WHERE key = 'managerPassword'"
```

Puis connectez-vous sur `/manager` avec cette valeur. Rien d'autre à faire :
ni script de déploiement à rejouer, ni redéploiement.

C'est le même chemin que celui qui reprenait un ancien `config/game.json` — la
valeur en clair n'est qu'un état transitoire, et une saisie erronée ne la
convertit pas, elle reste donc utilisable jusqu'à la bonne.

Deux remarques :

- **N'effacez pas la ligne**, écrivez dedans. Une case vide ferme l'accès au
  lieu de l'ouvrir, et il n'y a alors plus de porte du tout.
- Le mot de passe est lisible en base entre l'écriture et la première
  connexion. Ça ne l'expose qu'à qui a déjà accès à la base — c'est-à-dire à
  vous — mais autant ne pas laisser traîner.

Comme tout changement, il **invalide les sessions en cours** : les onglets
ouverts sous l'ancien mot de passe sont déconnectés.

## Clés API

Onglet **Paramètres** de `/manager`. Huit valeurs :

| Clé                     | Rôle                                                      |
| ----------------------- | --------------------------------------------------------- |
| `MISTRAL_API_KEY`       | Génération de quiz par IA.                                |
| `MISTRAL_MODEL`         | Modèle utilisé, `mistral-large-latest` par défaut.        |
| `MUSIC_PROVIDER`        | Catalogue interrogé par la génération : `auto` (défaut),  |
|                         | `spotify`, `deezer` ou `soundtrack`.                      |
| `SOUNDTRACK_API_TOKEN`  | Facultatif. Jeton partenaire, à demander à Soundtrack.    |
| `SOUNDTRACK_REFRESH`    | Posé par le bouton « Connecter ». Jamais saisi à la main. |
| `SOUNDTRACK_ZONE`       | Facultatif. La zone où sortir le son, choisie dans une    |
|                         | liste.                                                    |
| `SPOTIFY_CLIENT_ID`     | Recherche de morceaux, métadonnées, lecture.              |
| `SPOTIFY_CLIENT_SECRET` | Idem. Expire tous les 180 jours.                          |

Deezer et Soundtrack n'ont pas de clé, et c'est leur principal intérêt : leurs
catalogues répondent sans authentification. `auto` retient donc Spotify si ses
deux clés sont présentes, et Deezer sinon — une installation neuve a de la
musique avant d'avoir ouvert cet écran. Soundtrack, lui, ne se choisit
qu'explicitement : le retenir d'office changerait le catalogue d'installations
existantes sans que personne l'ait demandé.

Les réglages Soundtrack sont facultatifs et n'ouvrent qu'une chose : la
lecture **par zone sonore**, où le morceau sort en entier des enceintes du
lieu sous licence de diffusion, au lieu de l'extrait de 30 s joué dans le
navigateur. Chaque zone est un abonnement chez Soundtrack.

**Deux voies pour s'authentifier**, et le mot de passe n'est stocké dans
aucune :

1. **Un jeton partenaire**, à demander à Soundtrack. C'est la voie qu'ils
   recommandent pour la production.
2. **Une session utilisateur** — le bouton « Connecter » de l'écran. Les
   identifiants partent une fois au serveur, qui les échange contre un jeton
   de rafraîchissement ; lui seul est conservé, scellé comme les autres
   secrets. Le mot de passe n'entre jamais en base. Se révoque en le changeant
   chez Soundtrack.

Soundtrack déconseille la seconde en production : « if it's abused that user
can be rate limited or suspended ». C'est le compte de l'animateur qui est
exposé, pas une application — d'où le jeton partenaire, prioritaire dès qu'il
existe.

Ce réglage ne concerne que la génération. Dans l'éditeur les deux catalogues
restent proposés côte à côte, et la lecture suit l'URL enregistrée dans chaque
question : basculer ici ne rend aucun quiz injouable.

Trois règles gouvernent cet écran :

**Chiffrées au repos.** Les valeurs sensibles sont scellées en AES-GCM avec une
clé dérivée de `RAZZIA_MASTER_KEY`, qui reste un vrai secret Worker et ne tourne
jamais. Une fuite de la base seule ne livre rien.

**En écriture seule.** Aucune valeur secrète ne ressort de l'API : l'écran
affiche « définie, modifiée le… », jamais la valeur. Un champ laissé vide
signifie « ne pas changer » ; c'est le bouton dédié qui efface.

**Repli sur la liaison.** À la lecture, la valeur en base d'abord, sinon celle
du binding Worker. Un premier déploiement fonctionne donc sans passer par
l'écran, et la rotation s'y fait ensuite.

`SPOTIFY_CLIENT_ID` fait exception et n'est pas chiffré : le flux PKCE l'expose
de toute façon au navigateur.

## Le seul secret hors interface

`RAZZIA_MASTER_KEY`, posée par le script de déploiement en secret Worker. Deux
clés en sont dérivées par usage — une pour signer les sessions animateur, une
pour sceller les clés API. **La changer rendrait illisibles toutes les clés
enregistrées et invaliderait le mot de passe animateur.**

## Ce que contient la base

| Table      | Contenu                                           |
| ---------- | ------------------------------------------------- |
| `quizz`    | Les quiz, en JSON.                                |
| `results`  | Le classement de chaque manche terminée.          |
| `settings` | Mot de passe animateur, clés API scellées, thème. |
| `games`    | L'index PIN → partie, purgé chaque nuit.          |
| `branding` | Logo, icône et fond, en binaire.                  |

L'état vivant d'une partie ne s'y trouve pas : il vit dans le stockage du
Durable Object et disparaît avec la salle.

## Sauvegarde

D1 propose _Time Travel_, une restauration à la minute près, toujours active et
sans configuration — 7 jours sur le plan gratuit, 30 sur le payant. La
restauration porte sur la base entière, jamais sur une table ou une ligne.

Pour un quiz précis, le bouton d'export de l'onglet **Quiz** le sort en JSON.

Voir aussi [Quiz](quiz.md) et [Apparence](branding.md).

Retour au [sommaire](README.md).

## Stockage des Durable Objects

L'état d'une partie vit dans le stockage de son Durable Object, et l'objet
s'efface lui-même une fois la salle vide. Rien ne permet d'énumérer ces objets,
et Cloudflare n'en ramasse aucun : la mesure agrégée du stockage est donc le
seul détecteur de fuite disponible.

```sh
CLOUDFLARE_API_TOKEN=… node packages/worker/scripts/stockage-do.mjs 14
```

Au repos, elle doit être nulle. Une valeur non nulle est normale pendant une
partie et jusqu'à la fin de la grâce ; elle ne l'est plus si elle persiste
alors que personne ne joue.

Le même graphique existe dans le tableau de bord Cloudflare : **Durable
Objects**, sélectionner l'espace de noms, onglet **Metrics**, courbe « Total
storage ». Elle n'apparaît que pour les espaces de noms adossés à SQLite, ce
qui est le cas ici. Le détail par objet n'est pas proposé — Cloudflare ne
l'expose pas.
