import type { Fournisseur } from "@razzia/common/musique"
import type { GameResultMeta, QuizzMeta } from "@razzia/common/types/game"

export interface ManagerConfig {
  // Public : le flux PKCE l'expose de toute façon au navigateur, qui en a
  // besoin pour ouvrir la session Spotify.
  spotifyClientId: string | null
  // Le service musical retenu pour le contenu NOUVEAU — recherche dans
  // l'éditeur et génération par IA. Il ne décide pas de la lecture, qui suit
  // l'URI enregistrée dans chaque question.
  musicProvider: Fournisseur
  // Une zone sonore Soundtrack est-elle configurée ?
  //
  // Quand elle l'est, le Worker envoie le morceau ENTIER sur les enceintes du
  // lieu et le navigateur de l'animateur doit se taire — sans quoi on
  // entendrait l'extrait de trente secondes par-dessus. C'est un booléen, pas
  // un identifiant : rien de sensible ne descend.
  musicZone: boolean
  quizz: QuizzMeta[]
  results: GameResultMeta[]
  // Les clés API qui manquent à la génération par IA, par leur nom seul. Vide
  // quand elle est possible. Sert à griser le bouton plutôt qu'à faire
  // échouer un formulaire déjà rempli.
  iaManquants: string[]
}

// Le compte rendu d'une génération par IA.
//
// Il est STRUCTURÉ et non rédigé côté serveur : quizia parle français, et
// l'application se traduit en six langues. Le serveur renvoie donc les
// nombres, l'interface écrit la phrase. `message` reste là pour les échecs,
// trop variés pour être énumérés.
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

// Une question telle que l'IA la rend, avant enregistrement. Ces noms courts
// sont ceux du format d'échange de quizia, pas ceux du quiz enregistré.
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
  // Présentes même en cas d'échec d'ENREGISTREMENT : la génération a coûté
  // des jetons, les perdre en silence serait le pire des deux maux.
  questions?: QuestionGeneree[]
}

// Le branding modifiable depuis l'écran de configuration.
//
// Les trois adresses d'images sont facultatives et acceptent une URL externe :
// c'est la seule voie pour une image trop lourde pour la base. Une image
// téléversée l'emporte sur l'adresse.
export interface BrandingTheme {
  appName?: string
  colors?: Record<string, string>
  answerColors?: string[]
  font?: { family: string; url?: string }
  logo?: string
  favicon?: string
  background?: string
  // Les sons facultatifs. Ils tiennent ici, et non dans les réglages
  // animateur, parce que le thème est le seul canal de configuration servi
  // aux joueurs — qui ne s'authentifient jamais.
  sounds?: { answersMusic?: boolean }
}

export interface BrandingImage {
  nom: string
  mime: string
  taille: number
  modifiee: number
  /* Nombre de déclinaisons, quand l'image en a — le fond seul, aujourd'hui. */
  variantes?: number
}

export interface BrandingData {
  theme: BrandingTheme | null
  images: BrandingImage[]
  /** Le plafond par image, en octets, tel que le serveur l'applique. */
  max: number
}
