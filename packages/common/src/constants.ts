export const EVENTS = {
  GAME: {
    STATUS: "game:status",
    SUCCESS_ROOM: "game:successRoom",
    SUCCESS_JOIN: "game:successJoin",
    TOTAL_PLAYERS: "game:totalPlayers",
    ERROR_MESSAGE: "game:errorMessage",
    START_COOLDOWN: "game:startCooldown",
    COOLDOWN: "game:cooldown",
    RESET: "game:reset",
    UPDATE_QUESTION: "game:updateQuestion",
    PLAYER_ANSWER: "game:playerAnswer",
    CREATE: "game:create",
    // Amorce de lecture, envoyée au SEUL animateur à l'annonce de la
    // question. Le média audio n'accompagne pas SHOW_QUESTION — il ferait
    // démarrer un lecteur deux fois — et n'arrive qu'avec SELECT_ANSWER,
    // trop tard pour couvrir l'annonce.
    AUDIO_CUE: "game:audioCue",
  },
  PLAYER: {
    SUCCESS_RECONNECT: "player:successReconnect",
    UPDATE_LEADERBOARD: "player:updateLeaderboard",
    JOIN: "player:join",
    LOGIN: "player:login",
    RECONNECT: "player:reconnect",
    LEAVE: "player:leave",
    SELECTED_ANSWER: "player:selectedAnswer",
    CHECK_PIN: "player:checkPin",
    CHECK_PIN_RESULT: "player:checkPinResult",
  },
  MANAGER: {
    SUCCESS_RECONNECT: "manager:successReconnect",
    CONFIG: "manager:config",
    GAME_CREATED: "manager:gameCreated",
    STATUS_UPDATE: "manager:statusUpdate",
    NEW_PLAYER: "manager:newPlayer",
    REMOVE_PLAYER: "manager:removePlayer",
    ERROR_MESSAGE: "manager:errorMessage",
    PLAYER_KICKED: "manager:playerKicked",
    AUTH: "manager:auth",
    RECONNECT: "manager:reconnect",
    LEAVE: "manager:leave",
    KICK_PLAYER: "manager:kickPlayer",
    START_GAME: "manager:startGame",
    ABORT_QUIZ: "manager:abortQuiz",
    NEXT_QUESTION: "manager:nextQuestion",
    NEW_QUIZZ: "manager:newQuizz",
    SHOW_LEADERBOARD: "manager:showLeaderboard",
    GET_CONFIG: "manager:getConfig",
    // L'animateur annonce la largeur de son écran. Elle sert d'ÉCHELLE
    // commune aux animations qui se déroulent en largeur — la course de
    // chevaux —, pour qu'un téléphone montre les mêmes écarts qu'une
    // télévision plutôt qu'une course écrasée.
    VIEWPORT: "manager:viewport",
    LOGOUT: "manager:logout",
    UNAUTHORIZED: "manager:unauthorized",
  },
  QUIZZ: {
    GET: "quizz:get",
    DATA: "quizz:data",
    SAVE: "quizz:save",
    SAVE_SUCCESS: "quizz:saveSuccess",
    UPDATE: "quizz:update",
    UPDATE_SUCCESS: "quizz:updateSuccess",
    DELETE: "quizz:delete",
    ERROR: "quizz:error",
    GENERATE: "quizz:generate",
    GENERATED: "quizz:generated",
  },
  // Branding : couleurs, nom, police et les trois images. Même aiguillage
  // que les clés API — l'événement part vers /api par le shim client.
  BRANDING: {
    GET: "branding:get",
    DATA: "branding:data",
    SAVE: "branding:save",
    UPLOAD: "branding:upload",
    RESET: "branding:reset",
    CLEAR: "branding:clear",
    SAVED: "branding:saved",
    ERROR: "branding:error",
  },
  // Clés API. Comme le reste, l'événement passe par le shim client, qui
  // l'aiguille vers /api — les composants n'ont pas à connaître le jeton
  // de session ni la forme du transport.
  SETTINGS: {
    GET: "settings:get",
    DATA: "settings:data",
    SAVE: "settings:save",
    ERROR: "settings:error",
    PASSWORD: "settings:password",
    PASSWORD_OK: "settings:passwordOk",
  },
  RESULTS: {
    GET: "results:get",
    DATA: "results:data",
    DELETE: "results:delete",
  },
} as const

