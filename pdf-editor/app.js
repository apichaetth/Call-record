'use strict';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

class PDFEditor {
  constructor() {
    // PDF state
    this.pdfDoc       = null;
    this.pdfBytes     = null;   // original Uint8Array
    this.currentPage  = 1;
    this.totalPages   = 0;
    this.scale        = 1.5;

    // Tool state
    this.tool        = 'select';
    this.color       = '#e74c3c';
    this.strokeWidth = 3;
    this.opacity     = 1.0;
    this.fontSize    = 18;

    // Draw state
    this.isDrawing   = false;
    this.startX      = 0;
    this.startY      = 0;
    this.currentPath = [];
    this.snapshot    = null;   // ImageData for shape preview

    // Annotations keyed by page number: { 1: [...], 2: [...] }
    this.annotations = {};

    // History keyed by page number: { 1: { stack: [], index: -1 } }
    this.history = {};

    this.selectedIdx = null;   // index into annotations[currentPage]

    this.init();
  }

  /* ------------------------------------------------------------------ */
  /*  Initialization                                                      */
  /* ------------------------------------------------------------------ */

  init() {
    // Canvas refs
    this.pdfCanvas   = document.getElementById('pdfCanvas');
    this.annotCanvas = document.getElementById('annotationCanvas');
    this.pdfCtx      = this.pdfCanvas.getContext('2d');
    this.annotCtx    = this.annotCanvas.getContext('2d');

    this.bindToolbar();
    this.bindTools();
    this.bindCanvas();
    this.bindKeyboard();
    this.setupDrop();
  }

  /* ------------------------------------------------------------------ */
  /*  Event binding                                                       */
  /* ------------------------------------------------------------------ */

  bindToolbar() {
    // File
    document.getElementById('openBtn').addEventListener('click', () =>
      document.getElementById('fileInput').click());
    document.getElementById('fileInput').addEventListener('change', e => {
      const f = e.target.files[0];
      if (f) this.loadFile(f);
      e.target.value = '';
    });
    document.getElementById('saveBtn').addEventListener('click', () => this.savePDF());
    document.getElementById('exportImgBtn').addEventListener('click', () => this.exportImage());

    // Page
    document.getElementById('prevBtn').addEventListener('click', () => this.goTo(this.currentPage - 1));
    document.getElementById('nextBtn').addEventListener('click', () => this.goTo(this.currentPage + 1));
    document.getElementById('pageInput').addEventListener('change', e =>
      this.goTo(parseInt(e.target.value) || 1));

    // Zoom
    document.getElementById('zoomInBtn') .addEventListener('click', () => this.zoom(this.scale * 1.25));
    document.getElementById('zoomOutBtn').addEventListener('click', () => this.zoom(this.scale / 1.25));
    document.getElementById('fitBtn')    .addEventListener('click', () => this.fitPage());

    // History
    document.getElementById('undoBtn').addEventListener('click', () => this.undo());
    document.getElementById('redoBtn').addEventListener('click', () => this.redo());
  }

