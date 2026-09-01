// Ce que les animations promettent, vérifié sur un millier de graines.
//
// Deux affirmations tiennent tout le crédit de ces jeux : la dame finit sur
// la case que le serveur a tirée, et le cheval désigné franchit la ligne le
// premier. Aucune des deux ne se constate en relisant le code, et une seule
// graine qui déroge suffit à faire mentir l'écran devant la salle.

import {
  cadrage,
  calageDuGazon,
  FIN_DE_COURSE,
  hauteurCouloir,
  positionA,
  profils,
} from "@razzia/web/features/questions/paris/course"
import {
  CASE_DU_CHOIX,
  construire,
  departPour,
  DUREE_DUN_ECHANGE_MS,
  fenetresDuMelange,
  geometrie,
  nombreDEchanges,
  placeApres,
  placesInitiales,
} from "@razzia/web/features/questions/paris/melange"
import { describe, expect, it } from "vitest"

const GRAINES = Array.from({ length: 1000 }, (_, i) => i * 7919 + 13)

describe("bonneteau", () => {
  it("la dame finit toujours sur la case du bouton tiré", () => {
    const fautifs: string[] = []

    // Le serveur tire un indice de BOUTON — gauche, droite, milieu — et le
    // tapis se lit de gauche à droite. La conversion est le seul endroit où
    // les deux numérotations se rencontrent ; s'y tromper ferait gagner le
    // mauvais joueur sans que rien ne le signale.
    for (const graine of GRAINES) {
      for (const bouton of [0, 1, 2]) {
        const attendue = CASE_DU_CHOIX[bouton]
        const suite = construire(graine, 3, nombreDEchanges(4000))
        const depart = departPour(suite, attendue)
        const fin = placeApres(suite, depart, suite.length)

        if (fin !== attendue) {
          fautifs.push(`graine ${graine} → ${fin} au lieu de ${attendue}`)
        }
      }
    }

    expect(fautifs).toEqual([])
  })

  it("les trois boutons désignent trois cases distinctes", () => {
    // Une permutation, quelle qu'elle soit : chaque bouton une case, chaque
    // case un bouton. C'est cela qui doit tenir, pas l'ordre du jour.
    expect([...CASE_DU_CHOIX].sort((a, b) => a - b)).toEqual([0, 1, 2])
    expect(CASE_DU_CHOIX).toHaveLength(3)
  })

  it("le mélange n'échange jamais une case avec elle-même", () => {
    const suite = construire(42, 3, 9)

    expect(suite.every(({ a, b }) => a !== b)).toBe(true)
    expect(suite.every(({ a, b }) => a < 3 && b < 3 && a >= 0 && b >= 0)).toBe(
      true,
    )
  })

  it("la fenêtre règle le nombre d'échanges", () => {
    // Trois au minimum, quelle que soit la brièveté ; un plafond très haut,
    // qui n'existe que pour borner l'absurde.
    expect(nombreDEchanges(500)).toBe(3)
    expect(nombreDEchanges(3000)).toBe(5)
    expect(nombreDEchanges(12000)).toBe(20)
    expect(nombreDEchanges(600000)).toBe(40)
  })

  it("la dame reste visible assez longtemps pour être vue", () => {
    // Le défaut signalé : la découverte était une FRACTION de l'animation, si
    // bien qu'à trois secondes d'affichage elle ne durait qu'une demi-seconde
    // — souvent déjà passée le temps que la trame arrive et que la page
    // peigne. Une seconde pleine est le minimum, quelle que soit la durée
    // réglée dans l'éditeur (3 à 15 secondes).
    const courts: string[] = []

    for (let secondes = 3; secondes <= 15; secondes += 1) {
      const dureeMs = secondes * 1000
      const { revelation, repos } = fenetresDuMelange(dureeMs)

      if (revelation * dureeMs < 1000) {
        courts.push(`${secondes}s → ${(revelation * dureeMs).toFixed(0)}ms`)
      }

      // Et il doit rester de quoi mélanger.
      if ((repos - revelation) * dureeMs < 1000) {
        courts.push(`${secondes}s : fenêtre de mélange trop courte`)
      }
    }

    expect(courts).toEqual([])
  })
})

