// ── Cart state ───────────────────────────────────────────────────────────────
let cart = JSON.parse(localStorage.getItem('cart') || '[]');

function saveCart() { localStorage.setItem('cart', JSON.stringify(cart)); }

function updateCartBadge() {
  const count = cart.reduce((s, i) => s + i.qty, 0);
  document.querySelectorAll('.cart-badge').forEach(el => {
    el.textContent = count;
    el.style.display = count > 0 ? 'flex' : 'none';
  });
}

function addToCart(id, name, price, qty = 1) {
  const existing = cart.find(i => i.id === id);
  if (existing) existing.qty += qty;
  else cart.push({ id, name, price, qty });
  saveCart(); updateCartBadge();
  showToast(`เพิ่ม "${name}" ลงตะกร้าแล้ว`);
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  Object.assign(t.style, {
    position: 'fixed', bottom: '1.5rem', right: '1.5rem', zIndex: 9999,
    background: type === 'success' ? '#10b981' : '#ef4444', color: '#fff',
    padding: '.75rem 1.25rem', borderRadius: '10px', fontWeight: '600',
    fontSize: '.9rem', boxShadow: '0 4px 16px rgba(0,0,0,.15)',
    animation: 'fadeInUp .25s ease',
  });
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2800);
}

// ── Mobile nav ────────────────────────────────────────────────────────────────
function initNav() {
  const ham = document.querySelector('.hamburger');
  const nav = document.querySelector('.navbar-nav');
  if (!ham || !nav) return;
  ham.addEventListener('click', () => nav.classList.toggle('open'));
  document.addEventListener('click', e => {
    if (!ham.contains(e.target) && !nav.contains(e.target)) nav.classList.remove('open');
  });
}

// ── Password toggle ───────────────────────────────────────────────────────────
function initPasswordToggles() {
  document.querySelectorAll('.toggle-pw').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = btn.closest('.password-wrapper').querySelector('input');
      if (input.type === 'password') { input.type = 'text'; btn.textContent = '🙈'; }
      else { input.type = 'password'; btn.textContent = '👁'; }
    });
  });
}

// ── Quantity controls ─────────────────────────────────────────────────────────
function initQtyControls() {
  document.querySelectorAll('.qty-control').forEach(ctrl => {
    const minus = ctrl.querySelector('[data-action="minus"]');
    const plus = ctrl.querySelector('[data-action="plus"]');
    const val = ctrl.querySelector('.qty-val');
    if (!val) return;
    minus?.addEventListener('click', () => {
      const v = Math.max(1, parseInt(val.textContent) - 1);
      val.textContent = v; ctrl.dispatchEvent(new CustomEvent('change', { detail: v }));
    });
    plus?.addEventListener('click', () => {
      const v = parseInt(val.textContent) + 1;
      val.textContent = v; ctrl.dispatchEvent(new CustomEvent('change', { detail: v }));
    });
  });
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tabs').forEach(tabBar => {
    tabBar.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        tabBar.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const target = btn.dataset.tab;
        document.querySelectorAll('.tab-content').forEach(c => {
          c.classList.toggle('active', c.dataset.tab === target);
        });
      });
    });
  });
}

// ── FAQ accordion ─────────────────────────────────────────────────────────────
function initFaq() {
  document.querySelectorAll('.faq-question').forEach(q => {
    q.addEventListener('click', () => {
      const item = q.closest('.faq-item');
      item.classList.toggle('open');
    });
  });
}

// ── Shipping method selection ─────────────────────────────────────────────────
function initShippingOpts() {
  document.querySelectorAll('.shipping-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.shipping-opt').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      const radio = opt.querySelector('input[type="radio"]');
      if (radio) radio.checked = true;
    });
  });
}

// ── Payment method selection ──────────────────────────────────────────────────
function initPaymentOpts() {
  document.querySelectorAll('.payment-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.payment-opt').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      const radio = opt.querySelector('input[type="radio"]');
      if (radio) radio.checked = true;
    });
  });
}

// ── Category tabs (blog) ──────────────────────────────────────────────────────
function initCatTabs() {
  document.querySelectorAll('.cat-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
    });
  });
}

