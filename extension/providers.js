'use strict';

const providers = {
  chatgpt: {name: 'ChatGPT / Codex', origin: 'https://chatgpt.com', path: '/settings/usage', alternatePath: '/codex/settings/usage', help: 'Mở Usage trong ChatGPT hoặc trang Usage của Codex.'},
  claude: {name: 'Claude', origin: 'https://claude.ai', path: '/settings/usage', help: 'Mở Settings → Usage.'},
  gemini: {name: 'Gemini', origin: 'https://gemini.google.com', path: '/app', help: 'Mở Settings → Usage Limits.'}
};

const permissionFor = key => ({origins: [providers[key].origin + '/*']});

const defaultServices = ['chatgpt', 'claude', 'gemini'];
const additionalServices = {
  grok: {name: 'Grok / SuperGrok', origin: 'https://grok.com', path: '/dashboard', alternatePath: '/settings', menu: true},
  copilot: {name: 'GitHub Copilot', origin: 'https://github.com', path: '/settings/copilot', alternatePath: '/settings/billing/usage'},
  cursor: {name: 'Cursor', origin: 'https://cursor.com', path: '/dashboard', menu: true},
  kiro: {name: 'Kiro', origin: 'https://app.kiro.dev', path: '/account/usage'},
  manus: {name: 'Manus', origin: 'https://manus.im', path: '/app#settings/usage'},
  devin: {name: 'Devin', origin: 'https://app.devin.ai', path: '/settings/plans'},
  windsurf: {name: 'Windsurf', origin: 'https://windsurf.com', path: '/subscription'}
};
Object.assign(providers, additionalServices);

function visibleServices(saved) {
  return Array.isArray(saved) ? [...new Set(saved.filter(key => Object.hasOwn(providers, key)))] : defaultServices;
}

function isUsagePage(provider, address) {
  const url = new URL(address);
  const location = url.pathname.replace(/\/$/, '') + url.hash;
  return url.origin === provider.origin && [provider.path, provider.alternatePath].includes(location);
}
