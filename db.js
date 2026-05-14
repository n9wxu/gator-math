'use strict';
const Database = require('better-sqlite3');
const path     = require('path');
const crypto   = require('crypto');

const db = new Database(path.join(__dirname, 'gatormath.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at    INTEGER DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token     TEXT PRIMARY KEY,
    player_id INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS player_stats (
    player_id   INTEGER PRIMARY KEY,
    best_score  INTEGER DEFAULT 0,
    total_games INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS operation_stats (
    player_id         INTEGER NOT NULL,
    operation         TEXT NOT NULL,
    correct_eaten     INTEGER DEFAULT 0,
    incorrect_eaten   INTEGER DEFAULT 0,
    correct_presented INTEGER DEFAULT 0,
    PRIMARY KEY (player_id, operation)
  );
  CREATE TABLE IF NOT EXISTS fact_stats (
    player_id       INTEGER NOT NULL,
    operation       TEXT NOT NULL,
    operand         INTEGER NOT NULL,
    correct_eaten   INTEGER DEFAULT 0,
    incorrect_eaten INTEGER DEFAULT 0,
    presented       INTEGER DEFAULT 0,
    PRIMARY KEY (player_id, operation, operand)
  );
  CREATE TABLE IF NOT EXISTS focus_facts (
    player_id INTEGER NOT NULL,
    operation TEXT NOT NULL,
    operand   INTEGER NOT NULL,
    PRIMARY KEY (player_id, operation, operand)
  );
`);

const stmts = {
  findPlayer:       db.prepare('SELECT * FROM players WHERE username = ?'),
  getPlayerById:    db.prepare('SELECT id, username, created_at FROM players WHERE id = ?'),
  insertPlayer:     db.prepare('INSERT INTO players (username, password_hash) VALUES (?, ?)'),
  initStats:        db.prepare('INSERT OR IGNORE INTO player_stats (player_id) VALUES (?)'),
  getSession:       db.prepare('SELECT * FROM sessions WHERE token = ?'),
  insertSession:    db.prepare('INSERT INTO sessions (token, player_id) VALUES (?, ?)'),
  deleteSession:    db.prepare('DELETE FROM sessions WHERE token = ?'),
  deleteAllSessions:db.prepare('DELETE FROM sessions WHERE player_id = ?'),
  getPlayerStats:   db.prepare('SELECT * FROM player_stats WHERE player_id = ?'),
  getOpStats:       db.prepare('SELECT * FROM operation_stats WHERE player_id = ?'),
  getFactStats:     db.prepare('SELECT * FROM fact_stats WHERE player_id = ?'),
  getFocusFacts:    db.prepare('SELECT operation, operand FROM focus_facts WHERE player_id = ? ORDER BY operation, operand'),
  clearFocusFacts:  db.prepare('DELETE FROM focus_facts WHERE player_id = ?'),
  insertFocusFact:  db.prepare('INSERT OR IGNORE INTO focus_facts (player_id, operation, operand) VALUES (?, ?, ?)'),
  allPlayers:       db.prepare('SELECT id, username, created_at FROM players ORDER BY username COLLATE NOCASE'),
  updateBestScore:  db.prepare('UPDATE player_stats SET best_score = MAX(best_score, ?) WHERE player_id = ?'),
  incGames:         db.prepare('UPDATE player_stats SET total_games = total_games + 1 WHERE player_id = ?'),
  updatePassword:   db.prepare('UPDATE players SET password_hash = ? WHERE id = ?'),
  deletePlayer:     db.prepare('DELETE FROM players WHERE id = ?'),
  deletePlayerStats:db.prepare('DELETE FROM player_stats WHERE player_id = ?'),
  deleteOpStats:    db.prepare('DELETE FROM operation_stats WHERE player_id = ?'),
  deleteFactStats:  db.prepare('DELETE FROM fact_stats WHERE player_id = ?'),
  deleteFocusFacts: db.prepare('DELETE FROM focus_facts WHERE player_id = ?'),
  upsertOp:         db.prepare('INSERT OR IGNORE INTO operation_stats (player_id, operation) VALUES (?, ?)'),
  upsertFact:       db.prepare('INSERT OR IGNORE INTO fact_stats (player_id, operation, operand) VALUES (?, ?, ?)'),
  incOpCorrect:     db.prepare('UPDATE operation_stats SET correct_eaten   = correct_eaten   + 1 WHERE player_id = ? AND operation = ?'),
  incOpIncorrect:   db.prepare('UPDATE operation_stats SET incorrect_eaten = incorrect_eaten + 1 WHERE player_id = ? AND operation = ?'),
  incOpPresented:   db.prepare('UPDATE operation_stats SET correct_presented = correct_presented + 1 WHERE player_id = ? AND operation = ?'),
  incFactCorrect:   db.prepare('UPDATE fact_stats SET correct_eaten   = correct_eaten   + 1 WHERE player_id = ? AND operation = ? AND operand = ?'),
  incFactIncorrect: db.prepare('UPDATE fact_stats SET incorrect_eaten = incorrect_eaten + 1 WHERE player_id = ? AND operation = ? AND operand = ?'),
  incFactPresented: db.prepare('UPDATE fact_stats SET presented       = presented       + 1 WHERE player_id = ? AND operation = ? AND operand = ?'),
};

function createToken() { return crypto.randomBytes(32).toString('hex'); }

function register(username, passwordHash) {
  const r = stmts.insertPlayer.run(username, passwordHash);
  stmts.initStats.run(r.lastInsertRowid);
  return r.lastInsertRowid;
}

function findPlayer(username)  { return stmts.findPlayer.get(username); }
function getPlayerById(id)     { return stmts.getPlayerById.get(id); }

function createSession(playerId) {
  const token = createToken();
  stmts.insertSession.run(token, playerId);
  return token;
}
function getSession(token)   { return token ? stmts.getSession.get(token) : null; }
function deleteSession(token){ stmts.deleteSession.run(token); }

function getStats(playerId) {
  return {
    playerStats:    stmts.getPlayerStats.get(playerId) || { player_id: playerId, best_score: 0, total_games: 0 },
    operationStats: stmts.getOpStats.all(playerId),
    factStats:      stmts.getFactStats.all(playerId),
  };
}

function getAllPlayerStats() {
  return stmts.allPlayers.all().map(p => ({
    ...p,
    ...getStats(p.id),
    focusFacts: stmts.getFocusFacts.all(p.id),
  }));
}

function getFocusFacts(playerId) {
  return stmts.getFocusFacts.all(playerId);
}

const setFocusFacts = db.transaction((playerId, facts) => {
  stmts.clearFocusFacts.run(playerId);
  for (const { operation, operand } of facts) {
    stmts.insertFocusFact.run(playerId, operation, operand);
  }
});

function resetPassword(playerId, newHash) {
  stmts.updatePassword.run(newHash, playerId);
  stmts.deleteAllSessions.run(playerId);
}

const deletePlayer = db.transaction(playerId => {
  stmts.deleteAllSessions.run(playerId);
  stmts.deletePlayerStats.run(playerId);
  stmts.deleteOpStats.run(playerId);
  stmts.deleteFactStats.run(playerId);
  stmts.deleteFocusFacts.run(playerId);
  stmts.deletePlayer.run(playerId);
});

const recordPresented = db.transaction((playerId, operation, operands) => {
  stmts.upsertOp.run(playerId, operation);
  stmts.incOpPresented.run(playerId, operation);
  for (const op of operands) {
    stmts.upsertFact.run(playerId, operation, op);
    stmts.incFactPresented.run(playerId, operation, op);
  }
});

const recordEaten = db.transaction((playerId, operation, operands, isCorrect) => {
  stmts.upsertOp.run(playerId, operation);
  if (isCorrect) {
    stmts.incOpCorrect.run(playerId, operation);
    for (const op of operands) {
      stmts.upsertFact.run(playerId, operation, op);
      stmts.incFactCorrect.run(playerId, operation, op);
    }
  } else {
    stmts.incOpIncorrect.run(playerId, operation);
    for (const op of operands) {
      stmts.upsertFact.run(playerId, operation, op);
      stmts.incFactIncorrect.run(playerId, operation, op);
    }
  }
});

function updateBestScore(playerId, score) { stmts.updateBestScore.run(score, playerId); }
function incrementGames(playerId)         { stmts.incGames.run(playerId); }

module.exports = {
  register, findPlayer, getPlayerById,
  createSession, getSession, deleteSession,
  getStats, getAllPlayerStats,
  getFocusFacts, setFocusFacts,
  resetPassword, deletePlayer,
  recordPresented, recordEaten, updateBestScore, incrementGames,
};
