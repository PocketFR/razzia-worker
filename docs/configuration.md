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

**Perdu ?** Aucun rattrapage par l'interface — changer le mot de passe exige
d'être connecté. Il faut effacer la ligne en base, puis rejouer le script de
déploiement, qui en tirera un nouveau :

```sh
npx wrangler d1 execute razzia --remote \
  --command "DELETE FROM settings WHERE key = 'managerPassword'"
```

## Clés API

Onglet **Paramètres** de `/manager`. Quatre valeurs :

| Clé                     | Rôle                                               |
| ----------------------- | -------------------------------------------------- |
| `MISTRAL_API_KEY`       | Génération de quiz par IA.                         |
| `MISTRAL_MODEL`         | Modèle utilisé, `mistral-large-latest` par défaut. |
| `SPOTIFY_CLIENT_ID`     | Recherche de morceaux, métadonnées, lecture.       |
| `SPOTIFY_CLIENT_SECRET` | Idem. Expire tous les 180 jours.                   |

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
