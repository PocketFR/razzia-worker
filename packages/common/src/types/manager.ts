import type { GameResultMeta, QuizzMeta } from "@razzia/common/types/game"

export interface ManagerConfig {
  /* Public : le flux PKCE l'expose de toute façon au navigateur, qui en a
     besoin pour ouvrir la session Spotify. */
  spotifyClientId: string | null
  quizz: QuizzMeta[]
  results: GameResultMeta[]
  /* Les clés API qui manquent à la génération par IA, par leur nom seul. Vide
     quand elle est possible. Sert à griser le bouton plutôt qu'à faire
     échouer un formulaire déjà rempli. */
  iaManquants: string[]
}

/* Le compte rendu d'une génération par IA.

   Il est STRUCTURÉ et non rédigé côté serveur : quizia parle français, et
   l'application se traduit en six langues. Le serveur renvoie donc les
   nombres, l'interface écrit la phrase. `message` reste là pour les échecs,
   trop variés pour être énumérés. */
export interface RapportGeneration {
  retenues: number
  sonores: number
  difficulte: string
  tokens: number
  /** Les artistes demandés pour lesquels aucun morceau n'a été trouvé. */
  absents: string[]
  /** Questions écartées à l'enregistrement, faute d'être valides. */
  rejets: number
}

/* Une question telle que l'IA la rend, avant enregistrement. Ces noms courts
   sont ceux du format d'échange de quizia, pas ceux du quiz enregistré. */
export interface QuestionGeneree {
  q: string
  a: string[]
  s: number
  artiste?: string
  titre?: string
  start?: number
}

export interface ResultatGeneration {
  ok: boolean
  message: string
  rapport?: RapportGeneration
  /* Présentes même en cas d'échec d'ENREGISTREMENT : la génération a coûté
     des jetons, les perdre en silence serait le pire des deux maux. */
  questions?: QuestionGeneree[]
}

/* Le branding modifiable depuis l'écran de configuration.

   Les trois adresses d'images sont facultatives et acceptent une URL externe :
   c'est la seule voie pour une image trop lourde pour la base. Une image
   téléversée l'emporte sur l'adresse. */
export interface BrandingTheme {
  appName?: string
  colors?: Record<string, string>
  answerColors?: string[]
  font?: { family: string; url?: string }
  logo?: string
  favicon?: string
  background?: string
  /* Les sons facultatifs. Ils tiennent ici, et non dans les réglages
     animateur, parce que le thème est le seul canal de configuration servi
     aux joueurs — qui ne s'authentifient jamais. */
  sounds?: { answersMusic?: boolean }
}

export interface BrandingImage {
  nom: string
  mime: string
  taille: number
  modifiee: number
}

export interface BrandingData {
  theme: BrandingTheme | null
  images: BrandingImage[]
  /** Le plafond par image, en octets, tel que le serveur l'applique. */
  max: number
}
