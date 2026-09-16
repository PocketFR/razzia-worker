// L'échange de quiz : inliner les fichiers, et les défaire.
//
//   npx tsx scripts/test-echange.mts
//
// Deux règles décident de ce qu'un import donne, et aucune ne se voit :
//
//   - LE PARCOURS EST GÉNÉRIQUE. Une liste de champs écrite à la main aurait
//     oublié `fond` le jour où il est arrivé, et oubliera le suivant : le
//     fichier partirait sans son image, sans que rien ne le signale.
//   - UN FICHIER PERDU FAIT PERDRE SON CHAMP, jamais le quiz. C'est le choix
//     d'exploitation retenu : mieux vaut un quiz à retravailler dans l'éditeur
//     que pas de quiz du tout. Encore faut-il que ce qui reste soit VALIDE —
//     un média sans adresse ne l'est pas.

import {
  adresseBase64,
  adressesDuDocument,
  empreinteDuFichier,
  enBase64,
  estAdresseBase64,
  lireAdresseBase64,
  remplacerAdresses,
} from "../../common/src/echange.ts"
import { estMediaLocal, RE_CLE_MEDIA } from "../../common/src/media.ts"
import { quizzValidator } from "../../common/src/validators/quizz.ts"

let passes = 0
let echecs = 0

const verifier = (nom: string, ok: boolean, detail = "") => {
  if (ok) {
    passes += 1
    console.log(`  ok ${nom}`)
  } else {
    echecs += 1
    console.log(`  ÉCHEC ${nom}${detail ? ` — ${detail}` : ""}`)
  }
}

const cle = (n: number) => String(n).padStart(64, "0")
const media = (n: number) => `/media/${cle(n)}`

const quizz = {
  subject: "Soirée",
  questions: [
    {
      type: "single",
      question: "Avec une image",
      answers: ["a", "b"],
      solutions: [0],
      cooldown: 5,
      time: 20,
      media: { type: "image", url: media(1) },
      fond: media(2),
    },
    {
      type: "groupe",
      titre: "Interlude",
      questions: [
        {
          type: "single",
          question: "Dans le groupe",
          answers: ["a", "b"],
          solutions: [0],
          cooldown: 5,
          time: 20,
          // Le même fichier qu'ailleurs : il ne doit voyager qu'une fois.
          media: { type: "video", url: media(1) },
        },
      ],
    },
    {
      type: "diapo",
      question: "Texte",
      answers: [],
      solutions: [],
      cooldown: 5,
      time: 20,
      media: { type: "texte", texte: "Rien à téléverser" },
    },
    {
      type: "single",
      question: "Adresse externe",
      answers: ["a", "b"],
      solutions: [0],
      cooldown: 5,
      time: 20,
      media: { type: "image", url: "https://exemple.test/a.png" },
      // Un champ que personne n'a encore inventé.
      vignette: media(3),
    },
  ],
}

// ── Le parcours ────────────────────────────────────────────────────────────
console.log("=== le parcours ===")

const trouvees = adressesDuDocument(quizz, estMediaLocal)

verifier(
  "toutes les adresses, sans doublon",
  trouvees.length === 3 && trouvees.every((a) => a.startsWith("/media/")),
  trouvees.join(", "),
)
verifier("le fond compte comme le média", trouvees.includes(media(2)))
verifier("un champ inconnu aussi", trouvees.includes(media(3)))
verifier(
  "une adresse externe ne bouge pas",
  !trouvees.includes("https://exemple.test/a.png"),
)

// ── Le remplacement, et ce qu'il élague ────────────────────────────────────
console.log("=== le remplacement ===")

{
  const table = new Map<string, string | null>([
    [media(1), "data:image/webp;base64,AAA"],
    [media(2), null], // fond perdu
    [media(3), null], // champ inconnu perdu
  ])
  const refait = remplacerAdresses(quizz, table) as typeof quizz
  const q = refait.questions as Array<Record<string, never>>

  verifier(
    "une adresse connue est remplacée partout",
    JSON.stringify(refait).split("data:image/webp;base64,AAA").length - 1 === 2,
  )
  verifier("un fond perdu disparaît", !("fond" in q[0]))
  verifier(
    "la question, elle, reste",
    q[0].question === ("Avec une image" as never),
  )
  verifier("un champ inconnu perdu disparaît aussi", !("vignette" in q[3]))
  verifier("le texte d'une diapo n'est pas touché", "media" in q[2])
  verifier(
    "l'adresse externe est intacte",
    (q[3].media as { url: string }).url === "https://exemple.test/a.png",
  )
}

