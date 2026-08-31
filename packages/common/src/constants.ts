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
} as const

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
