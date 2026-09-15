// Les médias téléversés : ce qui se décide sans R2 ni D1.
//
//   npx tsx scripts/test-media.mts
//
// Trois décisions coûtent cher si elles se trompent, et aucune ne se voit à
// l'usage :
//
//   - le RAMASSAGE. Une référence manquée supprime un fichier encore utilisé ;
//     la diapo s'affiche vide le soir même, sans erreur nulle part.
//   - les CONTRÔLES D'ENVOI. Un plafond mal compté fait payer R2, qui facture
//     au-delà du quota gratuit.
//   - les ADRESSES D'IMAGES. `/cdn-cgi/image` sur une instance où le service
//     n'existe pas casse toutes les images, et sur une adresse externe il
//     consommerait le quota pour les images de n'importe qui.

import {
  adresseImage,
  cleDuMedia,
  genreDuMime,
  mediasReferences,
  PLAFOND_STOCKAGE_MEDIA,
  srcsetImage,
  TAILLE_MAX_MEDIA,
} from "../../common/src/media.ts"
import {
  aRamasser,
  examinerEnvoi,
  RAMASSAGE_PAR_PASSAGE,
  signatureReconnue,
  verifierLaSignature,
} from "../src/services/media"

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

const cle = (n: number) =>
  `0199a1b2-c3d4-4e5f-8a9b-${String(n).padStart(12, "0")}`

// ── Références ─────────────────────────────────────────────────────────────
console.log("=== références ===")

{
  const json = JSON.stringify({
    subject: "Soirée",
    questions: [
      { question: "Q", media: { type: "image", url: `/media/${cle(1)}` } },
      { question: "D", fond: `/media/${cle(2)}` },
      {
        type: "groupe",
        questions: [{ media: { type: "video", url: `/media/${cle(1)}` } }],
      },
      // Un champ qui n'existe pas encore : il doit compter d'office.
      { avenir: { vignette: `/media/${cle(3)}` } },
      {
        media: { type: "image", url: "https://exemple.test/media/pas-une-cle" },
      },
    ],
  })
  const trouvees = mediasReferences(json)

  verifier(
    "toutes les références, où qu'elles soient, champs futurs compris",
    trouvees.size === 3 && [1, 2, 3].every((n) => trouvees.has(cle(n))),
    [...trouvees].join(", "),
  )
}

verifier(
  "la clé d'une adresse exacte",
  cleDuMedia(`/media/${cle(7)}`) === cle(7),
)
verifier(
  "rien pour une adresse à paramètre",
  cleDuMedia(`/media/${cle(7)}?v=2`) === null,
)

// ── Ramassage ──────────────────────────────────────────────────────────────
console.log("=== ramassage ===")

{
  const anciens = [
    { cle: cle(1), complet: 1 }, // cité : gardé
    { cle: cle(2), complet: 1 }, // plus cité : supprimé
    { cle: cle(3), complet: 0 }, // cité mais incomplet : supprimé
  ]
  const quiz = [
    JSON.stringify({ media: { url: `/media/${cle(1)}` } }),
    JSON.stringify({ fond: `/media/${cle(3)}` }),
  ]
  const retires = aRamasser(anciens, quiz)

  verifier("un média cité par un quiz est gardé", !retires.includes(cle(1)))
  verifier(
    "un média que plus rien ne cite est supprimé",
    retires.includes(cle(2)),
  )
  verifier(
    "un envoi incomplet est supprimé même cité",
    retires.includes(cle(3)),
  )
  verifier(
    "un quiz sans média ne protège rien",
    aRamasser([{ cle: cle(9), complet: 1 }], ["{}"]).includes(cle(9)),
  )
}

{
  const beaucoup = Array.from({ length: 200 }, (_, i) => ({
    cle: cle(i),
    complet: 1,
  }))

  verifier(
    "au plus un lot par passage, sous les 100 paramètres d'une requête D1",
    aRamasser(beaucoup, []).length === RAMASSAGE_PAR_PASSAGE &&
      RAMASSAGE_PAR_PASSAGE <= 100,
  )
}

// ── Contrôles d'envoi ──────────────────────────────────────────────────────
console.log("=== contrôles d'envoi ===")

const refus = (mime: string, taille: number, occupe = 0) => {
  const r = examinerEnvoi(mime, taille, occupe)

  return "refus" in r ? r.refus : null
}

verifier(
  "une image de 2 Mo tout juste passe",
  refus("image/webp", TAILLE_MAX_MEDIA.image) === null,
)
verifier(
  "un octet de plus, non",
  refus("image/webp", TAILLE_MAX_MEDIA.image + 1) === "errors:media.tropGros",
)
verifier(
  "une vidéo de 25 Mo tout juste passe",
  refus("video/mp4", TAILLE_MAX_MEDIA.video) === null,
)
verifier(
  "un son de 10 Mo et un octet, non",
  refus("audio/mpeg", TAILLE_MAX_MEDIA.audio + 1) === "errors:media.tropGros",
)
verifier(
  "sans taille annoncée, refus",
  refus("image/png", NaN) === "errors:media.tailleInconnue",
)
verifier(
  "une taille nulle, refus",
  refus("image/png", 0) === "errors:media.tailleInconnue",
)
verifier(
  "le plafond compte ce qui est déjà stocké",
  refus("video/mp4", 1024, PLAFOND_STOCKAGE_MEDIA - 1000) ===
    "errors:media.plafond",
)
verifier(
  "pile au plafond, ça passe",
  refus("video/mp4", 1000, PLAFOND_STOCKAGE_MEDIA - 1000) === null,
)
verifier(
  "le plafond reste sous les 10 Go gratuits de R2",
  PLAFOND_STOCKAGE_MEDIA < 10 * 1024 ** 3,
)
verifier(
  "le genre se déduit du type",
  genreDuMime("audio/ogg") === "audio" && genreDuMime("text/html") === null,
)

