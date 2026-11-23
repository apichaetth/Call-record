/* POCO ใบเสร็จ — capture/scan receipts, OCR them, upload to pCloud (one folder per month). */
(function () {
  'use strict';

  const MAX_SIDE = 2400;       // px; keeps text sharp while files stay ~0.5–1.5 MB
  const JPEG_QUALITY = 0.85;

  const $ = s => document.querySelector(s);
  const els = {
    authBtn: $('#authBtn'), settingsBtn: $('#settingsBtn'), banner: $('#banner'),
    cameraBtn: $('#cameraBtn'), albumBtn: $('#albumBtn'),
    cameraInput: $('#cameraInput'), albumInput: $('#albumInput'),
    list: $('#list'), empty: $('#empty'), tpl: $('#itemTpl'),
    sendAllBtn: $('#sendAllBtn'), clearDoneBtn: $('#clearDoneBtn'),
    settings: $('#settings'), sClientId: $('#sClientId'), sFolder: $('#sFolder'),
    sAutoSend: $('#sAutoSend'), sCheck: $('#sCheck'), sStatus: $('#sStatus'),
    sSignOut: $('#sSignOut'), csvBtn: $('#csvBtn'),
  };

  /* ---------- settings ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem('rs.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('rs.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  const settings = {
    get clientId() { return store.get('clientId', ''); },
    get folderPath() { return store.get('folderPath', '/ใบเสร็จ'); },
    get autoSend() { return store.get('autoSend', true); },
  };

  /* ---------- IndexedDB ---------- */
  let dbPromise;
  function db() {
    dbPromise = dbPromise || new Promise((resolve, reject) => {
      const req = indexedDB.open('receipts', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('items', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }
  async function tx(mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction('items', mode);
      const r = fn(t.objectStore('items'));
      t.oncomplete = () => resolve(r && r.result);
      t.onerror = () => reject(t.error);
    });
  }
  const dbPut = item => tx('readwrite', s => s.put(item));
  const dbDel = id => tx('readwrite', s => s.delete(id));
  const dbAll = () => tx('readonly', s => s.getAll());

  /* ---------- state ---------- */
  const items = new Map();
  const thumbs = new Map();

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  async function save(item) {
    items.set(item.id, item);
    render(item);
    await dbPut(item);
  }

  /* ---------- image conversion (HEIC -> JPEG) ---------- */
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ img, url });
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('เปิดรูปไม่ได้ (ไฟล์อาจไม่ใช่รูปภาพ)')); };
      img.src = url;
    });
  }

  async function toJpeg(file) {
    // Safari decodes HEIC natively and applies EXIF rotation when drawing an <img>.
    const { img, url } = await loadImage(file);
    try {
      const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', JPEG_QUALITY));
      if (!blob) throw new Error('แปลงรูปเป็น JPG ไม่สำเร็จ');
      return blob;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /* ---------- OCR ---------- */
  let workerPromise = null;
  let ocrQueue = Promise.resolve();
  let currentOcrId = null;

  function getWorker() {
    if (!window.Tesseract) return Promise.reject(new Error('ยังโหลดตัวอ่านข้อความไม่เสร็จ ลองใหม่อีกครั้ง'));
    workerPromise = workerPromise || Tesseract.createWorker('tha+eng', 1, {
      logger: m => {
        const it = currentOcrId && items.get(currentOcrId);
        if (!it || it.status !== 'ocr') return;
        const pct = Math.round((m.progress || 0) * 100);
        const label = m.status === 'recognizing text' ? 'กำลังอ่านข้อความ ' + pct + '%' : 'กำลังเตรียมตัวอ่าน (ครั้งแรกจะนานหน่อย) ' + pct + '%';
        setStatusText(it.id, label, 'warn');
      },
    }).catch(err => { workerPromise = null; throw err; });
    return workerPromise;
  }

  function queueOcr(id) {
    ocrQueue = ocrQueue.then(() => runOcr(id)).catch(() => {});
    return ocrQueue;
  }

  async function runOcr(id) {
    let item = items.get(id);
    if (!item) return;
    item.status = 'ocr'; item.error = '';
    await save(item);
    currentOcrId = id;
    try {
      const worker = await getWorker();
      const { data } = await worker.recognize(item.blob);
      item = items.get(id);
      if (!item) return;
      const parsed = ReceiptParse.parseReceipt(data.text);
      // Keep anything the user already typed; fill only the blanks.
      for (const [k, v] of Object.entries(parsed)) if (!item.fields[k] && v) item.fields[k] = v;
      item.ocrText = data.text;
      item.status = 'review';
    } catch (err) {
      item = items.get(id);
      if (!item) return;
      item.status = 'review';
      item.error = 'อ่านอัตโนมัติไม่สำเร็จ กรอกเองได้: ' + (err && err.message || err);
    } finally {
      currentOcrId = null;
    }
    await save(item);
    if (item.mode === 'camera' && settings.autoSend) sendItem(item.id, { interactive: false });
  }

  /* ---------- pCloud auth (OAuth implicit flow, full-page redirect) ---------- */
  const PCLOUD_AUTH = 'https://my.pcloud.com/oauth2/authorize';
  const API_HOSTS = { 1: 'api.pcloud.com', 2: 'eapi.pcloud.com' };  // 1 = US, 2 = EU account
  const WEB_HOSTS = { 1: 'my.pcloud.com', 2: 'e.pcloud.com' };
  const AUTH_ERRORS = new Set([1000, 2000, 2094, 2095]);              // login required / bad or revoked token

  function auth() {
    const a = store.get('pcloud', null);
    return a && a.token ? a : null;
  }

  function appUrl() {
    return location.origin + location.pathname;
  }

  // Must be called from a tap. Leaves the page; boot() finishes the sign-in on return.
  function signIn() {
    if (!settings.clientId) { showBanner('ยังไม่ได้ใส่ pCloud Client ID ในตั้งค่า'); openSettings(); return; }
    const state = uid();
    store.set('oauthState', state);
    location.href = PCLOUD_AUTH + '?' + qs({ client_id: settings.clientId, response_type: 'token', redirect_uri: appUrl(), state });
  }

  // Returns true when this page load is the redirect back from pCloud.
  function finishSignIn() {
    if (!/access_token=|error=/.test(location.hash)) return false;
    const h = new URLSearchParams(location.hash.slice(1));
    history.replaceState(null, '', appUrl());
    const expected = store.get('oauthState', '');
    store.set('oauthState', '');
    if (h.get('error')) { showBanner('เข้าสู่ระบบ pCloud ไม่สำเร็จ: ' + h.get('error')); return true; }
    if (!expected || h.get('state') !== expected) { showBanner('การเข้าสู่ระบบไม่ตรงกับคำขอ ลองใหม่อีกครั้ง'); return true; }
    store.set('pcloud', { token: h.get('access_token'), locationid: Number(h.get('locationid')) || 1 });
    return true;
  }

  function signOut() {
    store.set('pcloud', null);
    Object.keys(localStorage).filter(k => k.startsWith('rs.folder.')).forEach(k => localStorage.removeItem(k));
    updateAuthUi();
  }

  function updateAuthUi() {
    const ok = !!auth();
    els.authBtn.textContent = ok ? 'เชื่อมต่อ pCloud แล้ว' : 'เข้าสู่ระบบ pCloud';
    els.authBtn.classList.toggle('ghost', ok);
    refreshBanner();
  }

  /* ---------- pCloud API ---------- */
  class AuthError extends Error {}
  const qs = o => new URLSearchParams(o).toString();

  async function pcloud(method, params = {}, body) {
    const a = auth();
    if (!a) throw new AuthError('ต้องเข้าสู่ระบบ pCloud');
    const host = API_HOSTS[a.locationid] || API_HOSTS[1];
    // Token goes in the query string: keeps requests "simple" for CORS, as the official SDK does.
    const url = 'https://' + host + '/' + method + '?' + qs({ ...params, access_token: a.token });
    let res;
    try {
      res = await fetch(url, body ? { method: 'POST', body } : {});
    } catch {
      throw new Error('เชื่อมต่อ pCloud ไม่ได้ (เช็กอินเทอร์เน็ต)');
    }
    const j = await res.json().catch(() => ({ result: res.status, error: 'HTTP ' + res.status }));
    if (j.result !== 0) {
      if (AUTH_ERRORS.has(j.result)) { signOut(); throw new AuthError('ต้องเข้าสู่ระบบ pCloud ใหม่'); }
      throw new Error((j.error || 'ผิดพลาด') + ' (' + j.result + ')');
    }
    return j;
  }

  function folderSegments(path) {
    return String(path || '').split('/').map(s => s.trim()).filter(Boolean);
  }

  // Walk/create the configured path, then the month folder. Returns the month folder's id.
  async function ensureFolderPath(segments) {
    const cacheKey = 'folder.' + segments.join('/');
    const cached = store.get(cacheKey, 0);
    if (cached) return cached;
    let id = 0; // pCloud root
    for (const name of segments) {
      const r = await pcloud('createfolderifnotexists', { folderid: id, name });
      id = r.metadata.folderid;
    }
    store.set(cacheKey, id);
    return id;
  }

  async function existingFile(folderid, name) {
    const r = await pcloud('listfolder', { folderid, nofiles: 0, noshares: 1 });
    return (r.metadata.contents || []).find(f => !f.isfolder && f.name === name);
  }

  async function uploadJpeg(blob, folderid, name) {
    const form = new FormData();
    form.append('file', blob, name);
    const r = await pcloud('uploadfile', { folderid, nopartial: 1, renameifexists: 1 }, form);
    return r.metadata[0];
  }

  function folderLink(folderid) {
    const a = auth();
    return 'https://' + (WEB_HOSTS[a && a.locationid] || WEB_HOSTS[1]) + '/#page=filemanager&folder=' + folderid;
  }

  /* ---------- naming & metadata ---------- */
  function localDate(ts) {
    const d = new Date(ts);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function cleanPart(s, max) {
    return String(s || '').replace(/[\\/:*?"<>|#%\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function fileNameFor(item) {
    const f = item.fields;
    const date = f.date || localDate(item.createdAt);
    const parts = [date, cleanPart(f.vendor, 40) || 'ใบเสร็จ'];
    if (f.total) parts.push(cleanPart(f.total, 16) + 'บาท');
    parts.push(item.id.slice(-4)); // keeps two bills with the same details from colliding
    return parts.join('_') + '.jpg';
  }

  /* ---------- CSV summary (pCloud has no per-file notes, so details travel in a CSV) ---------- */
  const CSV_COLS = [
    ['วันที่', i => i.fields.date], ['ร้าน/ผู้ขาย', i => i.fields.vendor], ['ยอดรวม', i => i.fields.total],
    ['VAT', i => i.fields.vat], ['เลขผู้เสียภาษี', i => i.fields.taxId], ['เลขที่บิล', i => i.fields.receiptNo],
    ['หมายเหตุ', i => i.fields.note], ['ชื่อไฟล์', i => i.fileName || fileNameFor(i)],
    ['ที่มา', i => i.mode === 'camera' ? 'ถ่ายจากกล้อง' : 'สแกนจากอัลบั้ม'],
    ['สถานะ', i => i.status === 'done' ? 'ส่งแล้ว' : 'ยังไม่ส่ง'],
  ];

  function csvFor(list) {
    const cell = v => {
      v = String(v == null ? '' : v);
      // Text cells for long digit strings so Excel keeps tax IDs intact.
      if (/^\d{10,}$/.test(v)) v = '="' + v + '"';
      return /[",\n]/.test(v) || v.startsWith('=') ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    const rows = [CSV_COLS.map(c => c[0])].concat(list.map(i => CSV_COLS.map(c => c[1](i))));
    return '\ufeff' + rows.map(r => r.map(cell).join(',')).join('\r\n'); // BOM: Excel reads Thai correctly
  }

  async function exportCsv() {
    const list = [...items.values()].filter(i => i.blob).sort((a, b) =>
      (a.fields.date || localDate(a.createdAt)).localeCompare(b.fields.date || localDate(b.createdAt)));
    if (!list.length) return;
    const name = 'สรุปใบเสร็จ_' + localDate(Date.now()) + '.csv';
    const file = new File([csvFor(list)], name, { type: 'text/csv' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; } catch (err) { if (err.name === 'AbortError') return; }
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  /* ---------- POCO System (waiting for connection details) ---------- */
  async function sendToPoco(/* item */) {
    // TODO: wire up once the POCO System endpoint, auth and required fields are known.
    return { skipped: true };
  }

  /* ---------- sending ---------- */
  const sending = new Set();

  function sendItem(id, { interactive }) {
    const item = items.get(id);
    if (!item || item.status === 'done' || sending.has(id)) return;
    if (!auth()) {
      markReady(item);
      if (interactive) signIn(); // leaves the page; queued items are sent on return
      return;
    }
    doUpload(item);
  }

  async function markReady(item, why) {
    item.status = 'ready';
    item.error = why || '';
    await save(item);
    refreshBanner();
  }

  async function doUpload(item) {
    sending.add(item.id);
    item.status = 'uploading'; item.error = '';
    await save(item);
    try {
      const month = (item.fields.date || localDate(item.createdAt)).slice(0, 7);
      const folderid = await ensureFolderPath(folderSegments(settings.folderPath).concat(month));
      const name = fileNameFor(item);
      // If an earlier attempt uploaded but the reply was lost, don't upload a second copy.
      const file = (await existingFile(folderid, name)) || (await uploadJpeg(item.blob, folderid, name));
      item.cloudId = file.fileid;
      item.cloudLink = folderLink(folderid);
      item.fileName = file.name || name;
      item.status = 'done';
      item.sentAt = Date.now();
      item.poco = (await sendToPoco(item)).skipped ? 'waiting' : 'sent';
    } catch (err) {
      if (err instanceof AuthError) { item.status = 'ready'; item.error = ''; }
      else {
        item.status = 'error';
        item.error = 'ส่งไม่สำเร็จ: ' + (err && err.message || err);
        // A stale cached month folder (deleted/moved) is a common cause; drop the cache.
        Object.keys(localStorage).filter(k => k.startsWith('rs.folder.')).forEach(k => localStorage.removeItem(k));
      }
    } finally {
      sending.delete(item.id);
    }
    await save(item);
    refreshBanner();
  }

  function sendAllPending(interactive) {
    if (!auth()) { if (interactive) signIn(); return; }
    for (const it of items.values()) if (it.status === 'ready' || it.status === 'error') sendItem(it.id, { interactive: false });
  }

  /* ---------- adding receipts ---------- */
  async function addFiles(fileList, mode) {
    const files = Array.from(fileList || []);
    for (const file of files) {
      const item = {
        id: uid(), mode, createdAt: Date.now(), status: 'converting', error: '',
        fields: { vendor: '', date: '', total: '', vat: '', taxId: '', receiptNo: '', note: '' },
      };
      items.set(item.id, item);
      render(item);
      try {
        item.blob = await toJpeg(file);
        await save(item);
        queueOcr(item.id);
      } catch (err) {
        item.status = 'error';
        item.error = err.message || String(err);
        render(item);
      }
    }
  }

  /* ---------- download / save ---------- */
  async function saveImage(item) {
    const name = fileNameFor(item);
    const file = new File([item.blob], name, { type: 'image/jpeg' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; } catch (err) { if (err.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = thumbUrl(item); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ---------- rendering ---------- */
  const STATUS = {
    converting: ['กำลังแปลงรูป…', 'warn'],
    ocr: ['กำลังอ่านข้อความ…', 'warn'],
    review: ['ตรวจข้อมูลแล้วกดส่ง', 'warn'],
    ready: ['รอส่ง (ต้องเข้าสู่ระบบ pCloud)', 'warn'],
    uploading: ['กำลังส่งขึ้น pCloud…', 'warn'],
    done: ['ส่งขึ้น pCloud แล้ว ✓', 'ok'],
    error: ['ผิดพลาด', 'err'],
  };

  function thumbUrl(item) {
    if (!item.blob) return '';
    if (!thumbs.has(item.id)) thumbs.set(item.id, URL.createObjectURL(item.blob));
    return thumbs.get(item.id);
  }

  function setStatusText(id, text, cls) {
    const el = els.list.querySelector('[data-id="' + id + '"] .status');
    if (el) { el.textContent = text; el.className = 'status ' + cls; }
  }

  function render(item) {
    let li = els.list.querySelector('[data-id="' + item.id + '"]');
    if (!li) {
      li = els.tpl.content.firstElementChild.cloneNode(true);
      li.dataset.id = item.id;
      wireItem(li, item.id);
      // Newest first.
      const after = [...els.list.children].find(n => (items.get(n.dataset.id) || {}).createdAt < item.createdAt);
      els.list.insertBefore(li, after || null);
    }
    const [label, cls] = STATUS[item.status] || ['', ''];
    setStatusText(item.id, item.status === 'ready' && item.error ? item.error : label, cls);
    const img = li.querySelector('.thumb');
    const url = thumbUrl(item);
    if (url && img.src !== url) img.src = url;

    const nameEl = li.querySelector('.filename');
    nameEl.textContent = (item.status === 'done' ? item.fileName : fileNameFor(item)) +
      (item.error && item.status !== 'ready' ? '\n' + item.error : '');
    nameEl.style.whiteSpace = 'pre-line';
    li.querySelector('.mode-tag').textContent =
      (item.mode === 'camera' ? 'ถ่ายจากกล้อง' : 'สแกนจากอัลบั้ม') + ' · ' + new Date(item.createdAt).toLocaleString('th-TH') +
      (item.status === 'done' ? ' · POCO System: รอเชื่อมต่อ' : '');

    const locked = item.status === 'done' || item.status === 'uploading' || item.status === 'converting';
    li.querySelectorAll('[data-f]').forEach(inp => {
      const k = inp.dataset.f;
      if (document.activeElement !== inp) inp.value = item.fields[k] || '';
      inp.disabled = locked;
    });
    li.classList.toggle('collapsed', item.status === 'done');

    const busy = item.status === 'ocr' || item.status === 'converting' || item.status === 'uploading';
    const send = li.querySelector('[data-a="send"]');
    send.hidden = item.status === 'done';
    send.disabled = busy;
    send.textContent = item.status === 'error' ? 'ลองส่งอีกครั้ง' : 'ส่งขึ้น pCloud';
    li.querySelector('[data-a="save"]').disabled = !item.blob;
    li.querySelector('[data-a="ocr"]').hidden = item.status === 'done';
    li.querySelector('[data-a="ocr"]').disabled = busy || !item.blob;
    const open = li.querySelector('[data-a="open"]');
    open.hidden = !item.cloudLink;
    if (item.cloudLink) open.href = item.cloudLink;
    li.querySelector('[data-a="del"]').disabled = item.status === 'uploading';

    updateListChrome();
  }

  function wireItem(li, id) {
    let timer;
    li.addEventListener('input', e => {
      const k = e.target.dataset.f;
      const item = items.get(id);
      if (!k || !item) return;
      item.fields[k] = e.target.value.trim();
      li.querySelector('.filename').textContent = fileNameFor(item);
      clearTimeout(timer);
      timer = setTimeout(() => dbPut(item), 400);
    });
    li.addEventListener('click', async e => {
      const a = e.target.closest('[data-a]');
      const item = items.get(id);
      if (!a || !item) return;
      switch (a.dataset.a) {
        case 'send': clearTimeout(timer); await dbPut(item); sendItem(id, { interactive: true }); break;
        case 'save': saveImage(item); break;
        case 'ocr': queueOcr(id); break;
        case 'del':
          if (item.status !== 'done' && !confirm('ใบเสร็จนี้ยังไม่ได้ส่ง ลบเลยไหม?')) return;
          items.delete(id); li.remove(); await dbDel(id);
          if (thumbs.has(id)) { URL.revokeObjectURL(thumbs.get(id)); thumbs.delete(id); }
          updateListChrome(); refreshBanner();
          break;
      }
    });
  }

  function updateListChrome() {
    const all = [...items.values()];
    els.empty.hidden = all.length > 0;
    els.sendAllBtn.hidden = !all.some(i => i.status === 'ready' || i.status === 'error');
    els.clearDoneBtn.hidden = !all.some(i => i.status === 'done');
    els.csvBtn.hidden = !all.some(i => i.blob);
  }

  /* ---------- banner ---------- */
  let bannerMsg = '';
  function showBanner(msg) { bannerMsg = msg; refreshBanner(); }
  function refreshBanner() {
    const waiting = [...items.values()].filter(i => i.status === 'ready').length;
    let msg = bannerMsg;
    if (!msg && !settings.clientId) msg = 'เริ่มต้น: กด ⚙︎ เพื่อใส่ pCloud Client ID และโฟลเดอร์ที่จะเก็บ';
    else if (!msg && waiting && !auth()) msg = 'มี ' + waiting + ' ใบรอส่ง — กด "เข้าสู่ระบบ pCloud" แล้วแอปจะส่งให้อัตโนมัติ';
    els.banner.textContent = msg;
    els.banner.hidden = !msg;
    updateListChrome();
  }

  /* ---------- settings dialog ---------- */
  function openSettings() {
    els.sClientId.value = settings.clientId;
    els.sFolder.value = settings.folderPath;
    els.sAutoSend.checked = settings.autoSend;
    els.sStatus.textContent = '';
    if (els.settings.showModal) els.settings.showModal(); else els.settings.setAttribute('open', '');
  }

  function persistSettings() {
    const clientId = els.sClientId.value.trim();
    if (clientId !== settings.clientId) signOut();
    store.set('clientId', clientId);
    const segs = folderSegments(els.sFolder.value);
    if (segs.some(x => /[\\:*?"<>|]/.test(x))) { els.sStatus.textContent = 'ชื่อโฟลเดอร์มีอักขระที่ใช้ไม่ได้'; return false; }
    store.set('folderPath', '/' + segs.join('/'));
    store.set('autoSend', els.sAutoSend.checked);
    return true;
  }

  els.settings.addEventListener('close', () => {
    if (els.settings.returnValue === 'save') persistSettings();
    bannerMsg = '';
    updateAuthUi();
  });
  els.sCheck.addEventListener('click', async () => {
    if (!persistSettings()) return;
    if (!settings.clientId) { els.sStatus.textContent = 'ใส่ Client ID ก่อน'; return; }
    if (!auth()) { els.sStatus.textContent = 'กำลังไปหน้าเข้าสู่ระบบ pCloud…'; signIn(); return; }
    els.sStatus.textContent = 'กำลังตรวจ…';
    try {
      const segs = folderSegments(settings.folderPath);
      const id = await ensureFolderPath(segs);
      const who = await pcloud('userinfo').catch(() => ({}));
      els.sStatus.innerHTML = '';
      els.sStatus.append('✓ พร้อมใช้: ' + (settings.folderPath) + (who.email ? ' (บัญชี ' + who.email + ')' : '') + ' ');
      const link = document.createElement('a');
      link.href = folderLink(id); link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'เปิดดู';
      els.sStatus.append(link);
    } catch (err) {
      els.sStatus.textContent = '✗ ' + (err.message || err);
    }
  });
  els.sSignOut.addEventListener('click', () => { signOut(); els.sStatus.textContent = 'ออกจากระบบ pCloud แล้ว'; });

  /* ---------- wiring ---------- */
  els.settingsBtn.addEventListener('click', openSettings);
  els.authBtn.addEventListener('click', () => {
    bannerMsg = '';
    if (auth()) { openSettings(); return; }
    signIn();
  });
  els.cameraBtn.addEventListener('click', () => els.cameraInput.click());
  els.albumBtn.addEventListener('click', () => els.albumInput.click());
  els.cameraInput.addEventListener('change', e => { addFiles(e.target.files, 'camera'); e.target.value = ''; });
  els.albumInput.addEventListener('change', e => { addFiles(e.target.files, 'album'); e.target.value = ''; });
  els.sendAllBtn.addEventListener('click', () => sendAllPending(true));
  els.csvBtn.addEventListener('click', exportCsv);
  els.clearDoneBtn.addEventListener('click', async () => {
    for (const it of [...items.values()]) {
      if (it.status !== 'done') continue;
      items.delete(it.id); await dbDel(it.id);
      const li = els.list.querySelector('[data-id="' + it.id + '"]'); if (li) li.remove();
      if (thumbs.has(it.id)) { URL.revokeObjectURL(thumbs.get(it.id)); thumbs.delete(it.id); }
    }
    updateListChrome();
  });

  async function boot() {
    const returnedFromSignIn = finishSignIn();
    try {
      const all = await dbAll();
      all.sort((a, b) => a.createdAt - b.createdAt);
      for (const it of all) {
        if (it.status === 'uploading') it.status = 'ready';    // interrupted mid-upload
        items.set(it.id, it);
        render(it);
        if (it.status === 'ocr') queueOcr(it.id);              // interrupted mid-OCR
      }
    } catch (err) {
      showBanner('เปิดที่เก็บข้อมูลในเครื่องไม่ได้: ' + (err.message || err));
    }
    updateAuthUi();
    if (returnedFromSignIn && auth()) sendAllPending(false);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  boot();
})();
