const fs = require('fs');
const path = require('path');
const { normalizeTitle } = require('./store');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CACHE_FILE = path.join(DATA_DIR, 'chordcache.json');

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 12000;

// key: normalized title -> { title, url, manual, ts }
const cache = new Map();
const inFlight = new Map();

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(CACHE_FILE, JSON.stringify([...cache.entries()], null, 2));
    } catch (err) {
      console.error('Failed to save chord cache:', err.message);
    }
  }, 400);
}

function load() {
  try {
    for (const [k, v] of JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))) cache.set(k, v);
  } catch {
    /* no cache yet */
  }
}

function fetchText(url) {
  return fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: 'follow'
  }).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  });
}

function decodeEntities(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// Strategy 1: web search for "<title> chords" restricted to ultimate-guitar.com,
// take the first tab hit (preferring chord sheets over tabs).
async function searchViaDuckDuckGo(title) {
  const q = `${title} chords site:tabs.ultimate-guitar.com`;
  const html = await fetchText('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q));
  const links = [];
  const re = /uddg=([^&"']+)/g;
  let m;
  while ((m = re.exec(html))) {
    try {
      const url = decodeURIComponent(m[1]);
      if (/^https?:\/\/tabs\.ultimate-guitar\.com\/tab\//.test(url)) links.push(url);
    } catch {
      /* skip malformed */
    }
  }
  return links.find((u) => /-chords-\d/.test(u)) || links[0] || null;
}

// Strategy 2: Ultimate Guitar's own search page embeds its results as JSON
// in a div.js-store data-content attribute.
async function searchViaUltimateGuitar(title) {
  const html = await fetchText(
    'https://www.ultimate-guitar.com/search.php?search_type=title&value=' + encodeURIComponent(title)
  );
  const m = html.match(/class="js-store"\s+data-content="([^"]+)"/);
  if (!m) return null;
  const data = JSON.parse(decodeEntities(m[1]));
  const results = (data?.store?.page?.data?.results || []).filter(
    (r) => r.tab_url && !r.marketing_type
  );
  if (!results.length) return null;
  const chordsOnly = results
    .filter((r) => r.type === 'Chords')
    .sort((a, b) => (b.votes || 0) - (a.votes || 0));
  return (chordsOnly[0] || results[0]).tab_url;
}

// Look up a chords URL for a song title. Case-insensitive cache first,
// then live search. Returns { url, cached } — url is null when nothing found.
async function lookup(title) {
  const key = normalizeTitle(title);
  if (!key) return { url: null, cached: false };

  const hit = cache.get(key);
  if (hit) return { url: hit.url, cached: true };

  if (inFlight.has(key)) return inFlight.get(key);

  const promise = (async () => {
    let url = null;
    try {
      url = await searchViaDuckDuckGo(title);
    } catch (err) {
      console.warn(`DDG search failed for "${title}": ${err.message}`);
    }
    if (!url) {
      try {
        url = await searchViaUltimateGuitar(title);
      } catch (err) {
        console.warn(`UG search failed for "${title}": ${err.message}`);
      }
    }
    if (url) {
      cache.set(key, { title: String(title).trim(), url, manual: false, ts: Date.now() });
      save();
    }
    return { url, cached: false };
  })().finally(() => inFlight.delete(key));

  inFlight.set(key, promise);
  return promise;
}

function getCached(title) {
  return cache.get(normalizeTitle(title)) || null;
}

function listCache() {
  return [...cache.entries()]
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

function setCache(title, url) {
  const key = normalizeTitle(title);
  if (!key || !/^https?:\/\//.test(url)) return null;
  const entry = { title: String(title).trim(), url: String(url).trim(), manual: true, ts: Date.now() };
  cache.set(key, entry);
  save();
  return { key, ...entry };
}

function deleteCache(key) {
  const ok = cache.delete(key);
  if (ok) save();
  return ok;
}

module.exports = { load, lookup, getCached, listCache, setCache, deleteCache };
