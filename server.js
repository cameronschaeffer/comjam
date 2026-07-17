const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');

const store = require('./lib/store');
const chords = require('./lib/chords');

const PORT = process.env.PORT || 3000;

store.load();
chords.load();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  '/vendor/qrcode.js',
  express.static(path.join(__dirname, 'node_modules', 'qrcode-generator', 'qrcode.js'))
);

const server = http.createServer(app);
const io = new Server(server);

function lanAddress() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces || []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

// ---------- REST ----------

app.get('/api/info', (req, res) => {
  res.json({ lanUrl: `http://${lanAddress()}:${PORT}` });
});

app.post('/api/sessions', (req, res) => {
  const { name, hostName } = req.body || {};
  const session = store.createSession(name, hostName);
  res.json({ code: session.code, name: session.name, adminKey: session.adminKey });
});

app.get('/api/sessions/:code', (req, res) => {
  const session = store.getSession(req.params.code);
  if (!session) return res.status(404).json({ error: 'not_found' });
  res.json({ code: session.code, name: session.name });
});

app.get(['/s/:code', '/s/:code/admin'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'session.html'));
});

// ---------- Real-time state ----------

function sortedSongs(session) {
  return [...session.songs].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'playing' ? -1 : 1;
    if (b.votes.length !== a.votes.length) return b.votes.length - a.votes.length;
    return a.addedAt - b.addedAt;
  });
}

function publicState(session) {
  return {
    code: session.code,
    name: session.name,
    hostName: session.hostName,
    people: io.sockets.adapter.rooms.get(session.code)?.size || 0,
    songs: sortedSongs(session),
    history: [...session.history].sort((a, b) => b.sungAt - a.sungAt)
  };
}

function broadcast(session) {
  io.to(session.code).emit('state', publicState(session));
  store.save();
}

function lookupChordsFor(session, song) {
  song.chordsStatus = 'searching';
  chords
    .lookup(song.title)
    .then(({ url }) => {
      // Song may have been sung/removed while we searched — update wherever it lives now.
      song.chordsUrl = url;
      song.chordsStatus = url ? 'found' : 'none';
      broadcast(session);
    })
    .catch(() => {
      song.chordsStatus = 'none';
      broadcast(session);
    });
}

// After a manual cache change, sync any queued songs whose title matches.
function applyCacheToSessions(normKey, url) {
  for (const session of store.allSessions()) {
    let touched = false;
    for (const song of [...session.songs, ...session.history]) {
      if (store.normalizeTitle(song.title) === normKey) {
        song.chordsUrl = url;
        song.chordsStatus = url ? 'found' : 'none';
        touched = true;
      }
    }
    if (touched) broadcast(session);
  }
}

// ---------- Socket handlers ----------

