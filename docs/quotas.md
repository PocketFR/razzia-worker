# Quotas

Ce que l'application consomme sur le plan gratuit de Cloudflare, **mesuré** et
non estimé, et pourquoi l'usage actuel est jugé optimal.

Cette page existe pour que la question ne se repose pas de zéro : plusieurs
pistes d'optimisation ont été explorées, chiffrées, et écartées pour des
raisons qu'il vaut mieux avoir écrites.

## La partie de référence

Tous les chiffres de cette page se rapportent à un même format, celui des
soirées réellement jouées ici :

> **100 joueurs, 150 questions, une seule salle** — soit environ
> **15 550 messages entrants** : 15 000 réponses, 100 connexions, et les
> quelque 450 messages de l'animateur.

La variante courante, **deux relances de 50 questions dans la même salle**,
coûte un tiers de moins : la WebSocket reste ouverte et il y a moitié moins de
réponses. Elle est signalée là où l'écart compte.

Les formules données permettent de recalculer pour un autre format ; `P`
désigne le nombre de joueurs et `Q` celui des questions.

## Les plafonds

|                              | Plan gratuit                 |
| ---------------------------- | ---------------------------- |
| Requêtes Worker              | 100 000 / jour               |
| CPU par requête              | 10 ms                        |
| Sous-requêtes par requête    | 50                           |
| **Écritures Durable Object** | **100 000 lignes / jour**    |
| Lectures Durable Object      | 5 000 000 lignes / jour      |
| D1 — lignes lues / écrites   | 5 000 000 / 100 000 par jour |
| KV — lectures / écritures    | 100 000 / 1 000 par jour     |

**Les requêtes vers les assets statiques sont gratuites et illimitées.** Seuls
les chemins listés dans `run_worker_first` sont facturés — c'est-à-dire le
strictement dynamique.

## Ce qu'une soirée consomme

Deux natures de coût, et elles ne se remplissent pas de la même façon :

|                    | par appareil                          | par partie      | par question           |
| ------------------ | ------------------------------------- | --------------- | ---------------------- |
| **Worker**         | thème, images (1<sup>re</sup> visite) | PIN + WebSocket | rien                   |
| **Durable Object** | —                                     | 1 connexion     | 1 écriture par réponse |

Une fois la WebSocket ouverte, une question ne produit plus **aucune** requête
Worker. Les messages entrants comptent comme requêtes d'objet, mais **à 20 pour
1** : cent réponses valent cinq requêtes.

Pour la partie de référence — 100 joueurs, 150 questions :

|                              | consommation                | part du quota |
| ---------------------------- | --------------------------- | ------------- |
| Requêtes Worker              | ~600                        | 0,6 %         |
| **Écritures Durable Object** | **~16 500**                 | **16 %**      |
| D1                           | quelques dizaines de lignes | négligeable   |

**C'est donc l'écriture d'objet qui borne**, et rien d'autre : environ **six
parties de référence par jour**. Les requêtes Worker ne pourraient être
atteintes qu'à trois cents parties quotidiennes.

## La loi des écritures, mesurée

Relevée sur de vraies parties jouées de bout en bout, en instrumentant
`storage.kv.put` et `setAlarm` :

> écritures ≈ **P × (Q + 2) + 3 Q** &nbsp;&nbsp;(P joueurs, Q questions)

Le « + 2 » par joueur est sa connexion et son inscription ; le « 3 Q », les
transitions de phase. Vérifiée à 10, 20 et 50 joueurs, à 5 et 10 questions :
l'écart au modèle reste sous 3 %.

**Deux relances de 50 questions dans la même salle coûtent un tiers de moins
qu'une partie de 150** — 21 000 lignes contre 31 300 avant l'optimisation
ci-dessous, la WebSocket restant ouverte et les réponses étant deux fois moins
nombreuses.

## L'optimisation qui a été faite

Chaque `setAlarm()` est facturé comme une ligne écrite, et l'objet réarmait
l'alarme à **chaque** écriture d'état — donc à chaque réponse, en réécrivant
la même échéance. Mesuré : les alarmes faisaient exactement la moitié des
écritures, `put` valant toujours `setAlarm + deleteAlarm`.