// Le battement de cœur de la WebSocket.
//
// POURQUOI IL EXISTE. Une veille involontaire coupe le réseau sans fermer la
// connexion TCP : la radio s'éteint, personne n'envoie de FIN. Au réveil, le
// navigateur annonce toujours `readyState === OPEN` et `send()` ne lève rien
// — il met en tampon. Aucun `close`, donc aucune reconnexion, donc un écran
// figé dont le seul remède était de recharger la page. Observé en soirée.
//
// Seul un aller-retour applicatif révèle le mensonge : l'API WebSocket du
// navigateur n'expose aucun moyen d'émettre une trame de contrôle ping.
//
// LES DEUX CHAÎNES SONT LITTÉRALES, ET C'EST UN CONTRAT. Côté objet, elles
// arment `setWebSocketAutoResponse`, qui répond depuis la périphérie sans
// réveiller l'objet hiberné — donc sans durée facturée. La correspondance y
// est EXACTE, sur le message entier : il ne peut donc y avoir ni horodatage
// ni numéro de séquence dedans, et le client doit les envoyer telles quelles
// plutôt que par `emit()`, qui reconstruit la trame et pourrait en changer
// la forme un jour.
//
// L'ÉCHEC SERAIT SILENCIEUX : une chaîne qui ne correspond plus n'est pas
// rejetée, elle réveille l'objet, tombe dans `webSocketMessage` où aucun
// événement ne lui répond, et le client conclut à une coupure générale. D'où
// le test de bout en bout dans smoke-ws.mjs, qui les éprouve contre le vrai
// runtime plutôt que contre notre idée de son comportement.
export const BATTEMENT = {
  PING: '{"e":"ping"}',
  PONG: '{"e":"pong"}',

  /** Rythme du battement quand l'onglet est au premier plan. */
  PERIODE_MS: 30_000,

  /**
   * Silence toléré avant de conclure que la socket est morte. Trois périodes :
   * un pong perdu ne doit pas coûter une reconnexion à toute la salle.
   */
  TOLERANCE_MS: 90_000,

  /**
   * Le délai de la SONDE, celle qu'on lance au retour au premier plan.
   *
   * Il est court parce que le cas est déjà connu : l'appareil sort de veille,
   * et si la connexion a survécu le pong revient en quelques dizaines de
   * millisecondes. Attendre la tolérance ordinaire ferait perdre la question
   * en cours — le minuteur du battement dort pendant la veille, lui aussi, et
   * ne s'apercevrait de rien avant une minute et demie.
   */
  SONDE_MS: 3_000,
} as const

export const NO_TIME_LIMIT = -1

export const MAX_POINTS = 1000

export const QUESTION_TYPES = {
  SINGLE: "single",
  MULTI: "multi",
  // Les paris. Ce sont des questions comme les autres — même éditeur, mêmes
  // phases, même barème — à ceci près que la bonne réponse n'est pas écrite
  // dans le quiz : le serveur la tire au moment de jouer. Voir paris.ts.
  ROUGE_NOIR: "rouge-noir",
  BONNETEAU: "bonneteau",
  PMU: "pmu",
  // Une diapo : un titre et un élément, sans réponses ni points. Elle se joue
  // dans le déroulé comme une étape, attend l'animateur pour avancer, et
  // n'entre ni dans la numérotation des questions ni dans l'historique.
  DIAPO: "diapo",
  // Un classement : les réponses sont à ranger dans l'ordre. L'ordre de
  // saisie de l'éditeur EST la bonne réponse ; ce que le joueur envoie est la
  // même liste d'indices, dans l'ordre qu'il propose. Voir classement.ts.
  CLASSEMENT: "classement",
} as const

/**
 * Le nombre de réponses qu'une question accepte.
 *
 * Quatre partout — quatre couleurs, quatre lettres, une grille à deux
 * colonnes — sauf pour un classement, qui n'a ni couleur ni lettre et se lit
 * en une seule colonne. Huit y restent jouables au doigt sur un téléphone ;
 * au-delà, la liste demande de faire défiler pendant qu'on déplace.
 */
export const MAX_REPONSES = 4

export const MAX_REPONSES_CLASSEMENT = 8

export const maxReponses = (type: string) =>
  type === QUESTION_TYPES.CLASSEMENT ? MAX_REPONSES_CLASSEMENT : MAX_REPONSES

// Le discriminant d'un bloc de quiz. Un bloc est soit une question — dont le
// `type` est l'un de QUESTION_TYPES — soit un groupe à élimination.
export const TYPE_GROUPE = "groupe"

export const SCORING_MODES = {
  STRICT: "strict",
  BALANCED: "balanced",
  LENIENT: "lenient",
} as const

export const MEDIA_TYPES = {
  IMAGE: "image",
  VIDEO: "video",
  AUDIO: "audio",
  // Le seul média sans fichier : un texte, écrit dans le quiz. Il n'a donc pas
  // d'adresse, et c'est pourquoi `QuestionMedia` est une union.
  TEXTE: "texte",
} as const

export const EXAMPLE_QUIZZ = {
  subject: "Example Quizz",
  questions: [
    {
      question: "What is good answer ?",
      answers: ["No", "Good answer", "No", "No"],
      solutions: [1],
      cooldown: 5,
      time: 15,
    },
    {
      question: "What is good answer with image ?",
      answers: ["No", "No", "No", "Good answer"],
      media: {
        type: MEDIA_TYPES.IMAGE,
        url: "https://placehold.co/600x400.png",
      },
      solutions: [3],
      cooldown: 5,
      time: 20,
    },
    {
      question: "What is good answer with two answers ?",
      answers: ["Good answer", "No"],
      media: {
        type: MEDIA_TYPES.IMAGE,
        url: "https://placehold.co/600x400.png",
      },
      solutions: [0],
      cooldown: 5,
      time: 20,
    },
    {
      question: "Which of these are primary colors ?",
      answers: ["Red", "Green", "Blue", "Yellow"],
      solutions: [0, 2, 3],
      cooldown: 5,
      time: 20,
    },
  ],
} as const
