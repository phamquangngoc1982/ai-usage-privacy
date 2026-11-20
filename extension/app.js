'use strict';

const $ = selector => document.querySelector(selector);
const popup = !new URLSearchParams(location.search).has('dashboard');
document.body.classList.toggle('popup', popup);
$('#open').hidden = !popup;

function element(tag, value, className) {
  const node = document.createElement(tag);
  if (value) node.textContent = value;
  if (className) node.className = className;
  return node;
}

function timestamp(date) {
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh'
  }).format(new Date(date));
}

const pending = new Set();
let renderVersion = 0;
let keys = defaultServices;

function iconButton(glyph, label, action, className = '') {
  const button = element('button', glyph, 'icon-button ' + className);
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.onclick = action;
  return button;
}

async function catalogAction(action, key) {
  try {
    const response = await chrome.runtime.sendMessage({action, key});
    if (!response?.ok) throw new Error('Catalog update unsuccessful');
    await render();
    return true;
  } catch {
    notice('Chưa thay đổi được danh sách dịch vụ.');
    return false;
  }
}

function providerIcon(key) {
  const icon = element('img', '', 'provider-icon');
  icon.src = `brands/${key}.png`;
  icon.alt = '';
  icon.width = 26;
  icon.height = 26;
  return icon;
}

function renderCatalog() {
  const options = Object.keys(providers).filter(key => !keys.includes(key)).map(key => {
    const add = element('button', '', 'quiet provider-choice');
    add.append(providerIcon(key), document.createTextNode(providers[key].name));
    add.onclick = async () => {
      add.disabled = true;
      if (await catalogAction('add', key)) $('#catalog').close();
      else add.disabled = false;
    };
    return add;
  });
  $('#choices').replaceChildren(...(options.length ? options : [element('p', 'Đã thêm tất cả dịch vụ.', 'hint')]));
}

async function render() {
  const version = ++renderVersion;
  const records = await chrome.storage.local.get(['selectedServices', ...Object.keys(providers).flatMap(key => [key, key + 'Status'])]);
  const selected = visibleServices(records.selectedServices);
  const granted = await Promise.all(selected.map(key => chrome.permissions.contains(permissionFor(key))));
  if (version !== renderVersion) return;
  keys = selected;
  const cards = keys.map((key, index) => {
    const provider = providers[key];
    const record = records[key];
    const card = element('article', '', 'card');
    card.dataset.key = key;
    const head = element('div', '', 'card-head');
    const title = element('h2', '', 'provider-title');
    title.append(providerIcon(key), document.createTextNode(provider.name));
    head.append(title);
    const actions = element('div', '', 'card-actions');
    if (record?.updatedAt) {
      const updated = element('time', timestamp(record.updatedAt));
      updated.dateTime = new Date(record.updatedAt).toISOString();
      updated.title = 'Lần cập nhật thành công gần nhất · Giờ Việt Nam';
      actions.append(updated);
    }
    const refresh = iconButton('↻', `Cập nhật ${provider.name}`, () => refreshUsage(key));
    refresh.disabled = pending.has(key) || pending.has('all');
    const remove = iconButton('×', `Xóa ${provider.name}`, () => catalogAction('remove', key), 'remove');
    actions.append(refresh, remove);
    head.append(actions);
    card.append(head);
    if (!record?.rows.length) card.append(element('p', 'Chưa có số liệu', 'hint'));
    for (const row of record?.rows || []) {
      const reading = element('div', '', 'reading');
      reading.append(element('strong', row.label));
      if (row.percent !== null) {
        const left = Math.round((100 - row.percent) * 100) / 100;
        reading.append(element('p', `Đã dùng ${row.percent}% · Còn ${left}%`));
        const meter = element('progress');
        meter.max = 100;
        meter.value = row.percent;
        meter.setAttribute('aria-label', `${row.label}: đã dùng ${row.percent}%`);
        reading.append(meter);
      }
      if (row.reset) reading.append(element('p', row.reset));
      if (row.note) reading.append(element('p', row.note, 'hint'));
      card.append(reading);
    }
    const state = records[key + 'Status']?.state;
    if (granted[index] && state === 'signin') card.append(element('p', 'Cần đăng nhập lại', 'hint'));
    if (granted[index] && state === 'unreadable') card.append(element('p', 'Lần cập nhật gần nhất chưa đọc được số liệu', 'hint'));
    const footer = element('footer');
    if (!granted[index]) {
      const connect = element('button', 'Kết nối', 'quiet');
      connect.onclick = () => refreshUsage(key);
      footer.append(connect);
    }
    if (granted[index] && (state === 'signin' || (state === 'unreadable' && Object.hasOwn(additionalServices, key)))) {
      const login = element('button', state === 'signin' ? 'Đăng nhập' : 'Mở trang tài khoản', 'quiet');
      login.onclick = () => chrome.tabs.create({url: provider.origin + provider.path});
      footer.append(login);
    }
    if (footer.childElementCount) card.append(footer);
    return card;
  });
  $('#cards').replaceChildren(...(cards.length ? cards : [element('p', 'Chưa có dịch vụ. Bấm Thêm dịch vụ để bắt đầu.', 'hint')]));
  $('#refresh').disabled = !keys.length || pending.size > 0;
  if ($('#catalog').open) renderCatalog();
}

