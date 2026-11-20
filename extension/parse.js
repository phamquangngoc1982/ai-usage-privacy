'use strict';

function parseUsage(input) {
  const lines = input.split(/\n/).map(line => line.trim().replace(/\s+/g, ' ')).filter(Boolean);
  const period = /^(?:\b(?:current session|current week|session limit|weekly(?: usage)?(?: limits?)?|monthly(?: usage)?(?: limits?)?|daily(?: usage)?(?: limits?)?|all models|sonnet only|opus only|fable only|(?:5[ -]?h(?:ours?)?|five[ -]hours?)(?: usage)?(?: limits?| window)?|(?:7[ -]?d(?:ays?)?|seven[ -]days?)(?: usage)?(?: limits?| window)?|remaining usage|usage allowance|fast|thinking|pro|flash(?:-lite)?|deep research|image generation|video generation)\b|phiên hiện tại|giới hạn (?:theo |hằng )?(?:tuần|tháng|ngày|5 giờ)|(?:mức )?sử dụng (?:hằng |theo )?(?:tuần|tháng|ngày)|(?:tất cả|mọi) mô hình|(?:hạn mức |giới hạn |mức sử dụng )?(?:5 giờ|7 ngày)(?: sử dụng)?|hạn mức (?:theo )?(?:tuần|tháng|ngày)|tuần này)/iu;
  const percentage = /(?<![\d.,])(\d{1,3}(?:[.,]\d+)?)\s*%/g;
  const used = /\bused\b|đã (?:dùng|sử dụng|tiêu thụ)/iu;
  const left = /\b(?:left|remaining|available)\b|còn lại/iu;
  const reset = /^(?:resets?\b|refresh(?:es)?\b|next reset\b|renews?\b|(?:đặt lại|làm mới|khôi phục)(?:\s|$))/iu;
  const status = /(?:limit reached|reached (?:your|the) limit|close to (?:your|the) limit|đã (?:chạm|đạt|hết) giới hạn|sắp (?:hết|chạm|đạt) (?:hạn mức|giới hạn))/iu;
  const rows = [];
  let name = 'Hạn mức hiển thị';
  let resetsAt = '';

  function add(row) {
    const existing = rows.find(item => item.label === row.label);
    if (!existing) rows.push(row);
    else {
      existing.reset ||= row.reset;
      existing.note ||= row.note;
      if (row.percent === null) return;
      if (existing.percent !== null && existing.percent !== row.percent) {
        existing.percent = null;
        existing.note = 'Có nhiều giá trị cho mục này. Hãy đối chiếu trang Usage.';
        existing.ambiguous = true;
      } else if (!existing.ambiguous) existing.percent = row.percent;
    }
  }

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.length > 150) continue;
    const title = line.match(period)?.[0];
    const tail = title ? line.slice(title.length).trim().replace(/^[:–—-]\s*/, '') : line;
    if (title && (!tail || /^(?:\d|used\b|remaining\b|đã dùng|còn lại)/iu.test(tail))) {
      name = title;
      resetsAt = '';
    }
    if (reset.test(line)) {
      const row = rows.find(item => item.label === name);
      if (row && !row.reset) row.reset = line;
      if (!row && name !== 'Hạn mức hiển thị') add({label: name, percent: null, reset: line, note: ''});
      resetsAt = line;
      continue;
    }
    for (const match of tail.matchAll(percentage)) {
      const start = match.index;
      const end = start + match[0].length;
      const terms = 'used|left|remaining|available|đã dùng|đã sử dụng|đã tiêu thụ|còn lại';
      const after = tail.slice(end).match(new RegExp(`^\\s*[:–—-]?\\s*(${terms})(?![\\p{L}])`, 'iu'))?.[1];
      const before = tail.slice(0, start).match(new RegExp(`(?:^|\\s)(${terms})\\s*[:–—-]?\\s*$`, 'iu'))?.[1];
      const separate = tail === match[0]
        ? [lines[index + 1], lines[index - 1]].find(line => line && new RegExp(`^(?:${terms})$`, 'iu').test(line))
        : '';
      const direction = after || before || separate;
      const value = Number(match[1].replace(',', '.'));
      if (!direction || value > 100) continue;
      const inlineReset = tail.slice(end).match(/(?:^|[·(,–—]\s*)((?:resets?\b|đặt lại|làm mới)[^)]*)/iu)?.[1] || '';
      const adjacentReset = lines[index + 1] && reset.test(lines[index + 1]) ? lines[index + 1] : '';
      add({label: name, percent: used.test(direction) ? value : left.test(direction) ? Math.round((100 - value) * 100) / 100 : null, reset: resetsAt || inlineReset || adjacentReset, note: ''});
    }
    const count = /^(?:(?:used|remaining|đã dùng|còn lại)\s*:?\s*)?\d[\d.,]*\s*(?:\/|of|trên)\s*\d[\d.,]*(?:\s+[\p{L} ]+)?$/iu;
    if (status.test(line) || count.test(tail)) {
      add({label: name, percent: null, reset: resetsAt, note: count.test(tail) ? tail : line});
    }
  }
  return rows.slice(0, 12).map(({label, percent, reset, note}) => ({label, percent, reset, note}));
}

if (typeof module !== 'undefined') module.exports = {parseUsage};

function parseAdditionalUsage(key, input) {
  const lines = input.split('\n').map(line => line.trim()).filter(Boolean);
  const rows = [];
  const number = value => Number(value.replaceAll(',', ''));
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const adjacent = [line, lines[i + 1]].filter(Boolean).join(' ');
    const copilot = key !== 'copilot' || /ai credits?/i.test(line);
    const count = line.match(/^(?:used\s+)?([\d,.]+)\s*(?:\/|of)\s*([\d,.]+)\s+((?:AI\s+)?credits?|ACUs?)\s*(?:used)?$/i);
    const amount = line.match(/^([\d,.]+)\s+((?:AI\s+)?credits?|ACUs?)\s+(?:used|remaining|left|available)$/i)
      || adjacent.match(/^(?:credits? (?:used|remaining|available)|available credits?|remaining credits?)\s*:?\s*([\d,.]+)$/i);
    if (count && copilot) {
      const used = number(count[1]);
      const total = number(count[2]);
      if (total > 0 && used >= 0 && used <= total) {
        rows.push({label: 'Hạn mức', percent: Math.round(used / total * 10000) / 100, reset: '', note: line});
      }
    } else if (amount && copilot && Number.isFinite(number(amount[1]))) {
      rows.push({label: 'Credit', percent: null, reset: '', note: amount[0]});
    }
  }
  if (key === 'grok') {
    input = input.replace(/^Weekly SuperGrok Limit\s*$/gim, 'Weekly limit');
  }
  const percentages = key === 'copilot' ? [] : parseUsage(input).filter(row => row.percent !== null);
  return [...percentages, ...rows.filter((row, index) => rows.findIndex(other => other.note === row.note) === index)].slice(0, 12);
}