describe("course de chevaux", () => {
  it("le cheval désigné franchit la ligne le premier", () => {
    const fautifs: string[] = []

    for (const graine of GRAINES) {
      for (const gagnant of [0, 1, 2, 3]) {
        const coureurs = profils(graine, 4, gagnant)
        const arrivees = coureurs.map((c) => c.arrivee)
        const autres = arrivees.filter((_, i) => i !== gagnant)

        if (autres.some((a) => a <= arrivees[gagnant])) {
          fautifs.push(
            `graine ${graine}, cheval ${gagnant} : ${String(arrivees)}`,
          )
        }
      }
    }

    expect(fautifs).toEqual([])
  })

  it("le gagnant est en tête au moment de couper la ligne", () => {
    const fautifs: string[] = []

    for (const graine of GRAINES.slice(0, 200)) {
      const coureurs = profils(graine, 4, 2)
      const positions = coureurs.map((c) => positionA(c, FIN_DE_COURSE))

      if (positions.some((p, i) => i !== 2 && p >= positions[2])) {
        fautifs.push(
          `graine ${graine} : ${positions.map((p) => p.toFixed(3)).join(" ")}`,
        )
      }
    }

    expect(fautifs).toEqual([])
  })

  it("personne ne recule, et personne ne s'arrête net", () => {
    const coureurs = profils(2026, 4, 1)

    for (const coureur of coureurs) {
      let precedent = -1

      for (let t = 0; t <= FIN_DE_COURSE; t += 0.01) {
        const x = positionA(coureur, t)

        expect(x).toBeGreaterThanOrEqual(precedent)
        precedent = x
      }
    }
  })
})

describe("les trois cartes du bonneteau", () => {
  // Le défaut : la dame partait sur sa case, les deux autres cartes restaient
  // sur leur propre indice. Dès que la dame ne partait pas de la case zéro,
  // deux cartes se superposaient — elle dessous — et une case restait vide.
  // Une fois sur trois selon la graine, la dame ne s'affichait pas.
  it("occupent trois cases distinctes, du début à la fin", () => {
    const fautifs: string[] = []

    for (const graine of GRAINES.slice(0, 300)) {
      for (const bouton of [0, 1, 2]) {
        const suite = construire(graine, 3, nombreDEchanges(4000))
        const depart = departPour(suite, CASE_DU_CHOIX[bouton])
        const initiales = placesInitiales(depart, 3)

        for (let fait = 0; fait <= suite.length; fait += 1) {
          const places = initiales.map((debut) =>
            placeApres(suite, debut, fait),
          )

          if (new Set(places).size !== 3) {
            fautifs.push(`graine ${graine}, après ${fait} : ${String(places)}`)
          }
        }
      }
    }

    expect(fautifs).toEqual([])
  })

  it("la règle naïve, elle, superposait deux cartes — c'est ce qu'on répare", () => {
    let collisions = 0
    let total = 0

    for (const graine of GRAINES.slice(0, 300)) {
      for (const bouton of [0, 1, 2]) {
        const suite = construire(graine, 3, nombreDEchanges(4000))
        const depart = departPour(suite, CASE_DU_CHOIX[bouton])
        // L'ancienne règle : la dame sur sa case, les autres sur leur indice.
        const naif = [0, 1, 2].map((carte) => (carte === 0 ? depart : carte))

        total += 1

        if (new Set(naif).size !== 3) {
          collisions += 1
        }
      }
    }

    // Environ deux tiers des départs : la dame ne s'affichait que lorsqu'elle
    // partait de la case zéro.
    expect(collisions).toBeGreaterThan(total / 2)
  })

  it("la dame part bien de sa case, et elle est la première", () => {
    expect(placesInitiales(2, 3)[0]).toBe(2)
    expect([...placesInitiales(2, 3)].sort((a, b) => a - b)).toEqual([0, 1, 2])
    expect([...placesInitiales(0, 3)].sort((a, b) => a - b)).toEqual([0, 1, 2])
  })

  it("un mélange plus long ajoute des échanges au lieu de les ralentir", () => {
    const court = nombreDEchanges(6000)
    const long = nombreDEchanges(24000)

    expect(long).toBeGreaterThan(court)
    // Le rythme reste le même : environ un échange toutes les six dixièmes.
    expect(24000 / long).toBeCloseTo(DUREE_DUN_ECHANGE_MS, -2)
  })
})