io.on('connection', (socket) => {
  let session = null;
  let clientId = null;

  const requireSession = () => session && store.getSession(session.code);
  const isAdmin = (key) => session && key && key === session.adminKey;
  const toast = (msg, type = 'error') => socket.emit('toast', { msg, type });

  socket.on('join', ({ code, clientId: cid }, ack) => {
    const s = store.getSession(code);
    if (!s) return ack && ack({ error: 'not_found' });
    session = s;
    clientId = String(cid || '').slice(0, 64);
    socket.join(s.code);
    ack && ack({ ok: true });
    broadcast(s);
  });

  socket.on('admin:auth', ({ key }, ack) => {
    ack && ack({ ok: isAdmin(key) });
  });

  socket.on('song:request', ({ title, requestedBy }) => {
    if (!requireSession() || !clientId) return;
    title = String(title || '').trim().slice(0, 120);
    if (title.length < 1) return toast('Type a song name first');

    const norm = store.normalizeTitle(title);
    if (!norm) return toast('Type a song name first');

    const sung = session.history.find((h) => store.normalizeTitle(h.title) === norm);
    if (sung) return toast(`“${sung.title}” was already sung tonight 🎤`);

    const existing = session.songs.find((s) => store.normalizeTitle(s.title) === norm);
    if (existing) {
      if (existing.votes.includes(clientId)) {
        return toast(`“${existing.title}” is already in the queue — you voted for it!`, 'info');
      }
      existing.votes.push(clientId);
      toast(`“${existing.title}” was already requested — added your vote ♥`, 'ok');
      return broadcast(session);
    }

    const song = {
      id: crypto.randomUUID(),
      title,
      requesterId: clientId,
      requestedBy: String(requestedBy || '').trim().slice(0, 40),
      chordsUrl: null,
      chordsStatus: 'pending',
      votes: [clientId],
      status: 'queued',
      addedAt: Date.now()
    };

    const cached = chords.getCached(title);
    if (cached) {
      song.chordsUrl = cached.url;
      song.chordsStatus = 'found';
    }

    session.songs.push(song);
    broadcast(session);
    if (!cached) lookupChordsFor(session, song);
  });

  socket.on('name:update', ({ name }) => {
    if (!requireSession() || !clientId) return;
    name = String(name || '').trim().slice(0, 40);
    let touched = false;
    for (const song of session.songs) {
      if (song.requesterId === clientId && song.requestedBy !== name) {
        song.requestedBy = name;
        touched = true;
      }
    }
    if (touched) broadcast(session);
  });

  socket.on('song:vote', ({ songId }) => {
    if (!requireSession() || !clientId) return;
    const song = session.songs.find((s) => s.id === songId);
    if (!song) return;
    const i = song.votes.indexOf(clientId);
    if (i >= 0) song.votes.splice(i, 1);
    else song.votes.push(clientId);
    broadcast(session);
  });

  // ----- Admin song controls -----

  socket.on('admin:playing', ({ key, songId }) => {
    if (!requireSession() || !isAdmin(key)) return;
    for (const s of session.songs) {
      if (s.id === songId) s.status = s.status === 'playing' ? 'queued' : 'playing';
      else s.status = 'queued';
    }
    broadcast(session);
  });

  socket.on('admin:sung', ({ key, songId }) => {
    if (!requireSession() || !isAdmin(key)) return;
    const i = session.songs.findIndex((s) => s.id === songId);
    if (i < 0) return;
    const [song] = session.songs.splice(i, 1);
    session.history.push({
      id: song.id,
      title: song.title,
      requestedBy: song.requestedBy,
      chordsUrl: song.chordsUrl,
      votes: song.votes.length,
      sungAt: Date.now()
    });
    broadcast(session);
  });

  socket.on('admin:remove', ({ key, songId }) => {
    if (!requireSession() || !isAdmin(key)) return;
    const i = session.songs.findIndex((s) => s.id === songId);
    if (i >= 0) {
      session.songs.splice(i, 1);
      broadcast(session);
    }
  });

  socket.on('admin:restore', ({ key, songId }) => {
    if (!requireSession() || !isAdmin(key)) return;
    const i = session.history.findIndex((h) => h.id === songId);
    if (i < 0) return;
    const [h] = session.history.splice(i, 1);
    session.songs.push({
      id: h.id,
      title: h.title,
      requestedBy: h.requestedBy,
      chordsUrl: h.chordsUrl,
      chordsStatus: h.chordsUrl ? 'found' : 'none',
      votes: [],
      status: 'queued',
      addedAt: Date.now()
    });
    broadcast(session);
  });

  socket.on('admin:relookup', ({ key, songId }) => {
    if (!requireSession() || !isAdmin(key)) return;
    const song = session.songs.find((s) => s.id === songId);
    if (!song) return;
    chords.deleteCache(store.normalizeTitle(song.title));
    lookupChordsFor(session, song);
    broadcast(session);
  });

  // ----- Admin chord cache -----

  socket.on('admin:cache:list', ({ key }, ack) => {
    if (!requireSession() || !isAdmin(key)) return ack && ack({ error: 'forbidden' });
    ack && ack({ entries: chords.listCache() });
  });

  socket.on('admin:cache:set', ({ key, title, url }, ack) => {
    if (!requireSession() || !isAdmin(key)) return ack && ack({ error: 'forbidden' });
    const entry = chords.setCache(title, url);
    if (!entry) return ack && ack({ error: 'Enter a song title and a valid http(s) link' });
    applyCacheToSessions(entry.key, entry.url);
    ack && ack({ ok: true, entries: chords.listCache() });
  });

  socket.on('admin:cache:delete', ({ key, cacheKey }, ack) => {
    if (!requireSession() || !isAdmin(key)) return ack && ack({ error: 'forbidden' });
    chords.deleteCache(cacheKey);
    ack && ack({ ok: true, entries: chords.listCache() });
  });

  socket.on('disconnect', () => {
    const s = requireSession();
    if (s) broadcast(s);
  });
});

server.listen(PORT, () => {
  const lan = `http://${lanAddress()}:${PORT}`;
  console.log('');
  console.log('  🎸 ComJam is running!');
  console.log('');
  console.log(`  On this computer:  http://localhost:${PORT}`);
  console.log(`  On the same wifi:  ${lan}`);
  console.log('');
  console.log('  Create a jam on the laptop, then share the QR code so');
  console.log('  everyone can request and vote from their phones.');
  console.log('');
});
