/* Session page: live queue, voting, admin controls, QR + chord cache modals */

const { el, toast } = ComJam;

const pathParts = location.pathname.split('/').filter(Boolean); // ["s", CODE, ("admin")?]
const CODE = (pathParts[1] || '').toUpperCase();
const wantsAdminPage = pathParts[2] === 'admin';
const clientId = ComJam.clientId();

let adminKey = ComJam.adminKey(CODE);
let isAdmin = false;
let state = null;
let lanUrl = location.origin;
let firstRender = true;

// Admin key can arrive via the share link hash (#key=XXXXXX)
const hashKey = new URLSearchParams(location.hash.slice(1)).get('key');
if (hashKey) {
  adminKey = hashKey.toUpperCase();
  ComJam.adminKey(CODE, adminKey);
  history.replaceState(null, '', location.pathname + location.search);
}

document.getElementById('jam-code').textContent = CODE;

fetch('/api/info')
  .then((r) => r.json())
  .then((info) => {
    if (info.lanUrl && !location.origin.includes('localhost')) lanUrl = location.origin;
    else if (info.lanUrl) lanUrl = info.lanUrl;
  })
  .catch(() => {});

const socket = io();

socket.on('connect', () => {
  socket.emit('join', { code: CODE, clientId }, (res) => {
    if (res?.error) {
      toast('This jam does not exist (or has ended)', 'error');
      setTimeout(() => (location.href = '/'), 1800);
      return;
    }
    tryAdminAuth();
  });
});

socket.on('state', (s) => {
  state = s;
  render();
});

socket.on('toast', ({ msg, type }) => toast(msg, type === 'error' ? 'error' : 'ok'));

function tryAdminAuth() {
  if (!adminKey) {
    if (wantsAdminPage) promptAdminKey();
    return;
  }
  socket.emit('admin:auth', { key: adminKey }, (res) => {
    isAdmin = !!res?.ok;
    if (!isAdmin) {
      ComJam.adminKey(CODE, '');
      adminKey = '';
      if (wantsAdminPage) promptAdminKey();
    }
    render();
  });
}

function promptAdminKey() {
  const entered = prompt('Enter the host key for this jam:');
  if (!entered) return;
  adminKey = entered.trim().toUpperCase();
  socket.emit('admin:auth', { key: adminKey }, (res) => {
    if (res?.ok) {
      isAdmin = true;
      ComJam.adminKey(CODE, adminKey);
      toast('Host controls unlocked 🎛', 'ok');
      render();
    } else {
      adminKey = '';
      toast('That host key is not right', 'error');
    }
  });
}

// ---------- Rendering ----------

function render() {
  if (!state) return;
  const paint = () => {
    document.title = `${state.name} · ComJam`;
    document.getElementById('jam-name').textContent = state.name;
    document.getElementById('people-pill').textContent = `👥 ${state.people}`;
    document.getElementById('admin-pill').classList.toggle('hidden', !isAdmin);
    document.getElementById('admin-link').textContent = isAdmin ? 'Chord link cache' : 'Host controls';
    renderNowPlaying();
    renderQueue();
    renderHistory();
  };
  if (!firstRender && document.startViewTransition) document.startViewTransition(paint);
  else paint();
  firstRender = false;
}

function chordsBits(song) {
  if (song.chordsStatus === 'searching' || song.chordsStatus === 'pending') {
    return el('span', { class: 'chords-pending', title: 'Finding chords…', text: '◌' });
  }
  if (song.chordsUrl) {
    return el('a', {
      class: 'chords-link',
      href: song.chordsUrl,
      target: '_blank',
      rel: 'noopener',
      title: 'Open chords on Ultimate Guitar',
      text: '🎼'
    });
  }
  return null;
}

function renderNowPlaying() {
  const holder = document.getElementById('now-playing');
  const song = state.songs.find((s) => s.status === 'playing');
  holder.classList.toggle('hidden', !song);
  holder.innerHTML = '';
  if (!song) return;

  holder.style.viewTransitionName = 'now-playing';
  const actions = el('div', { class: 'actions' });
  if (song.chordsUrl) {
    actions.append(
      el('a', { class: 'btn btn-ghost btn-small', href: song.chordsUrl, target: '_blank', rel: 'noopener' },
        '🎼 Open chords')
    );
  }
  if (isAdmin) {
    actions.append(
      el('button', {
        class: 'btn btn-ghost btn-small sung-btn',
        text: '✓ Done — mark as sung',
        onclick: () => socket.emit('admin:sung', { key: adminKey, songId: song.id })
      })
    );
  }

  holder.append(
    el('div', { class: 'label' }, el('span', { class: 'live-dot' }), 'Now singing'),
    el('h2', { text: song.title }),
    song.requestedBy ? el('div', { class: 'sub', text: `requested by ${song.requestedBy}` }) : null,
    el('div', { class: 'sub', text: `♥ ${song.votes.length} votes` }),
    actions
  );
}