L'échéance armée est désormais retenue dans l'état, et l'alarme n'est touchée
que lorsqu'elle change (voir `src/game/alarme.ts`). Avant / après, mêmes
parties :

|                           | avant | après |       |
| ------------------------- | ----- | ----- | ----- |
| 10 joueurs × 5 questions  | 182   | 123   | −32 % |
| 20 joueurs × 5 questions  | 322   | 196   | −39 % |
| 20 joueurs × 10 questions | 554   | 336   | −39 % |
| 50 joueurs × 5 questions  | 748   | 430   | −43 % |

Les `put` sont inchangés à une unité près : même travail, seules les alarmes
tombent. Sur la partie de référence, **31 300 lignes deviennent 16 500** — de
trois parties par jour à six.

## La durée, l'autre dimension facturée

Un Durable Object est facturé sur **deux** axes : les écritures ci-dessus, et
le **temps d'horloge pendant lequel il est actif et inéligible à
l'hibernation** — 13 000 GB-s par jour, soit, aux 128 Mo qui lui sont alloués
quoi qu'il en consomme, **104 000 secondes de temps actif** par jour.

Mesuré en chronométrant chaque message entrant :

|                           | messages | moyenne | max   |
| ------------------------- | -------- | ------- | ----- |
| 20 joueurs × 5 questions  | 126      | 0,6 ms  | 2 ms  |
| 20 joueurs × 40 questions | 861      | 1,9 ms  | 5 ms  |
| 50 joueurs × 40 questions | 2 091    | 3,7 ms  | 22 ms |

Le coût par message croît avec l'état : **+0,037 ms par question, +0,060 ms par
joueur**. Extrapolé à la partie de référence, ~10,8 ms par message pour ses
15 550 messages, soit **168 s actives = 21 GB-s = 0,16 %** du budget quotidien.

**L'écriture reste donc la contrainte, cent fois devant la durée.** Et même le
pire cas imaginable tient : un objet qui resterait éveillé trois heures
d'affilée coûterait 1 350 GB-s, soit 10,4 % du jour — encore sous les 16,5 %
des écritures.

**L'hibernation fonctionne, et c'est vérifié en production**, pas seulement
supposé : une session d'essai de plusieurs dizaines de minutes n'a produit que
**52,7 s de `wallTime`**. Un objet qui ne s'endormirait pas en afficherait des
milliers.

Ce qui la préserve : `acceptWebSocket` et non `accept()`, aucun `setTimeout` ni
`setInterval`, et l'alarme comme unique ordonnanceur. Ce qui la suspend : toute
promesse en cours — « as long as there is ongoing work or pending I/O ». Le
seul appel sortant régulier est la mise en file d'un morceau sur une zone
Soundtrack, bornée aux questions de ce service.

**`waitUntil` n'y est pour rien.** Il est **sans effet dans un Durable
Object** — « It does not extend the lifetime of a Durable Object » — et n'y
existe que par compatibilité d'API. Ce qui détache une tâche, c'est l'absence
d'`await` au site d'appel ; ce qui maintient l'objet actif, c'est le travail
lui-même.

## La piste ouverte : les réponses dans l'attachement

C'est la seule optimisation restante qui rapporterait vraiment, et elle n'est
pas écartée — seulement remise.

`serializeAttachment()` **n'est pas facturé comme une écriture** et **survit à
l'hibernation** (16 Ko par connexion). Une réponse pourrait donc vivre dans
l'attachement de la socket du joueur, l'état partagé n'étant écrit qu'à la
clôture de la question, après dépouillement par `getWebSockets()`.

**Le gain : les écritures passent de `P × Q` à `~3 Q`** — de 15 000 à 450 sur
la partie de référence, soit **~1 500 lignes au lieu de 16 500**,
de 16 % à 1,5 % du quota. L'infrastructure existe déjà : l'objet se sert de
`serializeAttachment` pour `{ clientId, role }` et de `getWebSockets(étiquette)`
pour retrouver les sockets d'un joueur.

**Ce qui est perdu, et dans quels cas exactement.** Un attachement disparaît
quand le SERVEUR considère la connexion fermée — pas quand le joueur range son
téléphone. D'où quatre cas, et un seul qui régresse :