function notice(message) {
  const node = $('#notice');
  node.textContent = message;
  node.hidden = !message;
}

async function refreshUsage(key) {
  const task = key || 'all';
  if (pending.has(task) || pending.has('all') || (!key && pending.size)) return;
  pending.add(task);
  notice('');
  const button = $('#refresh');
  if (!key) button.textContent = 'Đang cập nhật…';
  try {
    if (key && !await chrome.permissions.request(permissionFor(key))) return;
    await render();
    const {id: windowId} = await chrome.windows.getCurrent();
    const result = await chrome.runtime.sendMessage({action: 'refresh', windowId, key});
    if (!result?.states) throw new Error('Refresh unsuccessful');
    if (!key && result.states.length && result.states.every(state => state === 'disconnected')) {
      notice('Kết nối ít nhất một dịch vụ.');
    }
  } catch {
    notice('Chưa cập nhật được. Hãy thử lại.');
  } finally {
    pending.delete(task);
    button.textContent = 'Cập nhật tất cả';
    await render();
  }
}

$('#refresh').onclick = () => refreshUsage();
$('#add-service').onclick = () => {
  renderCatalog();
  $('#catalog').showModal();
};
$('#close-catalog').onclick = () => $('#catalog').close();
$('#open').onclick = () => chrome.tabs.create({url: chrome.runtime.getURL('index.html?dashboard')});
const auto = $('#auto');
chrome.storage.local.get('autoRefresh').then(({autoRefresh}) => { auto.checked = !!autoRefresh; });
auto.onchange = async () => {
  try {
    const result = await chrome.runtime.sendMessage({action: 'auto', enabled: auto.checked});
    if (result?.error) throw new Error('Alarm settings unavailable');
  } catch {
    const {autoRefresh} = await chrome.storage.local.get('autoRefresh');
    auto.checked = !!autoRefresh;
    notice('Chưa lưu được chế độ tự cập nhật.');
  }
};
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.autoRefresh) auto.checked = !!changes.autoRefresh.newValue;
  render();
});
chrome.permissions.onAdded.addListener(render);
chrome.permissions.onRemoved.addListener(render);
render();

const trayButton = $('#tray');
const trayPermission = {permissions: ['nativeMessaging']};

async function renderTrayButton() {
  trayButton.textContent = await chrome.permissions.contains(trayPermission)
    ? 'Đồng bộ khay Windows' : 'Kết nối khay Windows';
}
trayButton.onclick = async () => {
  try {
    if (!await chrome.permissions.request(trayPermission)) return;
    const result = await chrome.runtime.sendMessage({action: 'traySync'});
    notice(result?.ok ? 'Đã gửi số liệu đến AI Usage Tray.'
      : 'Chưa kết nối được. Kiểm tra đã cài app Windows với đúng ID tiện ích.');
  } catch {
    notice('Không kết nối được với AI Usage Tray.');
  } finally {
    await renderTrayButton();
  }
};
renderTrayButton();