function renderQueue() {
  const queueEl = document.getElementById('queue');
  const songs = state.songs.filter((s) => s.status !== 'playing');
  document.getElementById('queue-count').textContent =
    songs.length ? `${songs.length} song${songs.length === 1 ? '' : 's'}` : '';
  queueEl.innerHTML = '';

  if (!songs.length) {
    queueEl.append(
      el('div', { class: 'empty' },
        el('span', { class: 'big', text: '🎶' }),
        state.songs.length
          ? 'Queue is empty — request the next one!'
          : 'No requests yet — be the first to add a song!')
    );
    return;
  }

  songs.forEach((song, i) => {
    const voted = song.votes.includes(clientId);
    const card = el('div', { class: `song${i === 0 ? ' top' : ''}` });
    card.style.viewTransitionName = 'song-' + song.id.replace(/[^a-zA-Z0-9]/g, '');

    card.append(
      el('span', { class: 'rank', text: i === 0 ? '👑' : `${i + 1}` }),
      el('div', { class: 'info' },
        el('div', { class: 'title', text: song.title }),
        song.requestedBy ? el('div', { class: 'by', text: `by ${song.requestedBy}` }) : null
      ),
      chordsBits(song),
      el('button', {
        class: `vote-btn${voted ? ' voted' : ''}`,
        title: voted ? 'Remove your vote' : 'Vote for this song',
        onclick: () => socket.emit('song:vote', { songId: song.id })
      }, el('span', { class: 'heart', text: voted ? '♥' : '♡' }), ` ${song.votes.length}`)
    );

    if (isAdmin) {
      card.append(
        el('div', { class: 'admin-row' },
          el('button', {
            class: 'btn btn-ghost btn-small sing-btn',
            text: '🎤 Sing now',
            onclick: () => socket.emit('admin:playing', { key: adminKey, songId: song.id })
          }),
          el('button', {
            class: 'btn btn-ghost btn-small sung-btn',
            text: '✓ Sung',
            onclick: () => socket.emit('admin:sung', { key: adminKey, songId: song.id })
          }),
          el('button', {
            class: 'btn btn-ghost btn-small',
            text: '🔁',
            title: 'Search chords again',
            onclick: () => socket.emit('admin:relookup', { key: adminKey, songId: song.id })
          }),
          el('button', {
            class: 'btn btn-ghost btn-small danger',
            text: '✕',
            title: 'Remove from queue',
            onclick: () => {
              if (confirm(`Remove “${song.title}” from the queue?`))
                socket.emit('admin:remove', { key: adminKey, songId: song.id });
            }
          })
        )
      );
    }

    queueEl.append(card);
  });
}

function renderHistory() {
  const list = document.getElementById('history-list');
  const count = state.history.length;
  document.getElementById('history-count').textContent = count ? `(${count})` : '';
  list.innerHTML = '';

  if (!count) {
    list.append(el('div', { class: 'empty', text: 'Nothing sung yet — the night is young 🌙' }));
    return;
  }

  for (const h of state.history) {
    const time = new Date(h.sungAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const row = el('div', { class: 'sung' },
      el('span', { class: 'check', text: '✓' }),
      el('div', { class: 'info' },
        el('div', { class: 'title', text: h.title }),
        el('div', { class: 'time', text: `sung at ${time} · ♥ ${h.votes}` })
      )
    );
    if (h.chordsUrl) {
      row.append(el('a', {
        class: 'chords-link', href: h.chordsUrl, target: '_blank', rel: 'noopener',
        title: 'Open chords', text: '🎼'
      }));
    }
    if (isAdmin) {
      row.append(el('button', {
        class: 'btn btn-ghost btn-small',
        text: '↩︎',
        title: 'Put back in the queue',
        onclick: () => socket.emit('admin:restore', { key: adminKey, songId: h.id })
      }));
    }
    list.append(row);
  }
}

// ---------- Requesting ----------

const nameRow = document.getElementById('name-row');
const nameInput = document.getElementById('name-input');
nameInput.value = ComJam.displayName();
if (!ComJam.displayName()) nameRow.classList.remove('hidden');

document.getElementById('request-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('song-input');
  const title = input.value.trim();
  if (!title) return toast('Type a song name first', 'error');
  if (nameInput.value.trim()) ComJam.displayName(nameInput.value.trim());
  socket.emit('song:request', { title, requestedBy: ComJam.displayName() });
  input.value = '';
  nameRow.classList.add('hidden');
  input.blur();
});

// ---------- History toggle ----------

document.getElementById('history-toggle').addEventListener('click', (e) => {
  const btn = e.currentTarget;
  const list = document.getElementById('history-list');
  const open = list.classList.toggle('hidden');
  btn.classList.toggle('open', !open);
});

// ---------- Modals ----------