// ── Signatures ─────────────────────────────────────────────────────────────
console.log("=== signatures ===")

const octets = (...parties: Array<number[] | string>) =>
  Uint8Array.from(
    parties.flatMap((p) =>
      typeof p === "string" ? Array.from(p, (c) => c.charCodeAt(0)) : p,
    ),
  )

const VRAIS: Array<[string, Uint8Array]> = [
  ["image/jpeg", octets([0xff, 0xd8, 0xff, 0xe0], "JFIF")],
  [
    "image/png",
    octets([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "IHDR"),
  ],
  ["image/gif", octets("GIF89a......")],
  ["image/webp", octets("RIFF", [1, 2, 3, 4], "WEBPVP8 ")],
  ["image/avif", octets([0, 0, 0, 0x1c], "ftypavif")],
  ["audio/mpeg", octets("ID3", [4, 0, 0, 0, 0, 0, 0, 0, 0])],
  ["audio/mpeg", octets([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0, 0, 0, 0, 0])],
  ["audio/mp4", octets([0, 0, 0, 0x20], "ftypM4A ")],
  ["audio/ogg", octets("OggS", [0, 2, 0, 0, 0, 0, 0, 0])],
  ["video/mp4", octets([0, 0, 0, 0x18], "ftypmp42")],
  ["video/webm", octets([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0])],
]

for (const [mime, contenu] of VRAIS) {
  verifier(`un vrai ${mime} est reconnu`, signatureReconnue(contenu, mime))
}

const html = octets("<html><script>alert(1)</script>")

verifier(
  "du HTML déclaré image/png est refusé",
  !signatureReconnue(html, "image/png"),
)
verifier(
  "une vidéo déclarée image est refusée",
  !signatureReconnue(VRAIS[9][1], "image/jpeg"),
)
verifier(
  "un type inconnu n'est jamais reconnu",
  !signatureReconnue(VRAIS[0][1], "image/svg+xml"),
)

// Le flux : il doit retenir le début le temps de juger, puis tout laisser
// passer intact — et refuser AVANT d'avoir transmis le moindre octet.
const traverser = async (morceaux: Uint8Array[], mime: string) => {
  const { flux, refusee } = verifierLaSignature(mime)
  const source = new ReadableStream<Uint8Array>({
    start(c) {
      morceaux.forEach((m) => c.enqueue(m))
      c.close()
    },
  })
  const recus: number[] = []

  try {
    for await (const m of source.pipeThrough(flux)) {
      recus.push(...m)
    }

    return { recus, erreur: false, refusee: refusee() }
  } catch {
    return { recus, erreur: true, refusee: refusee() }
  }
}

{
  const png = octets(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    "IHDRdonnees",
  )
  // Découpé en morceaux plus petits que la signature : le cas réel d'un
  // corps de requête arrivant par paquets.
  const r = await traverser(
    [png.slice(0, 3), png.slice(3, 9), png.slice(9)],
    "image/png",
  )

  verifier(
    "un fichier conforme traverse intact, même découpé sous la signature",
    !r.erreur &&
      r.recus.length === png.length &&
      r.recus.every((v, i) => v === png[i]),
  )
}

{
  const r = await traverser([html.slice(0, 5), html.slice(5)], "image/png")

  verifier(
    "un fichier non conforme fait échouer le flux",
    r.erreur && r.refusee,
  )
  verifier(
    "sans qu'aucun octet ne soit transmis",
    r.recus.length === 0,
    `${r.recus.length} octets`,
  )
}

// ── Adresses d'images ──────────────────────────────────────────────────────
console.log("=== adresses d'images ===")

const locale = `/media/${cle(5)}`

verifier(
  "transformations actives : l'image passe par /cdn-cgi/image",
  adresseImage(locale, 640, true) ===
    `/cdn-cgi/image/width=640,format=auto,onerror=redirect${locale}`,
)
verifier(
  "transformations inactives : l'adresse nue",
  adresseImage(locale, 640, false) === locale,
)
verifier(
  "une adresse externe n'y passe jamais, même activées",
  adresseImage("https://exemple.test/a.png", 640, true) ===
    "https://exemple.test/a.png",
)
verifier(
  "le srcset ne propose que les largeurs fixes",
  srcsetImage(locale, true)
    ?.split(", ")
    .map((e) => e.split(" ")[1])
    .join() === "640w,1280w,1920w,2560w",
)
verifier(
  "pas de srcset sans transformations",
  srcsetImage(locale, false) === undefined,
)

console.log(`\n${passes} vérifications passées, ${echecs} échec(s)`)
process.exit(echecs === 0 ? 0 : 1)
