# Apparence

Onglet **Apparence** de `/manager`. Nom, police, couleurs, images — sans
redéployer, et sans toucher au code.

## Ce qui se règle

**Identité** — le nom de l'application, qui sert aussi de titre d'onglet et de
pied de page, et la police : une famille et, si besoin, l'adresse d'une feuille
de style (Google Fonts par exemple).

**Couleurs** — principale, secondaire, et les quatre couleurs des boutons de
réponse. Chaque couleur a une pastille et un champ texte. La pastille n'accepte
que la forme `#rrggbb` — c'est une limite du navigateur, pas du CSS ; la forme à
trois chiffres est dépliée pour elle, et le champ texte reste seul maître pour
tout le reste.

**Sons** — la musique jouée sur l'appareil des joueurs pendant qu'ils
répondent. **Éteinte par défaut.** Elle ne se déclenche jamais sur une question
musicale ou vidéo, qui a déjà son son.

**Images** — logo, icône d'onglet, fond d'écran. Soit une adresse, soit un
fichier téléversé. **Une image téléversée l'emporte sur l'adresse du même nom**
— il fallait trancher, et l'inverse aurait donné un fichier accepté qui ne
s'affiche pas. L'effacer rend la main à l'adresse.

Le bouton **Réinitialiser** rend l'apparence livrée avec l'application.

## Les limites des images

1,8 Mo par image, la contrainte venant de D1 qui plafonne une ligne à 2 Mo.
Au-delà, renseigner une adresse externe plutôt qu'un fichier : une grande image
n'a rien à faire dans une base de données.

Formats acceptés : PNG, JPEG, WebP, GIF, AVIF, ICO, et **SVG sous conditions**.

Un SVG n'est pas une image mais un document XML, qui peut porter du script. Il
passe donc un examen — script, gestionnaires d'événements, SMIL,
`foreignObject`, entités XML et références externes sont refusés — et il est
servi sous une `Content-Security-Policy` qui interdit tout, `sandbox` compris.
C'est cette seconde protection qui garantit réellement qu'aucun script ne
s'exécute ; l'examen du contenu vient en plus, jamais à la place.

## Le repli sur les fichiers livrés

Tant que rien n'est enregistré, l'application sert le branding du build,
`packages/web/public/branding/`. Remplacer ces fichiers et redéployer reste
possible, et c'est ce qui s'applique à une installation neuve.

Dès qu'on enregistre depuis l'écran, c'est la base qui fait foi — y compris si
l'on s'est contenté de valider les valeurs préremplies. Modifier les fichiers du
build n'a alors plus d'effet, jusqu'à un **Réinitialiser**.

## Le format du thème

Pour référence, la forme du JSON servi sur `/branding/theme.json` :

```json
{
  "appName": "Mon Quiz",
  "colors": { "primary": "#ff9900", "secondary": "#1a140b" },
  "answerColors": ["#e69f00", "#56b4e9", "#3dbfa0", "#cc79a7"],
  "font": {
    "family": "Rubik",
    "url": "https://fonts.googleapis.com/css2?family=Rubik:wght@300..900&display=swap"
  },
  "logo": "/branding/logo.svg",
  "favicon": "/branding/R.ico",
  "background": "/branding/background.webp",
  "sounds": { "answersMusic": false }
}
```

Tous les champs sont facultatifs ; ce qui est omis garde sa valeur par défaut.
Les images téléversées reçoivent une adresse versionnée
(`/branding/asset/logo?v=<date>`), ce qui autorise une mise en cache définitive :
une image remplacée change d'adresse.

Retour au [sommaire](README.md).
