/* ============================================================
   PDF Editor Pro — app.js
   Complete standalone implementation using PDF.js + pdf-lib
   ============================================================ */

(function () {
  'use strict';

  window.addEventListener('DOMContentLoaded', () => {
    setTimeout(init, 100);
  });

  function init() {
    const editor = new PDFEditor();
    editor.mount();
  }

  class PDFEditor {
    constructor() {
      this.pdfDoc       = null;
      this.pdfBytes     = null;
      this.currentPage  = 1;
      this.totalPages   = 0;
      this.currentScale = 1.0;
      this.fitScale     = 1.0;

      this.annotations  = {};
      this.history      = {};
      this.historyIndex = {};

      this.currentTool  = 'select';
      this.isDrawing    = false;
      this.startX       = 0;
      this.startY       = 0;
      this.snapshotData = null;
      this.currentPen   = null;

      this.selectedAnnot = null;

      this.color       = '#e74c3c';
      this.strokeWidth = 3;
      this.opacity     = 1.0;
      this.fontSize    = 18;

      this.thumbQueue  = [];
      this.thumbBusy   = false;

      this.pendingSignatureDataUrl = null;
      this.pendingStampDataUrl     = null;
      this.pendingStampOpacity     = 0.8;
      this.imageCache              = {};
      this.scannerFiles            = [];
    }

    mount() {
      this.pdfCanvas     = document.getElementById('pdfCanvas');
      this.annotCanvas   = document.getElementById('annotationCanvas');
      this.pdfCtx        = this.pdfCanvas.getContext('2d');
      this.annotCtx      = this.annotCanvas.getContext('2d');
      this.canvasWrapper = document.getElementById('canvasWrapper');
      this.canvasArea    = document.getElementById('canvasArea');

      this.textInput     = document.getElementById('textInput');

      this.openBtn       = document.getElementById('openBtn');
      this.fileInput     = document.getElementById('fileInput');
      this.saveBtn       = document.getElementById('saveBtn');
      this.exportImgBtn  = document.getElementById('exportImgBtn');
      this.prevBtn       = document.getElementById('prevBtn');
      this.nextBtn       = document.getElementById('nextBtn');
      this.pageInput     = document.getElementById('pageInput');
      this.totalPagesEl  = document.getElementById('totalPages');
      this.zoomInBtn     = document.getElementById('zoomInBtn');
      this.zoomOutBtn    = document.getElementById('zoomOutBtn');
      this.fitBtn        = document.getElementById('fitBtn');
      this.zoomLabel     = document.getElementById('zoomLabel');
      this.undoBtn       = document.getElementById('undoBtn');
      this.redoBtn       = document.getElementById('redoBtn');

      this.toolButtons       = document.querySelectorAll('.tool-btn');
      this.colorPicker       = document.getElementById('colorPicker');
      this.strokeWidthSlider = document.getElementById('strokeWidth');
      this.strokeWidthVal    = document.getElementById('strokeWidthVal');
      this.opacitySlider     = document.getElementById('opacitySlider');
      this.opacityVal        = document.getElementById('opacityVal');
      this.fontSizeSlider    = document.getElementById('fontSizeSlider');
      this.fontSizeVal       = document.getElementById('fontSizeVal');
      this.fontSizeOpts      = document.querySelectorAll('.font-size-opt');

      this.thumbContainer  = document.getElementById('thumbContainer');
      this.dropZone        = document.getElementById('dropZone');
      this.propsBody       = document.getElementById('propsBody');
      this.loadingOverlay  = document.getElementById('loadingOverlay');

      this.toastEl = this._createToast();
      this._bindEvents();
      this._bindPageOps();
      this._bindSignatureModal();
      this._bindStampModal();
      this._bindExtractModal();
      this._bindScannerModal();
      this._updateToolCursor();
    }

    _bindEvents() {
      this.openBtn.addEventListener('click', () => this.fileInput.click());
      this.fileInput.addEventListener('change', e => {
        if (e.target.files[0]) this._loadFile(e.target.files[0]);
        e.target.value = '';
      });

      this.saveBtn.addEventListener('click', () => this._savePDF());
      this.exportImgBtn.addEventListener('click', () => this._exportImage());

      this.prevBtn.addEventListener('click', () => this._gotoPage(this.currentPage - 1));
      this.nextBtn.addEventListener('click', () => this._gotoPage(this.currentPage + 1));
      this.pageInput.addEventListener('change', () => {
        const n = parseInt(this.pageInput.value, 10);
        if (!isNaN(n)) this._gotoPage(n);
      });
      this.pageInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') this.pageInput.blur();
      });

      this.zoomInBtn.addEventListener('click',  () => this._zoom(1.25));
      this.zoomOutBtn.addEventListener('click', () => this._zoom(0.8));
      this.fitBtn.addEventListener('click',     () => this._zoomFit());

      this.undoBtn.addEventListener('click', () => this._undo());
      this.redoBtn.addEventListener('click', () => this._redo());

      this.toolButtons.forEach(btn => {
        btn.addEventListener('click', () => this._setTool(btn.dataset.tool));
      });

      this.colorPicker.addEventListener('input', e => {
        this.color = e.target.value;
        if (this.selectedAnnot) {
          this.selectedAnnot.color = this.color;
          this._redrawAnnotations();
        }
      });
      this.strokeWidthSlider.addEventListener('input', e => {
        this.strokeWidth = parseInt(e.target.value, 10);
        this.strokeWidthVal.textContent = this.strokeWidth;
        if (this.selectedAnnot && this.selectedAnnot.width !== undefined) {
          this.selectedAnnot.width = this.strokeWidth;
          this._redrawAnnotations();
        }
      });
      this.opacitySlider.addEventListener('input', e => {
        this.opacity = parseInt(e.target.value, 10) / 100;
        this.opacityVal.textContent = e.target.value + '%';
        if (this.selectedAnnot) {
          this.selectedAnnot.opacity = this.opacity;
          this._redrawAnnotations();
        }
      });
      this.fontSizeSlider.addEventListener('input', e => {
        this.fontSize = parseInt(e.target.value, 10);
        this.fontSizeVal.textContent = this.fontSize + 'px';
        if (this.selectedAnnot && this.selectedAnnot.type === 'text') {
          this.selectedAnnot.fontSize = this.fontSize;
          this._redrawAnnotations();
        }
      });

      this.canvasArea.addEventListener('dragover', e => {
        e.preventDefault();
        this.dropZone.classList.add('drag-over');
      });
      this.canvasArea.addEventListener('dragleave', () => {
        this.dropZone.classList.remove('drag-over');
      });
      this.canvasArea.addEventListener('drop', e => {
        e.preventDefault();
        this.dropZone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file && file.type === 'application/pdf') this._loadFile(file);
        else this._toast('Please drop a PDF file', 'error');
      });

      this.annotCanvas.addEventListener('mousedown',  e => this._onMouseDown(e));
      this.annotCanvas.addEventListener('mousemove',  e => this._onMouseMove(e));
      this.annotCanvas.addEventListener('mouseup',    e => this._onMouseUp(e));
      this.annotCanvas.addEventListener('mouseleave', e => { if (this.isDrawing) this._onMouseUp(e); });

      this.annotCanvas.addEventListener('touchstart',  e => this._touchToMouse(e, 'mousedown'),  { passive: false });
      this.annotCanvas.addEventListener('touchmove',   e => this._touchToMouse(e, 'mousemove'),  { passive: false });
      this.annotCanvas.addEventListener('touchend',    e => this._touchToMouse(e, 'mouseup'),    { passive: false });

      this.textInput.addEventListener('blur',    () => this._confirmText());
      this.textInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.textInput.blur(); }
        e.stopPropagation();
      });

      document.addEventListener('keydown', e => this._onKeyDown(e));

      window.addEventListener('resize', () => {
        if (this.pdfDoc) this._zoomFit();
      });
    }

    _touchToMouse(e, type) {
      e.preventDefault();
      const touch = e.touches[0] || e.changedTouches[0];
      const me = new MouseEvent(type, {
        clientX: touch.clientX,
        clientY: touch.clientY,
        bubbles: true
      });
      this.annotCanvas.dispatchEvent(me);
    }

    _onKeyDown(e) {
      if (e.target === this.textInput) return;

      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === 'z') { e.preventDefault(); this._undo(); return; }
      if (ctrl && e.key === 'y') { e.preventDefault(); this._redo(); return; }
      if (ctrl && e.key === 's') { e.preventDefault(); this._savePDF(); return; }

      if (!this.pdfDoc) return;

      const map = { v:'select', t:'text', p:'pen', h:'highlighter',
                    r:'rect', c:'circle', l:'line', a:'arrow', e:'eraser',
                    i:'signature', m:'stamp' };
      if (!ctrl && map[e.key.toLowerCase()]) {
        this._setTool(map[e.key.toLowerCase()]);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedAnnot) {
        this._deleteSelected();
        return;
      }
    }

    async _loadFile(file) {
      this._showLoading(true);
      try {
        const buffer = await file.arrayBuffer();
        this.pdfBytes = buffer.slice(0);

        if (typeof pdfjsLib === 'undefined') {
          throw new Error('PDF.js library not loaded. Check CDN connectivity.');
        }
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

        const loadingTask = pdfjsLib.getDocument({ data: buffer.slice(0) });
        this.pdfDoc = await loadingTask.promise;
        this.totalPages = this.pdfDoc.numPages;

        this.annotations  = {};
        this.history      = {};
        this.historyIndex = {};
        this.selectedAnnot = null;
        this.currentPage   = 1;

        for (let i = 1; i <= this.totalPages; i++) {
          this.annotations[i]  = [];
          this.history[i]      = [ JSON.stringify([]) ];
          this.historyIndex[i] = 0;
        }

        this.totalPagesEl.textContent = this.totalPages;
        this.pageInput.max = this.totalPages;
        this._enableControls(true);
        this.dropZone.style.display    = 'none';
        this.canvasWrapper.style.display = 'block';

        await this._buildThumbnails();
        await this._zoomFit();
        this._toast('PDF loaded — ' + this.totalPages + ' page(s)', 'success');
      } catch (err) {
        console.error(err);
        this._toast('Failed to load PDF: ' + err.message, 'error');
      } finally {
        this._showLoading(false);
      }
    }

    async _renderPage(pageNum, scale) {
      if (!this.pdfDoc) return;
      const page     = await this.pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale });

      this.pdfCanvas.width     = viewport.width;
      this.pdfCanvas.height    = viewport.height;
      this.annotCanvas.width   = viewport.width;
      this.annotCanvas.height  = viewport.height;
      this.canvasWrapper.style.width  = viewport.width  + 'px';
      this.canvasWrapper.style.height = viewport.height + 'px';

      await page.render({ canvasContext: this.pdfCtx, viewport }).promise;
      this._redrawAnnotations();
      this._updatePageInput();
      this._highlightThumb(pageNum);
    }

    async _gotoPage(n) {
      if (!this.pdfDoc) return;
      n = Math.max(1, Math.min(this.totalPages, n));
      if (n === this.currentPage) return;
      this.currentPage = n;
      this.selectedAnnot = null;
      this._updatePropsPanel();
      await this._renderPage(this.currentPage, this.currentScale);
    }

    _updatePageInput() {
      this.pageInput.value      = this.currentPage;
      this.prevBtn.disabled     = this.currentPage <= 1;
      this.nextBtn.disabled     = this.currentPage >= this.totalPages;
    }

    async _zoom(factor) {
      if (!this.pdfDoc) return;
      const newScale = Math.min(5, Math.max(0.25, this.currentScale * factor));
      if (Math.abs(newScale - this.currentScale) < 0.001) return;

      const ratio = newScale / this.currentScale;
      const pg    = this.currentPage;
      this.annotations[pg] = this.annotations[pg].map(a => this._scaleAnnotation(a, ratio));
      this.history[pg]      = [ JSON.stringify(this.annotations[pg]) ];
      this.historyIndex[pg] = 0;

      this.currentScale = newScale;
      this.zoomLabel.textContent = Math.round(newScale * 100) + '%';
      await this._renderPage(this.currentPage, this.currentScale);
    }

    async _zoomFit() {
      if (!this.pdfDoc) return;
      const page     = await this.pdfDoc.getPage(this.currentPage);
      const vp       = page.getViewport({ scale: 1 });
      const areaW    = this.canvasArea.clientWidth  - 48;
      const areaH    = this.canvasArea.clientHeight - 48;
      const fitScale = Math.min(areaW / vp.width, areaH / vp.height, 3);

      if (Math.abs(fitScale - this.currentScale) > 0.001 && this.currentScale !== 1.0) {
        const ratio = fitScale / this.currentScale;
        const pg    = this.currentPage;
        this.annotations[pg] = this.annotations[pg].map(a => this._scaleAnnotation(a, ratio));
        this.history[pg]      = [ JSON.stringify(this.annotations[pg]) ];
        this.historyIndex[pg] = 0;
      }

      this.fitScale     = fitScale;
      this.currentScale = fitScale;
      this.zoomLabel.textContent = Math.round(fitScale * 100) + '%';
      await this._renderPage(this.currentPage, this.currentScale);
    }

    async _buildThumbnails() {
      this.thumbContainer.innerHTML = '';
      this.thumbQueue = [];
      for (let i = 1; i <= this.totalPages; i++) {
        const item = document.createElement('div');
        item.className    = 'thumb-item';
        item.dataset.page = i;
        item.title        = 'Page ' + i;

        const canvas = document.createElement('canvas');
        item.appendChild(canvas);

        const num = document.createElement('span');
        num.className   = 'thumb-num';
        num.textContent = i;
        item.appendChild(num);

        item.addEventListener('click', () => this._gotoPage(parseInt(item.dataset.page, 10)));
        this.thumbContainer.appendChild(item);
        this.thumbQueue.push({ pageNum: i, canvas });
      }
      this._drainThumbQueue();
    }

    async _drainThumbQueue() {
      if (this.thumbBusy || this.thumbQueue.length === 0) return;
      this.thumbBusy = true;
      const { pageNum, canvas } = this.thumbQueue.shift();
      try {
        const page     = await this.pdfDoc.getPage(pageNum);
        const vp       = page.getViewport({ scale: 1 });
        const scale    = 130 / vp.width;
        const viewport = page.getViewport({ scale });
        canvas.width   = viewport.width;
        canvas.height  = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      } catch (_) { /* ignore */ }
      this.thumbBusy = false;
      this._drainThumbQueue();
    }

    _highlightThumb(pageNum) {
      document.querySelectorAll('.thumb-item').forEach(el => {
        el.classList.toggle('active', parseInt(el.dataset.page, 10) === pageNum);
      });
      const active = document.querySelector('.thumb-item.active');
      if (active) active.scrollIntoView({ block: 'nearest' });
    }

    _setTool(tool) {
      if (tool === 'signature') { this._openSignatureModal(); return; }
      if (tool === 'stamp')     { this._openStampModal();    return; }
      this.currentTool = tool;
      this.toolButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.tool === tool));
      this._updateToolCursor();

      const showFont = tool === 'text';
      this.fontSizeOpts.forEach(el => {
        if (showFont) el.classList.add('visible');
        else          el.classList.remove('visible');
      });

      if (this.selectedAnnot && tool !== 'select') {
        this.selectedAnnot = null;
        this._redrawAnnotations();
        this._updatePropsPanel();
      }
    }

    _updateToolCursor() {
      if (this.canvasWrapper) {
        this.canvasWrapper.dataset.tool = this.currentTool;
      }
    }

    _getPos(e) {
      const rect  = this.annotCanvas.getBoundingClientRect();
      const scaleX = this.annotCanvas.width  / rect.width;
      const scaleY = this.annotCanvas.height / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top)  * scaleY
      };
    }

    _onMouseDown(e) {
      if (!this.pdfDoc) return;
      const pos = this._getPos(e);

      if (this.currentTool === 'select') {
        this._trySelect(pos.x, pos.y);
        return;
      }
      if (this.currentTool === 'text') {
        this._placeTextInput(pos.x, pos.y);
        return;
      }
      if (this.currentTool === 'eraser') {
        this._eraseAt(pos.x, pos.y);
        return;
      }
      if (this.currentTool === 'signature') {
        if (this.pendingSignatureDataUrl) {
          const w = 220, h = Math.round(220 * 0.38);
          this._addAnnotation({ type: 'signature', x: pos.x - w / 2, y: pos.y - h / 2,
                                 w, h, imageDataUrl: this.pendingSignatureDataUrl, opacity: 1.0 });
        }
        return;
      }
      if (this.currentTool === 'stamp') {
        if (this.pendingStampDataUrl) {
          const w = 190, h = 190;
          this._addAnnotation({ type: 'stamp', x: pos.x - w / 2, y: pos.y - h / 2,
                                 w, h, imageDataUrl: this.pendingStampDataUrl,
                                 opacity: this.pendingStampOpacity });
        }
        return;
      }

      this.isDrawing = true;
      this.startX    = pos.x;
      this.startY    = pos.y;

      if (this.currentTool === 'pen' || this.currentTool === 'highlighter') {
        this.currentPen = [{ x: pos.x, y: pos.y }];
      } else {
        this.snapshotData = this.annotCtx.getImageData(
          0, 0, this.annotCanvas.width, this.annotCanvas.height
        );
      }
    }

    _onMouseMove(e) {
      if (!this.isDrawing) return;
      const pos = this._getPos(e);

      if (this.currentTool === 'pen' || this.currentTool === 'highlighter') {
        this.currentPen.push({ x: pos.x, y: pos.y });
        this._drawLiveStroke();
        return;
      }

      this.annotCtx.putImageData(this.snapshotData, 0, 0);
      const preview = this._buildShapeAnnot(this.startX, this.startY, pos.x, pos.y);
      if (preview) this._drawAnnotation(this.annotCtx, preview);
    }

    _onMouseUp(e) {
      if (!this.isDrawing) return;
      this.isDrawing = false;
      const pos = this._getPos(e);

      if (this.currentTool === 'pen' || this.currentTool === 'highlighter') {
        if (this.currentPen && this.currentPen.length > 1) {
          const isHL = this.currentTool === 'highlighter';
          const annot = {
            type:    this.currentTool,
            points:  this.currentPen,
            color:   this.color,
            width:   isHL ? Math.max(this.strokeWidth * 4, 16) : this.strokeWidth,
            opacity: isHL ? 0.35 : this.opacity
          };
          this._addAnnotation(annot);
        }
        this.currentPen = null;
        return;
      }

      const annot = this._buildShapeAnnot(this.startX, this.startY, pos.x, pos.y);
      if (annot && this._annotHasSize(annot)) {
        this._addAnnotation(annot);
      } else if (this.snapshotData) {
        this.annotCtx.putImageData(this.snapshotData, 0, 0);
      }
      this.snapshotData = null;
    }

    _buildShapeAnnot(x1, y1, x2, y2) {
      const base = { color: this.color, width: this.strokeWidth, opacity: this.opacity };
      switch (this.currentTool) {
        case 'rect':
          return { ...base, type: 'rect',
                   x: Math.min(x1,x2), y: Math.min(y1,y2),
                   w: Math.abs(x2-x1),  h: Math.abs(y2-y1) };
        case 'circle':
          return { ...base, type: 'circle',
                   x: Math.min(x1,x2), y: Math.min(y1,y2),
                   rx: Math.abs(x2-x1)/2, ry: Math.abs(y2-y1)/2 };
        case 'line':
          return { ...base, type: 'line', x1, y1, x2, y2 };
        case 'arrow':
          return { ...base, type: 'arrow', x1, y1, x2, y2 };
        default:
          return null;
      }
    }

    _annotHasSize(annot) {
      if (!annot) return false;
      if (annot.type === 'rect')   return annot.w > 3 && annot.h > 3;
      if (annot.type === 'circle') return annot.rx > 2 && annot.ry > 2;
      if (annot.type === 'line' || annot.type === 'arrow') {
        const dx = annot.x2 - annot.x1, dy = annot.y2 - annot.y1;
        return Math.sqrt(dx*dx + dy*dy) > 5;
      }
      return true;
    }

    _drawLiveStroke() {
      if (!this.currentPen || this.currentPen.length < 2) return;
      const ctx   = this.annotCtx;
      const pts   = this.currentPen;
      const isHL  = this.currentTool === 'highlighter';
      const w     = isHL ? Math.max(this.strokeWidth * 4, 16) : this.strokeWidth;
      const alpha = isHL ? 0.35 : this.opacity;

      ctx.save();
      ctx.globalAlpha  = alpha;
      ctx.strokeStyle  = this.color;
      ctx.lineWidth    = w;
      ctx.lineCap      = 'round';
      ctx.lineJoin     = 'round';
      if (isHL) ctx.globalCompositeOperation = 'multiply';
      ctx.beginPath();
      ctx.moveTo(pts[pts.length - 2].x, pts[pts.length - 2].y);
      ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      ctx.stroke();
      if (isHL) ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
    }

    _drawAnnotation(ctx, annot, selected) {
      if (!annot) return;
      ctx.save();
      ctx.globalAlpha = annot.opacity !== undefined ? annot.opacity : 1;
      ctx.strokeStyle = annot.color  || '#e74c3c';
      ctx.fillStyle   = annot.color  || '#e74c3c';
      ctx.lineWidth   = annot.width  || 2;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';

      switch (annot.type) {
        case 'pen':
        case 'highlighter': {
          const pts = annot.points;
          if (!pts || pts.length < 2) break;
          if (annot.type === 'highlighter') ctx.globalCompositeOperation = 'multiply';
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
          ctx.stroke();
          ctx.globalCompositeOperation = 'source-over';
          break;
        }
        case 'text': {
          ctx.font         = (annot.fontSize || 18) + 'px "Segoe UI", sans-serif';
          ctx.globalAlpha  = annot.opacity !== undefined ? annot.opacity : 1;
          ctx.fillStyle    = annot.color || '#e74c3c';
          const lines = (annot.text || '').split('\n');
          lines.forEach((line, i) => {
            ctx.fillText(line, annot.x, annot.y + i * (annot.fontSize || 18) * 1.4);
          });
          break;
        }
        case 'rect':
          ctx.strokeRect(annot.x, annot.y, annot.w, annot.h);
          break;
        case 'circle': {
          const cx = annot.x + annot.rx;
          const cy = annot.y + annot.ry;
          ctx.beginPath();
          ctx.ellipse(cx, cy, annot.rx, annot.ry, 0, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'line':
          ctx.beginPath();
          ctx.moveTo(annot.x1, annot.y1);
          ctx.lineTo(annot.x2, annot.y2);
          ctx.stroke();
          break;
        case 'arrow':
          this._drawArrow(ctx, annot.x1, annot.y1, annot.x2, annot.y2);
          break;
        case 'signature':
        case 'stamp': {
          const cached = this.imageCache[annot.imageDataUrl];
          if (cached) {
            ctx.drawImage(cached, annot.x, annot.y, annot.w, annot.h);
          } else {
            const img = new Image();
            img.onload = () => {
              this.imageCache[annot.imageDataUrl] = img;
              this._redrawAnnotations();
            };
            img.src = annot.imageDataUrl;
          }
          break;
        }
      }

      if (selected) {
        const bb = this._boundingBox(annot);
        if (bb) {
          ctx.save();
          ctx.globalAlpha  = 1;
          ctx.strokeStyle  = '#4f8ef7';
          ctx.lineWidth    = 1.5;
          ctx.setLineDash([5, 3]);
          ctx.strokeRect(bb.x - 6, bb.y - 6, bb.w + 12, bb.h + 12);
          ctx.restore();
        }
      }

      ctx.restore();
    }

    _drawArrow(ctx, x1, y1, x2, y2) {
      const angle   = Math.atan2(y2 - y1, x2 - x1);
      const headLen = Math.max(12, (ctx.lineWidth || 2) * 4);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(
        x2 - headLen * Math.cos(angle - Math.PI / 6),
        y2 - headLen * Math.sin(angle - Math.PI / 6)
      );
      ctx.moveTo(x2, y2);
      ctx.lineTo(
        x2 - headLen * Math.cos(angle + Math.PI / 6),
        y2 - headLen * Math.sin(angle + Math.PI / 6)
      );
      ctx.stroke();
    }

    _redrawAnnotations() {
      const ctx = this.annotCtx;
      ctx.clearRect(0, 0, this.annotCanvas.width, this.annotCanvas.height);
      const annots = this.annotations[this.currentPage] || [];
      annots.forEach(a => this._drawAnnotation(ctx, a, a === this.selectedAnnot));
    }

    _addAnnotation(annot) {
      const pg = this.currentPage;
      this.annotations[pg].push(annot);
      this._pushHistory(pg);
      this._redrawAnnotations();
      this._updateUndoRedo();
    }

    _trySelect(x, y) {
      const annots = this.annotations[this.currentPage] || [];
      let found = null;
      for (let i = annots.length - 1; i >= 0; i--) {
        if (this._hitTest(annots[i], x, y)) { found = annots[i]; break; }
      }
      this.selectedAnnot = found;
      this._redrawAnnotations();
      this._updatePropsPanel();
    }

    _hitTest(annot, x, y) {
      const bb = this._boundingBox(annot);
      if (!bb) return false;
      const pad = 10;
      return x >= bb.x - pad && x <= bb.x + bb.w + pad &&
             y >= bb.y - pad && y <= bb.y + bb.h + pad;
    }

    _boundingBox(annot) {
      if (!annot) return null;
      switch (annot.type) {
        case 'pen':
        case 'highlighter': {
          if (!annot.points || annot.points.length === 0) return null;
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          annot.points.forEach(p => {
            if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
          });
          return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
        }
        case 'text': {
          const fs    = annot.fontSize || 18;
          const lines = (annot.text || '').split('\n');
          const maxLen = lines.reduce((m, l) => Math.max(m, l.length), 0);
          return { x: annot.x, y: annot.y - fs,
                   w: maxLen * fs * 0.6, h: lines.length * fs * 1.4 };
        }
        case 'rect':
          return { x: annot.x, y: annot.y, w: annot.w, h: annot.h };
        case 'circle':
          return { x: annot.x, y: annot.y, w: annot.rx * 2, h: annot.ry * 2 };
        case 'line':
        case 'arrow':
          return { x: Math.min(annot.x1, annot.x2), y: Math.min(annot.y1, annot.y2),
                   w: Math.abs(annot.x2 - annot.x1), h: Math.abs(annot.y2 - annot.y1) };
        case 'signature':
        case 'stamp':
          return { x: annot.x, y: annot.y, w: annot.w, h: annot.h };
        default: return null;
      }
    }

    _eraseAt(x, y) {
      const pg     = this.currentPage;
      const annots = this.annotations[pg];
      for (let i = annots.length - 1; i >= 0; i--) {
        if (this._hitTest(annots[i], x, y)) {
          if (this.selectedAnnot === annots[i]) {
            this.selectedAnnot = null;
            this._updatePropsPanel();
          }
          annots.splice(i, 1);
          this._pushHistory(pg);
          this._redrawAnnotations();
          this._updateUndoRedo();
          return;
        }
      }
    }

    _deleteSelected() {
      if (!this.selectedAnnot) return;
      const pg     = this.currentPage;
      const annots = this.annotations[pg];
      const idx    = annots.indexOf(this.selectedAnnot);
      if (idx !== -1) {
        annots.splice(idx, 1);
        this.selectedAnnot = null;
        this._pushHistory(pg);
        this._redrawAnnotations();
        this._updateUndoRedo();
        this._updatePropsPanel();
      }
    }

    _placeTextInput(x, y) {
      if (this.textInput.style.display !== 'none') this._confirmText();

      const cRect  = this.annotCanvas.getBoundingClientRect();
      const scaleX = this.annotCanvas.width  / cRect.width;
      const scaleY = this.annotCanvas.height / cRect.height;
      const cssX   = x / scaleX;
      const cssY   = y / scaleY;

      this.textInput.style.left     = cssX + 'px';
      this.textInput.style.top      = (cssY - this.fontSize / scaleY) + 'px';
      this.textInput.style.fontSize = (this.fontSize / scaleY) + 'px';
      this.textInput.style.color    = this.color;
      this.textInput.style.opacity  = this.opacity;
      this.textInput.style.display  = 'block';
      this.textInput.value          = '';

      this._textCanvasX = x;
      this._textCanvasY = y;

      setTimeout(() => this.textInput.focus(), 10);
    }

    _confirmText() {
      const txt = this.textInput.value.trim();
      this.textInput.style.display = 'none';
      if (!txt) return;
      const annot = {
        type:     'text',
        x:        this._textCanvasX,
        y:        this._textCanvasY,
        text:     txt,
        color:    this.color,
        fontSize: this.fontSize,
        opacity:  this.opacity
      };
      this._addAnnotation(annot);
    }

    _pushHistory(pg) {
      const snap    = JSON.stringify(this.annotations[pg]);
      const history = this.history[pg];
      const idx     = this.historyIndex[pg];
      history.splice(idx + 1);
      history.push(snap);
      this.historyIndex[pg] = history.length - 1;
      this._updateUndoRedo();
    }

    _undo() {
      if (!this.pdfDoc) return;
      const pg  = this.currentPage;
      const idx = this.historyIndex[pg];
      if (idx <= 0) return;
      this.historyIndex[pg] = idx - 1;
      this.annotations[pg]  = JSON.parse(this.history[pg][idx - 1]);
      this.selectedAnnot    = null;
      this._redrawAnnotations();
      this._updateUndoRedo();
      this._updatePropsPanel();
    }

    _redo() {
      if (!this.pdfDoc) return;
      const pg  = this.currentPage;
      const idx = this.historyIndex[pg];
      if (idx >= this.history[pg].length - 1) return;
      this.historyIndex[pg] = idx + 1;
      this.annotations[pg]  = JSON.parse(this.history[pg][idx + 1]);
      this.selectedAnnot    = null;
      this._redrawAnnotations();
      this._updateUndoRedo();
      this._updatePropsPanel();
    }

    _updateUndoRedo() {
      if (!this.pdfDoc) return;
      const pg  = this.currentPage;
      const idx = this.historyIndex[pg] || 0;
      this.undoBtn.disabled = idx <= 0;
      this.redoBtn.disabled = idx >= (this.history[pg] || []).length - 1;
    }

    _updatePropsPanel() {
      const pb = this.propsBody;
      if (!this.selectedAnnot) {
        pb.innerHTML = '<p class="props-empty">No annotation selected</p>';
        return;
      }
      const a = this.selectedAnnot;
      let html = '<div class="prop-row"><label>Type</label>';
      html += '<span class="prop-type-badge">' + a.type + '</span></div>';

      if (a.color !== undefined) {
        html += '<div class="prop-row"><label>Color</label>';
        html += '<input type="color" id="propColor" value="' + a.color + '" /></div>';
      }
      if (a.width !== undefined && a.type !== 'text') {
        const w = Math.round(a.width);
        html += '<div class="prop-row"><label>Width</label>';
        html += '<input type="range" id="propWidth" min="1" max="30" value="' + w + '" />';
        html += '<span id="propWidthVal">' + w + '</span></div>';
      }
      if (a.opacity !== undefined) {
        const opPct = Math.round(a.opacity * 100);
        html += '<div class="prop-row"><label>Opacity</label>';
        html += '<input type="range" id="propOpacity" min="5" max="100" value="' + opPct + '" />';
        html += '<span id="propOpacityVal">' + opPct + '%</span></div>';
      }
      if (a.type === 'text') {
        const fs = Math.round(a.fontSize);
        html += '<div class="prop-row"><label>Font Size</label>';
        html += '<input type="range" id="propFontSize" min="8" max="72" value="' + fs + '" />';
        html += '<span id="propFontSizeVal">' + fs + 'px</span></div>';
        html += '<div class="prop-row"><label>Text</label>';
        html += '<input type="text" id="propText" value="' + this._escAttr(a.text) + '" /></div>';
      }
      html += '<button class="prop-delete-btn" id="propDeleteBtn">Delete Annotation</button>';
      pb.innerHTML = html;

      const pc = document.getElementById('propColor');
      if (pc) pc.addEventListener('input', e => {
        a.color = e.target.value;
        this.colorPicker.value = e.target.value;
        this.color = e.target.value;
        this._redrawAnnotations();
      });

      const pw = document.getElementById('propWidth');
      if (pw) pw.addEventListener('input', e => {
        a.width = parseInt(e.target.value, 10);
        document.getElementById('propWidthVal').textContent = a.width;
        this._redrawAnnotations();
      });

      const po = document.getElementById('propOpacity');
      if (po) po.addEventListener('input', e => {
        a.opacity = parseInt(e.target.value, 10) / 100;
        document.getElementById('propOpacityVal').textContent = e.target.value + '%';
        this._redrawAnnotations();
      });

      const pfs = document.getElementById('propFontSize');
      if (pfs) pfs.addEventListener('input', e => {
        a.fontSize = parseInt(e.target.value, 10);
        document.getElementById('propFontSizeVal').textContent = a.fontSize + 'px';
        this._redrawAnnotations();
      });

      const pt = document.getElementById('propText');
      if (pt) pt.addEventListener('input', e => {
        a.text = e.target.value;
        this._redrawAnnotations();
      });

      document.getElementById('propDeleteBtn').addEventListener('click', () => this._deleteSelected());
    }

    _escAttr(str) {
      return (str || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;');
    }

    _scaleAnnotation(annot, ratio) {
      const a = JSON.parse(JSON.stringify(annot));
      switch (a.type) {
        case 'pen':
        case 'highlighter':
          a.points = a.points.map(p => ({ x: p.x * ratio, y: p.y * ratio }));
          a.width  = a.width * ratio;
          break;
        case 'text':
          a.x        = a.x        * ratio;
          a.y        = a.y        * ratio;
          a.fontSize = a.fontSize * ratio;
          break;
        case 'rect':
          a.x = a.x * ratio; a.y = a.y * ratio;
          a.w = a.w * ratio; a.h = a.h * ratio;
          a.width = a.width * ratio;
          break;
        case 'circle':
          a.x  = a.x  * ratio; a.y  = a.y  * ratio;
          a.rx = a.rx * ratio; a.ry = a.ry * ratio;
          a.width = a.width * ratio;
          break;
        case 'line':
        case 'arrow':
          a.x1 = a.x1 * ratio; a.y1 = a.y1 * ratio;
          a.x2 = a.x2 * ratio; a.y2 = a.y2 * ratio;
          a.width = a.width * ratio;
          break;
        case 'signature':
        case 'stamp':
          a.x = a.x * ratio; a.y = a.y * ratio;
          a.w = a.w * ratio; a.h = a.h * ratio;
          break;
      }
      return a;
    }

    async _savePDF() {
      if (!this.pdfDoc || !this.pdfBytes) {
        this._toast('No PDF loaded', 'error');
        return;
      }
      if (typeof PDFLib === 'undefined') {
        this._toast('pdf-lib not loaded. Check CDN.', 'error');
        return;
      }
      this._showLoading(true);
      try {
        const RENDER_SCALE  = 2;
        const { PDFDocument } = PDFLib;
        const pdfLibDoc     = await PDFDocument.load(this.pdfBytes.slice(0));

        for (let pgNum = 1; pgNum <= this.totalPages; pgNum++) {
          const annots = this.annotations[pgNum];
          if (!annots || annots.length === 0) continue;

          const pdfPage          = pdfLibDoc.getPage(pgNum - 1);
          const { width: pdfW, height: pdfH } = pdfPage.getSize();

          const pjsPage  = await this.pdfDoc.getPage(pgNum);
          const viewport = pjsPage.getViewport({ scale: RENDER_SCALE });

          const offCanvas    = document.createElement('canvas');
          offCanvas.width    = viewport.width;
          offCanvas.height   = viewport.height;
          const offCtx       = offCanvas.getContext('2d');
          await pjsPage.render({ canvasContext: offCtx, viewport }).promise;

          const ratio        = RENDER_SCALE / this.currentScale;
          const scaledAnnots = annots.map(a => this._scaleAnnotation(a, ratio));

          // Pre-load images for signature/stamp annotations
          const imageAnnots = scaledAnnots.filter(a => a.imageDataUrl);
          await Promise.all(imageAnnots.map(a => this._ensureImageCached(a.imageDataUrl)));

          scaledAnnots.forEach(a => this._drawAnnotation(offCtx, a, false));

          const pngDataUrl = offCanvas.toDataURL('image/png');
          const pngBytes   = this._dataURLtoBytes(pngDataUrl);
          const pngImage   = await pdfLibDoc.embedPng(pngBytes);

          pdfPage.drawImage(pngImage, {
            x:       0,
            y:       0,
            width:   pdfW,
            height:  pdfH,
            opacity: 1
          });
        }

        const savedBytes = await pdfLibDoc.save();
        this._downloadBlob(
          new Blob([savedBytes], { type: 'application/pdf' }),
          'edited.pdf'
        );
        this._toast('PDF saved successfully', 'success');
      } catch (err) {
        console.error(err);
        this._toast('Save failed: ' + err.message, 'error');
      } finally {
        this._showLoading(false);
      }
    }

    _exportImage() {
      if (!this.pdfDoc) {
        this._toast('No PDF loaded', 'error');
        return;
      }
      const composite    = document.createElement('canvas');
      composite.width    = this.pdfCanvas.width;
      composite.height   = this.pdfCanvas.height;
      const ctx          = composite.getContext('2d');
      ctx.drawImage(this.pdfCanvas,   0, 0);
      ctx.drawImage(this.annotCanvas, 0, 0);
      composite.toBlob(blob => {
        this._downloadBlob(blob, 'page-' + this.currentPage + '.png');
        this._toast('Image exported', 'success');
      }, 'image/png');
    }

    _dataURLtoBytes(dataURL) {
      const base64 = dataURL.split(',')[1];
      const raw    = atob(base64);
      const bytes  = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      return bytes;
    }

    _downloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href     = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
    }

    _enableControls(enabled) {
      const pagesBtn = document.getElementById('pagesBtn');
      [this.saveBtn, this.exportImgBtn, this.prevBtn, this.nextBtn,
       this.pageInput, this.zoomInBtn, this.zoomOutBtn, this.fitBtn, pagesBtn].forEach(el => {
        el.disabled = !enabled;
      });
      if (enabled) {
        this.undoBtn.disabled = true;
        this.redoBtn.disabled = true;
        this._updatePageInput();
      }
    }

    _showLoading(show) {
      this.loadingOverlay.style.display = show ? 'flex' : 'none';
    }

    // ── Image cache helper ───────────────────────────────────────────
    _ensureImageCached(dataUrl) {
      if (this.imageCache[dataUrl]) return Promise.resolve(this.imageCache[dataUrl]);
      return new Promise(resolve => {
        const img = new Image();
        img.onload = () => { this.imageCache[dataUrl] = img; resolve(img); };
        img.onerror = () => resolve(null);
        img.src = dataUrl;
      });
    }

    // ── Reload document helper ───────────────────────────────────────
    async _reloadDocument(newBytes, goToPage, preservedAnnotations) {
      const arr = newBytes instanceof Uint8Array ? newBytes : new Uint8Array(newBytes);
      this.pdfBytes = arr;
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      if (this.pdfDoc) { try { this.pdfDoc.destroy(); } catch (_) {} }
      const task = pdfjsLib.getDocument({ data: arr.slice(0) });
      this.pdfDoc      = await task.promise;
      this.totalPages  = this.pdfDoc.numPages;
      this.currentPage = Math.max(1, Math.min(goToPage || 1, this.totalPages));
      this.selectedAnnot = null;

      this.annotations  = preservedAnnotations || {};
      this.history      = {};
      this.historyIndex = {};
      for (let i = 1; i <= this.totalPages; i++) {
        if (!this.annotations[i]) this.annotations[i] = [];
        this.history[i]      = [ JSON.stringify(this.annotations[i]) ];
        this.historyIndex[i] = 0;
      }
      this.totalPagesEl.textContent = this.totalPages;
      this.pageInput.max = this.totalPages;
      this._enableControls(true);
      await this._buildThumbnails();
      await this._zoomFit();
    }

    // ── Page operations ──────────────────────────────────────────────
    _bindPageOps() {
      const menu    = document.getElementById('pagesMenu');
      const toggle  = document.getElementById('pagesBtn');
      if (!toggle) return;

      toggle.addEventListener('click', e => {
        e.stopPropagation();
        menu.classList.toggle('open');
      });
      document.addEventListener('click', () => menu.classList.remove('open'));

      document.getElementById('addPageBeforeBtn').addEventListener('click', () => {
        menu.classList.remove('open');
        this._addBlankPage(true);
      });
      document.getElementById('addPageAfterBtn').addEventListener('click', () => {
        menu.classList.remove('open');
        this._addBlankPage(false);
      });
      document.getElementById('deletePageBtn').addEventListener('click', () => {
        menu.classList.remove('open');
        this._deletePage();
      });
      document.getElementById('extractPagesBtn').addEventListener('click', () => {
        menu.classList.remove('open');
        this._openExtractModal();
      });
      document.getElementById('scannerBtn').addEventListener('click', () => {
        menu.classList.remove('open');
        this._openScannerModal();
      });
    }

    async _deletePage() {
      if (!this.pdfDoc) return;
      if (this.totalPages <= 1) { this._toast('Cannot delete the only page', 'error'); return; }
      if (!confirm(`Delete page ${this.currentPage} of ${this.totalPages}?`)) return;

      this._showLoading(true);
      try {
        const { PDFDocument } = PDFLib;
        const doc = await PDFDocument.load(this.pdfBytes.slice(0));
        doc.removePage(this.currentPage - 1);
        const newBytes = await doc.save();

        // Shift annotations: pages after deleted shift down by 1
        const delPg  = this.currentPage;
        const newAnnots = {};
        for (let i = 1; i <= this.totalPages; i++) {
          if (i === delPg) continue;
          const newIdx = i < delPg ? i : i - 1;
          newAnnots[newIdx] = this.annotations[i] || [];
        }
        const goTo = Math.min(this.currentPage, this.totalPages - 1);
        await this._reloadDocument(newBytes, goTo, newAnnots);
        this._toast('Page deleted', 'success');
      } catch (err) {
        console.error(err);
        this._toast('Delete failed: ' + err.message, 'error');
      } finally {
        this._showLoading(false);
      }
    }

    async _addBlankPage(before) {
      if (!this.pdfDoc) return;
      this._showLoading(true);
      try {
        const { PDFDocument } = PDFLib;
        const doc  = await PDFDocument.load(this.pdfBytes.slice(0));
        const ref  = doc.getPage(this.currentPage - 1);
        const { width, height } = ref.getSize();
        const insertAt = before ? this.currentPage - 1 : this.currentPage;
        doc.insertPage(insertAt, [width, height]);
        const newBytes = await doc.save();

        // Shift annotations: pages at/after insert position shift up by 1
        const newAnnots = {};
        for (let i = 1; i <= this.totalPages; i++) {
          const newIdx = i <= insertAt ? i : i + 1;
          newAnnots[newIdx] = this.annotations[i] || [];
        }
        // The new blank page gets empty annotations (already default)
        const goTo = before ? this.currentPage : this.currentPage + 1;
        await this._reloadDocument(newBytes, goTo, newAnnots);
        this._toast('Blank page added', 'success');
      } catch (err) {
        console.error(err);
        this._toast('Add page failed: ' + err.message, 'error');
      } finally {
        this._showLoading(false);
      }
    }

    async _extractPages(pageNums) {
      if (!pageNums.length) { this._toast('No pages selected', 'error'); return; }
      this._showLoading(true);
      try {
        const { PDFDocument } = PDFLib;
        const src    = await PDFDocument.load(this.pdfBytes.slice(0));
        const out    = await PDFDocument.create();
        const copied = await out.copyPages(src, pageNums.map(n => n - 1));
        copied.forEach(p => out.addPage(p));
        const bytes = await out.save();
        this._downloadBlob(new Blob([bytes], { type: 'application/pdf' }), 'extracted.pdf');
        this._toast(`Extracted ${pageNums.length} page(s)`, 'success');
      } catch (err) {
        console.error(err);
        this._toast('Extract failed: ' + err.message, 'error');
      } finally {
        this._showLoading(false);
      }
    }

    async _createFromScanner(files, pageSize) {
      if (!files.length) return;
      this._showLoading(true);
      try {
        const { PDFDocument } = PDFLib;
        const doc = await PDFDocument.create();

        for (const file of files) {
          const buf  = await file.arrayBuffer();
          const type = file.type;

          let pngBytes;
          if (type === 'image/jpeg' || type === 'image/jpg') {
            // embed JPEG directly
            const img     = await doc.embedJpg(buf);
            const [pw, ph] = this._resolvePageSize(pageSize, img.width, img.height);
            const page     = doc.addPage([pw, ph]);
            const scale    = Math.min(pw / img.width, ph / img.height);
            const dw = img.width * scale, dh = img.height * scale;
            page.drawImage(img, { x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh });
          } else {
            // Convert to PNG via canvas
            const dataUrl    = await this._fileToDataUrl(file);
            const htmlImg    = await this._ensureImageCached(dataUrl);
            const cvs        = document.createElement('canvas');
            cvs.width        = htmlImg.naturalWidth;
            cvs.height       = htmlImg.naturalHeight;
            cvs.getContext('2d').drawImage(htmlImg, 0, 0);
            pngBytes = this._dataURLtoBytes(cvs.toDataURL('image/png'));
            const img     = await doc.embedPng(pngBytes);
            const [pw, ph] = this._resolvePageSize(pageSize, img.width, img.height);
            const page     = doc.addPage([pw, ph]);
            const scale    = Math.min(pw / img.width, ph / img.height);
            const dw = img.width * scale, dh = img.height * scale;
            page.drawImage(img, { x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh });
          }
        }

        const bytes = await doc.save();
        await this._reloadDocument(bytes, 1, {});
        this._toast(`Created PDF from ${files.length} image(s)`, 'success');
      } catch (err) {
        console.error(err);
        this._toast('Create failed: ' + err.message, 'error');
      } finally {
        this._showLoading(false);
      }
    }

    _resolvePageSize(mode, imgW, imgH) {
      if (mode === 'a4')     return [595, 842];
      if (mode === 'letter') return [612, 792];
      return [imgW, imgH]; // fit
    }

    _fileToDataUrl(file) {
      return new Promise((res, rej) => {
        const r = new FileReader();
        r.onload  = e => res(e.target.result);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
    }

    // ── Signature modal ──────────────────────────────────────────────
    _openSignatureModal() {
      document.getElementById('signatureModal').style.display = 'flex';
      this._activateSigTab('draw');
      const canvas = document.getElementById('sigCanvas');
      const ctx    = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    _bindSignatureModal() {
      const modal = document.getElementById('signatureModal');
      if (!modal) return;

      // Tab switching
      modal.querySelectorAll('.sig-tab').forEach(tab => {
        tab.addEventListener('click', () => this._activateSigTab(tab.dataset.sigtab));
      });

      // Drawing on sig canvas
      const canvas = document.getElementById('sigCanvas');
      let drawing = false, lastX = 0, lastY = 0;

      const getPos = e => {
        const r = canvas.getBoundingClientRect();
        const src = e.touches ? e.touches[0] : e;
        return { x: (src.clientX - r.left) * (canvas.width / r.width),
                 y: (src.clientY - r.top)  * (canvas.height / r.height) };
      };
      const startDraw = e => {
        e.preventDefault();
        drawing = true;
        const p = getPos(e); lastX = p.x; lastY = p.y;
      };
      const moveDraw = e => {
        e.preventDefault();
        if (!drawing) return;
        const p   = getPos(e);
        const ctx2 = canvas.getContext('2d');
        ctx2.strokeStyle = document.getElementById('sigColor').value;
        ctx2.lineWidth   = parseInt(document.getElementById('sigWidth').value, 10);
        ctx2.lineCap     = 'round';
        ctx2.lineJoin    = 'round';
        ctx2.beginPath();
        ctx2.moveTo(lastX, lastY);
        ctx2.lineTo(p.x, p.y);
        ctx2.stroke();
        lastX = p.x; lastY = p.y;
      };
      const stopDraw = () => { drawing = false; };

      canvas.addEventListener('mousedown',  startDraw);
      canvas.addEventListener('mousemove',  moveDraw);
      canvas.addEventListener('mouseup',    stopDraw);
      canvas.addEventListener('mouseleave', stopDraw);
      canvas.addEventListener('touchstart', startDraw, { passive: false });
      canvas.addEventListener('touchmove',  moveDraw,  { passive: false });
      canvas.addEventListener('touchend',   stopDraw);

      document.getElementById('sigClearBtn').addEventListener('click', () => {
        const c = document.getElementById('sigCanvas');
        c.getContext('2d').clearRect(0, 0, c.width, c.height);
      });

      // Type tab live preview
      const updateTypePreview = () => {
        const text  = document.getElementById('sigTypeText').value;
        const font  = document.getElementById('sigTypeFont').value;
        const color = document.getElementById('sigTypeColor').value;
        const pc    = document.getElementById('sigTypePreview');
        const pCtx  = pc.getContext('2d');
        pCtx.clearRect(0, 0, pc.width, pc.height);
        pCtx.font        = font;
        pCtx.fillStyle   = color;
        pCtx.textBaseline = 'middle';
        pCtx.textAlign   = 'center';
        pCtx.fillText(text, pc.width / 2, pc.height / 2);
      };
      document.getElementById('sigTypeText').addEventListener('input', updateTypePreview);
      document.getElementById('sigTypeFont').addEventListener('change', updateTypePreview);
      document.getElementById('sigTypeColor').addEventListener('input', updateTypePreview);

      // Upload tab
      const uploadZone  = document.getElementById('sigUploadZone');
      const uploadInput = document.getElementById('sigUploadInput');
      uploadZone.addEventListener('click', () => uploadInput.click());
      uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
      uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
      uploadZone.addEventListener('drop', e => {
        e.preventDefault(); uploadZone.classList.remove('drag-over');
        if (e.dataTransfer.files[0]) this._loadSigUpload(e.dataTransfer.files[0]);
      });
      uploadInput.addEventListener('change', e => {
        if (e.target.files[0]) this._loadSigUpload(e.target.files[0]);
      });

      // OK / Cancel
      document.getElementById('sigOkBtn').addEventListener('click', () => {
        const dataUrl = this._captureSigDataUrl();
        if (!dataUrl) { this._toast('Please draw, type, or upload a signature', 'error'); return; }
        this.pendingSignatureDataUrl = dataUrl;
        modal.style.display = 'none';
        this.currentTool = 'signature';
        this.toolButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.tool === 'signature'));
        this._updateToolCursor();
        this._toast('Click on the page to place the signature', 'info');
      });
      document.getElementById('sigCancelBtn').addEventListener('click', () => {
        modal.style.display = 'none';
      });
      document.getElementById('sigModalClose').addEventListener('click', () => {
        modal.style.display = 'none';
      });
    }

    _activateSigTab(name) {
      document.querySelectorAll('.sig-tab').forEach(t =>
        t.classList.toggle('active', t.dataset.sigtab === name));
      document.getElementById('sigPaneDraw').style.display   = name === 'draw'   ? '' : 'none';
      document.getElementById('sigPaneType').style.display   = name === 'type'   ? '' : 'none';
      document.getElementById('sigPaneUpload').style.display = name === 'upload' ? '' : 'none';
    }

    _loadSigUpload(file) {
      const reader = new FileReader();
      reader.onload = e => {
        const prev = document.getElementById('sigUploadPreview');
        prev.src   = e.target.result;
        prev.style.display = 'block';
        document.getElementById('sigUploadZone').style.display = 'none';
      };
      reader.readAsDataURL(file);
    }

    _captureSigDataUrl() {
      // Determine active tab
      const drawPane = document.getElementById('sigPaneDraw');
      if (drawPane.style.display !== 'none') {
        const c   = document.getElementById('sigCanvas');
        const ctx = c.getContext('2d');
        const d   = ctx.getImageData(0, 0, c.width, c.height).data;
        const hasPixels = Array.from(d).some((v, i) => i % 4 === 3 && v > 0);
        return hasPixels ? c.toDataURL('image/png') : null;
      }
      const typPane = document.getElementById('sigPaneType');
      if (typPane.style.display !== 'none') {
        const text = document.getElementById('sigTypeText').value.trim();
        if (!text) return null;
        // Render typed text to a canvas
        const c   = document.createElement('canvas');
        c.width   = 480; c.height = 120;
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.font         = document.getElementById('sigTypeFont').value;
        ctx.fillStyle    = document.getElementById('sigTypeColor').value;
        ctx.textBaseline = 'middle';
        ctx.textAlign    = 'center';
        ctx.fillText(text, c.width / 2, c.height / 2);
        return c.toDataURL('image/png');
      }
      // Upload pane
      const prev = document.getElementById('sigUploadPreview');
      if (prev.style.display !== 'none' && prev.src) return prev.src;
      return null;
    }

    // ── Stamp modal ──────────────────────────────────────────────────
    _openStampModal() {
      document.getElementById('stampModal').style.display = 'flex';
      // Set today's date as default
      const today = new Date().toISOString().split('T')[0];
      document.getElementById('stampDateVal').value = today;
      this._updateStampPreview();
    }

    _bindStampModal() {
      const modal = document.getElementById('stampModal');
      if (!modal) return;

      const update = () => this._updateStampPreview();
      ['stampStyle', 'stampText', 'stampSubtext', 'stampColor', 'stampIncludeDate', 'stampDateVal']
        .forEach(id => {
          const el = document.getElementById(id);
          if (el) { el.addEventListener('input', update); el.addEventListener('change', update); }
        });

      document.getElementById('stampIncludeDate').addEventListener('change', e => {
        document.getElementById('stampDateVal').style.display = e.target.checked ? 'block' : 'none';
        this._updateStampPreview();
      });

      document.getElementById('stampOpacity').addEventListener('input', e => {
        document.getElementById('stampOpacityVal').textContent = e.target.value + '%';
        this._updateStampPreview();
      });

      document.getElementById('stampOkBtn').addEventListener('click', () => {
        const dataUrl = this._generateStampDataUrl();
        this.pendingStampDataUrl   = dataUrl;
        this.pendingStampOpacity   = parseInt(document.getElementById('stampOpacity').value, 10) / 100;
        modal.style.display = 'none';
        this.currentTool = 'stamp';
        this.toolButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.tool === 'stamp'));
        this._updateToolCursor();
        this._toast('Click on the page to place the stamp', 'info');
      });
      document.getElementById('stampCancelBtn').addEventListener('click', () => {
        modal.style.display = 'none';
      });
      document.getElementById('stampModalClose').addEventListener('click', () => {
        modal.style.display = 'none';
      });
    }

    _getStampConfig() {
      const includeDate = document.getElementById('stampIncludeDate').checked;
      return {
        style:   document.getElementById('stampStyle').value,
        text:    document.getElementById('stampText').value   || 'COMPANY',
        sub:     document.getElementById('stampSubtext').value || '',
        color:   document.getElementById('stampColor').value,
        date:    includeDate ? document.getElementById('stampDateVal').value : '',
        opacity: parseInt(document.getElementById('stampOpacity').value, 10) / 100
      };
    }

    _updateStampPreview() {
      const cfg = this._getStampConfig();
      const url = this._generateStampDataUrl(cfg);
      const pc  = document.getElementById('stampPreviewCanvas');
      const img = new Image();
      img.onload = () => {
        const ctx = pc.getContext('2d');
        ctx.clearRect(0, 0, pc.width, pc.height);
        ctx.globalAlpha = cfg.opacity;
        ctx.drawImage(img, 0, 0, pc.width, pc.height);
        ctx.globalAlpha = 1;
      };
      img.src = url;
    }

    _generateStampDataUrl(cfg) {
      if (!cfg) cfg = this._getStampConfig();
      const SIZE = 400;
      const c    = document.createElement('canvas');
      c.width = c.height = SIZE;
      const ctx  = c.getContext('2d');
      const cx   = SIZE / 2, cy = SIZE / 2;
      ctx.strokeStyle = cfg.color;
      ctx.fillStyle   = cfg.color;
      ctx.lineCap     = 'round';

      if (cfg.style === 'round') {
        const R  = SIZE * 0.43;
        const R2 = R - 18;
        ctx.lineWidth = 7;
        ctx.beginPath(); ctx.arc(cx, cy, R,  0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, R2, 0, Math.PI * 2); ctx.stroke();

        // Arc text on top (company name)
        this._drawArcText(ctx, cfg.text,   R - 9, cx, cy, -Math.PI * 0.9, Math.PI * 0.9, false);
        if (cfg.sub) {
          this._drawArcText(ctx, cfg.sub, R - 9, cx, cy, Math.PI * 0.1, Math.PI * 1.9, true);
        }
        // Center date or star
        if (cfg.date) {
          ctx.font = 'bold 28px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(cfg.date, cx, cy);
        } else {
          // Decorative star
          ctx.font = '52px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('✦', cx, cy);
        }

      } else if (cfg.style === 'rect') {
        const pad = 24;
        ctx.lineWidth = 6;
        ctx.strokeRect(pad, pad, SIZE - pad * 2, SIZE - pad * 2);
        ctx.lineWidth = 2;
        ctx.strokeRect(pad + 10, pad + 10, SIZE - (pad + 10) * 2, SIZE - (pad + 10) * 2);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

        let textY = cy;
        if (cfg.sub || cfg.date) textY = cy - 22;
        ctx.font = `bold ${Math.min(36, 260 / Math.max(cfg.text.length, 1) * 1.8)}px Arial`;
        ctx.fillText(cfg.text, cx, textY);

        if (cfg.sub) {
          ctx.font = '22px Arial';
          ctx.fillText(cfg.sub, cx, textY + 38);
        }
        if (cfg.date) {
          ctx.font = '22px Arial';
          ctx.fillText(cfg.date, cx, textY + (cfg.sub ? 70 : 38));
        }

      } else {
        // Predefined labels: approved, received, confidential, draft
        const LABELS = { approved:'APPROVED', received:'RECEIVED',
                         confidential:'CONFIDENTIAL', draft:'DRAFT' };
        const label  = LABELS[cfg.style] || cfg.style.toUpperCase();

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(-0.15);
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';

        const fs = Math.min(64, Math.max(28, 320 / label.length));
        ctx.font = `bold ${fs}px Arial`;
        const m  = ctx.measureText(label);
        const bw = m.width + 30, bh = fs + 24;
        ctx.lineWidth = 5;
        ctx.strokeRect(-bw / 2, -bh / 2, bw, bh);
        ctx.fillText(label, 0, 0);

        if (cfg.text) {
          ctx.font = '22px Arial';
          ctx.fillText(cfg.text, 0, bh / 2 + 20);
        }
        if (cfg.date) {
          ctx.font = '20px Arial';
          ctx.fillText(cfg.date, 0, bh / 2 + (cfg.text ? 46 : 20));
        }
        ctx.restore();
      }

      return c.toDataURL('image/png');
    }

    _drawArcText(ctx, text, radius, cx, cy, startAngle, endAngle, flip) {
      if (!text) return;
      const totalAngle = endAngle - startAngle;
      const step       = totalAngle / Math.max(text.length - 1, 1);
      const fs         = Math.min(28, Math.max(14, (radius * Math.abs(totalAngle)) / Math.max(text.length, 1) * 0.9));
      ctx.font         = `bold ${fs}px Arial`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'bottom';

      for (let i = 0; i < text.length; i++) {
        const angle = startAngle + i * step;
        ctx.save();
        ctx.translate(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
        ctx.rotate(angle + (flip ? -Math.PI / 2 : Math.PI / 2));
        ctx.fillText(text[i], 0, 0);
        ctx.restore();
      }
    }

    // ── Extract modal ────────────────────────────────────────────────
    _openExtractModal() {
      if (!this.pdfDoc) return;
      const modal = document.getElementById('extractModal');
      const grid  = document.getElementById('extractGrid');
      grid.innerHTML = '';

      for (let i = 1; i <= this.totalPages; i++) {
        const item = document.createElement('div');
        item.className    = 'extract-page-item';
        item.dataset.page = i;
        if (i === this.currentPage) item.classList.add('selected');

        const cvs    = document.createElement('canvas');
        const numEl  = document.createElement('span');
        numEl.className   = 'extract-page-num';
        numEl.textContent = 'Page ' + i;
        item.appendChild(cvs);
        item.appendChild(numEl);
        grid.appendChild(item);

        item.addEventListener('click', () => item.classList.toggle('selected'));

        this.pdfDoc.getPage(i).then(pg => {
          const vp = pg.getViewport({ scale: 64 / pg.getViewport({ scale: 1 }).width });
          cvs.width  = vp.width;
          cvs.height = vp.height;
          pg.render({ canvasContext: cvs.getContext('2d'), viewport: vp });
        });
      }

      modal.style.display = 'flex';
    }

    _bindExtractModal() {
      const modal = document.getElementById('extractModal');
      if (!modal) return;

      document.getElementById('extractSelAll').addEventListener('click', () => {
        modal.querySelectorAll('.extract-page-item').forEach(el => el.classList.add('selected'));
      });
      document.getElementById('extractSelNone').addEventListener('click', () => {
        modal.querySelectorAll('.extract-page-item').forEach(el => el.classList.remove('selected'));
      });
      document.getElementById('extractSelCurrent').addEventListener('click', () => {
        modal.querySelectorAll('.extract-page-item').forEach(el =>
          el.classList.toggle('selected', parseInt(el.dataset.page, 10) === this.currentPage));
      });
      document.getElementById('extractOkBtn').addEventListener('click', () => {
        const pages = [...modal.querySelectorAll('.extract-page-item.selected')]
          .map(el => parseInt(el.dataset.page, 10));
        modal.style.display = 'none';
        this._extractPages(pages);
      });
      document.getElementById('extractCancelBtn').addEventListener('click', () => {
        modal.style.display = 'none';
      });
      document.getElementById('extractModalClose').addEventListener('click', () => {
        modal.style.display = 'none';
      });
    }

    // ── Scanner modal ────────────────────────────────────────────────
    _openScannerModal() {
      this.scannerFiles = [];
      document.getElementById('scannerGrid').innerHTML = '';
      document.getElementById('scannerOpts').style.display  = 'none';
      document.getElementById('scannerCreateBtn').disabled  = true;
      document.getElementById('scannerModal').style.display = 'flex';
    }

    _bindScannerModal() {
      const modal = document.getElementById('scannerModal');
      if (!modal) return;

      const dropZone = document.getElementById('scannerDropZone');
      const input    = document.getElementById('scannerInput');

      document.getElementById('scannerSelectBtn').addEventListener('click', () => input.click());
      dropZone.addEventListener('click', e => { if (e.target === dropZone || e.target.tagName === 'P') input.click(); });
      dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
      dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
      dropZone.addEventListener('drop', e => {
        e.preventDefault(); dropZone.classList.remove('drag-over');
        this._addScannerFiles([...e.dataTransfer.files].filter(f => f.type.startsWith('image/')));
      });
      input.addEventListener('change', e => {
        this._addScannerFiles([...e.target.files]);
        e.target.value = '';
      });

      document.getElementById('scannerCreateBtn').addEventListener('click', () => {
        const pageSize = document.getElementById('scannerPageSize').value;
        modal.style.display = 'none';
        this._createFromScanner([...this.scannerFiles], pageSize);
      });
      document.getElementById('scannerCancelBtn').addEventListener('click', () => {
        modal.style.display = 'none';
      });
      document.getElementById('scannerModalClose').addEventListener('click', () => {
        modal.style.display = 'none';
      });
    }

    _addScannerFiles(files) {
      this.scannerFiles.push(...files);
      this._renderScannerGrid();
    }

    _renderScannerGrid() {
      const grid = document.getElementById('scannerGrid');
      grid.innerHTML = '';
      this.scannerFiles.forEach((file, idx) => {
        const item  = document.createElement('div');
        item.className = 'scanner-page-item';

        const img     = document.createElement('img');
        img.src       = URL.createObjectURL(file);
        img.onload    = () => URL.revokeObjectURL(img.src);
        img.alt       = 'Page ' + (idx + 1);

        const num    = document.createElement('div');
        num.className = 'scanner-page-num';
        num.textContent = idx + 1;

        const rm = document.createElement('button');
        rm.className = 'scanner-remove';
        rm.textContent = '×';
        rm.addEventListener('click', e => {
          e.stopPropagation();
          this.scannerFiles.splice(idx, 1);
          this._renderScannerGrid();
        });

        item.appendChild(img);
        item.appendChild(num);
        item.appendChild(rm);
        grid.appendChild(item);
      });

      const hasFiles = this.scannerFiles.length > 0;
      document.getElementById('scannerOpts').style.display    = hasFiles ? 'flex' : 'none';
      document.getElementById('scannerCreateBtn').disabled     = !hasFiles;
    }

    _createToast() {
      const el       = document.createElement('div');
      el.className   = 'toast';
      document.body.appendChild(el);
      return el;
    }

    _toast(msg, type) {
      clearTimeout(this._toastTimer);
      this.toastEl.textContent = msg;
      this.toastEl.className   = 'toast' + (type ? ' ' + type : '');
      void this.toastEl.offsetWidth;
      this.toastEl.classList.add('show');
      this._toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), 3000);
    }
  }

})();
