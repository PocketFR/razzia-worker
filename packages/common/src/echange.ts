// L'échange de quiz : export en un seul fichier, import qui le défait.
//
// UN QUIZ EXPORTÉ DOIT RESTER UN DOCUMENT UNIQUE. Les fichiers téléversés y
// voyagent donc inlinés en `data:`, ce qui gonfle de 33 % mais garde un
// fichier lisible par l'application d'origine, dont ce format est déjà celui
// qu'elle accepte dans le champ d'adresse.
//
// LE REMPLACEMENT EST GÉNÉRIQUE, et ce n'est pas de la coquetterie : `media`
// et `fond` ne sont pas les seuls champs, et le prochain ajouté serait oublié
// d'une liste écrite à la main. On parcourt donc le document entier, comme le
// ramassage parcourt le JSON d'un quiz pour y trouver ses références.

/** Les adresses retenues par le prédicat, sans doublon, dans l'ordre. */
export const adressesDuDocument = (
  valeur: unknown,
  retenir: (_adresse: string) => boolean,
): string[] => {
  const vues = new Set<string>()

  const parcourir = (noeud: unknown) => {
    if (typeof noeud === "string") {
      if (retenir(noeud)) {
        vues.add(noeud)
      }

      return
    }

    if (Array.isArray(noeud)) {
      noeud.forEach(parcourir)

      return
    }

    if (noeud && typeof noeud === "object") {
      Object.values(noeud).forEach(parcourir)
    }
  }

  parcourir(valeur)

  return [...vues]
}

/** Ce que rend `remplacerAdresses` pour une adresse absente de la table. */
const INCHANGE = Symbol("inchangé")

/**
 * Réécrit les adresses d'un document. `null` signifie « perdue ».
 *
 * UNE ADRESSE PERDUE FAIT DISPARAÎTRE SON CHAMP, et un objet qui perd son
 * `url` disparaît à son tour — un média sans adresse ne désigne plus rien, et
 * le validateur le refuserait.
 *
 * C'est le choix d'exploitation retenu : mieux vaut un quiz importé avec une
 * image manquante, qu'on retravaille dans l'éditeur, que pas de quiz du tout.
 * Ce qui a été perdu se dit ailleurs, à l'écran — jamais en silence.
 */
export const remplacerAdresses = <T>(
  valeur: T,
  table: Map<string, string | null>,
): T => {
  const refaire = (noeud: unknown): unknown => {
    if (typeof noeud === "string") {
      return table.has(noeud) ? table.get(noeud) : INCHANGE
    }

    if (Array.isArray(noeud)) {
      // Un élément perdu quitte la liste plutôt que d'y laisser un trou.
      return (noeud as unknown[])
        .map((element) => {
          const refait = refaire(element)

          return refait === INCHANGE ? element : refait
        })
        .filter((element) => element !== null)
    }

    if (!noeud || typeof noeud !== "object") {
      return INCHANGE
    }

    const sortie: Record<string, unknown> = {}
    let avaitUneAdresse = false

    for (const [cle, sous] of Object.entries(noeud)) {
      const refait = refaire(sous)

      if (refait === INCHANGE) {
        sortie[cle] = sous

        continue
      }

      if (cle === "url" && typeof sous === "string" && table.has(sous)) {
        avaitUneAdresse = true
      }

      // Perdue : le champ disparaît.
      if (refait === null) {
        continue
      }

      sortie[cle] = refait
    }

    // Un objet qui portait une adresse et l'a perdue n'est plus rien.
    if (avaitUneAdresse && !("url" in sortie)) {
      return null
    }

    return sortie
  }

  const refait = refaire(valeur)

  return (refait === INCHANGE ? valeur : refait) as T
}

// ── Base64 ────────────────────────────────────────────────────────────────

/** `data:<type>;base64,<données>`, tel qu'un export en produit. */
const RE_DATA_URL = /^data:([^;,]+)(;base64)?,(.*)$/s

export const estAdresseBase64 = (adresse: string) => RE_DATA_URL.test(adresse)

export interface FichierInline {
  mime: string
  octets: Uint8Array
}

/**
 * Décode une adresse `data:`. Rend null si elle n'en est pas une, ou si son
 * contenu n'est pas du base64 lisible — un fichier tronqué à la copie, par
 * exemple, qu'il vaut mieux signaler que téléverser à moitié.
 */
export const lireAdresseBase64 = (adresse: string): FichierInline | null => {
  const trouve = RE_DATA_URL.exec(adresse)

  if (!trouve?.[2]) {
    return null
  }

  try {
    const brut = atob(trouve[3])
    const octets = new Uint8Array(brut.length)

    for (let i = 0; i < brut.length; i++) {
      octets[i] = brut.charCodeAt(i)
    }

    return { mime: trouve[1], octets }
  } catch {
    return null
  }
}

/**
 * Encode des octets en base64.
 *
 * PAR TRANCHES, et c'est nécessaire : `String.fromCharCode(...octets)` sur une
 * vidéo de 25 Mo étale des millions d'arguments sur la pile d'appel et fait
 * lever « Maximum call stack size exceeded ».
 */
export const enBase64 = (octets: Uint8Array): string => {
  const TRANCHE = 0x8000
  let texte = ""

  for (let i = 0; i < octets.length; i += TRANCHE) {
    texte += String.fromCharCode(...octets.subarray(i, i + TRANCHE))
  }

  return btoa(texte)
}

export const adresseBase64 = (mime: string, octets: Uint8Array) =>
  `data:${mime};base64,${enBase64(octets)}`

/** L'empreinte d'un fichier, pour ne pas stocker deux fois le même. */
export const empreinteDuFichier = async (octets: Uint8Array) => {
  const condense = await crypto.subtle.digest("SHA-256", octets.slice())

  return [...new Uint8Array(condense)]
    .map((o) => o.toString(16).padStart(2, "0"))
    .join("")
}

export const RE_EMPREINTE = /^[0-9a-f]{64}$/
