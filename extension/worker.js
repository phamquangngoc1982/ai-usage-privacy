'use strict';

importScripts('providers.js', 'parse.js', 'direct.js');

let activeRefresh;
let backgroundRefresh;
let catalogQueue = Promise.resolve();

function inCatalogOrder(task) {
  const result = catalogQueue.then(task);
  catalogQueue = result.catch(() => {});
  return result;
}

async function selectedServices() {
  const {selectedServices: saved} = await chrome.storage.local.get('selectedServices');
  return visibleServices(saved);
}

function changeCatalog(key, add) {
  return inCatalogOrder(async () => {
    const keys = await selectedServices();
    if (add) {
      if (!keys.includes(key)) await chrome.storage.local.set({selectedServices: [...keys, key]});
    } else {
      await chrome.storage.local.set({selectedServices: keys.filter(item => item !== key)});
      await chrome.storage.local.remove([key, key + 'Status']);
      await chrome.permissions.remove(permissionFor(key));
    }
    return {ok: true};
  });
}

function probeUsage(key, navigate, provider) {
  const visible = node => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
  const matching = (selector, pattern) => [...document.querySelectorAll(selector)]
    .filter(visible).find(node => [node.innerText, node.getAttribute('aria-label'), node.getAttribute('title')]
      .some(value => value && pattern.test(value.trim())));
  const title = /usage limits|usage & billing|^usage$|mức sử dụng|hạn mức|giới hạn sử dụng/iu;
  const panel = [...document.querySelectorAll('[role="dialog"], dialog[open]')].filter(visible)
    .find(node => node.innerText.split('\n').some(line => title.test(line.trim())));
  const main = document.querySelector('main, [role="main"]') || document.body;
  const path = location.pathname.replace(/\/$/, '');
  const knownPath = key === 'claude' && path === '/settings/usage'
    || key === 'chatgpt' && ['/settings/usage', '/codex/settings/usage'].includes(path)
    || key === 'gemini' && /^\/app\/usage(?:-limits)?$/.test(path)
    || provider.extra && [provider.path, provider.alternatePath].includes(path + location.hash);
  const signIn = /\/(?:login|signin|sign-in|auth)(?:\/|$)/i.test(path) ||
    !!matching('a, button', /^(?:log in|sign in|đăng nhập)$/iu);
  const heading = matching('h1, h2, h3, [role="heading"]', title);
  if (provider.menu && navigate && !signIn) {
    const control = matching('a, button, [role="tab"], [role="menuitem"]',
      /^(?:usage|spending|usage & billing|mức sử dụng)$/iu);
    if (control && !control.matches('[aria-selected="true"], [aria-current="page"]')) {
      control.click();
      return {step: 'usage'};
    }
  }
  const root = panel || (knownPath && main) || (heading && heading.closest('section, [role="region"]'));
  if (root?.innerText) {
    const value = root.innerText.slice(0, 16000);
    if (panel || knownPath || heading) return {text: value, signIn};
  }
  if (key === 'gemini' && !signIn && navigate) {
    const selector = 'button, a, [role="menuitem"], [role="button"]';
    const usage = matching(selector, /^(?:usage limits|giới hạn sử dụng|hạn mức sử dụng)$/iu);
    if (usage) {
      usage.click();
      return {step: 'usage'};
    }
    const settings = matching(selector, /^(?:settings(?: (?:and|&) help)?|cài đặt(?: và trợ giúp)?)$/iu);
    if (settings && settings.getAttribute('aria-expanded') !== 'true') {
      settings.click();
      return {step: 'settings'};
    }
  }
  return {signIn};
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function collectUsage(key, windowId, scratch) {
  const provider = providers[key];
  const url = provider.origin + provider.path;
  const tabs = await chrome.tabs.query({windowId, url: provider.origin + '/*'});
  const existing = tabs.find(tab => {
    if (tab.id === scratch.id || !tab.url) return false;
    const path = new URL(tab.url).pathname.replace(/\/$/, '');
    if (key === 'gemini') return /^\/app\/usage(?:-limits)?$/.test(path);
    return isUsagePage(provider, tab.url);
  });
  if (existing) {
    await chrome.tabs.reload(existing.id);
    const result = await readTab(key, existing.id, url);
    if (result.state !== 'unreadable' || !provider.alternatePath) return result;
  }
  const usedPath = existing ? new URL(existing.url).pathname.replace(/\/$/, '') + new URL(existing.url).hash : '';
  const paths = [provider.path, provider.alternatePath].filter(path => path && path !== usedPath);
  for (const path of paths) {
    const target = provider.origin + path;
    if (scratch.id === undefined) {
      const tab = await chrome.tabs.create({windowId, url: target, active: false});
      scratch.id = tab.id;
    } else {
      await chrome.tabs.update(scratch.id, {url: target});
    }
    const result = await readTab(key, scratch.id, target);
    if (result.state !== 'unreadable') return result;
  }
  return {state: 'unreadable'};
}

async function readTab(key, tabId, url) {
  const provider = providers[key];
  let settingsOpened = false;
  let usageOpened = false;
  const attempts = key === 'gemini' ? 20 : 12;
  for (let attempt = 0; attempt < attempts; attempt++) {
    await delay(650);
    const current = await chrome.tabs.get(tabId);
    if (current.status !== 'complete') continue;
    const targetUrl = new URL(current.url || current.pendingUrl || url);
    if (targetUrl.origin !== provider.origin) {
      if (['accounts.google.com', 'auth.openai.com'].includes(targetUrl.hostname)
          || /\/login|\/signin/.test(targetUrl.pathname)) return {state: 'signin'};
      return {state: 'unreadable'};
    }
    const [{result}] = await chrome.scripting.executeScript({
      target: {tabId}, func: probeUsage, args: [key, !usageOpened && (!settingsOpened || attempt % 3 === 0), {...provider, extra: Object.hasOwn(additionalServices, key)}]
    });
    if (result?.step === 'settings') settingsOpened = true;
    if (result?.step === 'usage') usageOpened = true;
    if (result?.signIn && attempt >= 3) return {state: 'signin'};
    const content = result?.signIn ? '' : result?.text || '';
    const parsed = Object.hasOwn(additionalServices, key) ? parseAdditionalUsage(key, content) : parseUsage(content);
    const rows = parsed.filter(row =>
      !row.note.startsWith('Có nhiều giá trị') && (row.percent !== null || row.reset || row.note)
    );
    if (rows.some(row => row.percent !== null || row.note) || (attempt >= 8 && rows.length)) {
      return {state: 'ok', rows};
    }
  }
  return {state: 'unreadable'};
}

async function refreshProvider(key, windowId, scratch, directOnly = false) {
  let outcome = {state: 'unreadable'};
  let source = 'page';
  try {
    if (!(await selectedServices()).includes(key) || !await chrome.permissions.contains(permissionFor(key))) return 'disconnected';
    const rows = await fetchDirectUsage(key);
    if (rows.length) {
      outcome = {state: 'ok', rows};
      source = 'direct';
    } else if (directOnly) {
      return 'unavailable';
    } else {
      outcome = await collectUsage(key, windowId, scratch);
    }
  } catch {
    if (directOnly) return 'unavailable';
  }
  return inCatalogOrder(async () => {
    if (!(await selectedServices()).includes(key) || !await chrome.permissions.contains(permissionFor(key))) return 'disconnected';
    const now = Date.now();
    const patch = {[key + 'Status']: {state: outcome.state, checkedAt: now}};
    if (outcome.state === 'ok') patch[key] = {rows: outcome.rows, source, updatedAt: now};
    await chrome.storage.local.set(patch);
    return outcome.state;
  });
}

async function refreshAllProviders(windowId, service) {
  const scratch = {};
  const states = [];
  try {
    for (const key of service ? [service] : await selectedServices()) {
      const state = await refreshProvider(key, windowId, scratch).catch(() => 'unreadable');
      states.push(state);
    }
    return states;
  } finally {
    if (scratch.id !== undefined) await chrome.tabs.remove(scratch.id).catch(() => {});
  }
}

const autoAlarm = 'usage-refresh';
const intervalMinutes = 15;

async function syncAlarm() {
  const {autoRefresh} = await chrome.storage.local.get('autoRefresh');
  if (!autoRefresh) await chrome.alarms.clear(autoAlarm);
  else if (!await chrome.alarms.get(autoAlarm)) {
    await chrome.alarms.create(autoAlarm, {periodInMinutes: intervalMinutes});
  }
}

async function setAuto(enabled) {
  await chrome.storage.local.set({autoRefresh: enabled});
  await syncAlarm();
  return {enabled};
}

function startRefresh(run) {
  const previous = activeRefresh;
  const operation = (async () => {
    await previous?.catch(() => {});
    await backgroundRefresh;
    return run();
  })();
  activeRefresh = operation;
  operation.finally(() => { if (activeRefresh === operation) activeRefresh = null; }).catch(() => {});
  return operation;
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.action === 'auto' && typeof message.enabled === 'boolean') {
    setAuto(message.enabled).then(reply, () => reply({error: true}));
    return true;
  }
  if (['add', 'remove'].includes(message?.action) && Object.hasOwn(providers, message.key)) {
    changeCatalog(message.key, message.action === 'add').then(reply, () => reply({error: true}));
    return true;
  }
  if (message?.action !== 'refresh' || !Number.isInteger(message.windowId)
      || (message.key !== undefined && !Object.hasOwn(providers, message.key))) return;
  startRefresh(() => refreshAllProviders(message.windowId, message.key))
    .then(states => reply({states}), () => reply({error: true}));
  return true;
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== autoAlarm || activeRefresh || backgroundRefresh) return;
  backgroundRefresh = Promise.all(directProviders.map(key =>
    refreshProvider(key, undefined, undefined, true).catch(() => 'unavailable')
  )).finally(() => { backgroundRefresh = null; });
});

