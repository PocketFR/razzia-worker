// <input type="color"> n'accepte QUE la forme #rrggbb, et retombe
// silencieusement sur le noir devant tout le reste. C'est une limite de
// l'élément, pas du CSS : la feuille de style, elle, comprend « #555 » aussi
// bien que « red ».
//
// La forme à trois chiffres est donc dépliée avant d'être donnée à la
// pastille — c'est celle du thème livré, dont les deux couleurs s'affichaient
// noires. Les autres notations (nom de couleur, rgb(), variable) restent hors
// de portée de l'élément ; la pastille montre alors du noir, mais le champ
// texte à côté garde la valeur réelle et reste seul maître.
//
// Dans un fichier à part, et non dans le composant : c'est la seule façon de
// l'éprouver sans monter React.

const HEXA_LONG = /^#[0-9a-f]{6}$/i
const HEXA_COURT = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i

export const pourPastille = (valeur: string): string => {
  if (HEXA_LONG.test(valeur)) {
    return valeur
  }

  const court = HEXA_COURT.exec(valeur)

  if (!court) {
    return "#000000"
  }

  const [, r, v, b] = court

  return `#${r}${r}${v}${v}${b}${b}`
}
