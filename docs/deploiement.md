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

> Une version de ce document affirmait que node 26 faisait planter wrangler en
> erreur de segmentation. C'était faux : les plantages venaient d'une barrette
> de mémoire défaillante sur la machine de développement, remplacée depuis.
> Retesté sur toute la chaîne — appels à l'API Cloudflare, requêtes D1
> distantes, build, déploiement à blanc — node 26 ne pose aucun problème. La
> leçon vaut d'être notée : un symptôme reproductible n'est pas
> nécessairement causé par ce qu'on croit.

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

Le script rappelle les deux dernières actions, qui ne peuvent pas être
automatisées :

1. Déclarer `https://<domaine>/spotify/callback` dans les _Redirect URIs_ de
   l'application Spotify. Spotify compare cette adresse à l'identique et refuse
   l'autorisation sans même rediriger si elle n'y figure pas.
2. Saisir les clés Mistral et Spotify dans `/manager`, onglet **Paramètres**.

Voir [Configuration](configuration.md).

## Mettre à jour

Un simple redéploiement suffit ; le schéma et les données ne bougent pas.

```sh
cd packages/worker && sh scripts/deployer.sh
```

Retour au [sommaire](README.md).