describe("disposition des cartes", () => {
  // Hors échange, deux cartes ne doivent jamais se toucher : le tapis devient
  // sinon illisible, et c'est exactement ce qui arrivait quand la taille des
  // cartes venait de la HAUTEUR du conteneur — sur un écran étroit, trois
  // cartes ne tenaient pas côte à côte.
  it("laisse une marge entre deux cartes voisines, au repos", () => {
    for (const choix of [2, 3, 4]) {
      const { largeur, ecart, centre } = geometrie(choix)

      for (let place = 0; place + 1 < choix; place += 1) {
        const droiteDeLaPremiere = centre(place) + largeur / 2
        const gaucheDeLaSuivante = centre(place + 1) - largeur / 2

        expect(gaucheDeLaSuivante - droiteDeLaPremiere).toBeCloseTo(ecart)
      }
    }
  })

  it("occupe toute la largeur, sans déborder", () => {
    for (const choix of [2, 3, 4]) {
      const { largeur, centre } = geometrie(choix)

      expect(centre(0) - largeur / 2).toBeCloseTo(0)
      expect(centre(choix - 1) + largeur / 2).toBeCloseTo(100)
    }
  })

  it("se mesure sur la fenêtre, jamais en pourcentages", () => {
    // Un pourcentage se résout contre le parent, et la chaîne de parents de
    // cet écran s'ajuste à son contenu : « 100 % » y valait la largeur du
    // titre, soit un tapis de 263 px sur un écran de 1920.
    const { largeurDuTapis, hauteurDuTapis } = geometrie(3)

    expect(largeurDuTapis).not.toContain("%")
    expect(hauteurDuTapis).not.toContain("%")
    expect(largeurDuTapis).toContain("vw")
    expect(hauteurDuTapis).toContain("vh")
  })

  it("pose ses deux dimensions au même rapport", () => {
    const { hauteur, largeurDuTapis, hauteurDuTapis } = geometrie(3)

    // Les deux sont écrites en dur dans le style : si elles divergeaient, le
    // tapis serait déformé et les cartes ne rempliraient plus leur case.
    const deLargeur = Number(/calc\(([\d.]+) \*/u.exec(largeurDuTapis)?.[1])
    const deHauteur = Number(/\/ ([\d.]+)\)/u.exec(hauteurDuTapis)?.[1])

    expect(deLargeur).toBeCloseTo(100 / hauteur, 2)
    expect(deHauteur).toBeCloseTo(deLargeur, 3)
  })

  it("garde les proportions d'une carte à jouer", () => {
    const { largeur, hauteur } = geometrie(3)

    expect(largeur / hauteur).toBeCloseTo(63 / 88)
  })
})

