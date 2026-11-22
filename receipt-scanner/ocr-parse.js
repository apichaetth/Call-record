/*
 * Pull receipt fields out of raw OCR text (Thai + English receipts).
 * Every value is a best guess: the user reviews and edits before sending.
 * Works in the browser (window.parseReceipt) and in Node (module.exports) for tests.
 */
(function (root) {
  'use strict';

  const THAI = '฀-๿';
  // Our own company appears on bills as the buyer; never take it as the vendor.
  const OWN_COMPANY = /poco|โพโค/i;

  const THAI_MONTHS = [
    ['มกราคม', 'ม.ค.'], ['กุมภาพันธ์', 'ก.พ.'], ['มีนาคม', 'มี.ค.'], ['เมษายน', 'เม.ย.'],
    ['พฤษภาคม', 'พ.ค.'], ['มิถุนายน', 'มิ.ย.'], ['กรกฎาคม', 'ก.ค.'], ['สิงหาคม', 'ส.ค.'],
    ['กันยายน', 'ก.ย.'], ['ตุลาคม', 'ต.ค.'], ['พฤศจิกายน', 'พ.ย.'], ['ธันวาคม', 'ธ.ค.'],
  ];
  const EN_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  // Tesseract often puts spaces between Thai characters; join them back.
  function joinThai(s) {
    const re = new RegExp('([' + THAI + '])\\s+(?=[' + THAI + '])', 'g');
    return s.replace(re, '$1');
  }

  function normalizeLines(text) {
    return String(text || '')
      .replace(/\r/g, '')
      .split('\n')
      .map(l => joinThai(l).replace(/[ \t]+/g, ' ').trim())
      .filter(Boolean);
  }

  const AMOUNT_RE = /\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{2}(?!\d)|\d+(?=\s*(?:บาท|thb|฿)\b)/gi;

  function amountsIn(line) {
    const out = [];
    // OCR reads "1,234.50" as "1,234 .50" or "1 234.50" sometimes; tidy before matching.
    const cleaned = line.replace(/(\d)\s+\.(\d{2})/g, '$1.$2').replace(/(\d)\s(\d{3})(?=[.,]\d{2})/g, '$1$2');
    let m;
    AMOUNT_RE.lastIndex = 0;
    while ((m = AMOUNT_RE.exec(cleaned))) {
      const v = parseFloat(m[0].replace(/,/g, ''));
      if (!isNaN(v)) out.push(v);
    }
    return out;
  }

  const TOTAL_TIERS = [
    /ยอดสุทธิ|รวมสุทธิ|จำนวนเงินสุทธิ|ยอดเงินสุทธิ|รวมทั้งสิ้น|รวมเงินทั้งสิ้น|ยอดชำระ|ยอดที่ต้องชำระ|grand\s*total|net\s*total|net\s*amount|total\s*amount|amount\s*due|total\s*due/i,
    /ยอดรวม|รวมเงิน|จำนวนเงินรวม|รวม|total/i,
  ];
  const NOT_TOTAL = /ก่อนภาษี|ก่อน\s*vat|ไม่รวม|sub\s*-?\s*total|ภาษีมูลค่าเพิ่ม|^\s*vat|ส่วนลด|discount|จำนวน\s*(ชิ้น|รายการ)|qty|items?\b/i;

  function findTotal(lines) {
    for (const tier of TOTAL_TIERS) {
      const hits = [];
      lines.forEach((line, i) => {
        if (!tier.test(line) || (tier === TOTAL_TIERS[1] && NOT_TOTAL.test(line))) return;
        let a = amountsIn(line);
        if (!a.length && lines[i + 1]) a = amountsIn(lines[i + 1]);
        if (a.length) hits.push(a[a.length - 1]);
      });
      if (hits.length) return Math.max(...hits);
    }
    // Fallback: the largest money-looking number on the receipt.
    const all = lines.flatMap(amountsIn).filter(v => v < 10000000);
    return all.length ? Math.max(...all) : null;
  }

  function findVat(lines) {
    for (const line of lines) {
      if (!/ภาษีมูลค่าเพิ่ม|\bvat\b|ภาษี\s*7/i.test(line)) continue;
      if (/ก่อน|ไม่รวม|before|excl/i.test(line)) continue;
      const a = amountsIn(line).filter(v => v !== 7 && v !== 7.0);
      if (a.length) return a[a.length - 1];
    }
    return null;
  }

  function validThaiTaxId(id) {
    if (!/^\d{13}$/.test(id)) return false;
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(id[i]) * (13 - i);
    return (11 - (sum % 11)) % 10 === Number(id[12]);
  }

  function findTaxId(lines) {
    const candidates = [];
    lines.forEach((line, i) => {
      const re = /(?:\d[\s-]?){12}\d/g;
      let m;
      while ((m = re.exec(line))) {
        const id = m[0].replace(/[\s-]/g, '');
        if (id.length !== 13) continue;
        const labelled = /ผู้เสียภาษี|เลขประจำตัว|tax\s*id|tax\s*no|เลขที่ภาษี/i.test(line) ||
          (i > 0 && /ผู้เสียภาษี|tax\s*id/i.test(lines[i - 1]));
        const ctx = lines.slice(Math.max(0, i - 1), i + 1).join(' ');
        candidates.push({ id, score: (validThaiTaxId(id) ? 2 : 0) + (labelled ? 1 : 0) - (OWN_COMPANY.test(ctx) ? 3 : 0), i });
      }
    });
    if (!candidates.length) return '';
    candidates.sort((a, b) => b.score - a.score || a.i - b.i);
    return candidates[0].id;
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function toIsoDate(d, m, y) {
    d = Number(d); m = Number(m); y = Number(y);
    if (y < 100) y = y >= 40 ? 2500 + y : 2000 + y; // 2-digit Thai receipts are usually B.E. (69 = 2569)
    if (y > 2400) y -= 543; // Buddhist Era -> Common Era
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return '';
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1) return '';
    return y + '-' + pad(m) + '-' + pad(d);
  }

  function findDate(lines) {
    const prefer = lines.filter(l => /วันที่|date|ลงวันที่/i.test(l));
    const order = prefer.concat(lines);
    for (const line of order) {
      let m = line.match(/(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{4}|\d{2})(?!\d)/);
      if (m) { const iso = toIsoDate(m[1], m[2], m[3]); if (iso) return iso; }
      m = line.match(/(\d{4})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{1,2})(?!\d)/);
      if (m) { const iso = toIsoDate(m[3], m[2], m[1]); if (iso) return iso; }
      for (let i = 0; i < 12; i++) {
        const [full, abbr] = THAI_MONTHS[i];
        const abbrNoDots = abbr.replace(/\./g, '\\.?\\s?');
        const re = new RegExp('(\\d{1,2})\\s*(?:' + full + '|' + abbrNoDots + ')\\s*(\\d{4}|\\d{2})(?!\\d)');
        m = line.match(re);
        if (m) { const iso = toIsoDate(m[1], i + 1, m[2]); if (iso) return iso; }
      }
      m = line.match(/(\d{1,2})[\s\-]*([a-z]{3})[a-z]*[\s\-,]*(\d{4}|\d{2})(?!\d)/i);
      if (m && EN_MONTHS.includes(m[2].toLowerCase())) {
        const iso = toIsoDate(m[1], EN_MONTHS.indexOf(m[2].toLowerCase()) + 1, m[3]);
        if (iso) return iso;
      }
    }
    return '';
  }

  function findReceiptNo(lines) {
    for (const line of lines) {
      if (!/เลขที่|เล่มที่|receipt\s*no|invoice\s*no|inv\.?\s*no|\bno\.|doc(?:ument)?\s*no|bill\s*no/i.test(line)) continue;
      if (/ผู้เสียภาษี|tax\s*id|โทร|tel|สาขา/i.test(line)) continue;
      const after = line.split(/เลขที่|เล่มที่|receipt\s*no\.?|invoice\s*no\.?|inv\.?\s*no\.?|\bno\.|doc(?:ument)?\s*no\.?|bill\s*no\.?/i).pop();
      const m = after && after.match(/[A-Za-z0-9][A-Za-z0-9\-\/_.]{2,}/);
      if (m) return m[0].replace(/[.]$/, '');
    }
    return '';
  }

  const NOT_VENDOR = /ใบเสร็จ|ใบกำกับ|receipt|tax\s*invoice|invoice|ต้นฉบับ|สำเนา|copy|original|วันที่|date|เลขที่|โทร|tel|ที่อยู่|^\W*$/i;

  function findVendor(lines) {
    const head = lines.slice(0, 10);
    const company = head.find(l => /บริษัท|บจก|ห้างหุ้นส่วน|หจก|co\.?,?\s*ltd|limited|company|ร้าน/i.test(l) && !OWN_COMPANY.test(l));
    if (company) return tidyVendor(company);
    const first = head.find(l => !NOT_VENDOR.test(l) && !OWN_COMPANY.test(l) && (l.match(new RegExp('[A-Za-z' + THAI + ']', 'g')) || []).length >= 3);
    return first ? tidyVendor(first) : '';
  }

  function tidyVendor(s) {
    return s.replace(/\s*\(?\s*(สำนักงานใหญ่|head\s*office|สาขา[^)]*)\s*\)?\s*$/i, '').replace(/^[^A-Za-z0-9฀-๿]+|[^A-Za-z0-9฀-๿.)]+$/g, '').slice(0, 80);
  }

  function parseReceipt(text) {
    const lines = normalizeLines(text);
    const total = findTotal(lines);
    const vat = findVat(lines);
    return {
      vendor: findVendor(lines),
      date: findDate(lines),
      total: total == null ? '' : total.toFixed(2),
      vat: vat == null ? '' : vat.toFixed(2),
      taxId: findTaxId(lines),
      receiptNo: findReceiptNo(lines),
    };
  }

  const api = { parseReceipt, validThaiTaxId, toIsoDate, normalizeLines };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ReceiptParse = api;
})(this);