// ── Dashboard line chart ──────────────────────────────────────────────────────
function drawLineChart(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight;

  const labels = ['1 พ.ค.', '8 พ.ค.', '15 พ.ค.', '22 พ.ค.', '29 พ.ค.'];
  const revenue = [600000, 850000, 750000, 1100000, 1250000];
  const expense = [400000, 500000, 420000, 650000, 700000];

  const W = canvas.width, H = canvas.height;
  const pad = { top: 20, right: 20, bottom: 40, left: 70 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;

  const maxVal = Math.max(...revenue) * 1.15;
  const xStep = chartW / (labels.length - 1);

  function xPos(i) { return pad.left + i * xStep; }
  function yPos(v) { return pad.top + chartH - (v / maxVal) * chartH; }

  ctx.clearRect(0, 0, W, H);

  // Grid lines
  ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const y = pad.top + (chartH / 5) * i;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    ctx.fillStyle = '#94a3b8'; ctx.font = '11px system-ui'; ctx.textAlign = 'right';
    const val = Math.round(maxVal * (1 - i / 5) / 1000);
    ctx.fillText(val + 'K', pad.left - 8, y + 4);
  }

  // X labels
  ctx.textAlign = 'center'; ctx.fillStyle = '#94a3b8'; ctx.font = '11px system-ui';
  labels.forEach((l, i) => ctx.fillText(l, xPos(i), H - 8));

  // Draw line helper
  function drawLine(data, color, fillColor) {
    ctx.beginPath();
    data.forEach((v, i) => { if (i === 0) ctx.moveTo(xPos(i), yPos(v)); else ctx.lineTo(xPos(i), yPos(v)); });
    ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.stroke();
    // Fill
    ctx.lineTo(xPos(data.length - 1), pad.top + chartH);
    ctx.lineTo(pad.left, pad.top + chartH); ctx.closePath();
    ctx.fillStyle = fillColor; ctx.fill();
    // Dots
    data.forEach((v, i) => {
      ctx.beginPath(); ctx.arc(xPos(i), yPos(v), 4, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    });
  }

  drawLine(revenue, '#2563eb', 'rgba(37,99,235,.08)');
  drawLine(expense, '#10b981', 'rgba(16,185,129,.06)');

  // Legend
  ctx.fillStyle = '#2563eb'; ctx.fillRect(pad.left, 6, 12, 3);
  ctx.fillStyle = '#1e293b'; ctx.font = '11px system-ui'; ctx.textAlign = 'left';
  ctx.fillText('รายได้', pad.left + 16, 12);
  ctx.fillStyle = '#10b981'; ctx.fillRect(pad.left + 65, 6, 12, 3);
  ctx.fillStyle = '#1e293b'; ctx.fillText('ค่าใช้จ่าย', pad.left + 81, 12);
}

// ── Dashboard donut chart ─────────────────────────────────────────────────────
function drawDonutChart(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight;

  const data = [
    { label: 'ออนไลน์', value: 45, color: '#2563eb' },
    { label: 'หน้าร้าน', value: 30, color: '#10b981' },
    { label: 'แอกเท็น', value: 15, color: '#f59e0b' },
    { label: 'อื่นๆ', value: 10, color: '#e2e8f0' },
  ];

  const W = canvas.width, H = canvas.height;
  const cx = W * .42, cy = H / 2, r = Math.min(W, H) * .36, ir = r * .58;
  let angle = -Math.PI / 2;

  ctx.clearRect(0, 0, W, H);

  data.forEach(d => {
    const slice = (d.value / 100) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, angle, angle + slice);
    ctx.fillStyle = d.color; ctx.fill();
    angle += slice;
  });

  // Hole
  ctx.beginPath(); ctx.arc(cx, cy, ir, 0, Math.PI * 2);
  ctx.fillStyle = '#fff'; ctx.fill();

  // Center text
  ctx.fillStyle = '#1e293b'; ctx.font = 'bold 20px system-ui'; ctx.textAlign = 'center';
  ctx.fillText('2,340', cx, cy + 2);
  ctx.font = '11px system-ui'; ctx.fillStyle = '#94a3b8';
  ctx.fillText('ยอดรวม', cx, cy + 18);

  // Legend
  let ly = H * .2;
  data.forEach(d => {
    ctx.fillStyle = d.color; ctx.fillRect(W * .72, ly, 12, 12);
    ctx.fillStyle = '#1e293b'; ctx.font = '12px system-ui'; ctx.textAlign = 'left';
    ctx.fillText(`${d.label}  ${d.value}%`, W * .72 + 18, ly + 10);
    ly += 28;
  });
}

// ── Cart page specific ────────────────────────────────────────────────────────
function initCartPage() {
  const rows = document.querySelectorAll('.cart-row');
  function recalc() {
    let sub = 0;
    rows.forEach(row => {
      const price = parseFloat(row.dataset.price || 0);
      const qty = parseInt(row.querySelector('.qty-val')?.textContent || 1);
      const total = price * qty;
      const totalEl = row.querySelector('.row-total');
      if (totalEl) totalEl.textContent = '฿' + total.toLocaleString();
      sub += total;
    });
    const shipping = 50;
    const grand = sub + shipping;
    const subtotalEl = document.getElementById('cart-subtotal');
    const grandEl = document.getElementById('cart-grand');
    if (subtotalEl) subtotalEl.textContent = '฿' + sub.toLocaleString();
    if (grandEl) grandEl.textContent = '฿' + grand.toLocaleString();
  }

  rows.forEach(row => {
    row.querySelector('.qty-control')?.addEventListener('change', recalc);
    row.querySelector('.delete-btn')?.addEventListener('click', () => {
      row.remove(); recalc();
    });
  });
  recalc();

  const promoBtn = document.getElementById('apply-promo');
  if (promoBtn) promoBtn.addEventListener('click', () => {
    const code = document.getElementById('promo-input')?.value.trim().toUpperCase();
    if (code === 'SAVE10') showToast('ใช้โค้ดส่วนลด 10% สำเร็จ!');
    else showToast('โค้ดไม่ถูกต้อง', 'error');
  });
}

// ── Form validation ───────────────────────────────────────────────────────────
function initForms() {
  document.querySelectorAll('form.validate').forEach(form => {
    form.addEventListener('submit', e => {
      e.preventDefault();
      const inputs = form.querySelectorAll('[required]');
      let valid = true;
      inputs.forEach(input => {
        if (!input.value.trim()) { input.style.borderColor = '#ef4444'; valid = false; }
        else input.style.borderColor = '';
      });
      if (valid) showToast(form.dataset.success || 'ส่งข้อมูลสำเร็จ!');
    });
  });
}

// ── CSS animation keyframe ────────────────────────────────────────────────────
const style = document.createElement('style');
style.textContent = `@keyframes fadeInUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }`;
document.head.appendChild(style);

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  updateCartBadge();
  initNav();
  initPasswordToggles();
  initQtyControls();
  initTabs();
  initFaq();
  initShippingOpts();
  initPaymentOpts();
  initCatTabs();
  initCartPage();
  initForms();
  // Charts
  drawLineChart('lineChart');
  drawDonutChart('donutChart');
  // Resize charts
  window.addEventListener('resize', () => {
    drawLineChart('lineChart');
    drawDonutChart('donutChart');
  });
});
