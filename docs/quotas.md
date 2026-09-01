# Quotas

Ce que l'application consomme sur le plan gratuit de Cloudflare, **mesuré** et
non estimé, et pourquoi l'usage actuel est jugé optimal.

Cette page existe pour que la question ne se repose pas de zéro : plusieurs
pistes d'optimisation ont été explorées, chiffrées, et écartées pour des
raisons qu'il vaut mieux avoir écrites.

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

Pour un format de 100 joueurs et 150 questions :

|                              | consommation                | part du quota |
| ---------------------------- | --------------------------- | ------------- |
| Requêtes Worker              | ~600                        | 0,6 %         |
| **Écritures Durable Object** | **~16 500**                 | **16 %**      |
| D1                           | quelques dizaines de lignes | négligeable   |

**C'est donc l'écriture d'objet qui borne**, et rien d'autre : environ **six
parties de ce format par jour**. Les requêtes Worker ne pourraient être
atteintes qu'à trois cents parties quotidiennes.

## La loi des écritures, mesurée

Relevée sur de vraies parties jouées de bout en bout, en instrumentant
`storage.kv.put` et `setAlarm` :

> écritures ≈ **P × (Q + 2) + 3 Q** &nbsp;&nbsp;(P joueurs, Q questions)

Le « + 2 » par joueur est sa connexion et son inscription ; le « 3 Q », les
transitions de phase. Vérifiée à 10, 20 et 50 joueurs, à 5 et 10 questions :
l'écart au modèle reste sous 3 %.

**Deux relances de 50 questions dans la même salle coûtent un tiers de moins
qu'une partie de 150** — la WebSocket reste ouverte et il y a moitié moins de
réponses.

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
tombent. Sur le format de référence, **31 300 lignes deviennent 16 500** — de
trois parties par jour à six.

## Les pistes écartées, et pourquoi

**Grouper les réponses en mémoire** — ce serait le seul gain restant, d'un
facteur dix. C'est **incompatible avec l'hibernation**, sur laquelle tout cet
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
soit environ trois mille parties du format de référence. Aucune optimisation
restante n'en approche, et aucune ne se paie sans concéder quelque chose.

## Deux règles d'exploitation

**Ne pas déployer pendant une soirée.** Chaque déploiement redémarre les
Durable Objects. C'est la seule éviction que nous provoquons nous-mêmes, et
elle force tous les joueurs à se reconnecter en pleine question.

**Un domaine personnalisé.** L'API Cache n'opère que là ; sur une adresse
`workers.dev`, le thème est reconstruit à chaque affichage. Voir
[Déploiement](deploiement.md).

Retour au [sommaire](README.md).
