// Ce qu'un service musical doit savoir faire, et rien de plus.
//
// Quatre opérations, ce sont exactement celles que le reste du code appelle
// aujourd'hui — deux pour l'éditeur, deux pour la génération. L'interface
// n'anticipe rien : un cinquième besoin ajoutera un cinquième membre, et les
// deux implantations le porteront ensemble.

import type { Fournisseur, Piste } from "@razzia/common/musique"
import type { Morceau } from "./texte"

export interface Catalogue {
  readonly nom: Fournisseur

  /** Recherche libre, pour la liste déroulante de l'éditeur. */
  chercher: (_q: string) => Promise<Piste[]>

  /** Métadonnées d'un morceau désigné par son identifiant. */
  piste: (_id: string) => Promise<Piste | null>

  /** Morceaux d'un artiste, filtrés et datés, pour la génération. */
  pistesDeLArtiste: (
    _nom: string,
    _anneeMin: number | null,
    _anneeMax: number | null,
  ) => Promise<Morceau[]>

  /** Retrouve un morceau précis à partir d'un artiste et d'un titre. */
  resoudre: (_artiste: string, _titre: string) => Promise<Morceau | null>

  /** Les noms des clés qui manquent pour s'en servir. Vide = prêt. */
  manque: () => string[]
}
