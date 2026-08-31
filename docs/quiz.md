# Quiz

Les quiz vivent en base, plus dans des fichiers. Trois façons d'en obtenir un.

## L'éditeur

Onglet **Quiz** de `/manager`, bouton **Créer manuellement**. On y saisit les
questions, les réponses, la ou les bonnes solutions, les durées, et un média
éventuel.

Pour une question musicale, le bouton Spotify du bloc média ouvre une recherche :
on tape un titre, on choisit un résultat, et l'URL `spotify:<id>` est remplie.
Un lecteur permet d'écouter le morceau et de fixer le point de départ.

## La génération par IA

Onglet **Quiz**, bouton **Créer par IA**. On décrit ce qu'on veut en une phrase
— « un blind test de 15 questions sur le rock français des années 80, pour des
joueurs avancés » — et le quiz est écrit, enregistré, et affiché en aperçu.

La génération résout les morceaux sur Spotify et source les questions de culture
générale sur l'[Open Trivia Database](https://opentdb.com/) (CC BY-SA 4.0).
Comptez une minute.

Le bouton est grisé tant qu'il manque une clé API — la liste des manquantes
apparaît au survol. Ce sont les mêmes que le serveur exige : Mistral et Spotify.

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
| `answers`   | De 2 à 4 réponses.                                                                                                                                             |
| `solutions` | Les index des bonnes réponses, à partir de 0. Plusieurs valeurs pour une question à réponses multiples.                                                        |
| `media`     | Facultatif. `type` vaut `image`, `video` ou `audio` ; `url` porte l'adresse.                                                                                   |
| `cooldown`  | Secondes d'affichage de l'énoncé avant les réponses (3 à 15).                                                                                                  |
| `time`      | Secondes pour répondre (5 à 120).                                                                                                                              |
| `maxPoints` | Points d'une bonne réponse. 1000 par défaut.                                                                                                                   |
| `penalty`   | Points retirés à une mauvaise réponse. Aucune par défaut ; le total d'un joueur ne descend jamais sous zéro, et une question sans réponse n'est pas pénalisée. |

L'`id` est attribué à l'enregistrement, il n'a pas à figurer dans le fichier.

## Les morceaux Spotify

Une question musicale porte `"type": "audio"` et une URL de la forme :

```
spotify:<identifiant de 22 caractères>
spotify:<identifiant de 22 caractères>:<départ en secondes>
```

Le morceau est lu par l'animateur, via le Web Playback SDK, sur son propre
compte Spotify Premium. Les joueurs n'ont rien à connecter : ils entendent le
son de la pièce.

À noter : la musique d'attente ne se superpose jamais à une question `audio` ou
`video`. Elle est de toute façon éteinte par défaut, voir [Apparence](branding.md).

Retour au [sommaire](README.md).