describe("cadrage de la course", () => {
  const TELE = 1920
  const TELEPHONE = 390

  // La promesse tenue par le cadrage : l'écart entre deux chevaux occupe le
  // même nombre de pixels sur les deux écrans. C'est cet écart, seul, qui dit
  // qui est en train de gagner — le réduire de cinq fois rend la course
  // illisible sur un téléphone.
  it("l'écart entre deux chevaux est le même sur les deux écrans", () => {
    const positions = [0.42, 0.5, 0.55, 0.61]
    const surTele = cadrage(TELE, TELE, positions)
    const surTelephone = cadrage(TELEPHONE, TELE, positions)

    const ecart = (vue: ReturnType<typeof cadrage>) =>
      vue.abscisse(positions[3]) - vue.abscisse(positions[0])

    expect(ecart(surTelephone)).toBeCloseTo(ecart(surTele), 6)
  })

  it("la télévision ne défile pas : elle voit toute la piste", () => {
    for (const t of [0, 0.3, 0.6, 0.82]) {
      const vue = cadrage(TELE, TELE, [t, t, t, t])

      expect(vue.decalage).toBe(0)
      expect(vue.piste).toBe(TELE)
    }
  })

  it("le téléphone garde le peloton au centre", () => {
    const positions = [0.5, 0.5, 0.5, 0.5]
    const vue = cadrage(TELEPHONE, TELE, positions)
    const surEcran = vue.abscisse(0.5) - vue.decalage

    expect(surEcran).toBeCloseTo(TELEPHONE / 2, 0)
  })

  it("la caméra ne sort jamais de la piste", () => {
    const bornes: string[] = []

    for (let t = 0; t <= 1; t += 0.02) {
      const vue = cadrage(TELEPHONE, TELE, [t, t, t, t])

      if (vue.decalage < 0 || vue.decalage > vue.piste - vue.vue) {
        bornes.push(`t=${t.toFixed(2)} → ${vue.decalage}`)
      }
    }

    expect(bornes).toEqual([])
  })

  it("au départ et à l'arrivée, elle se cale sur les bords", () => {
    const depart = cadrage(TELEPHONE, TELE, [0, 0, 0, 0])
    const arrivee = cadrage(TELEPHONE, TELE, [1, 1, 1, 1])

    expect(depart.decalage).toBe(0)
    expect(arrivee.decalage).toBeCloseTo(TELE - TELEPHONE, 0)
  })

  it("sans référence, la piste tient dans l'écran local", () => {
    const vue = cadrage(TELEPHONE, undefined, [0.5, 0.5, 0.5, 0.5])

    expect(vue.piste).toBe(TELEPHONE)
    expect(vue.decalage).toBe(0)
  })

  it("le cheval franchit la ligne, quelle que soit l'échelle", () => {
    for (const largeur of [TELEPHONE, 768, TELE]) {
      const vue = cadrage(largeur, largeur, [1])
      // Bord droit du cheval sur le bord droit de la piste : il recouvre donc
      // le damier, plus étroit que lui.
      expect(vue.abscisse(1) + vue.cheval / 2).toBeCloseTo(vue.piste, 6)
      expect(vue.damier).toBeLessThan(vue.cheval)
    }
  })
})

describe("calage du gazon", () => {
  const TUILE = 1636

  // Sans décalage, les répétitions de la texture s'alignent d'un couloir à
  // l'autre : quatre coutures verticales à la même abscisse, que l'œil repère
  // aussitôt.
  it("garde les couloirs bien séparés, sur toutes les graines", () => {
    // Le tirage libre en alignait deux une fois sur cent trente. Stratifié,
    // l'écart minimal est garanti par construction.
    const minimal = (TUILE / 4) * 0.4
    const serres: string[] = []

    for (const graine of GRAINES) {
      const calages = calageDuGazon(graine, 4, TUILE)

      for (let i = 0; i + 1 < calages.length; i += 1) {
        if (calages[i + 1] - calages[i] < minimal) {
          serres.push(`graine ${graine} : ${String(calages)}`)
        }
      }
    }

    expect(serres).toEqual([])
  })

  it("reste dans une tuile : au-delà, le décalage revient au même", () => {
    const calages = GRAINES.slice(0, 200).flatMap((g) =>
      calageDuGazon(g, 4, TUILE),
    )

    expect(Math.min(...calages)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...calages)).toBeLessThan(TUILE)
  })

  it("est le même partout pour une graine donnée", () => {
    // La télévision et les téléphones doivent montrer le MÊME gazon.
    expect(calageDuGazon(4242, 4, TUILE)).toEqual(calageDuGazon(4242, 4, TUILE))
    expect(calageDuGazon(4242, 4, TUILE)).not.toEqual(
      calageDuGazon(4243, 4, TUILE),
    )
  })

  it("le couloir suit l'échelle du cheval", () => {
    expect(hauteurCouloir(65)).toBeGreaterThan(65)
    expect(hauteurCouloir(32)).toBeLessThan(hauteurCouloir(68))
  })
})
