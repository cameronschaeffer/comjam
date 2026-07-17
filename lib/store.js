const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

const SESSION_TTL_MS = 36 * 60 * 60 * 1000; // sessions expire 36h after creation
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function debouncedSaver(file, getData) {
  let timer = null;
  return () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      try {
        ensureDataDir();
        fs.writeFileSync(file, JSON.stringify(getData(), null, 2));
      } catch (err) {
        console.error(`Failed to save ${path.basename(file)}:`, err.message);
      }
    }, 400);
  };
}

// Normalize a song title for duplicate detection and cache keys:
// case-insensitive, diacritics stripped, punctuation/whitespace collapsed.
function normalizeTitle(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function randomCode(len, alphabet = CODE_ALPHABET) {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += alphabet[crypto.randomInt(alphabet.length)];
  }
  return out;
}

const sessions = new Map(); // code -> session

const save = debouncedSaver(SESSIONS_FILE, () => [...sessions.values()]);

function load() {
  const list = loadJSON(SESSIONS_FILE, []);
  const now = Date.now();
  for (const s of list) {
    if (now - s.createdAt < SESSION_TTL_MS) sessions.set(s.code, s);
  }
}

function createSession(name, hostName) {
  let code;
  do {
    code = randomCode(4);
  } while (sessions.has(code));

  const session = {
    code,
    name: String(name || 'Community Jam').slice(0, 60),
    hostName: String(hostName || '').slice(0, 40),
    adminKey: randomCode(6),
    createdAt: Date.now(),
    songs: [], // { id, title, requestedBy, chordsUrl, chordsStatus, votes: [clientId], status, addedAt }
    history: [] // { id, title, requestedBy, chordsUrl, votes, sungAt }
  };
  sessions.set(code, session);
  save();
  return session;
}

function getSession(code) {
  return sessions.get(String(code || '').toUpperCase()) || null;
}

function allSessions() {
  return [...sessions.values()];
}

module.exports = { load, save, createSession, getSession, allSessions, normalizeTitle, randomCode };
