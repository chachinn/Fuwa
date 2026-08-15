(() => {
  'use strict';

  const DB_NAME = 'FuwaDB';
  const MODULE_VERSION = 'v102';
  const $ = (id) => document.getElementById(id);
  const uid = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  const today = () => new Date().toISOString().slice(0, 10);
  const esc = (value = '') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let dbPromise = null;
  let activeTab = 'garden';

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open FuwaDB'));
    });
    return dbPromise;
  }

  async function getAll(storeName) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function countStore(storeName) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).count();
      req.onsuccess = () => resolve(Number(req.result) || 0);
      req.onerror = () => reject(req.error);
    });
  }

  async function getMediaForEntryIds(entryIds) {
    const ids = [...new Set((entryIds || []).filter(Boolean))];
    if (!ids.length) return [];
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('media', 'readonly');
      const store = tx.objectStore('media');
      if (!store.indexNames.contains('entryId')) { reject(new Error('Fuwa media index is unavailable')); return; }
      const index = store.index('entryId');
      const results = new Array(ids.length);
      let remaining = ids.length;
      ids.forEach((id, position) => {
        const req = index.getAll(id);
        req.onsuccess = () => { results[position] = req.result || []; if (--remaining === 0) resolve(results.flat()); };
        req.onerror = () => reject(req.error);
      });
      tx.onerror = () => reject(tx.error || new Error('Fuwa media read failed'));
      tx.onabort = () => reject(tx.error || new Error('Fuwa media read aborted'));
    });
  }

  async function put(storeName, record) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(record);
      tx.oncomplete = () => {
        if (!['media'].includes(storeName)) {
          window.dispatchEvent(new CustomEvent('fuwa-local-data-changed', { detail: { source: 'local', action: 'save', storeName, recordId: record?.id || null, at: Date.now() } }));
        }
        resolve(record);
      };
      tx.onerror = () => reject(tx.error || new Error('FuwaDB write failed'));
      tx.onabort = () => reject(tx.error || new Error('FuwaDB write aborted'));
    });
  }

  async function remove(storeName, id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(id);
      tx.oncomplete = () => {
        window.dispatchEvent(new CustomEvent('fuwa-local-data-changed', { detail: { source: 'local', action: 'remove', storeName, recordId: id, at: Date.now() } }));
        resolve();
      };
      tx.onerror = () => reject(tx.error || new Error('FuwaDB delete failed'));
    });
  }

  async function refreshMainState() {
    try {
      if (typeof window.loadState === 'function') await window.loadState();
      if (typeof window.renderAll === 'function') window.renderAll();
    } catch (error) {
      console.info('Memory Garden saved; main Fuwa view will refresh next navigation.', error);
    }
  }

  function notify(message) {
    if (typeof window.toast === 'function') return window.toast(message);
    const host = $('fuwaRoadmapToast');
    if (!host) return;
    host.textContent = message;
    host.classList.add('show');
    clearTimeout(host._timer);
    host._timer = setTimeout(() => host.classList.remove('show'), 2200);
  }

  function injectShell() {
    if ($('fuwaRoadmapSheet')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'memoryGardenDrawerButton';
    button.className = 'drawer-menu-item fuwa-roadmap-entry';
    button.innerHTML = '<span class="drawer-item-icon roadmap-garden-icon" aria-hidden="true">❀</span><span><strong>Memory Garden</strong><small>Chapters, capsules, one-photo days & insights.</small></span><b>›</b>';

    const journalDetails = [...document.querySelectorAll('.drawer-group')].find(el => /Journal & Memories/i.test(el.textContent || ''));
    const list = journalDetails?.querySelector('.drawer-menu-list');
    if (list) list.appendChild(button);
    else document.querySelector('.drawer-scroll')?.appendChild(button);

    document.body.insertAdjacentHTML('beforeend', `
      <div class="roadmap-sheet hidden" id="fuwaRoadmapSheet" role="dialog" aria-modal="true" aria-labelledby="fuwaRoadmapTitle">
        <div class="roadmap-shell">
          <header class="roadmap-header">
            <button type="button" class="roadmap-close" id="fuwaRoadmapClose" aria-label="Close Memory Garden">×</button>
            <div><p class="eyebrow">Your memories, growing together</p><h2 id="fuwaRoadmapTitle">Memory Garden</h2><p>Gather chapters, seal little capsules, keep one-photo days, and see the shape of your writing.</p></div>
          </header>
          <nav class="roadmap-tabs" aria-label="Memory Garden sections">
            <button data-roadmap-tab="garden" class="active">Garden</button>
            <button data-roadmap-tab="chapters">Chapters</button>
            <button data-roadmap-tab="capsules">Capsules</button>
            <button data-roadmap-tab="onephoto">One Photo</button>
            <button data-roadmap-tab="wonder">I Wonder…</button>
            <button data-roadmap-tab="insights">Insights</button>
          </nav>
          <main class="roadmap-content" id="fuwaRoadmapContent"></main>
        </div>
      </div>
      <div class="roadmap-toast" id="fuwaRoadmapToast" role="status" aria-live="polite"></div>
    `);

    button.addEventListener('click', openSheet);
    $('fuwaRoadmapClose')?.addEventListener('click', closeSheet);
    $('fuwaRoadmapSheet')?.addEventListener('click', (event) => { if (event.target === $('fuwaRoadmapSheet')) closeSheet(); });
    document.querySelectorAll('[data-roadmap-tab]').forEach(tab => tab.addEventListener('click', () => switchTab(tab.dataset.roadmapTab)));
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !$('fuwaRoadmapSheet')?.classList.contains('hidden')) closeSheet(); });
  }

  function openSheet() {
    document.getElementById('fuwaDrawer')?.classList.remove('open');
    document.getElementById('fuwaDrawerBackdrop')?.classList.add('hidden');
    $('fuwaRoadmapSheet')?.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    render();
  }

  function closeSheet() {
    $('fuwaRoadmapSheet')?.classList.add('hidden');
    document.body.style.overflow = '';
  }

  function switchTab(tab) {
    activeTab = tab;
    document.querySelectorAll('[data-roadmap-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.roadmapTab === tab));
    render();
  }

  async function loadCore() {
    const [entries, lifeCollections, moments, thoughtBubbles, moodCheckins] = await Promise.all([
      getAll('entries'), getAll('lifeCollections'), getAll('moments'), getAll('thoughtBubbles'), getAll('moodCheckins')
    ]);
    const chapters = lifeCollections.filter(item => item.kind === 'life-chapter');
    let media = [];
    let mediaCount = 0;
    if (activeTab === 'garden') mediaCount = await countStore('media');
    if (activeTab === 'onephoto') {
      const ids = entries.filter(entry => (entry.tags || []).includes('one-photo-one-sentence')).sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 60).map(entry => entry.id);
      media = await getMediaForEntryIds(ids);
      mediaCount = media.length;
    }
    return { entries, chapters, moments, thoughtBubbles, moodCheckins, media, mediaCount };
  }

  async function render() {
    const host = $('fuwaRoadmapContent');
    if (!host) return;
    host.innerHTML = '<div class="roadmap-loading">Gathering your little garden…</div>';
    try {
      const data = await loadCore();
      if (activeTab === 'chapters') renderChapters(host, data);
      else if (activeTab === 'capsules') renderCapsules(host, data);
      else if (activeTab === 'onephoto') renderOnePhoto(host, data);
      else if (activeTab === 'wonder') renderWonder(host, data);
      else if (activeTab === 'insights') renderInsights(host, data);
      else renderGarden(host, data);
    } catch (error) {
      console.error('Memory Garden render failed.', error);
      host.innerHTML = '<div class="roadmap-empty"><strong>Memory Garden could not open just now.</strong><span>Your existing Fuwa data was not changed.</span><button id="roadmapRetry" type="button">Try again</button></div>';
      $('roadmapRetry')?.addEventListener('click', render);
    }
  }

  function entryLabel(entry) {
    return entry.title || entry.body?.slice(0, 54) || entry.date || 'Untitled memory';
  }

  function renderGarden(host, { entries, chapters, moments, thoughtBubbles, mediaCount }) {
    const capsules = moments.filter(m => m.kind === 'memory-capsule' || (m.tags || []).includes('memory-capsule'));
    const onePhotoCount = entries.filter(e => (e.tags || []).includes('one-photo-one-sentence')).length;
    const wonders = thoughtBubbles.filter(b => b.kind === 'i-wonder');
    const chapterPlants = chapters.length ? chapters.map((chapter, index) => {
      const count = Array.isArray(chapter.entryIds) ? chapter.entryIds.length : 0;
      const size = Math.min(4, Math.max(1, Math.ceil(count / 4)));
      return `<button class="garden-plant size-${size}" data-open-chapter="${esc(chapter.id)}" aria-label="Open ${esc(chapter.title)} chapter"><span class="plant-flower">${['❀','✿','❁','✾'][index % 4]}</span><strong>${esc(chapter.title)}</strong><small>${count} ${count === 1 ? 'memory' : 'memories'}</small></button>`;
    }).join('') : '<div class="garden-seed"><span>🌱</span><strong>Your first chapter can grow here.</strong><small>A chapter can hold memories from many different days.</small><button type="button" data-jump-tab="chapters">Plant a chapter</button></div>';

    host.innerHTML = `
      <section class="garden-hero"><div><p class="eyebrow">A visual life garden</p><h3>${chapters.length ? `${chapters.length} chapter${chapters.length === 1 ? '' : 's'} are growing` : 'Your garden is ready for its first chapter'}</h3><p>The garden grows from memories you choose. Bigger flowers simply mean a chapter has gathered more entries — there is no score and nothing to keep up with.</p></div><span class="garden-cloud" aria-hidden="true">☁️</span></section>
      <div class="garden-field">${chapterPlants}</div>
      <div class="roadmap-stat-grid">
        <article><span>✦</span><strong>${entries.length}</strong><small>journal memories</small></article>
        <article><span>◌</span><strong>${capsules.length}</strong><small>memory capsules</small></article>
        <article><span>▣</span><strong>${onePhotoCount}</strong><small>one-photo days</small></article>
        <article><span>?</span><strong>${wonders.length}</strong><small>future questions</small></article>
        <article><span>♡</span><strong>${mediaCount}</strong><small>attached photos</small></article>
      </div>
      <section class="roadmap-gentle-note"><strong>Nothing here replaces your journal.</strong><p>Memory Garden is only another way to arrange what is already yours.</p></section>
    `;
    host.querySelectorAll('[data-jump-tab]').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.jumpTab)));
    host.querySelectorAll('[data-open-chapter]').forEach(btn => btn.addEventListener('click', () => { activeTab = 'chapters'; document.querySelectorAll('[data-roadmap-tab]').forEach(t => t.classList.toggle('active', t.dataset.roadmapTab === 'chapters')); render().then(() => document.querySelector(`[data-chapter-card="${CSS.escape(btn.dataset.openChapter)}"]`)?.scrollIntoView({behavior:'smooth',block:'center'})); }));
  }

  function renderChapters(host, { entries, chapters }) {
    const recent = [...entries].sort((a,b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)).slice(0, 60);
    host.innerHTML = `
      <section class="roadmap-section-head"><div><p class="eyebrow">Life Chapters</p><h3>Stories can belong to more than one chapter.</h3><p>Choose only the memories that feel like they belong together. Fuwa will never move an entry by itself.</p></div></section>
      <form id="chapterForm" class="roadmap-form">
        <label>Chapter name<input id="chapterTitle" maxlength="70" required placeholder="My Japan chapter"></label>
        <label>What makes this chapter yours?<textarea id="chapterDescription" rows="3" maxlength="320" placeholder="Optional — a little note about this season of life"></textarea></label>
        <details class="chapter-entry-picker"><summary>Choose memories <span id="chapterSelectedCount">0 selected</span></summary><div class="chapter-entry-list">${recent.length ? recent.map(e => `<label><input type="checkbox" name="chapterEntry" value="${esc(e.id)}"><span><strong>${esc(entryLabel(e))}</strong><small>${esc(e.date || '')}</small></span></label>`).join('') : '<p class="muted">Write a journal entry first, then it can join a chapter.</p>'}</div></details>
        <button class="roadmap-primary" type="submit">Create Chapter</button>
      </form>
      <div class="chapter-list">${chapters.length ? chapters.map(ch => chapterCard(ch, entries)).join('') : '<div class="roadmap-empty compact"><strong>No chapters yet.</strong><span>Create one when a group of memories starts feeling like part of the same story.</span></div>'}</div>
    `;
    $('chapterForm')?.addEventListener('change', () => { const count = document.querySelectorAll('input[name="chapterEntry"]:checked').length; if ($('chapterSelectedCount')) $('chapterSelectedCount').textContent = `${count} selected`; });
    $('chapterForm')?.addEventListener('submit', saveChapter);
    host.querySelectorAll('[data-delete-chapter]').forEach(btn => btn.addEventListener('click', () => deleteChapter(btn.dataset.deleteChapter)));
  }

  function chapterCard(chapter, entries) {
    const ids = Array.isArray(chapter.entryIds) ? chapter.entryIds : [];
    const linked = ids.map(id => entries.find(e => e.id === id)).filter(Boolean).slice(0, 5);
    return `<article class="chapter-card" data-chapter-card="${esc(chapter.id)}"><div class="chapter-card-top"><span>❀</span><div><h4>${esc(chapter.title || 'Untitled chapter')}</h4><p>${esc(chapter.description || 'A chapter in your Fuwa story.')}</p></div><button type="button" data-delete-chapter="${esc(chapter.id)}" aria-label="Delete chapter">×</button></div><div class="chapter-memory-chips">${linked.length ? linked.map(e => `<span>${esc(entryLabel(e))}</span>`).join('') : '<small>No memories linked yet.</small>'}</div><footer>${ids.length} ${ids.length === 1 ? 'memory' : 'memories'} in this chapter</footer></article>`;
  }

  async function saveChapter(event) {
    event.preventDefault();
    const title = $('chapterTitle')?.value.trim();
    if (!title) return;
    const record = {
      id: uid('chapter'), title, description: $('chapterDescription')?.value.trim() || '',
      entryIds: [...document.querySelectorAll('input[name="chapterEntry"]:checked')].map(el => el.value),
      createdAt: Date.now(), updatedAt: Date.now(), version: 1
    };
    record.kind = 'life-chapter'; record.category = 'chapter'; record.note = record.description;
    await put('lifeCollections', record);
    notify('Chapter planted in your Memory Garden ❀');
    render();
  }

  async function deleteChapter(id) {
    if (!confirm('Remove this chapter? The journal entries inside it will stay exactly where they are.')) return;
    await remove('lifeCollections', id);
    notify('Chapter removed. Your entries were kept.');
    render();
  }

  function renderCapsules(host, { entries, moments }) {
    const capsules = moments.filter(m => m.kind === 'memory-capsule' || (m.tags || []).includes('memory-capsule')).sort((a,b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
    const recent = [...entries].sort((a,b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 40);
    host.innerHTML = `
      <section class="roadmap-section-head"><div><p class="eyebrow">Memory Capsules</p><h3>Seal a small piece of right now.</h3><p>Add a mood, song, weather note, and a memory to return to later.</p></div></section>
      <form id="capsuleForm" class="roadmap-form">
        <label>Capsule title<input id="capsuleTitle" maxlength="100" required placeholder="A little piece of August"></label>
        <label>Note for Future You<textarea id="capsuleNote" rows="4" maxlength="900" placeholder="What do you hope you remember about this moment?"></textarea></label>
        <div class="roadmap-two"><label>Mood<input id="capsuleMood" maxlength="40" placeholder="calm, excited, unsure…"></label><label>Open again on<input id="capsuleReopen" type="date"></label></div>
        <div class="roadmap-two"><label>Song<input id="capsuleSong" maxlength="120" placeholder="Optional"></label><label>Weather<input id="capsuleWeather" maxlength="80" placeholder="Optional"></label></div>
        <label>Link a journal memory<select id="capsuleEntry"><option value="">None</option>${recent.map(e => `<option value="${esc(e.id)}">${esc(entryLabel(e))}</option>`).join('')}</select></label>
        <button class="roadmap-primary" type="submit">Seal Capsule</button>
      </form>
      <div class="capsule-list">${capsules.length ? capsules.map(c => `<article class="capsule-card"><span class="capsule-ribbon">◌</span><div><small>${esc(c.reopenDate ? `Return ${c.reopenDate}` : c.date || '')}</small><h4>${esc(c.title)}</h4><p>${esc(c.note || '')}</p><div class="capsule-meta">${c.mood ? `<span>♡ ${esc(c.mood)}</span>` : ''}${c.song ? `<span>♪ ${esc(c.song)}</span>` : ''}${c.weather ? `<span>☁ ${esc(c.weather)}</span>` : ''}</div></div><button type="button" data-delete-capsule="${esc(c.id)}" aria-label="Delete capsule">×</button></article>`).join('') : '<div class="roadmap-empty compact"><strong>No capsules yet.</strong><span>Seal one when today feels worth opening again later.</span></div>'}</div>
    `;
    $('capsuleForm')?.addEventListener('submit', saveCapsule);
    host.querySelectorAll('[data-delete-capsule]').forEach(btn => btn.addEventListener('click', () => deleteCapsule(btn.dataset.deleteCapsule)));
  }

  async function saveCapsule(event) {
    event.preventDefault();
    const title = $('capsuleTitle')?.value.trim();
    if (!title) return;
    const now = Date.now();
    const record = {
      id: uid('moment'), title, type: 'other', kind: 'memory-capsule', date: today(), place: '',
      extraA: $('capsuleSong')?.value.trim() || '', extraB: $('capsuleWeather')?.value.trim() || '', amount: null, rating: null, quote: '',
      note: $('capsuleNote')?.value.trim() || '', tags: ['memory-capsule'], includeWrapped: false,
      mood: $('capsuleMood')?.value.trim() || '', song: $('capsuleSong')?.value.trim() || '', weather: $('capsuleWeather')?.value.trim() || '',
      reopenDate: $('capsuleReopen')?.value || '', linkedEntryId: $('capsuleEntry')?.value || '', createdAt: now, updatedAt: now
    };
    await put('moments', record);
    await refreshMainState();
    notify('Memory capsule sealed ◌');
    render();
  }

  async function deleteCapsule(id) {
    if (!confirm('Delete this Memory Capsule?')) return;
    await remove('moments', id); await refreshMainState(); notify('Capsule removed.'); render();
  }

  function renderOnePhoto(host, { entries, media }) {
    const onePhotoEntries = entries.filter(e => (e.tags || []).includes('one-photo-one-sentence')).sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 60);
    const mediaByEntry = new Map(); media.forEach(m => { if (!mediaByEntry.has(m.entryId)) mediaByEntry.set(m.entryId, m); });
    host.innerHTML = `
      <section class="roadmap-section-head"><div><p class="eyebrow">One Photo + One Sentence</p><h3>A whole day can fit in two little things.</h3><p>The photo stays in Fuwa's local media store, just like ordinary journal attachments.</p></div></section>
      <form id="onePhotoForm" class="roadmap-form">
        <label>One sentence<textarea id="onePhotoSentence" rows="3" maxlength="300" required placeholder="The rain made the whole street smell like summer."></textarea></label>
        <label class="one-photo-picker">One photo<input id="onePhotoFile" type="file" accept="image/*" required><span id="onePhotoFileLabel">Choose a photo</span></label>
        <label>Date<input id="onePhotoDate" type="date" value="${today()}"></label>
        <button class="roadmap-primary" type="submit">Keep This Day</button>
      </form>
      <div class="one-photo-grid">${onePhotoEntries.length ? onePhotoEntries.map(e => { const m = mediaByEntry.get(e.id); return `<article><div class="one-photo-thumb" data-photo-id="${m ? esc(m.id) : ''}">${m ? '<span>Photo</span>' : '<span>No photo found</span>'}</div><small>${esc(e.date || '')}</small><p>${esc(e.body || e.title || '')}</p></article>`; }).join('') : '<div class="roadmap-empty compact"><strong>No one-photo days yet.</strong><span>Use this when a full journal entry would be more than you need.</span></div>'}</div>
    `;
    $('onePhotoFile')?.addEventListener('change', (e) => { if ($('onePhotoFileLabel')) $('onePhotoFileLabel').textContent = e.target.files?.[0]?.name || 'Choose a photo'; });
    $('onePhotoForm')?.addEventListener('submit', saveOnePhoto);
    hydrateOnePhotoThumbs(mediaByEntry, onePhotoEntries);
  }

  async function hydrateOnePhotoThumbs(mediaByEntry, entries) {
    const byId = new Map(entries.map(e => [e.id, mediaByEntry.get(e.id)]));
    document.querySelectorAll('.one-photo-grid article').forEach((card, index) => {
      const media = byId.get(entries[index]?.id);
      const host = card.querySelector('.one-photo-thumb');
      if (!media?.blob || !host) return;
      const url = URL.createObjectURL(media.blob);
      host.innerHTML = `<img src="${url}" alt="One photo memory">`;
      host.querySelector('img')?.addEventListener('load', () => setTimeout(() => URL.revokeObjectURL(url), 500), { once: true });
    });
  }

  async function compressPhoto(file) {
    let source = null;
    let cleanup = () => {};
    try {
      if (typeof createImageBitmap === 'function') {
        try {
          source = await createImageBitmap(file);
          cleanup = () => source?.close?.();
        } catch (error) {
          console.info('Fuwa is using the compatible photo decoder.', error);
        }
      }
      if (!source) {
        const url = URL.createObjectURL(file);
        source = await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error('Photo could not be decoded'));
          img.src = url;
        });
        cleanup = () => URL.revokeObjectURL(url);
      }
      const sourceWidth = source.width || source.naturalWidth;
      const sourceHeight = source.height || source.naturalHeight;
      if (!sourceWidth || !sourceHeight) throw new Error('Photo dimensions are unavailable');
      const max = 1800;
      const scale = Math.min(1, max / Math.max(sourceWidth, sourceHeight));
      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Photo canvas is unavailable');
      context.drawImage(source, 0, 0, width, height);
      const blob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Photo compression failed')), 'image/jpeg', 0.82));
      return { blob, width, height, type: 'image/jpeg' };
    } finally {
      try { cleanup(); } catch (_) {}
    }
  }

  async function saveOnePhoto(event) {
    event.preventDefault();
    const sentence = $('onePhotoSentence')?.value.trim();
    const file = $('onePhotoFile')?.files?.[0];
    if (!sentence || !file) return notify('Add one sentence and one photo first.');
    const button = event.submitter; if (button) button.disabled = true;
    try {
      const photo = await compressPhoto(file);
      const now = Date.now(); const entryId = uid('entry');
      const entry = { id: entryId, title: 'One Photo + One Sentence', body: sentence, date: $('onePhotoDate')?.value || today(), mood: 'good', tags: ['one-photo-one-sentence'], afterthought: '', createdAt: now, updatedAt: now };
      const mediaRecord = { id: uid('media'), entryId, blob: photo.blob, type: photo.type, width: photo.width, height: photo.height, originalName: file.name || 'Fuwa photo', createdAt: now };
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(['entries', 'media'], 'readwrite'); tx.objectStore('entries').put(entry); tx.objectStore('media').put(mediaRecord);
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      });
      window.dispatchEvent(new CustomEvent('fuwa-local-data-changed', { detail: { source:'local', action:'save-entry', storeName:'entries', recordId:entryId, at:Date.now() } }));
      await refreshMainState(); notify('One photo day tucked into Fuwa ▣'); render();
    } catch (error) {
      console.error('One Photo + One Sentence failed.', error); notify('Fuwa could not save that photo. Your existing data was not changed.');
    } finally { if (button) button.disabled = false; }
  }

  function renderWonder(host, { thoughtBubbles }) {
    const wonders = thoughtBubbles.filter(b => b.kind === 'i-wonder').sort((a,b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
    host.innerHTML = `
      <section class="roadmap-section-head"><div><p class="eyebrow">I Wonder…</p><h3>Leave a question for Future You.</h3><p>It lives alongside Thought Bubbles, with an optional date to ask yourself again.</p></div></section>
      <form id="wonderForm" class="roadmap-form"><label>What do you wonder?<textarea id="wonderText" rows="4" maxlength="600" required placeholder="I wonder if this will still matter to me next year…"></textarea></label><label>Ask me again on<input id="wonderDate" type="date"></label><button class="roadmap-primary" type="submit">Keep This Question</button></form>
      <div class="wonder-list">${wonders.length ? wonders.map(w => `<article><span>?</span><div><small>${w.revisitDate ? `Ask again ${esc(w.revisitDate)}` : 'For Future You'}</small><p>${esc(w.text)}</p></div><button type="button" data-delete-wonder="${esc(w.id)}" aria-label="Delete question">×</button></article>`).join('') : '<div class="roadmap-empty compact"><strong>No future questions yet.</strong><span>Keep one whenever you catch yourself wondering how something will turn out.</span></div>'}</div>
    `;
    $('wonderForm')?.addEventListener('submit', saveWonder);
    host.querySelectorAll('[data-delete-wonder]').forEach(btn => btn.addEventListener('click', () => deleteWonder(btn.dataset.deleteWonder)));
  }

  async function saveWonder(event) {
    event.preventDefault(); const text = $('wonderText')?.value.trim(); if (!text) return;
    const now = Date.now(); const record = { id: uid('bubble'), text, date: today(), releasedAt: null, kind: 'i-wonder', revisitDate: $('wonderDate')?.value || '', createdAt: now, updatedAt: now };
    await put('thoughtBubbles', record); await refreshMainState(); notify('Question kept for Future You ?'); render();
  }

  async function deleteWonder(id) { if (!confirm('Remove this future question?')) return; await remove('thoughtBubbles', id); await refreshMainState(); notify('Question removed.'); render(); }

  function renderInsights(host, { entries, moodCheckins, chapters }) {
    const now = new Date(); const ym = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    const thisMonth = entries.filter(e => String(e.date || '').startsWith(ym));
    const words = entries.reduce((sum,e) => sum + String(`${e.title || ''} ${e.body || ''}`).trim().split(/\s+/).filter(Boolean).length, 0);
    const tagCounts = new Map(); entries.forEach(e => (e.tags || []).forEach(t => tagCounts.set(t, (tagCounts.get(t) || 0) + 1)));
    const topTags = [...tagCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6);
    const moods = new Map(); [...moodCheckins, ...entries.filter(e=>e.mood)].forEach(item => { const m = item.mood; if (m) moods.set(m,(moods.get(m)||0)+1); });
    const moodRows = [...moods.entries()].sort((a,b)=>b[1]-a[1]); const maxMood = Math.max(1, ...moodRows.map(x=>x[1]));
    const dates = new Set(entries.map(e=>e.date).filter(Boolean));
    let streak = 0; const cursor = new Date(); for(let i=0;i<3650;i++){ const d=cursor.toISOString().slice(0,10); if(dates.has(d)) streak++; else if(i>0) break; cursor.setDate(cursor.getDate()-1); }
    host.innerHTML = `
      <section class="roadmap-section-head"><div><p class="eyebrow">Writing & Mood Insights</p><h3>A quiet overview — not a scorecard.</h3><p>These numbers describe what is in Fuwa. They are never used to judge how often or how much you write.</p></div></section>
      <div class="insight-number-grid"><article><strong>${entries.length}</strong><span>entries</span></article><article><strong>${thisMonth.length}</strong><span>this month</span></article><article><strong>${words.toLocaleString()}</strong><span>words kept</span></article><article><strong>${chapters.length}</strong><span>chapters</span></article><article><strong>${streak}</strong><span>current writing days</span></article></div>
      <section class="insight-card"><h4>Your most-used tags</h4>${topTags.length ? `<div class="tag-cloud">${topTags.map(([tag,count])=>`<span>#${esc(tag)} <small>${count}</small></span>`).join('')}</div>` : '<p class="muted">Tags will gather here as you use them.</p>'}</section>
      <section class="insight-card"><h4>Mood distribution</h4>${moodRows.length ? `<div class="mood-bars">${moodRows.map(([m,count])=>`<div><span>${esc(m)}</span><i><b style="width:${Math.max(8, Math.round(count/maxMood*100))}%"></b></i><small>${count}</small></div>`).join('')}</div>` : '<p class="muted">Mood check-ins will gather here over time.</p>'}</section>
      <section class="roadmap-gentle-note"><strong>For deeper reflection</strong><p>Emotional Weather and Fuwa Insights still hold the richer month-by-month and meaning-based views. This page is the simple numeric overview the original roadmap was missing.</p></section>
    `;
  }

  async function verifyStorageShape() {
    try {
      const db = await openDb();
      const required = ['entries','media','lifeCollections','moments','thoughtBubbles'];
      return required.every(name => db.objectStoreNames.contains(name));
    } catch (_) { return false; }
  }

  window.fuwaMemoryGardenDebug = { version: MODULE_VERSION, openDb, getAll, countStore, getMediaForEntryIds, verifyStorageShape, switchTab, render };
  window.fuwaRoadmapDebug = window.fuwaMemoryGardenDebug;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectShell, { once: true });
  else injectShell();
})();