|                                                          |                                           |
| -------------------------------------------------------- | ----------------------------------------- |
| téléphone verrouillé, socket encore ouverte côté serveur | réponse comptée                           |
| socket morte mais pas encore détectée                    | réponse comptée                           |
| reconnexion pendant la question                          | sauvée par un vidage sur `webSocketClose` |
| **redémarrage de l'objet en pleine question**            | **réponses perdues**                      |

**LA RÈGLE QUI REND CE COMPROMIS ACCEPTABLE.** Perdre les réponses d'une
question est équitable — personne n'est lésé relativement, le classement ne
change pas — **à condition que ce soit tout ou rien**. Or le vidage sur
`webSocketClose` casse cette propriété : après un redémarrage, ceux qui
s'étaient reconnectés auraient leur réponse en base, les autres non.

Il faudrait donc, au rechargement d'un objet trouvant une question en phase de
réponses, **effacer les réponses partielles**. Le tout-ou-rien devient une
règle explicite du jeu au lieu d'un accident. Sans cette ligne, l'optimisation
introduit une inéquité au lieu de l'éviter.

**Ce qui reste à savoir avant de s'y mettre**, et qui n'est pas mesuré : **à
quelle fréquence un objet redémarre-t-il** hors déploiement. L'hypothèse est
« rarement », et c'est une hypothèse. Elle se lève en journalisant chaque
construction de l'objet sur quelques soirées.

**Pourquoi ce n'est pas fait.** Le gain — de six parties par jour à soixante —
n'a pas d'emploi tant qu'on en joue quelques-unes par soirée, et le coût n'est
plus le risque de perte mais le **risque d'implantation** : cela réécrit
l'enregistrement des réponses, le court-circuit « tout le monde a répondu », le
compteur diffusé et la reconnexion. Trois de ces quatre mécanismes ont déjà
produit des défauts subtils.

Équitable ne veut pas dire invisible, enfin : les joueurs auront vu « réponse
envoyée » et se verront comptés absents. C'est un coût d'animation, pas de
justice.

## Les pistes écartées, et pourquoi

**Grouper les réponses en mémoire** — c'est **incompatible avec l'hibernation**, sur laquelle tout cet
objet est construit : quand il hiberne, _« in-memory state is reset »_, et il
hiberne dès qu'il ne reçoit plus d'événement pendant un court moment. Une
fenêtre de réponses est pleine de ces silences. Un tampon en mémoire y
disparaîtrait sans panne, sans erreur et sans trace.

Ce n'est donc pas une affaire de probabilité de défaillance — c'est le
fonctionnement normal et recherché de l'objet.

**Grouper les réponses dans le stockage** — sans gain : une ligne est facturée
par `put`, quelle que soit sa taille. On écrirait toujours une ligne par
réponse.

**`allowUnconfirmed: true`** — lève l'attente de la porte de sortie, donc
accélère la salve, mais **n'économise aucune ligne**. Et il affaiblit une
garantie réelle : aujourd'hui le compteur de réponses n'est diffusé qu'une fois
l'écriture confirmée sur disque, si bien qu'un joueur qui voit le compteur
bouger sait que sa réponse est persistée.

**Passer le branding sur KV** — cela _retirerait_ de la marge. KV n'accorde que
100 000 lectures par jour, soit exactement le budget de requêtes du Worker, là
où D1 en offre cinquante fois plus. Voir aussi le cache de `theme.json`, qui
ramène trois requêtes D1 à une sans changer de brique.

## Le prochain palier n'est pas une optimisation

Si le besoin venait — plusieurs événements par jour —, le plan payant à **5 $
par mois** fait passer les écritures d'objet de 3 à **50 millions par mois**,
soit environ trois mille parties de référence par mois. Aucune optimisation
restante n'en approche, et aucune ne se paie sans concéder quelque chose.

## Deux règles d'exploitation

**Ne pas déployer pendant une soirée.** Chaque déploiement redémarre les
Durable Objects. C'est la seule éviction que nous provoquons nous-mêmes, et
elle force tous les joueurs à se reconnecter en pleine question.

**Un domaine personnalisé.** L'API Cache n'opère que là ; sur une adresse
`workers.dev`, le thème est reconstruit à chaque affichage. Voir
[Déploiement](deploiement.md).

Retour au [sommaire](README.md).
