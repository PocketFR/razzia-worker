-- Schéma D1 de razzia. Remplace l'arborescence config/ du serveur Node.
--
-- Les identifiants ne dérivent plus d'un nom de fichier : l'amont les en avait
-- déjà découplés (791e7f8), et il n'y a plus de fichier du tout ici. Deux quiz
-- peuvent donc porter le même titre sans se marcher dessus — la déduplication
-- « slug, slug-2, slug-3 » héritée du pyscript n'a plus lieu d'être.

CREATE TABLE IF NOT EXISTS quizz (
  id         TEXT    PRIMARY KEY,
  subject    TEXT    NOT NULL,
  json       TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- subject, date et player_count sont recopiés hors du JSON : getResultsMeta() ne
-- renvoie que ces quatre champs, donc le listage n'a aucun JSON à désérialiser.
CREATE TABLE IF NOT EXISTS results (
  id           TEXT    PRIMARY KEY,
  subject      TEXT    NOT NULL,
  date         TEXT    NOT NULL,
  player_count INTEGER NOT NULL,
  json         TEXT    NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS results_date ON results (date DESC);

-- Le mot de passe animateur, plus les clés API saisies depuis /manager/config.
--
-- Deux protections distinctes cohabitent ici, et la colonne `encrypted` ne
-- décrit que la première :
--   encrypted = 1  valeur scellée en AES-GCM, donc RÉVERSIBLE — c'est le cas
--                  des clés API, qu'il faut pouvoir relire pour s'en servir ;
--   managerPassword  empreinte à clé, préfixée « hmac$ », donc À SENS UNIQUE.
--                  Sa colonne encrypted vaut 0 : ce n'est pas un chiffré.
--                  Une valeur sans ce préfixe est du clair hérité du
--                  game.json de l'amont, converti à la première connexion.
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT    PRIMARY KEY,
  value      TEXT    NOT NULL,
  encrypted  INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- L'index PIN -> partie. Un Durable Object ne s'adresse que par son nom, donc
-- la recherche par code d'invitation (l'ancien getGameByInviteCode du Registry)
-- a besoin de cette table. Purgée par Cron Trigger.
-- quizz_id et manager_client_id sont ici et non dans le Durable Object :
-- celui-ci n'existe pas encore au moment de la création. Il s'initialise à la
-- première connexion en lisant cette ligne, plutôt que de croire un client
-- qui pourrait se déclarer animateur d'une partie qui n'est pas la sienne.
CREATE TABLE IF NOT EXISTS games (
  invite_code       TEXT    PRIMARY KEY,
  game_id           TEXT    NOT NULL UNIQUE,
  quizz_id          TEXT    NOT NULL,
  manager_client_id TEXT    NOT NULL,
  created_at        INTEGER NOT NULL
);

-- Le branding modifiable depuis l'interface : logo, favicon, fond.
--
-- En BLOB et non en base64 : D1 plafonne une ligne à 2 Mo, et l'encodage
-- base64 gonflerait de 33 % un fond d'écran qui frôle déjà la limite.
--
-- Les couleurs, le nom et la police n'ont pas leur place ici : ils tiennent en
-- un JSON, rangé dans `settings` sous la clé brandingTheme. Ce qui vaut une
-- table à part, c'est le binaire — et lui seul.
CREATE TABLE IF NOT EXISTS branding (
  name       TEXT    PRIMARY KEY,
  mime       TEXT    NOT NULL,
  bytes      BLOB    NOT NULL,
  updated_at INTEGER NOT NULL
);
