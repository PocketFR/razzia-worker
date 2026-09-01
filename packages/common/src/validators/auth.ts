import z from "zod"

// Le pseudo est ÉBARBÉ avant d'être mesuré.
//
// Les claviers de téléphone ajoutent volontiers une espace en validant une
// suggestion. Elle passait jusque dans le classement, où elle décalait le nom,
// et comptait dans la longueur — « Marie-Christine » plus une espace était
// refusé comme trop long alors qu'il tient.
//
// L'ordre compte : `.trim()` avant les bornes, sinon elles mesureraient la
// version non ébarbée. Et c'est la valeur ébarbée que rend `safeParse`, donc
// c'est elle qui est enregistrée.
export const usernameValidator = z
  .string()
  .trim()
  .min(1, "errors:auth.usernameTooShort")
  .max(20, "errors:auth.usernameTooLong")

export const inviteCodeValidator = z
  .string()
  .length(6, "errors:auth.invalidInviteCode")
