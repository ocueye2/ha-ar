/* HA AR Control — frontend. Plain JS, no build step.
   SECURITY: no HA token anywhere in this file. No localStorage token,
   no token field, no Authorization header. The browser only sends
   entity_id + action to /api/control; the server adds the HA token. */
let ENTITIES = [];
let CURRENT = null;
let LOCKED = null; // locked match — AR keeps showing it even if frames miss
let stream = null, arTimer = null, arBusy = false, lastMatchAt = 0;

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.style.display = 'block';
  clearTimeout(t._h); t._h = setTimeout(() => t.style.display = 'none', 3200);
}
function showTab(name) {
  for (const n of ['ar', 'library', 'settings'])
    document.getElementById('tab-' + n).classList.toggle('hidden', n !== name);
  for (const n of ['Ar', 'Lib', 'Set'])
    document.getElementById('tab' + n + 'Btn').classList.remove('active');
  document.getElementById('tab' + (name === 'ar' ? 'Ar' : name === 'library' ? 'Lib' : 'Set') + 'Btn').classList.add('active');
  if (name === 'library') loadRefs();
  if (name === 'settings') loadSettings();
  if (name !== 'ar') stopAR();
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function refreshHealth() {
  try {
    const r = await fetch('/api/health'); const j = await r.json();
    const dot = document.getElementById('haDot'), st = document.getElementById('haStatus');
    if (j.ha && j.ha.ok) { dot.className = 'dot ok'; st.textContent = 'HA connected'; }
    else { dot.className = 'dot bad'; st.textContent = j.ha && j.ha.configured ? 'HA unreachable' : 'HA key not set on server'; }
    document.getElementById('refCount').textContent = (j.refs || 0) + ' object' + (j.refs === 1 ? '' : 's');
    const hb = document.getElementById('healthBox'); if (hb) hb.textContent = JSON.stringify(j, null, 2);
    const sk = document.getElementById('serverKeyStatus');
    if (sk) sk.textContent = j.ha && j.ha.configured
      ? '✓ Server-side HA key is set (source: ' + (j.ha.source || 'server') + '). It is never shown here.'
      : '✗ No server-side HA key yet — set HA_TOKEN in docker-compose env or /run/secrets/ha_token, then restart the container.';
  } catch (e) { document.getElementById('haStatus').textContent = 'offline'; }
}

async function loadEntities() {
  const sel = document.getElementById('newTarget');
  try {
    const r = await fetch('/api/entities'); const j = await r.json();
    ENTITIES = j.entities || [];
    const groups = {};
    for (const e of ENTITIES) (groups[e.domain] = groups[e.domain] || []).push(e);
    sel.innerHTML = '';
    for (const [domain, list] of Object.entries(groups)) {
      const og = document.createElement('optgroup'); og.label = domain;
      for (const e of list) {
        const o = document.createElement('option');
        o.value = JSON.stringify({type: domain === 'scene' ? 'scene' : domain === 'script' ? 'script' : 'entity', id: e.entity_id});
        o.textContent = e.name + '  (' + e.entity_id + ')';
        og.appendChild(o);
      }
      sel.appendChild(og);
    }
    document.getElementById('entityNote').textContent =
      j.source === 'home-assistant' ? ENTITIES.length + ' targets from Home Assistant.'
      : 'Home Assistant is not connected yet — showing your known devices. Set the server-side key to see scenes, scripts and live state.';
  } catch (e) { document.getElementById('entityNote').textContent = 'Could not load targets.'; }
}

async function loadRefs() {
  const box = document.getElementById('refList');
  const r = await fetch('/api/refs'); const j = await r.json();
  if (!j.refs.length) { box.innerHTML = '<p class="muted">No objects yet. Add your first one above — a photo of your bed lamp is a good start.</p>'; return; }
  box.innerHTML = j.refs.map(ref => `
    <div class="card ref">
      <img src="/photos/${esc(ref.photos[0] || '')}" alt="">
      <div class="meta"><b>${esc(ref.name)}</b>
        <small>${esc(ref.target_type)} · ${esc(ref.target_id)}</small><br>
        <small>${(ref.photos || []).length} photo(s)</small></div>
      <div class="actions">
        <button class="btn secondary" onclick="addPhoto('${ref.id}')">+ photo</button>
        <button class="btn danger" onclick="deleteRef('${ref.id}')">Delete</button>
      </div>
    </div>`).join('');
}
async function deleteRef(id) {
  if (!confirm('Delete this reference?')) return;
  await fetch('/api/refs/' + id, {method: 'DELETE'});
  loadRefs(); refreshHealth();
}
function addPhoto(id) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment';
  inp.onchange = async () => {
    const fd = new FormData(); fd.append('photo', inp.files[0]);
    const r = await fetch('/api/refs/' + id + '/photo', {method: 'POST', body: fd});
    const j = await r.json();
    toast(j.ok ? 'Photo added.' : ('Error: ' + (j.error || 'failed')));
    loadRefs();
  };
  inp.click();
}
async function saveRef() {
  const name = document.getElementById('newName').value.trim();
  const files = document.getElementById('newPhotos').files;
  const btn = document.getElementById('saveRefBtn');
  if (!name) return toast('Give it a name first.');
  if (!files.length) return toast('Add at least one reference photo.');
  let target; try { target = JSON.parse(document.getElementById('newTarget').value); } catch { return toast('Pick a target first.'); }
  btn.disabled = true;
  const fd = new FormData();
  fd.append('name', name); fd.append('target_type', target.type); fd.append('target_id', target.id);
  for (const f of files) fd.append('photos', f);
  const r = await fetch('/api/refs', {method: 'POST', body: fd});
  const j = await r.json(); btn.disabled = false;
  if (!j.ok) return toast('Error: ' + (j.error || 'failed'));
  toast('Saved — now point your AR camera at it.');
  document.getElementById('newName').value = ''; document.getElementById('newPhotos').value = '';
  loadRefs(); refreshHealth(); showTab('ar');
}

