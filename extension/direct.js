'use strict';

const directProviders = ['chatgpt', 'claude'];
const usageFormatter = new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh'
});

async function usageJson(origin, path, headers = {}) {
  const response = await fetch(origin + path, {
    credentials: 'include', redirect: 'error', cache: 'no-store',
    headers: {Accept: 'application/json', ...headers},
    signal: AbortSignal.timeout(2500)
  });
  return response.ok ? response.json() : null;
}

function usageRow(label, percent, resetAt) {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return null;
  const instant = new Date(resetAt ?? NaN);
  const reset = Number.isNaN(instant.getTime()) ? '' : 'Đặt lại ' + usageFormatter.format(instant);
  return {label, percent, reset, note: ''};
}

function codexRows(data) {
  const limits = data?.rate_limit;
  return [limits?.primary_window, limits?.secondary_window].flatMap((item, index) => {
    if (!item) return [];
    const duration = item.limit_window_seconds;
    const label = duration === 18000 ? 'Giới hạn 5 giờ'
      : duration === 604800 ? 'Giới hạn hằng tuần' : index ? 'Hạn mức phụ' : 'Hạn mức chính';
    const row = usageRow(label, item.used_percent,
      Number.isFinite(item.reset_at) ? item.reset_at * 1000 : null);
    return row ? [row] : [];
  });
}

async function fetchCodexUsage(origin) {
  const session = await usageJson(origin, '/api/auth/session');
  if (!session?.accessToken || typeof session.accessToken !== 'string') return [];
  const headers = {Authorization: 'Bearer ' + session.accessToken};
  if (typeof session.account?.id === 'string') headers['ChatGPT-Account-Id'] = session.account.id;
  return codexRows(await usageJson(origin, '/backend-api/wham/usage', headers));
}

async function fetchClaudeUsage(origin) {
  const organizations = await usageJson(origin, '/api/organizations');
  // Use the webpage when the active organization cannot be inferred safely.
  if (!Array.isArray(organizations) || organizations.length !== 1) return [];
  const id = organizations[0]?.uuid;
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return [];
  const limits = await usageJson(origin, '/api/organizations/' + id + '/usage');
  const labels = {
    five_hour: 'Phiên 5 giờ', seven_day: 'Giới hạn hằng tuần',
    seven_day_sonnet: 'Sonnet · Tuần', seven_day_opus: 'Opus · Tuần',
    seven_day_fable: 'Fable · Tuần', seven_day_cowork: 'Cowork · Tuần'
  };
  return Object.entries(labels).flatMap(([key, label]) => {
    const item = limits?.[key];
    const row = item && usageRow(label, item.utilization, item.resets_at);
    return row ? [row] : [];
  });
}

async function fetchDirectUsage(key) {
  if (!directProviders.includes(key)) return [];
  try {
    const {origin} = providers[key];
    return await (key === 'chatgpt' ? fetchCodexUsage(origin) : fetchClaudeUsage(origin));
  } catch {
    return [];
  }
}
