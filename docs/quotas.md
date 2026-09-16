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
| R2 — stockage                | 10 Go / mois, **au compte**  |
| R2 — écritures / lectures    | 1 M / 10 M par mois          |
| Images — transformations     | 5 000 / mois, **au compte**  |

**Les requêtes vers les assets statiques sont gratuites et illimitées.** Seuls
les chemins listés dans `run_worker_first` sont facturés — c'est-à-dire le
strictement dynamique.

**Une réponse servie par Workers Cache ne compte pas non plus** : elle n'invoque
pas le Worker. C'est ce qui rend gratuits, en soirée, les médias téléversés et
le thème. Voir [Les médias téléversés](#les-médias-téléversés).

**Deux dépassements ne se valent pas.** Au-delà du quota, Images refuse la
transformation et sert l'original, sans facture. R2, lui, **facture** — et exige
un moyen de paiement dès l'activation. D'où les garde-fous décrits plus bas.

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
| Requêtes d'objet             | ~2 600                      | 2,6 %         |
| **Écritures Durable Object** | **~16 500**                 | **16 %**      |
| D1                           | quelques dizaines de lignes | négligeable   |

**C'est donc l'écriture d'objet qui borne**, et rien d'autre : environ **six
parties de référence par jour**. Les requêtes Worker ne pourraient être
atteintes qu'à trois cents parties quotidiennes.

### Le battement de cœur, qui pèse plus que la partie elle-même

Les 2 600 requêtes d'objet ci-dessus se répartissent d'une façon contre-intuitive :
**778 pour toute la partie** — ses 15 550 messages, à 20 pour 1 — et **1 818 pour
les seuls pings**, à raison d'un ping toutes les trente secondes sur 101 appareils
pendant trois heures.

Le battement coûte donc **plus du double de tout le reste réuni**. C'est assumé,
et voici pourquoi il n'est pas discutable :

- il ne coûte **rien en durée**. Les pings sont répondus par
  `setWebSocketAutoResponse` depuis la périphérie, sans réveiller l'objet
  hiberné : « will not incur additional wall-clock time, and so they will not be
  charged ». L'exonération porte sur la durée et sur elle seule — **rien dans la
  documentation n'exclut ces messages du compte des requêtes**, et c'est pourquoi
  ils sont comptés ici plutôt que supposés gratuits ;
- 2,6 % contre les 16 % des écritures : le facteur six qui sépare les deux
  dimensions reste intact, et rien ne change quant à ce qui borne ;
- sans lui, une veille involontaire laissait un joueur devant un écran figé
  jusqu'à ce qu'il recharge la page, sans qu'aucun événement ne le signale ni
  côté client ni côté objet.

Le seul réglage qui vaudrait la peine d'être rediscuté est la **période**, si le
nombre de parties quotidiennes augmentait : la passer à soixante secondes
diviserait ce poste par deux, au prix d'un doublement du temps de détection
pour les coupures qui ne sont pas des sorties de veille. Les sorties de veille,
elles, sont traitées par la sonde immédiate et ne dépendent pas de la période.

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

## Les médias téléversés

Les images, sons et vidéos des diapos et des questions sont stockés dans R2, et
leurs métadonnées dans D1. **Le coût en soirée est nul**, et c'est mesuré, pas
supposé.

### La mesure qui a décidé de l'architecture

Le 15/09/2026, sur un worker jetable lisant un fichier R2, `wrangler tail`
ouvert pour compter les invocations :

| cas                                                | résultat                                    |
| -------------------------------------------------- | ------------------------------------------- |
| Domaine personnalisé, requêtes répétées            | MISS +1 invocation, puis HIT +0             |
| **workers.dev**                                    | **identique** : Workers Cache y fonctionne  |
| Corps de 25 Mo                                     | HIT +0, octets identiques                   |
| `/cdn-cgi/image`, largeur jamais demandée          | **+0** : la source est lue dans le cache    |
| `/cdn-cgi/image` sur une source froide             | +1, qui remplit aussi le cache de la source |
| Purge par étiquette, depuis une requête ou le cron | effective                                   |
| Requête `Range` sur un objet en cache              | HIT +0, mais **200 entier** : jamais de 206 |

### Ce qu'une soirée coûte

**Une invocation et une lecture R2 par fichier, une fois** — puis rien, quel que
soit le nombre de téléphones. Cette première requête est faite par l'écran de
l'animateur à la création de la partie (le _préchauffage_) : sans elle, cent
téléphones demandant la même vidéo froide au même instant pourraient chacun
réveiller le Worker avant que le premier n'ait rempli le cache.

**La vidéo et le son sont chargés en entier**, puis lus depuis un lien `blob:`.
Une balise `<video src>` demanderait des morceaux en `Range`, que le cache ne
conserve jamais : chaque morceau réveillerait le Worker. Safari exige de toute
façon un vrai 206 pour lire une vidéo, ce que le cache ne sait pas rendre.

**Chaque déploiement vide le cache** : la version du Worker fait partie de la
clé. Le préchauffage de la partie suivante le remplit à nouveau.

### Les garde-fous de R2

| quota gratuit             | garde-fou                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 10 Go stockés             | **plafond de 8 Go** pour razzia, vérifié avant d'accepter un envoi                                           |
| 1 M d'écritures par mois  | une par envoi — hors d'atteinte                                                                              |
| 10 M de lectures par mois | seulement sur MISS ; identifiant inconnu refusé par D1 **avant** R2, adresse à paramètres redirigée avant R2 |
| suppression               | gratuite                                                                                                     |

Le quota R2 est **au compte** : les autres sites hébergés sur le même compte
y puisent aussi — il faut les compter avant de relever le plafond. Au pire, sans aucun cache, 100 téléphones ×
150 médias font 15 000 lectures par soirée, soit environ 660 soirées par mois.

Tailles maximales par fichier : image 2 Mo, son 10 Mo, vidéo 25 Mo. Aucune
opération courante ne liste le bucket — lister compte comme une écriture : le
plafond se vérifie depuis les tailles tenues dans D1.

### Les transformations d'images

Activables **par instance**, dans Paramètres → Médias, et seulement si
« Images → Transformations » est allumé sur la zone. Sans le service, une
adresse `/cdn-cgi/image` répond 404 et `onerror=redirect` ne rattrape rien —
mesuré sur une zone sans le service, et sur workers.dev, où il ne peut pas
exister.

Les largeurs sont **fixes** (640, 1280, 1920, 2560) : chaque largeur distincte
compte pour une transformation, et des largeurs libres laisseraient n'importe
qui en inventer. « Resize images from any origin » reste désactivé.

### L'adresse d'un fichier est son empreinte

La clé d'un média est le **SHA-256 de son contenu**, calculé par le navigateur.
Trois conséquences, gratuites :

- **le même fichier n'est jamais stocké deux fois** : deux téléversements
  identiques donnent la même adresse, sans table ni recherche ;
- **réimporter un quiz ne coûte rien** : le navigateur demande l'adresse en
  `HEAD`, servie par le cache, et n'envoie que ce qui manque ;
- **le cache d'un an est justifié** : une adresse ne peut pas changer de
  contenu, puisque le contenu la nomme.

Le serveur, lui, ne recalcule pas cette empreinte — il reçoit le fichier en
flux et ne peut pas le condenser sans le tenir entier en mémoire. Il **refuse
donc d'écraser une clé déjà prise** : au pire, un client fautif range un
fichier sous un nom qui ne lui correspond pas, jamais sous celui d'un autre.

### L'export emporte les fichiers

Un quiz exporté doit rester **un seul document**, y compris sur une autre
installation où `/media/<empreinte>` ne désigne rien. Les fichiers y voyagent
donc inlinés en `data:`, ce qui gonfle de 33 % et reste lisible par
l'application dont ce projet est issu.

Tout se fait **dans le navigateur**, jamais dans le Worker : dix millisecondes
de processeur par requête, et une ligne D1 plafonnée à 2 Mo, quand une image de
2 Mo en pèse 2,7 une fois encodée. Une adresse `data:` est d'ailleurs refusée à
l'enregistrement, pour qu'un fichier écrit à la main ne puisse pas gonfler la
ligne d'un quiz.

**L'import est partiel, par choix.** Un fichier refusé — trop gros, type non
accepté, plafond atteint — fait perdre son média à sa question, jamais le quiz :
on préfère un quiz à retravailler dans l'éditeur à pas de quiz du tout. Ce qui
manque est listé à l'écran, sans quoi le trou ne se découvrirait qu'en soirée.

### Le ramassage

Le cron quotidien supprime les médias qu'**aucun quiz** ne cite depuis plus de
**24 h**, et les envois restés incomplets. Le délai protège un fichier téléversé
dans un quiz pas encore enregistré, et une partie en cours qui joue la copie
d'un quiz modifié entre-temps. Les résultats archivés ne comptent pas comme
références : un vieux résultat peut perdre son image.

## Le prochain palier n'est pas une optimisation

Si le besoin venait — plusieurs événements par jour —, le plan payant à **5 $
par mois** fait passer les écritures d'objet de 3 à **50 millions par mois**,
soit environ trois mille parties de référence par mois. Aucune optimisation
restante n'en approche, et aucune ne se paie sans concéder quelque chose.

## Deux règles d'exploitation

**Ne pas déployer pendant une soirée.** Chaque déploiement redémarre les
Durable Objects. C'est la seule éviction que nous provoquons nous-mêmes, et
elle force tous les joueurs à se reconnecter en pleine question. Il vide aussi
Workers Cache : les médias d'une partie déjà lancée repartiraient à froid.

**Un domaine personnalisé, pour les images.** Workers Cache fonctionne aussi sur
`workers.dev` — mesuré —, mais `/cdn-cgi/image` n'y existe pas : les images
téléversées y sont servies en pleine taille. Voir [Déploiement](deploiement.md).

Retour au [sommaire](README.md).