/* ---------------- AR live view ---------------- */
function setChip(text) { document.getElementById('arChip').textContent = text; }

async function startAR() {
  const video = document.getElementById('arVideo');
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false });
  } catch (e) {
    // Camera needs HTTPS on a real phone (localhost is exempt). Offer still-photo fallback.
    toast('Camera blocked — use Snap & match once, or open this over HTTPS.');
    setChip('Camera blocked — use Snap & match');
    document.getElementById('stillFile').click();
    return;
  }
  video.srcObject = stream;
  await video.play().catch(() => {});
  document.getElementById('startArBtn').classList.add('hidden');
  document.getElementById('stopArBtn').classList.remove('hidden');
  document.getElementById('scanline').style.display = 'block';
  setChip('Scanning… point at an object');
  // Match a frame every ~1.2s, skip while one is in flight.
  arTimer = setInterval(arTick, 1200);
  arTick();
}
function stopAR() {
  if (arTimer) { clearInterval(arTimer); arTimer = null; }
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  document.getElementById('startArBtn').classList.remove('hidden');
  document.getElementById('stopArBtn').classList.add('hidden');
  document.getElementById('scanline').style.display = 'none';
  setChip('Camera off — tap Start AR');
}
function unlockAR() {
  LOCKED = null; CURRENT = null;
  document.getElementById('arOverlay').innerHTML = '';
  document.getElementById('arCandidates').innerHTML = '';
  document.getElementById('matchBox').innerHTML = '';
  setChip('Unlocked — scanning…');
}
async function arTick() {
  if (arBusy || !stream) return;
  if (LOCKED) return; // hold the locked device, don't re-match over it
  const video = document.getElementById('arVideo');
  if (!video.videoWidth) return;
  arBusy = true;
  try {
    const canvas = document.getElementById('arCanvas');
    const scale = Math.min(1, 640 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.72));
    if (!blob) return;
    const fd = new FormData(); fd.append('frame', blob, 'frame.jpg');
    const j = await (await fetch('/api/ar/match', {method: 'POST', body: fd})).json();
    if (!j.ok) { setChip(j.error || 'No references yet'); return; }
    if (j.accepted && j.best) {
      lastMatchAt = Date.now();
      setChip('✓ ' + j.best.name + ' — ' + Math.round(j.best.score * 100) + '%');
      showMatch(j.best, true);
    } else {
      // Don't clear a fresh match on one miss — hold it 4s to avoid flicker.
      if (CURRENT && Date.now() - lastMatchAt < 4000) return;
      setChip(j.results && j.results.length ? 'Not sure — tap the right one below' : 'No match — point at a saved object');
      if (j.results && j.results.length) showCandidates(j.results);
    }
  } catch (e) { /* next tick retries */ }
  finally { arBusy = false; }
}
function captureStill() { document.getElementById('stillFile').click(); }
document.getElementById('stillFile').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return;
  const fd = new FormData(); fd.append('photo', file);
  const j = await (await fetch('/api/scan', {method: 'POST', body: fd})).json();
  if (!j.ok) return toast(j.error || 'Scan failed');
  if (j.accepted && j.best) showMatch(j.best, false);
  else { toast('Not sure — best was ' + Math.round((j.results[0]?.score || 0) * 100) + '%'); showCandidates(j.results); }
  e.target.value = '';
});

function showCandidates(results) {
  document.getElementById('arCandidates').innerHTML = '<div class="candidates">' + results.map(r => `
    <button class="cand" onclick='pickCandidate(${JSON.stringify(r).replace(/'/g, "&#39;")})'>
      <img src="/photos/${esc(r.photos[0] || '')}" alt="">
      <span><b>${esc(r.name)}</b><small>${esc(r.target_id)} · ${Math.round(r.score * 100)}% match</small></span>
    </button>`).join('') + '</div>';
}
function pickCandidate(r) { LOCKED = r; showMatch(r, true); setChip('🔒 Locked: ' + r.name); }

