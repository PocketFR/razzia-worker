# Quiz

Les quiz vivent en base, plus dans des fichiers. Trois façons d'en obtenir un.

## L'éditeur

Onglet **Quiz** de `/manager`, bouton **Créer manuellement**. On y saisit les
questions, les réponses, la ou les bonnes solutions, les durées, et un média
éventuel.

Pour une question musicale, trois boutons ouvrent le bloc média : **Spotify**,
**Deezer** et **Soundtrack**. On tape un titre, on choisit un résultat, et l'URL du service est
remplie. Un lecteur permet d'écouter le morceau — et, chez Spotify seulement,
de fixer le point de départ.

Les deux coexistent : un même quiz peut mêler des morceaux des deux catalogues,
et chaque question se joue avec le sien. Le bouton Spotify n'apparaît que si
l'identifiant client est configuré ; Deezer ne demande rien.

## La génération par IA

Onglet **Quiz**, bouton **Créer par IA**. On décrit ce qu'on veut en une phrase
— « un blind test de 15 questions sur le rock français des années 80, pour des
joueurs avancés » — et le quiz est écrit, enregistré, et affiché en aperçu.

La génération résout les morceaux sur le service choisi dans l'onglet
**Paramètres** — Spotify, Deezer, ou « automatique », qui prend Spotify s'il est
configuré et Deezer sinon — et source les questions de culture générale sur
l'[Open Trivia Database](https://opentdb.com/) (CC BY-SA 4.0). Comptez une
minute.

Le bouton est grisé tant qu'il manque une clé API — la liste des manquantes
apparaît au survol. Ce sont les mêmes que le serveur exige : Mistral, plus les
clés Spotify si c'est Spotify qui est retenu. Avec Deezer, Mistral suffit.

Ce réglage ne gouverne que la génération : dans l'éditeur les deux catalogues
restent proposés, et la lecture suit toujours l'URL enregistrée dans la
question.

## L'import

Bouton d'import de l'onglet **Quiz**, qui accepte le JSON produit par le bouton
d'export. C'est aussi la voie pour transférer un quiz d'une installation à une
autre.

## Le format

```json
{
  "subject": "Blind Test Rock français 80s",
  "questions": [
    {
      "question": "Quel est le titre de ce morceau ?",
      "answers": ["Cendrillon", "Ça (c'est vraiment toi)", "Un autre monde"],
      "media": { "type": "audio", "url": "spotify:5Aom4pV5XRvO33DrZ5bMLD:45" },
      "solutions": [0],
      "cooldown": 5,
      "time": 20
    },
    {
      "question": "Lesquelles de ces couleurs sont primaires ?",
      "answers": ["Rouge", "Vert", "Bleu", "Jaune"],
      "solutions": [0, 2],
      "cooldown": 5,
      "time": 20,
      "maxPoints": 1500,
      "penalty": 200
    }
  ]
}
```

| Champ       | Rôle                                                                                                                                                           |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `subject`   | Le titre du quiz.                                                                                                                                              |
| `question`  | L'énoncé.                                                                                                                                                      |
| `type`      | `single` (défaut), `multi`, `classement`, `diapo`, ou un pari — `rouge-noir`, `bonneteau`, `pmu`.                                                              |
| `answers`   | De 2 à 4 réponses, jusqu'à 8 pour un `classement`.                                                                                                             |
| `solutions` | Les index des bonnes réponses, à partir de 0. Plusieurs valeurs pour une question à réponses multiples.                                                        |
| `media`     | Facultatif. `type` vaut `image`, `video` ou `audio` ; `url` porte l'adresse.                                                                                   |
| `cooldown`  | Secondes d'affichage de l'énoncé avant les réponses (3 à 15).                                                                                                  |
| `time`      | Secondes pour répondre (5 à 120).                                                                                                                              |
| `maxPoints` | Points d'une bonne réponse. 1000 par défaut.                                                                                                                   |
| `penalty`   | Points retirés à une mauvaise réponse. Aucune par défaut ; le total d'un joueur ne descend jamais sous zéro, et une question sans réponse n'est pas pénalisée. |