const modalRoot = document.getElementById('modal-root');

function openModal(title, ...content) {
  closeModal();
  const backdrop = el('div', { class: 'modal-backdrop', onclick: (e) => { if (e.target === backdrop) closeModal(); } },
    el('div', { class: 'modal' },
      el('div', { class: 'modal-head' },
        el('h2', { text: title }),
        el('button', { class: 'icon-btn', text: '✕', onclick: closeModal })
      ),
      ...content
    )
  );
  modalRoot.append(backdrop);
}

function closeModal() {
  modalRoot.innerHTML = '';
}

function qrSvg(text, px = 6) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const size = n * px;
  let rects = '';
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (qr.isDark(r, c)) rects += `<rect x="${c * px}" y="${r * px}" width="${px}" height="${px}"/>`;
  const holder = document.createElement('div');
  holder.innerHTML =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="#111">${rects}</svg>`;
  return holder.firstChild;
}

function openQrModal() {
  const joinUrl = `${lanUrl}/s/${CODE}`;
  const content = el('div', { class: 'qr-holder' },
    el('div', { class: 'qr-box' }, qrSvg(joinUrl)),
    el('div', {},
      el('div', { class: 'join-url', text: joinUrl }),
      el('div', { class: 'join-code', text: CODE })
    ),
    el('div', { class: 'share-tip', text: 'Scan with any phone camera, or go to the address and enter the code.' })
  );
  openModal('Join this jam 🎶', content);
}

document.getElementById('qr-btn').addEventListener('click', openQrModal);

// ---------- Welcome (right after creating a jam) ----------

if (new URLSearchParams(location.search).get('welcome') && adminKey) {
  history.replaceState(null, '', location.pathname);
  setTimeout(() => {
    const joinUrl = `${lanUrl}/s/${CODE}`;
    openModal('Your jam is live! 🚀',
      el('div', { class: 'qr-holder' },
        el('div', { class: 'qr-box' }, qrSvg(joinUrl)),
        el('div', { class: 'join-code', text: CODE })
      ),
      el('div', { class: 'share-grid' },
        el('div', { class: 'share-tip', text: 'Point this screen at the room — everyone scans to request & vote.' }),
        el('div', { class: 'admin-key-box' },
          el('div', { class: 'key', text: adminKey }),
          el('div', { class: 'hint', text: 'Host key — open this jam on your phone, tap “Host controls”, and enter it to manage songs from anywhere.' })
        ),
        el('button', { class: 'btn btn-primary', text: 'Let’s jam 🎸', onclick: closeModal })
      )
    );
  }, 600);
}

// ---------- Admin: unlock link + chord cache manager ----------

document.getElementById('admin-link').addEventListener('click', () => {
  if (!isAdmin) return promptAdminKey();
  openCacheModal();
});

function openCacheModal() {
  socket.emit('admin:cache:list', { key: adminKey }, (res) => {
    if (res?.error) return toast('Could not load the cache', 'error');
    showCacheModal(res.entries);
  });
}

function showCacheModal(entries) {
  const titleField = el('input', { class: 'field', placeholder: 'Song title (e.g. Hallelujah)', maxlength: '120' });
  const urlField = el('input', { class: 'field', placeholder: 'https://tabs.ultimate-guitar.com/…', inputmode: 'url' });

  const form = el('div', { class: 'cache-form' },
    el('div', { class: 'share-tip', text: 'Pin the exact chords link a song should use. Lookups are case-insensitive.' }),
    titleField,
    urlField,
    el('button', {
      class: 'btn btn-primary btn-small', text: 'Save link',
      onclick: () => {
        socket.emit('admin:cache:set', { key: adminKey, title: titleField.value, url: urlField.value }, (res) => {
          if (res?.error) return toast(res.error, 'error');
          toast('Chord link saved 🎼', 'ok');
          showCacheModal(res.entries);
        });
      }
    })
  );

  const list = el('div', { class: 'cache-list' });
  if (!entries.length) {
    list.append(el('div', { class: 'empty', text: 'No cached chord links yet. They appear here as songs get requested.' }));
  }
  for (const entry of entries) {
    list.append(
      el('div', { class: 'cache-entry' },
        el('div', { class: 'info' },
          el('div', { class: 'title', text: entry.title }),
          el('a', { class: 'url', href: entry.url, target: '_blank', rel: 'noopener', text: entry.url })
        ),
        el('span', { class: `tag${entry.manual ? ' manual' : ''}`, text: entry.manual ? 'pinned' : 'auto' }),
        el('button', {
          class: 'del', text: '✕', title: 'Remove from cache',
          onclick: () => {
            socket.emit('admin:cache:delete', { key: adminKey, cacheKey: entry.key }, (res) => {
              if (res?.ok) showCacheModal(res.entries);
            });
          }
        })
      )
    );
  }

  openModal('Chord link cache 🎼', form, list);
}