function stateText(st) {
  if (!st) return 'State unknown — check the server-side HA key in Settings.';
  const a = st.attributes || {};
  let s = 'State: ' + st.state;
  if (a.brightness != null) s += ' · ' + Math.round(a.brightness / 255 * 100) + '%';
  if (a.rgb_color) s += ' · rgb(' + a.rgb_color.join(', ') + ')';
  return s;
}
function showMatch(m, inAr) {
  CURRENT = m;
  const isLight = m.target_id.startsWith('light.');
  const isSceneScript = m.target_type === 'scene' || m.target_type === 'script';
  const swatches = ['#ffffff', '#ffd166', '#ff9f1c', '#ff5d5d', '#7c5cff', '#2dd4bf', '#4da3ff', '#ff7ad9']
    .map(c => `<button class="swatch" style="background:${c}" title="${c}" onclick="setColor('${c}', this)"></button>`).join('');
  const inner = `
    <span class="pill">✓ ${Math.round(m.score * 100)}% match</span>
    <span class="pill">${esc(m.target_type)}</span>
    ${LOCKED ? '<span class="pill">🔒 locked</span>' : ''}
    <h2>${esc(m.name)}</h2>
    <p class="state-line">${esc(stateText(m.state))}</p>
    ${isSceneScript ? `
      <button class="btn block" onclick="runTarget()">▶ Run ${m.target_type === 'scene' ? 'scene' : 'script'}</button>`
    : `
      <div class="controls-row">
        <button class="btn" onclick="doControl('turn_on')">On</button>
        <button class="btn secondary" onclick="doControl('turn_off')">Off</button>
        <button class="btn secondary" onclick="doControl('toggle')">Toggle</button>
        <button class="btn secondary" onclick="lockCurrent()">${LOCKED ? '🔓 Unlock' : '🔒 Lock'}</button>
      </div>
      ${isLight ? `
      <label>Brightness — <span id="briVal">${m.state?.attributes?.brightness != null ? Math.round(m.state.attributes.brightness / 255 * 100) : 50}%</span></label>
      <input type="range" min="1" max="100" value="${m.state?.attributes?.brightness != null ? Math.round(m.state.attributes.brightness / 255 * 100) : 50}"
        oninput="document.getElementById('briVal').textContent=this.value+'%'"
        onchange="doControl('turn_on', {brightness_pct: +this.value})">
      <label>Colour</label>
      <div class="controls-row"><div class="swatches">${swatches}</div>
        <input type="color" value="#ffd166" onchange="setColor(this.value, null)"></div>
      <label>Colour temperature (K)</label>
      <input type="range" min="2000" max="6500" step="100" value="3500"
        onchange="doControl('turn_on', {color_temp_kelvin: +this.value})">
      ` : `<p class="muted">This is a ${esc(m.target_id.split('.')[0])} — on/off and toggle above. Colour and brightness appear for lights.</p>`}
    `}`;
  // Floating AR card over the video + a copy below for small screens.
  document.getElementById('arOverlay').innerHTML = `<div class="card match ar-card">${inner}</div>`;
  document.getElementById('matchBox').innerHTML = `<div class="card match">${inner}</div>`;
  document.getElementById('arCandidates').innerHTML = '';
}
function lockCurrent() {
  if (LOCKED) { unlockAR(); }
  else if (CURRENT) { LOCKED = CURRENT; showMatch(CURRENT, true); setChip('🔒 Locked: ' + CURRENT.name); toast('Locked — AR won\'t switch away while you adjust it.'); }
}
async function doControl(action, extra = {}) {
  if (!CURRENT) return;
  const r = await fetch('/api/control', {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({target_type: CURRENT.target_type, target_id: CURRENT.target_id, action, ...extra})});
  const j = await r.json();
  if (!j.ok) return toast('Error: ' + (j.error || 'failed'));
  if (j.state) { CURRENT.state = j.state; if (LOCKED) LOCKED.state = j.state; showMatch(CURRENT, true); }
  else toast('Done.');
}
function setColor(hex, el) {
  document.querySelectorAll('.swatch').forEach(s => s.classList.remove('sel'));
  if (el) el.classList.add('sel');
  doControl('turn_on', {rgb_color: hex});
}
function runTarget() { doControl('run'); }

/* ---------------- settings (no token) ---------------- */
async function loadSettings() {
  const r = await fetch('/api/settings'); const j = await r.json();
  document.getElementById('setThreshold').value = j.match_threshold ?? 0.55;
  document.getElementById('thrVal').textContent = j.match_threshold ?? 0.55;
  document.getElementById('setClip').checked = !!j.enable_clip;
  refreshHealth();
}
async function saveSettings() {
  const body = {match_threshold: +document.getElementById('setThreshold').value,
    enable_clip: document.getElementById('setClip').checked};
  const r = await fetch('/api/settings', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const j = await r.json();
  toast(j.ok ? 'Saved.' : 'Error: ' + (j.error || 'failed'));
  refreshHealth(); loadEntities();
}

refreshHealth(); loadEntities(); loadRefs();
