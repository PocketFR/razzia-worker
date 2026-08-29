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

-- game.json, plus les clés API saisies depuis /manager/config.
-- encrypted = 1 quand la valeur est scellée en AES-GCM par la clé maîtresse.
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT    PRIMARY KEY,
  value      TEXT    NOT NULL,
  encrypted  INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- L'index PIN -> partie. Un Durable Object ne s'adresse que par son nom, donc
-- la recherche par code d'invitation (l'ancien getGameByInviteCode du Registry)
-- a besoin de cette table. Purgée par Cron Trigger.
CREATE TABLE IF NOT EXISTS games (
  invite_code TEXT    PRIMARY KEY,
  game_id     TEXT    NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL
);