  bindTools() {
    // Tool buttons
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.tool = btn.dataset.tool;
        document.getElementById('canvasWrapper').dataset.tool = this.tool;
        this.toggleFontSizeOpts();
      });
    });

    // Color
    document.getElementById('colorPicker').addEventListener('input', e => {
      this.color = e.target.value;
    });

    // Stroke width
    document.getElementById('strokeWidth').addEventListener('input', e => {
      this.strokeWidth = parseInt(e.target.value);
      document.getElementById('strokeWidthVal').textContent = e.target.value;
    });

    // Opacity
    document.getElementById('opacitySlider').addEventListener('input', e => {
      this.opacity = parseInt(e.target.value) / 100;
      document.getElementById('opacityVal').textContent = e.target.value + '%';
    });

    // Font size
    document.getElementById('fontSizeSlider').addEventListener('input', e => {
      this.fontSize = parseInt(e.target.value);
      document.getElementById('fontSizeVal').textContent = e.target.value + 'px';
    });
  }

  toggleFontSizeOpts() {
    document.querySelectorAll('.font-size-opt').forEach(el => {
      el.classList.toggle('visible', this.tool === 'text');
    });
  }

  bindCanvas() {
    const c = this.annotCanvas;
    c.addEventListener('mousedown',  e => this.onDown(e));
    c.addEventListener('mousemove',  e => this.onMove(e));
    c.addEventListener('mouseup',    e => this.onUp(e));
    c.addEventListener('mouseleave', e => this.onUp(e));

    c.addEventListener('touchstart',  e => { e.preventDefault(); this.onDown(this.toMouse(e)); }, { passive: false });
    c.addEventListener('touchmove',   e => { e.preventDefault(); this.onMove(this.toMouse(e)); }, { passive: false });
    c.addEventListener('touchend',    e => { e.preventDefault(); this.onUp({}); });
  }

  bindKeyboard() {
    document.addEventListener('keydown', e => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z') { e.preventDefault(); this.undo(); }
        if (e.key === 'y') { e.preventDefault(); this.redo(); }
        if (e.key === 's') { e.preventDefault(); this.savePDF(); }
        if (e.key === 'o') { e.preventDefault(); document.getElementById('fileInput').click(); }
        return;
      }
      // Delete selected
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedIdx !== null) {
        const t = e.target.tagName.toLowerCase();
        if (t !== 'input' && t !== 'textarea') {
          e.preventDefault();
          this.deleteSelected();
        }
      }
      // Tool shortcuts
      const shortcuts = { v:'select', t:'text', p:'pen', h:'highlighter',
                          r:'rect',   c:'circle', l:'line', a:'arrow', e:'eraser' };
      const t = e.target.tagName.toLowerCase();
      if (t !== 'input' && t !== 'textarea' && !e.altKey && shortcuts[e.key]) {
        const toolName = shortcuts[e.key];
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        document.querySelector(`[data-tool="${toolName}"]`).classList.add('active');
        this.tool = toolName;
        document.getElementById('canvasWrapper').dataset.tool = this.tool;
        this.toggleFontSizeOpts();
      }
    });
  }

  setupDrop() {
    const area = document.getElementById('canvasArea');
    area.addEventListener('dragover', e => {
      e.preventDefault();
      document.getElementById('dropZone').classList.add('drag-over');
    });
    area.addEventListener('dragleave', () => {
      document.getElementById('dropZone').classList.remove('drag-over');
    });
    area.addEventListener('drop', e => {
      e.preventDefault();
      document.getElementById('dropZone').classList.remove('drag-over');
      const f = e.dataTransfer.files[0];
      if (f && f.type === 'application/pdf') this.loadFile(f);
    });
  }

  /* ------------------------------------------------------------------ */
  /*  PDF Loading                                                         */
  /* ------------------------------------------------------------------ */

  async loadFile(file) {
    this.showLoading(true);
    try {
      const buf = await file.arrayBuffer();
      this.pdfBytes = new Uint8Array(buf);

      const task = pdfjsLib.getDocument({ data: this.pdfBytes.slice() });
      this.pdfDoc    = await task.promise;
      this.totalPages = this.pdfDoc.numPages;
      this.currentPage = 1;
      this.annotations = {};
      this.history     = {};
      this.selectedIdx = null;

      document.getElementById('totalPages').textContent = this.totalPages;
      document.getElementById('pageInput').max = this.totalPages;
      document.getElementById('pageInput').disabled = false;
      this.enableButtons(true);

      document.getElementById('dropZone').style.display = 'none';
      document.getElementById('canvasWrapper').style.display = 'block';
      document.getElementById('canvasWrapper').dataset.tool = this.tool;

      await this.renderPage(1);
      this.generateThumbnails();
      setTimeout(() => this.fitPage(), 100);
    } catch (err) {
      this.toast('Failed to load PDF: ' + err.message, 'error');
    }
    this.showLoading(false);
  }

  /* ------------------------------------------------------------------ */
  /*  Rendering                                                           */
  /* ------------------------------------------------------------------ */

  async renderPage(num) {
    if (!this.pdfDoc) return;
    this.currentPage = Math.max(1, Math.min(this.totalPages, num));
    document.getElementById('pageInput').value = this.currentPage;
    document.getElementById('prevBtn').disabled = this.currentPage <= 1;
    document.getElementById('nextBtn').disabled = this.currentPage >= this.totalPages;

    const page     = await this.pdfDoc.getPage(this.currentPage);
    const viewport = page.getViewport({ scale: this.scale });

    this.pdfCanvas.width   = viewport.width;
    this.pdfCanvas.height  = viewport.height;
    this.annotCanvas.width  = viewport.width;
    this.annotCanvas.height = viewport.height;

    // Keep wrapper sized
    const wrapper = document.getElementById('canvasWrapper');
    wrapper.style.width  = viewport.width  + 'px';
    wrapper.style.height = viewport.height + 'px';

    await page.render({ canvasContext: this.pdfCtx, viewport }).promise;
    this.redrawAnnotations();
    this.updateActiveThumbnail();
    this.refreshHistoryButtons();
  }

  redrawAnnotations() {
    const ctx    = this.annotCtx;
    const annots = this.annotations[this.currentPage] || [];
    ctx.clearRect(0, 0, this.annotCanvas.width, this.annotCanvas.height);
    annots.forEach((a, i) => this.drawAnnot(ctx, a, i === this.selectedIdx));
  }

  drawAnnot(ctx, a, selected) {
    ctx.save();
    ctx.globalAlpha  = a.opacity ?? 1;
    ctx.strokeStyle  = a.color;
    ctx.fillStyle    = a.color;
    ctx.lineWidth    = a.width ?? 2;
    ctx.lineCap      = 'round';
    ctx.lineJoin     = 'round';

    switch (a.type) {
      case 'pen':
        this.pathStroke(ctx, a.points);
        break;

      case 'highlighter':
        ctx.globalAlpha = Math.min(a.opacity ?? 1, 0.35);
        ctx.lineWidth   = (a.width ?? 3) * 4;
        this.pathStroke(ctx, a.points);
        break;

      case 'text':
        ctx.globalAlpha = a.opacity ?? 1;
        ctx.font        = `${a.fontSize ?? 18}px Arial, sans-serif`;
        ctx.fillStyle   = a.color;
        // Multi-line support
        (a.text || '').split('\n').forEach((line, i) =>
          ctx.fillText(line, a.x, a.y + i * (a.fontSize ?? 18) * 1.3));
        break;

      case 'rect': {
        ctx.strokeRect(a.x, a.y, a.w, a.h);
        break;
      }

      case 'circle': {
        const cx = a.x + a.rx, cy = a.y + a.ry;
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.abs(a.rx), Math.abs(a.ry), 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }

      case 'line':
        ctx.beginPath();
        ctx.moveTo(a.x1, a.y1);
        ctx.lineTo(a.x2, a.y2);
        ctx.stroke();
        break;

      case 'arrow':
        this.drawArrow(ctx, a.x1, a.y1, a.x2, a.y2);
        break;
    }

    if (selected) {
      const b = this.bounds(a);
      if (b) {
        ctx.save();
        ctx.globalAlpha  = 0.8;
        ctx.strokeStyle  = '#4f8ef7';
        ctx.lineWidth    = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(b.x - 6, b.y - 6, b.w + 12, b.h + 12);
        ctx.restore();
      }
    }

    ctx.restore();
  }

  pathStroke(ctx, pts) {
    if (!pts || pts.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  drawArrow(ctx, x1, y1, x2, y2) {
    const headLen = Math.max(12, (ctx.lineWidth) * 5);
    const angle   = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6),
               y2 - headLen * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6),
               y2 - headLen * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
  }

  /* ------------------------------------------------------------------ */
  /*  Mouse / Touch handlers                                              */
  /* ------------------------------------------------------------------ */

  toMouse(e) {
    const t = e.touches[0] || e.changedTouches[0];
    return { clientX: t.clientX, clientY: t.clientY };
  }

  pos(e) {
    const rect = this.annotCanvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (this.annotCanvas.width  / rect.width),
      y: (e.clientY - rect.top)  * (this.annotCanvas.height / rect.height)
    };
  }

  onDown(e) {
    if (!this.pdfDoc) return;
    const { x, y } = this.pos(e);
    this.startX = x; this.startY = y;
    this.isDrawing = true;

    if (this.tool === 'text') {
      this.isDrawing = false;
      this.placeText(x, y);
      return;
    }
    if (this.tool === 'select') {
      this.isDrawing = false;
      this.selectAt(x, y);
      return;
    }
    if (this.tool === 'eraser') {
      this.isDrawing = false;
      this.eraseAt(x, y);
      return;
    }

    this.snapshot = this.annotCtx.getImageData(
      0, 0, this.annotCanvas.width, this.annotCanvas.height);

    if (this.tool === 'pen' || this.tool === 'highlighter') {
      this.currentPath = [{ x, y }];
    }
  }

  onMove(e) {
    if (!this.isDrawing || !this.pdfDoc) return;
    const { x, y } = this.pos(e);

    if (this.tool === 'pen' || this.tool === 'highlighter') {
      this.currentPath.push({ x, y });
      this.annotCtx.putImageData(this.snapshot, 0, 0);
      this.drawAnnot(this.annotCtx, this.buildAnnot(this.tool, x, y), false);
      return;
    }

    // Shape preview
    if (this.snapshot) this.annotCtx.putImageData(this.snapshot, 0, 0);
    const preview = this.buildAnnot(this.tool, x, y);
    if (preview) this.drawAnnot(this.annotCtx, preview, false);
  }

  onUp(e) {
    if (!this.isDrawing || !this.pdfDoc) return;
    this.isDrawing = false;

    let endX = this.startX, endY = this.startY;
    if (e.clientX !== undefined) { const p = this.pos(e); endX = p.x; endY = p.y; }

    let annot = null;
    if (this.tool === 'pen' || this.tool === 'highlighter') {
      if (this.currentPath.length > 1) annot = this.buildAnnot(this.tool, endX, endY);
      this.currentPath = [];
    } else if (!['select','eraser','text'].includes(this.tool)) {
      annot = this.buildAnnot(this.tool, endX, endY);
    }

    if (annot) this.pushAnnot(annot);
    this.snapshot = null;
    this.redrawAnnotations();
  }

  buildAnnot(tool, x2, y2) {
    const base = { color: this.color, width: this.strokeWidth, opacity: this.opacity };
    switch (tool) {
      case 'pen':
      case 'highlighter':
        return { ...base, type: tool, points: [...this.currentPath] };
      case 'rect':
        return { ...base, type: 'rect',   x: this.startX, y: this.startY,
                 w: x2 - this.startX, h: y2 - this.startY };
      case 'circle':
        return { ...base, type: 'circle', x: this.startX, y: this.startY,
                 rx: (x2 - this.startX) / 2, ry: (y2 - this.startY) / 2 };
      case 'line':
        return { ...base, type: 'line',   x1: this.startX, y1: this.startY, x2, y2 };
      case 'arrow':
        return { ...base, type: 'arrow',  x1: this.startX, y1: this.startY, x2, y2 };
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /*  Text tool                                                           */
  /* ------------------------------------------------------------------ */

  placeText(cx, cy) {
    const inp  = document.getElementById('textInput');
    const rect = this.annotCanvas.getBoundingClientRect();
    const sx   = rect.width  / this.annotCanvas.width;
    const sy   = rect.height / this.annotCanvas.height;

    inp.style.display  = 'block';
    inp.style.left     = (rect.left + cx * sx) + 'px';
    inp.style.top      = (rect.top  + cy * sy - this.fontSize * sy) + 'px';
    inp.style.fontSize = (this.fontSize * sy) + 'px';
    inp.style.color    = this.color;
    inp.style.opacity  = this.opacity;
    inp.value = '';
    inp.focus();

    const finish = () => {
      const text = inp.value;
      if (text.trim()) {
        this.pushAnnot({
          type: 'text', x: cx, y: cy,
          text, color: this.color,
          fontSize: this.fontSize,
          opacity: this.opacity
        });
        this.redrawAnnotations();
      }
      inp.style.display = 'none';
      inp.removeEventListener('blur',    finish);
      inp.removeEventListener('keydown', onKey);
    };

    const onKey = e => {
      if (e.key === 'Escape') { inp.value = ''; finish(); }
    };

    inp.addEventListener('blur',    finish);
    inp.addEventListener('keydown', onKey);
  }

  /* ------------------------------------------------------------------ */
  /*  Select / Erase                                                      */
  /* ------------------------------------------------------------------ */

  selectAt(x, y) {
    const annots = this.annotations[this.currentPage] || [];
    this.selectedIdx = null;
    for (let i = annots.length - 1; i >= 0; i--) {
      if (this.hitTest(annots[i], x, y)) { this.selectedIdx = i; break; }
    }
    this.redrawAnnotations();
    this.renderProps();
  }

  eraseAt(x, y) {
    const annots = this.annotations[this.currentPage] || [];
    const before = annots.length;
    this.annotations[this.currentPage] = annots.filter(a => !this.hitTest(a, x, y));
    if (this.annotations[this.currentPage].length !== before) {
      if (this.selectedIdx !== null &&
          this.selectedIdx >= this.annotations[this.currentPage].length)
        this.selectedIdx = null;
      this.saveHistory();
      this.redrawAnnotations();
      this.renderProps();
    }
  }

  deleteSelected() {
    if (this.selectedIdx === null) return;
    const annots = this.annotations[this.currentPage] || [];
    annots.splice(this.selectedIdx, 1);
    this.annotations[this.currentPage] = annots;
    this.selectedIdx = null;
    this.saveHistory();
    this.redrawAnnotations();
    this.renderProps();
  }

  hitTest(a, x, y) {
    const b = this.bounds(a);
    if (!b) return false;
    const pad = 10;
    return x >= b.x - pad && x <= b.x + b.w + pad &&
           y >= b.y - pad && y <= b.y + b.h + pad;
  }

  bounds(a) {
    switch (a.type) {
      case 'pen':
      case 'highlighter': {
        if (!a.points || !a.points.length) return null;
        const xs = a.points.map(p => p.x), ys = a.points.map(p => p.y);
        const x = Math.min(...xs), y = Math.min(...ys);
        return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
      }
      case 'text':
        return { x: a.x, y: a.y - (a.fontSize ?? 18), w: 120, h: a.fontSize ?? 18 };
      case 'rect':
        return { x: Math.min(a.x, a.x + a.w), y: Math.min(a.y, a.y + a.h),
                 w: Math.abs(a.w), h: Math.abs(a.h) };
      case 'circle':
        return { x: a.x, y: a.y, w: Math.abs(a.rx) * 2, h: Math.abs(a.ry) * 2 };
      case 'line':
      case 'arrow': {
        const x = Math.min(a.x1, a.x2), y = Math.min(a.y1, a.y2);
        return { x, y, w: Math.abs(a.x2 - a.x1), h: Math.abs(a.y2 - a.y1) };
      }
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /*  Annotations store / history                                         */
  /* ------------------------------------------------------------------ */

  pushAnnot(a) {
    if (!this.annotations[this.currentPage])
      this.annotations[this.currentPage] = [];
    this.annotations[this.currentPage].push(a);
    this.saveHistory();
  }

  saveHistory() {
    const n = this.currentPage;
    if (!this.history[n]) this.history[n] = { stack: [], index: -1 };
    const h = this.history[n];
    h.stack = h.stack.slice(0, h.index + 1);
    h.stack.push(JSON.stringify(this.annotations[n] || []));
    h.index = h.stack.length - 1;
    this.refreshHistoryButtons();
  }

  undo() {
    const n = this.currentPage;
    const h = this.history[n];
    if (!h || h.index <= 0) return;
    h.index--;
    this.annotations[n] = JSON.parse(h.stack[h.index]);
    if (this.selectedIdx !== null &&
        this.selectedIdx >= (this.annotations[n] || []).length)
      this.selectedIdx = null;
    this.redrawAnnotations();
    this.renderProps();
    this.refreshHistoryButtons();
  }

  redo() {
    const n = this.currentPage;
    const h = this.history[n];
    if (!h || h.index >= h.stack.length - 1) return;
    h.index++;
    this.annotations[n] = JSON.parse(h.stack[h.index]);
    this.redrawAnnotations();
    this.refreshHistoryButtons();
  }

  refreshHistoryButtons() {
    const n = this.currentPage;
    const h = this.history[n];
    document.getElementById('undoBtn').disabled = !h || h.index <= 0;
    document.getElementById('redoBtn').disabled = !h || h.index >= h.stack.length - 1;
  }

  /* ------------------------------------------------------------------ */
  /*  Properties panel                                                    */
  /* ------------------------------------------------------------------ */

  renderProps() {
    const body = document.getElementById('propsBody');
    if (this.selectedIdx === null) {
      body.innerHTML = '<p class="props-empty">No annotation selected</p>';
      return;
    }
    const a = (this.annotations[this.currentPage] || [])[this.selectedIdx];
    if (!a) { body.innerHTML = '<p class="props-empty">No annotation selected</p>'; return; }

    body.innerHTML = `
      <div class="prop-row">
        <label>Type</label>
        <span class="prop-type-badge">${a.type}</span>
      </div>
      <div class="prop-row">
        <label>Color</label>
        <input type="color" value="${a.color}" id="propColor">
      </div>
      ${a.type !== 'text' ? `
      <div class="prop-row">
        <label>Stroke Width (<span id="propWidthVal">${a.width ?? 2}</span>)</label>
        <input type="range" min="1" max="30" value="${a.width ?? 2}" id="propWidth">
      </div>` : `
      <div class="prop-row">
        <label>Font Size (<span id="propFontVal">${a.fontSize ?? 18}</span>px)</label>
        <input type="range" min="8" max="72" value="${a.fontSize ?? 18}" id="propFont">
      </div>`}
      <div class="prop-row">
        <label>Opacity (<span id="propOpacityVal">${Math.round((a.opacity ?? 1) * 100)}</span>%)</label>
        <input type="range" min="5" max="100" value="${Math.round((a.opacity ?? 1) * 100)}" id="propOpacity">
      </div>
      <button class="prop-delete-btn" id="propDeleteBtn">🗑 Delete annotation</button>
    `;

    document.getElementById('propColor').addEventListener('input', e => {
      this.updateSelected('color', e.target.value);
    });

    const pw = document.getElementById('propWidth');
    if (pw) pw.addEventListener('input', e => {
      document.getElementById('propWidthVal').textContent = e.target.value;
      this.updateSelected('width', parseInt(e.target.value));
    });

    const pf = document.getElementById('propFont');
    if (pf) pf.addEventListener('input', e => {
      document.getElementById('propFontVal').textContent = e.target.value;
      this.updateSelected('fontSize', parseInt(e.target.value));
    });

    document.getElementById('propOpacity').addEventListener('input', e => {
      document.getElementById('propOpacityVal').textContent = e.target.value;
      this.updateSelected('opacity', parseInt(e.target.value) / 100);
    });

    document.getElementById('propDeleteBtn').addEventListener('click', () => this.deleteSelected());
  }

  updateSelected(prop, value) {
    if (this.selectedIdx === null) return;
    const annots = this.annotations[this.currentPage];
    if (!annots || !annots[this.selectedIdx]) return;
    annots[this.selectedIdx][prop] = value;
    this.redrawAnnotations();
  }

  /* ------------------------------------------------------------------ */
  /*  Navigation & Zoom                                                   */
  /* ------------------------------------------------------------------ */

  async goTo(n) {
    n = Math.max(1, Math.min(this.totalPages, n || 1));
    if (n === this.currentPage) return;
    this.selectedIdx = null;
    await this.renderPage(n);
    this.renderProps();
  }

  zoom(s) {
    this.scale = Math.max(0.25, Math.min(5, s));
    document.getElementById('zoomLabel').textContent = Math.round(this.scale * 100) + '%';
    this.renderPage(this.currentPage);
  }

  fitPage() {
    if (!this.pdfDoc) return;
    const area = document.getElementById('canvasArea');
    const w = area.clientWidth  - 48;
    const h = area.clientHeight - 48;
    this.pdfDoc.getPage(this.currentPage).then(page => {
      const vp = page.getViewport({ scale: 1 });
      this.zoom(Math.min(w / vp.width, h / vp.height));
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Thumbnails                                                          */
  /* ------------------------------------------------------------------ */

  async generateThumbnails() {
    const container = document.getElementById('thumbContainer');
    container.innerHTML = '';

    for (let i = 1; i <= this.totalPages; i++) {
      const wrap  = document.createElement('div');
      wrap.className = 'thumb-item';
      wrap.dataset.page = i;
      wrap.title = `Page ${i}`;
      const cv    = document.createElement('canvas');
      const label = document.createElement('span');
      label.className = 'thumb-num';
      label.textContent = i;
      wrap.appendChild(cv);
      wrap.appendChild(label);
      container.appendChild(wrap);
      wrap.addEventListener('click', () => this.goTo(i));

      try {
        const page = await this.pdfDoc.getPage(i);
        const vp   = page.getViewport({ scale: 0.18 });
        cv.width   = vp.width;
        cv.height  = vp.height;
        await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      } catch (_) {}
    }
    this.updateActiveThumbnail();
  }

  updateActiveThumbnail() {
    document.querySelectorAll('.thumb-item').forEach(el => {
      el.classList.toggle('active', parseInt(el.dataset.page) === this.currentPage);
    });
    const active = document.querySelector('.thumb-item.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  /* ------------------------------------------------------------------ */
  /*  Save PDF                                                            */
  /* ------------------------------------------------------------------ */

  async savePDF() {
    if (!this.pdfDoc || !this.pdfBytes) return;
    const btn = document.getElementById('saveBtn');
    btn.disabled = true;
    btn.innerHTML = '<span>Saving…</span>';
    this.showLoading(true);

    try {
      const { PDFDocument } = PDFLib;
      const pdfLibDoc = await PDFDocument.load(this.pdfBytes);
      const libPages  = pdfLibDoc.getPages();

      for (let n = 1; n <= this.totalPages; n++) {
        const annots = this.annotations[n];
        if (!annots || !annots.length) continue;

        // Render annotations at 2× for quality
        const saveScale = 2;
        const page      = await this.pdfDoc.getPage(n);
        const vp        = page.getViewport({ scale: saveScale });

        const offCanvas = document.createElement('canvas');
        offCanvas.width  = vp.width;
        offCanvas.height = vp.height;
        const ctx = offCanvas.getContext('2d');

        const ratio = saveScale / this.scale;
        annots.forEach(a => this.drawAnnot(ctx, this.scaleAnnot(a, ratio), false));

        const dataUrl = offCanvas.toDataURL('image/png');
        const resp    = await fetch(dataUrl);
        const imgBuf  = await resp.arrayBuffer();
        const pngImg  = await pdfLibDoc.embedPng(imgBuf);

        const { width, height } = libPages[n - 1].getSize();
        libPages[n - 1].drawImage(pngImg, { x: 0, y: 0, width, height });
      }

      const saved = await pdfLibDoc.save();
      this.downloadBytes(saved, 'edited.pdf', 'application/pdf');
      this.toast('PDF saved!', 'success');
    } catch (err) {
      this.toast('Save failed: ' + err.message, 'error');
    }

    btn.disabled = false;
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
      <polyline points="17 21 17 13 7 13 7 21"/>
      <polyline points="7 3 7 8 15 8"/>
    </svg> Save PDF`;
    this.showLoading(false);
  }

  scaleAnnot(a, r) {
    const s = { ...a };
    if (a.points)     s.points    = a.points.map(p => ({ x: p.x * r, y: p.y * r }));
    if (a.x  != null) s.x  = a.x  * r;
    if (a.y  != null) s.y  = a.y  * r;
    if (a.w  != null) s.w  = a.w  * r;
    if (a.h  != null) s.h  = a.h  * r;
    if (a.rx != null) s.rx = a.rx * r;
    if (a.ry != null) s.ry = a.ry * r;
    if (a.x1 != null) { s.x1 = a.x1 * r; s.y1 = a.y1 * r; }
    if (a.x2 != null) { s.x2 = a.x2 * r; s.y2 = a.y2 * r; }
    if (a.fontSize != null) s.fontSize = a.fontSize * r;
    if (a.width    != null) s.width    = a.width    * r;
    return s;
  }

  /* ------------------------------------------------------------------ */
  /*  Export Image                                                        */
  /* ------------------------------------------------------------------ */

  exportImage() {
    const composite = document.createElement('canvas');
    composite.width  = this.pdfCanvas.width;
    composite.height = this.pdfCanvas.height;
    const ctx = composite.getContext('2d');
    ctx.drawImage(this.pdfCanvas,   0, 0);
    ctx.drawImage(this.annotCanvas, 0, 0);
    composite.toBlob(blob => {
      this.downloadBytes(blob, `page-${this.currentPage}.png`, 'image/png');
      this.toast(`Page ${this.currentPage} exported!`, 'success');
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Helpers                                                             */
  /* ------------------------------------------------------------------ */

  downloadBytes(data, name, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  enableButtons(on) {
    ['saveBtn', 'exportImgBtn', 'prevBtn', 'nextBtn',
     'zoomInBtn', 'zoomOutBtn', 'fitBtn'].forEach(id => {
      document.getElementById(id).disabled = !on;
    });
  }

  showLoading(show) {
    document.getElementById('loadingOverlay').style.display = show ? 'flex' : 'none';
  }

  toast(msg, type = '') {
    let el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className   = `toast ${type}`;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), 3000);
  }
}

document.addEventListener('DOMContentLoaded', () => { window.editor = new PDFEditor(); });
