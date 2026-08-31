// Ce que le registre des questions n'a pas le droit d'importer.
//
// Le défaut qu'il garde : `game/utils/constants` importe les quinze écrans de
// jeu, dont l'un tire ce registre. Un module de questions qui revient y
// chercher quoi que ce soit referme donc un cycle — et pendant qu'il se
// dénoue, les constantes de `constants.ts` valent `undefined`. Les fabriques
// de composants de pari en gardaient `undefined` pour toujours, et les boutons
// de mise tombaient à l'affichage, en jeu comme dans l'éditeur.
//
// Rien dans le typage ni dans le lint ne signale ce cycle. Ce test, si.

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

// Depuis la racine du paquet : sous jsdom, `import.meta.url` n'est pas une
// URL de fichier.
const source = join(process.cwd(), "src")
const racine = join(source, "features", "questions")

const fichiers = (dossier: string): string[] =>
  readdirSync(dossier).flatMap((entree) => {
    const chemin = join(dossier, entree)

    if (statSync(chemin).isDirectory()) {
      return entree === "__tests__" ? [] : fichiers(chemin)
    }

    return /\.tsx?$/u.test(entree) ? [chemin] : []
  })

describe("dépendances du registre des questions", () => {
  it("aucun module de question n'importe game/utils/constants", () => {
    const fautifs = fichiers(racine).filter((chemin) =>
      readFileSync(chemin, "utf8").includes(
        '"@razzia/web/features/game/utils/constants"',
      ),
    )

    expect(fautifs.map((f) => f.replace(racine, ""))).toEqual([])
  })

  it("le module des couleurs de réponse n'importe rien", () => {
    const couleurs = readFileSync(
      join(source, "features", "game", "utils", "reponses.ts"),
      "utf8",
    )

    // Une donnée pure : aucun import, donc aucun cycle possible.
    expect(couleurs).not.toMatch(/^import /mu)
  })
})
