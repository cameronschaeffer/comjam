const tabJoin = document.getElementById('tab-join');
const tabCreate = document.getElementById('tab-create');
const joinForm = document.getElementById('join-form');
const createForm = document.getElementById('create-form');

function showTab(which) {
  const join = which === 'join';
  tabJoin.classList.toggle('active', join);
  tabCreate.classList.toggle('active', !join);
  joinForm.classList.toggle('hidden', !join);
  createForm.classList.toggle('hidden', join);
}

tabJoin.addEventListener('click', () => showTab('join'));
tabCreate.addEventListener('click', () => showTab('create'));

document.getElementById('join-name').value = ComJam.displayName();

joinForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (code.length < 4) return ComJam.toast('Enter the 4-letter jam code', 'error');
  const name = document.getElementById('join-name').value.trim();
  if (name) ComJam.displayName(name);
  const res = await fetch(`/api/sessions/${code}`);
  if (!res.ok) return ComJam.toast(`No jam found with code ${code}`, 'error');
  location.href = `/s/${code}`;
});

createForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('create-name').value.trim() || 'Community Jam';
  const hostName = document.getElementById('host-name').value.trim();
  if (hostName) ComJam.displayName(hostName);
  const res = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, hostName })
  });
  if (!res.ok) return ComJam.toast('Could not create the jam — try again', 'error');
  const { code, adminKey } = await res.json();
  ComJam.adminKey(code, adminKey);
  location.href = `/s/${code}?welcome=1`;
});