{
  // LE CAS QUI COMPTE : le média lui-même est perdu. Le garder sans adresse
  // rendrait la question invalide, et le quiz entier refusé à l'import.
  const table = new Map<string, string | null>([[media(1), null]])
  const refait = remplacerAdresses(quizz, table) as typeof quizz
  const q = refait.questions as Array<Record<string, unknown>>

  verifier("un média perdu emporte son objet", !("media" in q[0]))
  verifier(
    "y compris au fond d'un groupe",
    !("media" in (q[1].questions as Array<Record<string, unknown>>)[0]),
  )

  const verdict = quizzValidator.safeParse(refait)

  verifier(
    "et le quiz amputé reste enregistrable",
    verdict.success,
    verdict.success ? "" : verdict.error.issues[0].message,
  )
}

// ── Base64 ─────────────────────────────────────────────────────────────────
console.log("=== base64 ===")

{
  // Plus long qu'une tranche d'encodage : `String.fromCharCode(...octets)` sur
  // un tableau de cette taille ferait déborder la pile d'appel.
  const grand = new Uint8Array(200_000).map((_, i) => i % 256)
  const adresse = adresseBase64("video/mp4", grand)
  const relu = lireAdresseBase64(adresse)

  verifier("c'est bien une adresse de données", estAdresseBase64(adresse))
  verifier("le type survit", relu?.mime === "video/mp4")
  verifier(
    "les octets reviennent à l'identique, même sur 200 000",
    relu !== null &&
      relu.octets.length === grand.length &&
      relu.octets.every((o, i) => o === grand[i]),
  )
  verifier(
    "le gonflement est bien d'un tiers",
    Math.abs(enBase64(grand).length / grand.length - 4 / 3) < 0.01,
  )
}

verifier(
  "une adresse sans base64 est refusée",
  lireAdresseBase64("data:text/plain,bonjour") === null,
)
verifier(
  "du base64 illisible est refusé",
  lireAdresseBase64("data:image/png;base64,ceci n'est pas du base64 §") ===
    null,
)
verifier("une adresse ordinaire n'en est pas une", !estAdresseBase64(media(1)))

// ── L'empreinte ────────────────────────────────────────────────────────────
console.log("=== l'empreinte ===")

{
  const abc = new TextEncoder().encode("abc")
  const empreinte = await empreinteDuFichier(abc)

  // La valeur de référence de SHA-256("abc").
  verifier(
    "c'est bien un SHA-256",
    empreinte ===
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    empreinte,
  )
  verifier("et une clé de média acceptable", RE_CLE_MEDIA.test(empreinte))
  verifier(
    "le même contenu donne la même clé",
    (await empreinteDuFichier(new TextEncoder().encode("abc"))) === empreinte,
  )
  verifier(
    "un contenu différent, une autre",
    (await empreinteDuFichier(new TextEncoder().encode("abd"))) !== empreinte,
  )
}

// ── L'aller-retour complet ─────────────────────────────────────────────────
console.log("=== l'aller-retour ===")

{
  const octets = new TextEncoder().encode("de faux octets d'image")
  const exporte = remplacerAdresses(
    quizz,
    new Map([
      [media(1), adresseBase64("image/webp", octets)],
      [media(2), adresseBase64("image/webp", octets)],
      [media(3), adresseBase64("image/webp", octets)],
    ]),
  )

  const inlinees = adressesDuDocument(exporte, estAdresseBase64)

  verifier(
    "l'export ne laisse plus aucune adresse locale",
    adressesDuDocument(exporte, estMediaLocal).length === 0,
  )
  verifier(
    "et le même fichier n'y figure qu'une fois",
    inlinees.length === 1,
    `${inlinees.length} adresses distinctes`,
  )

  // À l'import, le fichier reprend l'adresse de son empreinte.
  const cleRendue = `/media/${await empreinteDuFichier(octets)}`
  const importe = remplacerAdresses(
    exporte,
    new Map(inlinees.map((a) => [a, cleRendue])),
  )

  verifier(
    "l'import rend un quiz sans base64",
    adressesDuDocument(importe, estAdresseBase64).length === 0,
  )
  verifier(
    "dont les adresses sont celles du contenu",
    adressesDuDocument(importe, estMediaLocal).join() === cleRendue,
  )

  const verdict = quizzValidator.safeParse(importe)

  verifier(
    "et qui s'enregistre",
    verdict.success,
    verdict.success ? "" : verdict.error.issues[0].message,
  )
}

console.log(`\n${passes} vérifications passées, ${echecs} échec(s)`)
process.exit(echecs === 0 ? 0 : 1)
