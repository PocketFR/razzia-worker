# Contribuer

Ce dépôt est un fork de [Razzia](https://github.com/Ralex91/Razzia) porté sur
Cloudflare Workers. Les corrections qui concernent le **jeu lui-même** — règles,
interface, calcul des points — ont probablement leur place en amont plutôt
qu'ici ; celles qui touchent au **portage** — transport, stockage,
ordonnancement, génération par IA, apparence — sont les bienvenues.

## Avant d'ouvrir une pull request

```sh
pnpm install
pnpm run typecheck   # tsc -b : « tsc -p » ne vérifierait rien, voir ci.yml
pnpm lint
pnpm format
```

Les suites d'intégration demandent un serveur local et une base peuplée :

```sh
cd packages/worker
npx wrangler dev --local &
node scripts/smoke-api.mjs http://localhost:8787
```

Le mot de passe animateur de la base locale se passe en argument ou par
`RAZZIA_MDP`.

## Une chose que les tests ne voient pas

`wrangler dev` n'applique **aucune limite de plateforme**. Un décodage qui
coûtait 216 ms de temps processeur — vingt fois le budget du plan gratuit —
passait au vert en local et aurait échoué en production. Pour tout ce qui
manipule de gros volumes dans le Worker, mesurez.

## Le style du code

Les commentaires sont en français et expliquent **pourquoi**, pas quoi. Ceux qui
racontent une décision, un piège rencontré ou une mesure valent bien plus que
ceux qui paraphrasent la ligne suivante.