chrome.runtime.onStartup.addListener(syncAlarm);
chrome.runtime.onInstalled.addListener(syncAlarm);

let trayQueue = Promise.resolve();
function syncTray() {
  const operation = trayQueue.then(async () => {
    if (!await chrome.permissions.contains({permissions: ['nativeMessaging']})) return {ok: false};
    const keys = await selectedServices();
    const records = await chrome.storage.local.get(keys.flatMap(key => [key, key + 'Status']));
    const services = keys.map(key => ({
      name: providers[key].name,
      updatedAt: records[key]?.updatedAt || 0,
      state: records[key + 'Status']?.state || '',
      rows: (records[key]?.rows || []).slice(0, 12).map(row => ({
        label: String(row.label || '').slice(0, 120),
        percent: Number.isFinite(row.percent) && row.percent >= 0 && row.percent <= 100 ? row.percent : null,
        reset: String(row.reset || '').slice(0, 180),
        note: String(row.note || '').slice(0, 180)
      }))
    }));
    return chrome.runtime.sendNativeMessage('com.aiusage.tray', {version: 1, services});
  });
  trayQueue = operation.catch(() => {});
  return operation;
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.action !== 'traySync') return;
  syncTray().then(reply, () => reply({ok: false}));
  return true;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (Object.keys(changes).some(key => key === 'selectedServices' || Object.hasOwn(providers, key) ||
      (key.endsWith('Status') && Object.hasOwn(providers, key.slice(0, -6))))) syncTray().catch(() => {});
});
