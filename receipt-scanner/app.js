/* POCO ใบเสร็จ — capture/scan receipts, OCR them, upload to a Google Shared Drive. */
(function () {
  'use strict';

  const SCOPE = 'https://www.googleapis.com/auth/drive';
  const DRIVE = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
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
  };

  /* ---------- settings ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem('rs.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('rs.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  const settings = {
    get clientId() { return store.get('clientId', ''); },
    get folderId() { return store.get('folderId', ''); },
    get autoSend() { return store.get('autoSend', true); },
  };

  function parseFolderId(input) {
    const s = String(input || '').trim();
    const m = s.match(/folders\/([\w-]{10,})/) || s.match(/[?&]id=([\w-]{10,})/);
    if (m) return m[1];
    return /^[\w-]{10,}$/.test(s) ? s : '';
  }

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

  /* ---------- Google auth ---------- */
  let tokenClient = null;
  let pendingAfterAuth = [];

  function token() {
    const t = store.get('token', null);
    return t && t.exp > Date.now() + 60000 ? t.value : '';
  }

  function initTokenClient() {
    if (tokenClient || !settings.clientId || !(window.google && google.accounts && google.accounts.oauth2)) return !!tokenClient;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: settings.clientId,
      scope: SCOPE,
      callback: resp => {
        if (resp.error) { showBanner('เข้าสู่ระบบไม่สำเร็จ: ' + resp.error); pendingAfterAuth = []; return; }
        store.set('token', { value: resp.access_token, exp: Date.now() + (Number(resp.expires_in) || 3600) * 1000 });
        updateAuthUi();
        const fns = pendingAfterAuth; pendingAfterAuth = [];
        fns.forEach(fn => fn());
      },
      error_callback: err => {
        pendingAfterAuth = [];
        showBanner(err && err.type === 'popup_closed' ? 'ปิดหน้าต่างเข้าสู่ระบบก่อนเสร็จ' :
          'เปิดหน้าต่างเข้าสู่ระบบไม่ได้ ถ้าใช้จากหน้าจอโฮม ลองเปิดแอปผ่าน Safari แทน');
      },
    });
    return true;
  }

  // Must be called from a tap so iOS allows the Google popup.
  function withToken(fn) {
    if (token()) { fn(); return; }
    if (!settings.clientId) { showBanner('ยังไม่ได้ใส่ Google Client ID ในตั้งค่า'); openSettings(); return; }
    if (!initTokenClient()) { showBanner('ระบบ Google ยังโหลดไม่เสร็จ ลองอีกครั้งในไม่กี่วินาที'); return; }
    pendingAfterAuth.push(fn);
    tokenClient.requestAccessToken({ prompt: store.get('signedInOnce', false) ? '' : 'consent' });
    store.set('signedInOnce', true);
  }

  function updateAuthUi() {
    const ok = !!token();
    els.authBtn.textContent = ok ? 'เชื่อมต่อแล้ว' : 'เข้าสู่ระบบ Google';
    els.authBtn.classList.toggle('ghost', ok);
    refreshBanner();
  }

  /* ---------- Google Drive ---------- */
  class AuthError extends Error {}

  async function drive(url, opts = {}) {
    const t = token();
    if (!t) throw new AuthError('ต้องเข้าสู่ระบบ Google');
    const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + t } });
    if (res.status === 401) { store.set('token', null); updateAuthUi(); throw new AuthError('หมดเวลาเข้าสู่ระบบ'); }
    if (!res.ok) {
      let msg = res.status + '';
      try { const j = await res.json(); msg = (j.error && j.error.message) || msg; } catch { /* not JSON */ }
      if (res.status === 404) msg = 'ไม่พบโฟลเดอร์ หรือบัญชีนี้ไม่มีสิทธิ์ใน Shared Drive นั้น';
      if (res.status === 403) msg = 'ไม่มีสิทธิ์เขียนในโฟลเดอร์นี้ (' + msg + ')';
      throw new Error(msg);
    }
    return res.json();
  }

  const qs = o => new URLSearchParams(o).toString();
  const ALL = { supportsAllDrives: 'true' };
  const LIST = { ...ALL, includeItemsFromAllDrives: 'true', corpora: 'allDrives' };
  const esc = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  function getFolder(id) {
    return drive(DRIVE + '/files/' + encodeURIComponent(id) + '?' + qs({ ...ALL, fields: 'id,name,mimeType,driveId,capabilities(canAddChildren)' }));
  }

  async function ensureSubfolder(parentId, name) {
    const cacheKey = 'folder.' + parentId + '.' + name;
    const cached = store.get(cacheKey, '');
    if (cached) return cached;
    const q = "name = '" + esc(name) + "' and '" + esc(parentId) + "' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
    const found = await drive(DRIVE + '/files?' + qs({ ...LIST, q, fields: 'files(id)', pageSize: '1' }));
    let id = found.files && found.files[0] && found.files[0].id;
    if (!id) {
      const made = await drive(DRIVE + '/files?' + qs({ ...ALL, fields: 'id' }), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, parents: [parentId], mimeType: 'application/vnd.google-apps.folder' }),
      });
      id = made.id;
    }
    store.set(cacheKey, id);
    return id;
  }

  async function findExisting(parentId, receiptId) {
    const q = "'" + esc(parentId) + "' in parents and appProperties has { key='receiptId' and value='" + esc(receiptId) + "' } and trashed = false";
    const r = await drive(DRIVE + '/files?' + qs({ ...LIST, q, fields: 'files(id,webViewLink)', pageSize: '1' }));
    return r.files && r.files[0];
  }

  async function uploadJpeg(blob, meta) {
    const boundary = 'rs' + uid();
    const body = new Blob([
      '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n',
      JSON.stringify(meta),
      '\r\n--' + boundary + '\r\nContent-Type: image/jpeg\r\n\r\n',
      blob,
      '\r\n--' + boundary + '--',
    ]);
    return drive(UPLOAD + '?' + qs({ ...ALL, uploadType: 'multipart', fields: 'id,webViewLink' }), {
      method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body,
    });
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

  function descriptionFor(item) {
    const f = item.fields;
    return [
      ['ร้าน/ผู้ขาย', f.vendor], ['วันที่', f.date], ['ยอดรวม', f.total], ['VAT', f.vat],
      ['เลขผู้เสียภาษี', f.taxId], ['เลขที่บิล', f.receiptNo], ['หมายเหตุ', f.note],
      ['ที่มา', item.mode === 'camera' ? 'ถ่ายจากกล้อง' : 'สแกนจากอัลบั้ม'],
    ].filter(([, v]) => v).map(([k, v]) => k + ': ' + v).join('\n');
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
    if (!settings.folderId) {
      markReady(item, 'ยังไม่ได้ตั้งค่าโฟลเดอร์ Shared Drive');
      if (interactive) openSettings();
      return;
    }
    if (!token()) {
      if (interactive) withToken(() => sendItem(id, { interactive: false }));
      else markReady(item);
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
      const parent = await ensureSubfolder(settings.folderId, month);
      const name = fileNameFor(item);
      let file = await findExisting(parent, item.id);
      if (!file) {
        const f = item.fields;
        file = await uploadJpeg(item.blob, {
          name, parents: [parent], mimeType: 'image/jpeg', description: descriptionFor(item),
          appProperties: {
            receiptId: item.id, total: f.total || '', date: f.date || '', taxId: f.taxId || '',
            mode: item.mode, pocoStatus: 'pending',
          },
        });
      }
      item.driveId = file.id;
      item.driveLink = file.webViewLink || 'https://drive.google.com/file/d/' + file.id + '/view';
      item.fileName = name;
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

  function sendAllPending() {
    withToken(() => {
      for (const it of items.values()) if (it.status === 'ready' || it.status === 'error') sendItem(it.id, { interactive: false });
    });
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
    ready: ['รอส่ง (ต้องเข้าสู่ระบบ Google)', 'warn'],
    uploading: ['กำลังส่งขึ้น Drive…', 'warn'],
    done: ['ส่งขึ้น Drive แล้ว ✓', 'ok'],
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
    send.textContent = item.status === 'error' ? 'ลองส่งอีกครั้ง' : 'ส่งขึ้น Drive';
    li.querySelector('[data-a="save"]').disabled = !item.blob;
    li.querySelector('[data-a="ocr"]').hidden = item.status === 'done';
    li.querySelector('[data-a="ocr"]').disabled = busy || !item.blob;
    const open = li.querySelector('[data-a="open"]');
    open.hidden = !item.driveLink;
    if (item.driveLink) open.href = item.driveLink;
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
  }

  /* ---------- banner ---------- */
  let bannerMsg = '';
  function showBanner(msg) { bannerMsg = msg; refreshBanner(); }
  function refreshBanner() {
    const waiting = [...items.values()].filter(i => i.status === 'ready').length;
    let msg = bannerMsg;
    if (!msg && (!settings.clientId || !settings.folderId)) msg = 'เริ่มต้น: กด ⚙︎ เพื่อใส่ Google Client ID และโฟลเดอร์ Shared Drive';
    else if (!msg && waiting && !token()) msg = 'มี ' + waiting + ' ใบรอส่ง — กด "เข้าสู่ระบบ Google" แล้วแอปจะส่งให้อัตโนมัติ';
    els.banner.textContent = msg;
    els.banner.hidden = !msg;
    updateListChrome();
  }

  /* ---------- settings dialog ---------- */
  function openSettings() {
    els.sClientId.value = settings.clientId;
    els.sFolder.value = settings.folderId;
    els.sAutoSend.checked = settings.autoSend;
    els.sStatus.textContent = '';
    if (els.settings.showModal) els.settings.showModal(); else els.settings.setAttribute('open', '');
  }

  function persistSettings() {
    const clientId = els.sClientId.value.trim();
    if (clientId !== settings.clientId) { tokenClient = null; store.set('token', null); }
    store.set('clientId', clientId);
    const fid = parseFolderId(els.sFolder.value);
    if (els.sFolder.value.trim() && !fid) { els.sStatus.textContent = 'อ่าน ID โฟลเดอร์จากลิงก์ไม่ได้'; return false; }
    store.set('folderId', fid);
    store.set('autoSend', els.sAutoSend.checked);
    return true;
  }

  els.settings.addEventListener('close', () => {
    if (els.settings.returnValue === 'save') persistSettings();
    bannerMsg = '';
    updateAuthUi();
  });
  els.sCheck.addEventListener('click', () => {
    if (!persistSettings()) return;
    if (!settings.folderId) { els.sStatus.textContent = 'ใส่ลิงก์โฟลเดอร์ก่อน'; return; }
    els.sStatus.textContent = 'กำลังตรวจ…';
    withToken(async () => {
      try {
        const f = await getFolder(settings.folderId);
        if (f.mimeType !== 'application/vnd.google-apps.folder') throw new Error('ลิงก์นี้ไม่ใช่โฟลเดอร์');
        const canWrite = !f.capabilities || f.capabilities.canAddChildren !== false;
        els.sStatus.textContent = (canWrite ? '✓ พบโฟลเดอร์ "' : '⚠ พบ "') + f.name + '"' +
          (f.driveId ? ' (Shared Drive)' : ' (My Drive)') + (canWrite ? '' : ' แต่ไม่มีสิทธิ์เพิ่มไฟล์');
      } catch (err) {
        els.sStatus.textContent = '✗ ' + (err.message || err);
      }
    });
  });

  /* ---------- wiring ---------- */
  els.settingsBtn.addEventListener('click', openSettings);
  els.authBtn.addEventListener('click', () => {
    bannerMsg = '';
    withToken(() => { updateAuthUi(); sendAllPending(); });
  });
  els.cameraBtn.addEventListener('click', () => els.cameraInput.click());
  els.albumBtn.addEventListener('click', () => els.albumInput.click());
  els.cameraInput.addEventListener('change', e => { addFiles(e.target.files, 'camera'); e.target.value = ''; });
  els.albumInput.addEventListener('change', e => { addFiles(e.target.files, 'album'); e.target.value = ''; });
  els.sendAllBtn.addEventListener('click', sendAllPending);
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
    // GIS loads async; set up the token client once it is there.
    const t = setInterval(() => { if (initTokenClient() || !settings.clientId) clearInterval(t); }, 500);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  boot();
})();
