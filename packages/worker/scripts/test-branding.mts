/*
 * Le contrôle du contenu d'un SVG, et le dépliage des couleurs courtes.
 *
 *   npx tsx scripts/test-branding.mts
 *
 * Ces deux fonctions sont pures : elles se vérifient sans serveur, ce qui
 * permet d'aligner beaucoup de cas — et l'examen d'un SVG ne vaut que par le
 * nombre de formes qu'il connaît.
 *
 * RAPPEL, parce qu'il décide de la lecture de ces tests : cet examen n'est
 * pas une preuve d'innocuité. Une analyse par expressions régulières sur du
 * XML se contourne. La garantie tient à la Content-Security-Policy posée au
 * service, éprouvée elle par smoke-branding ; ce qui suit écarte l'accident
 * et le fichier ramassé n'importe où.
 */

import { dangerDuSvg } from "../src/services/branding"
import { pourPastille } from "../../web/src/features/manager/lib/couleur"

let echecs = 0
let passes = 0

const verifier = (nom: string, condition: boolean, detail = "") => {
  if (condition) {
    passes += 1
    console.log(`  ok ${nom}`)
  } else {
    echecs += 1
    console.log(`  ÉCHEC ${nom}${detail ? ` — ${detail}` : ""}`)
  }
}

const octets = (texte: string) => new TextEncoder().encode(texte)

const PROPRE = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <title>Logo</title>
  <path d="M4 4h16v16H4z" fill="#555555" stroke-linejoin="round"/>
  <circle cx="12" cy="12" r="5" style="fill:#fff"/>
</svg>`

console.log("— un SVG ordinaire passe")
verifier("le logo type est accepté", dangerDuSvg(octets(PROPRE)) === null,
  String(dangerDuSvg(octets(PROPRE))))

// Le piège des faux positifs : « font-family » contient « on », et une
// déclaration d'espace de noms contient « http:// ». Ni l'un ni l'autre ne
// doit déclencher le refus, sans quoi plus aucun SVG ne passerait.
const COURANT = `<svg xmlns="http://www.w3.org/2000/svg"
  xmlns:xlink="http://www.w3.org/1999/xlink">
  <text font-family="Rubik" stroke-linejoin="round">Bonjour</text>
  <image xlink:href="data:image/png;base64,iVBORw0KGgo="/>
</svg>`
verifier("espaces de noms et font-family ne déclenchent rien",
  dangerDuSvg(octets(COURANT)) === null, String(dangerDuSvg(octets(COURANT))))

console.log("— ce qui doit être refusé")
const refuse = (nom: string, contenu: string) =>
  verifier(nom, dangerDuSvg(octets(contenu)) !== null)

refuse("script", `<svg><script>alert(1)</script></svg>`)
refuse("script en majuscules", `<svg><SCRIPT>alert(1)</SCRIPT></svg>`)
refuse("script espacé", `<svg>< script >alert(1)</script></svg>`)
refuse("gestionnaire onload", `<svg onload="alert(1)"></svg>`)
refuse("gestionnaire onclick sur une forme", `<svg><rect onclick="x()"/></svg>`)
refuse("URL javascript:", `<svg><a href="javascript:alert(1)">x</a></svg>`)
refuse(
  "javascript: masqué en entités décimales",
  `<svg><a href="&#106;avascript:alert(1)">x</a></svg>`,
)
refuse(
  "javascript: masqué en entités hexadécimales",
  `<svg><a href="&#x6a;avascript:alert(1)">x</a></svg>`,
)
refuse("foreignObject", `<svg><foreignObject><body/></foreignObject></svg>`)
refuse("iframe", `<svg><iframe src="/"/></svg>`)
refuse("entité XML", `<!DOCTYPE svg [<!ENTITY x "y">]><svg/>`)
refuse("animation SMIL", `<svg><animate attributeName="href" to="x"/></svg>`)
refuse("référence externe", `<svg><use href="https://ailleurs/x.svg#a"/></svg>`)
refuse("image distante", `<svg><image xlink:href="//ailleurs/x.png"/></svg>`)
refuse("ce n'est pas un SVG", `<html><body>coucou</body></html>`)

verifier(
  "un binaire qui n'est pas de l'UTF-8 est refusé",
  dangerDuSvg(new Uint8Array([0xff, 0xfe, 0x00, 0x01])) !== null,
)

console.log("— couleurs hexadécimales courtes")
verifier("#555 devient #555555", pourPastille("#555") === "#555555",
  pourPastille("#555"))
verifier("#000 devient #000000", pourPastille("#000") === "#000000")
verifier("#AbC déplie en gardant la casse", pourPastille("#AbC") === "#AAbbCC",
  pourPastille("#AbC"))
verifier("une couleur longue est rendue telle quelle",
  pourPastille("#ff9900") === "#ff9900")
verifier("un nom de couleur retombe sur le noir",
  pourPastille("red") === "#000000")
verifier("une valeur vide retombe sur le noir", pourPastille("") === "#000000")
verifier("une forme à quatre chiffres n'est pas dépliée à tort",
  pourPastille("#5555") === "#000000", pourPastille("#5555"))

console.log(`\n${passes} tests passés, ${echecs} échec(s)`)
process.exit(echecs ? 1 : 0)
