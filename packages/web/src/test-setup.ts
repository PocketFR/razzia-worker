// I18n est initialisé pour de vrai : les libellés servent d'ancrage aux tests,
// et une clé manquante doit se voir. jsdom n'annonce aucune langue, le
// détecteur retombe donc sur l'anglais — on fixe le français, celui du projet.
import i18n from "@razzia/web/i18n"

await i18n.changeLanguage("fr")