L'`id` est attribué à l'enregistrement, il n'a pas à figurer dans le fichier.

## Le classement

`"type": "classement"` : les joueurs rangent les réponses dans l'ordre plutôt
que d'en choisir une — « classez ces chansons par ordre de sortie ». Ils
déplacent une colonne au doigt, à la souris ou aux flèches du clavier.

**Les réponses se saisissent dans le bon ordre, et c'est lui la bonne
réponse** : `solutions` est déduit à l'enregistrement et vaut `[0, 1, 2, …]`.
Rien à cocher dans l'éditeur. À l'écran, l'ordre est mélangé — le serveur
diffuse une graine, chaque appareil en déduit le même ordre, et jamais celui
du quiz.

Le barème note les **paires** : deux éléments sont dans le bon ordre l'un par
rapport à l'autre, ou non. Les trois réglages sont ceux d'une question à choix
multiple :

| Mode      | Ce qui est compté                                             |
| --------- | ------------------------------------------------------------- |
| Strict    | L'ordre exact, ou rien.                                       |
| Équilibré | Les paires bien ordonnées moins les mal ordonnées. Le défaut. |
| Indulgent | Les paires bien ordonnées.                                    |

Sur quatre éléments, échanger deux voisins coûte une paire sur six ; une liste
tournée d'un cran, qui n'a plus aucun élément à sa place, garde la moitié de
ses paires.

L'écran des résultats montre le bon ordre et **combien de joueurs l'ont trouvé
sans la moindre faute**, sur le nombre de réponses reçues — les barres du
dépouillement ordinaire n'auraient rien à dire, chaque réponse étant choisie
une fois par chaque joueur.

## Les morceaux

Une question musicale porte `"type": "audio"` et une URL de la forme :

```
spotify:<identifiant de 22 caractères>
spotify:<identifiant de 22 caractères>:<départ en secondes>
deezer:<identifiant numérique>
soundtrack:<identifiant de 22 caractères>
```

C'est cette URL qui décide du lecteur, et non les réglages : un quiz écrit avec
des identifiants Spotify continue de se jouer par Spotify après une bascule du
réglage de génération. L'en-tête de l'éditeur propose une **conversion** d'un
catalogue à l'autre, qui montre chaque correspondance avant d'écrire quoi que
ce soit.

Dans les deux cas le morceau est lu par l'animateur, jamais par les joueurs :
leur téléphone reste muet, ils entendent le son de la pièce.

|                 | Spotify                                                 | Deezer             | Soundtrack                          |
| --------------- | ------------------------------------------------------- | ------------------ | ----------------------------------- |
| À configurer    | identifiant client, secret, et une connexion par soirée | rien               | rien, ou un jeton pour le mode zone |
| Compte          | Premium exigé                                           | aucun              | aucun, sauf pour le mode zone       |
| Ce qui sort     | le morceau entier                                       | un extrait de 30 s | un extrait, ou le morceau entier    |
| Où              | le navigateur de l'animateur                            | le navigateur      | le navigateur, ou les enceintes     |
| Point de départ | réglable                                                | choisi par Deezer  | choisi par Soundtrack               |

**Le mode zone de Soundtrack** est le seul des trois à couvrir la diffusion en
public : l'animateur appaire une zone sonore dans les paramètres, et le
morceau sort en entier des enceintes du lieu, sous licence. Sans zone, le
comportement est celui de Deezer — un extrait de 30 s dans le navigateur.

L'API Deezer est employée ici dans un **cadre d'usage personnel**,
conformément à ses conditions d'utilisation : c'est le cadre de cette
installation, et il mérite d'être revérifié avant tout autre emploi.

À noter : la musique d'attente ne se superpose jamais à une question `audio` ou
`video`. Elle est de toute façon éteinte par défaut, voir [Apparence](branding.md).

Retour au [sommaire](README.md).
