'use strict';

/**
 * MyJDownloader Click'n'Load Extension - Manifest V3 Background Service Worker
 * Compatible with Google Chrome & Microsoft Edge
 */

importScripts(
  'vendor/crypto-js/components/core.js',
  'vendor/crypto-js/rollups/aes.js',
  'vendor/crypto-js/rollups/hmac-sha256.js',
  'scripts/jdapi-sw.js'
);

const ITEM_TYPE = {
  TEXT: 'text',
  LINK: 'link',
  CNL: 'cnl'
};

const STORAGE_KEYS = {
  CLICKNLOAD_ACTIVE: 'CLICKNLOAD_ACTIVE',
  CONTEXT_MENU_SIMPLE: 'CONTEXT_MENU_SIMPLE',
  ADD_LINKS_DIALOG_ACTIVE: 'ADD_LINKS_DIALOG_ACTIVE',
  COUNTDOWN_ACTIVE: 'COUNTDOWN_ACTIVE',
  COUNTDOWN_VALUE: 'COUNTDOWN_VALUE',
  DEFAULT_PREFERRED_JD: 'DEFAULT_PREFERRED_JD',
  CACHED_DEVICE_LIST: 'CACHED_DEVICE_LIST',
  ADD_LINK_CACHED_OPTIONS: 'ADD_LINK_CACHED_OPTIONS',
  ADD_LINK_CACHED_HISTORY: 'ADD_LINK_CACHED_HISTORY',
  SAVED_FOR_LATER: 'CLIPBOARD_HISTORY'
};

const SESSION_KEYS = {
  REQUEST_QUEUE: 'MYJD_SESSION_REQUEST_QUEUE',
  POPUP_CANDIDATES: 'MYJD_SESSION_POPUP_CANDIDATES'
};

const DNR_CNL_RULE_IDS = [1001, 1002, 1003, 1004, 1005, 1006];

const JD_CHECK_EXTENSION_PATH = '/res/jdcheck.js';
const JD_CROSS_DOMAIN_EXTENSION_PATH = '/res/crossdomain.xml';
const JD_CNL_DUMMY_HTML_EXTENSION_PATH = '/res/cnl.html';

const urlRegexp = new RegExp(
  '([a-zA-Z0-9]+://)?([a-zA-Z0-9_]+:[a-zA-Z0-9_]+@)?([a-zA-Z0-9.-]+\\.[A-Za-z]{2,4})(:[0-9]+)?(/.*)?'
);

// Singleton JDAPI Client for Service Worker
const myjdClient = new self.MyJDClientSW({
  API_ROOT: 'https://api.jdownloader.org',
  APP_KEY: 'myjd_webextension_chrome'
});

let requestIDCounter = 0;
let requestQueue = {};
let popupCandidates = {};
let previousActiveTab = null;
let recentCnlFingerprints = new Map();

let state = {
  isConnected: false
};

let settings = {
  [STORAGE_KEYS.CLICKNLOAD_ACTIVE]: true,
  [STORAGE_KEYS.CONTEXT_MENU_SIMPLE]: true,
  [STORAGE_KEYS.ADD_LINKS_DIALOG_ACTIVE]: true,
  [STORAGE_KEYS.COUNTDOWN_ACTIVE]: true,
  [STORAGE_KEYS.COUNTDOWN_VALUE]: 3
};

// ============================================================================
// Session Storage Persistence Helpers
// ============================================================================
let sessionLoadedPromise = null;

function ensureSessionStateLoaded() {
  if (sessionLoadedPromise) return sessionLoadedPromise;
  sessionLoadedPromise = new Promise((resolve) => {
    if (!chrome.storage || !chrome.storage.session) {
      resolve();
      return;
    }
    chrome.storage.session.get(
      [SESSION_KEYS.REQUEST_QUEUE, SESSION_KEYS.POPUP_CANDIDATES],
      (res) => {
        if (res && res[SESSION_KEYS.REQUEST_QUEUE]) {
          requestQueue = Object.assign({}, res[SESSION_KEYS.REQUEST_QUEUE], requestQueue);
        }
        if (res && res[SESSION_KEYS.POPUP_CANDIDATES]) {
          popupCandidates = Object.assign({}, res[SESSION_KEYS.POPUP_CANDIDATES], popupCandidates);
        }
        resolve();
      }
    );
  });
  return sessionLoadedPromise;
}

function saveRequestQueue() {
  if (chrome.storage && chrome.storage.session) {
    chrome.storage.session.set({ [SESSION_KEYS.REQUEST_QUEUE]: requestQueue });
  }
}

function savePopupCandidates() {
  if (chrome.storage && chrome.storage.session) {
    chrome.storage.session.set({ [SESSION_KEYS.POPUP_CANDIDATES]: popupCandidates });
  }
}

function chromeErrorCallback() {
  if (chrome.runtime && chrome.runtime.lastError) {
    // Suppress benign MV3 messaging errors when tabs/popups close
  }
}

function safeSendMessage(message) {
  try {
    chrome.runtime.sendMessage(message, () => {
      if (chrome.runtime && chrome.runtime.lastError) {}
    });
  } catch (e) {}
}

function safeTabSendMessage(tabId, message, callback) {
  if (tabId === undefined || tabId === null || tabId < 0) return;
  try {
    chrome.tabs.sendMessage(Number(tabId), message, (res) => {
      if (chrome.runtime && chrome.runtime.lastError) {}
      if (typeof callback === 'function') callback(res);
    });
  } catch (e) {}
}

function updateBadge(currentState) {
  if (!currentState.isConnected) {
    chrome.action.setBadgeBackgroundColor({ color: '#f3d435' }, chromeErrorCallback);
    chrome.action.setBadgeText({ text: '!' }, chromeErrorCallback);
  } else if (settings[STORAGE_KEYS.CLICKNLOAD_ACTIVE] === false) {
    chrome.action.setBadgeBackgroundColor({ color: '#888888' }, chromeErrorCallback);
    chrome.action.setBadgeText({ text: 'OFF' }, chromeErrorCallback);
  } else {
    chrome.action.setBadgeBackgroundColor({ color: '#2b8a3e' }, chromeErrorCallback);
    chrome.action.setBadgeText({ text: 'CNL' }, chromeErrorCallback);
  }
}

// ============================================================================
// Settings Initialization
// ============================================================================
function initSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      [
        STORAGE_KEYS.CLICKNLOAD_ACTIVE,
        STORAGE_KEYS.CONTEXT_MENU_SIMPLE,
        STORAGE_KEYS.ADD_LINKS_DIALOG_ACTIVE,
        STORAGE_KEYS.COUNTDOWN_ACTIVE,
        STORAGE_KEYS.COUNTDOWN_VALUE
      ],
      (result) => {
        const res = result || {};
        settings[STORAGE_KEYS.CLICKNLOAD_ACTIVE] =
          res[STORAGE_KEYS.CLICKNLOAD_ACTIVE] !== undefined
            ? Boolean(res[STORAGE_KEYS.CLICKNLOAD_ACTIVE])
            : true;
        settings[STORAGE_KEYS.CONTEXT_MENU_SIMPLE] =
          res[STORAGE_KEYS.CONTEXT_MENU_SIMPLE] !== undefined
            ? Boolean(res[STORAGE_KEYS.CONTEXT_MENU_SIMPLE])
            : true;
        settings[STORAGE_KEYS.ADD_LINKS_DIALOG_ACTIVE] =
          res[STORAGE_KEYS.ADD_LINKS_DIALOG_ACTIVE] !== undefined
            ? Boolean(res[STORAGE_KEYS.ADD_LINKS_DIALOG_ACTIVE])
            : true;
        settings[STORAGE_KEYS.COUNTDOWN_ACTIVE] =
          res[STORAGE_KEYS.COUNTDOWN_ACTIVE] !== undefined
            ? Boolean(res[STORAGE_KEYS.COUNTDOWN_ACTIVE])
            : true;
        settings[STORAGE_KEYS.COUNTDOWN_VALUE] =
          res[STORAGE_KEYS.COUNTDOWN_VALUE] !== undefined
            ? Number(res[STORAGE_KEYS.COUNTDOWN_VALUE])
            : 3;
        resolve(settings);
      }
    );
  });
}

// ============================================================================
// DeclarativeNetRequest Rules (Intercepts 127.0.0.1:9666 / localhost:9666)
// ============================================================================
async function syncCnlDeclarativeRules(enable) {
  if (!chrome.declarativeNetRequest) return;
  try {
    if (!enable) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: DNR_CNL_RULE_IDS,
        addRules: []
      });
      return;
    }

    const rules = [
      {
        id: 1001,
        priority: 100,
        action: {
          type: 'redirect',
          redirect: { extensionPath: JD_CHECK_EXTENSION_PATH }
        },
        condition: {
          urlFilter: 'http://127.0.0.1:9666/jdcheck.js*',
          resourceTypes: ['script', 'xmlhttprequest', 'other']
        }
      },
      {
        id: 1002,
        priority: 100,
        action: {
          type: 'redirect',
          redirect: { extensionPath: JD_CHECK_EXTENSION_PATH }
        },
        condition: {
          urlFilter: 'http://localhost:9666/jdcheck.js*',
          resourceTypes: ['script', 'xmlhttprequest', 'other']
        }
      },
      {
        id: 1003,
        priority: 100,
        action: {
          type: 'redirect',
          redirect: { extensionPath: JD_CROSS_DOMAIN_EXTENSION_PATH }
        },
        condition: {
          urlFilter: 'http://127.0.0.1:9666/crossdomain.xml*',
          resourceTypes: ['xmlhttprequest', 'other', 'sub_frame', 'main_frame']
        }
      },
      {
        id: 1004,
        priority: 100,
        action: {
          type: 'redirect',
          redirect: { extensionPath: JD_CROSS_DOMAIN_EXTENSION_PATH }
        },
        condition: {
          urlFilter: 'http://localhost:9666/crossdomain.xml*',
          resourceTypes: ['xmlhttprequest', 'other', 'sub_frame', 'main_frame']
        }
      },
      {
        id: 1005,
        priority: 90,
        action: {
          type: 'redirect',
          redirect: { extensionPath: JD_CNL_DUMMY_HTML_EXTENSION_PATH }
        },
        condition: {
          regexFilter: '^http://127\\.0\\.0\\.1:9666/flash/add(crypted2)?(\\?(?!.*fromExtension).*)?$',
          resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'ping', 'other']
        }
      },
      {
        id: 1006,
        priority: 90,
        action: {
          type: 'redirect',
          redirect: { extensionPath: JD_CNL_DUMMY_HTML_EXTENSION_PATH }
        },
        condition: {
          regexFilter: '^http://localhost:9666/flash/add(crypted2)?(\\?(?!.*fromExtension).*)?$',
          resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'ping', 'other']
        }
      }
    ];

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: DNR_CNL_RULE_IDS,
      addRules: rules
    });
  } catch (e) {
    console.warn('[MyJD CNL] Failed to update DNR rules:', e);
  }
}

// ============================================================================
// Click'n'Load Helpers & Interception
// ============================================================================
function checkIfRequestMatches(testRequest, path) {
  if (!testRequest) return false;
  const lower = testRequest.toLowerCase();
  const target = path.toLowerCase();
  return (
    lower.indexOf('localhost:9666' + target) !== -1 ||
    lower.indexOf('127.0.0.1:9666' + target) !== -1
  );
}

function isJDCheckUrl(url) {
  return checkIfRequestMatches(url, '/jdcheck.js') || (url && url.toLowerCase().endsWith('/jdcheck.js'));
}

function isFlashAddCryptedUrl(url) {
  return checkIfRequestMatches(url, '/flash/addcrypted2');
}

function isFlashAddUrl(url) {
  return checkIfRequestMatches(url, '/flash/add');
}

function parseRawPostBody(body) {
  const result = {};
  if (!body) return result;
  const vars = body.split('&');
  for (let i = 0; i < vars.length; i++) {
    const pair = vars[i].split('=');
    const key = decodeURIComponent((pair[0] || '').replace(/\+/g, ' '));
    if (!key) continue;
    const rawVal = pair.slice(1).join('=');
    let val = '';
    try {
      val = decodeURIComponent((rawVal || '').replace(/\+/g, ' '));
    } catch (e) {
      val = rawVal || '';
    }
    if (result[key] === undefined) {
      result[key] = [val];
    } else if (Array.isArray(result[key])) {
      result[key].push(val);
    } else {
      result[key] = [result[key], val];
    }
  }
  return result;
}

function readArrayBuffer(buffers) {
  const decoder = new TextDecoder('utf-8');
  let output = '';
  for (let j = 0; j < buffers.length; j++) {
    if (buffers[j] && buffers[j].bytes) {
      output += decoder.decode(new Uint8Array(buffers[j].bytes), { stream: true });
    }
  }
  output += decoder.decode();
  return output;
}

function computeCnlFingerprint(formData) {
  if (!formData) return '';
  const firstVal = (v) => (Array.isArray(v) ? v[0] || '' : v || '');
  const crypted = firstVal(formData.crypted);
  const urls = firstVal(formData.urls);
  const jk = firstVal(formData.jk);
  const pkg = firstVal(formData.package);
  return `${crypted.slice(0, 64)}|${urls.slice(0, 64)}|${jk.slice(0, 32)}|${pkg}`;
}

function isDuplicateCnlRequest(formData) {
  const fp = computeCnlFingerprint(formData);
  if (!fp || fp === '|||') return false;
  const now = Date.now();
  for (const [k, ts] of recentCnlFingerprints.entries()) {
    if (now - ts > 2500) {
      recentCnlFingerprints.delete(k);
    }
  }
  if (recentCnlFingerprints.has(fp)) {
    return true;
  }
  recentCnlFingerprints.set(fp, now);
  return false;
}

function addCNLRequestToQueue(tab, details, openerTab) {
  if (!details.requestBody) {
    details.requestBody = { formData: {} };
  }
  if (
    details.requestBody.raw &&
    details.requestBody.raw[0] &&
    details.requestBody.raw[0].bytes &&
    !details.requestBody.formData
  ) {
    try {
      const rawPostBody = readArrayBuffer(details.requestBody.raw);
      details.requestBody.formData = parseRawPostBody(rawPostBody);
    } catch (e) {
      details.requestBody.formData = {};
    }
  }

  const formData = (details.requestBody && details.requestBody.formData) || {};
  if (isDuplicateCnlRequest(formData)) {
    return false;
  }

  requestIDCounter++;
  const time = Date.now();
  const detailsTab = openerTab || tab || { id: details.tabId };

  details.source = Array.isArray(formData.source) ? formData.source[0] : formData.source;
  details.urls = Array.isArray(formData.urls) ? formData.urls[0] : formData.urls;
  details.passwords = formData.passwords;
  details.package = Array.isArray(formData.package) ? formData.package[0] : formData.package;

  const sanitizedDetails = {
    url: details.url,
    tabId: details.tabId,
    type: details.type,
    source: details.source,
    urls: details.urls,
    passwords: details.passwords,
    package: details.package,
    requestBody: {
      formData: formData
    }
  };

  let parentUrl;
  if (detailsTab.url && detailsTab.url.indexOf('chrome://newtab') === -1 && !detailsTab.url.startsWith('data:')) {
    parentUrl = detailsTab.url;
  }
  if (!parentUrl && details.source) {
    parentUrl = details.source;
  }

  let faviconUrl = detailsTab.favIconUrl;
  if (!faviconUrl && details.source && urlRegexp.test(details.source)) {
    try {
      const parsedOrigin = new URL(
        details.source.startsWith('http://') || details.source.startsWith('https://')
          ? details.source
          : 'https://' + details.source
      ).origin;
      faviconUrl = parsedOrigin + '/favicon.ico';
    } catch (e) {}
  }

  let title = detailsTab.title;
  if ((!title || title.startsWith('data:')) && details.package) {
    title = details.package;
  }

  const newRequest = {
    id: '' + requestIDCounter + time + Math.floor(Math.random() * 10000),
    type: ITEM_TYPE.CNL,
    time: time,
    parent: {
      url: parentUrl || 'Click\'n\'Load',
      title: title || details.package || 'Click\'n\'Load Paket',
      favIconUrl: faviconUrl
    },
    content: sanitizedDetails
  };

  const targetTabId = detailsTab.id;
  if (requestQueue[targetTabId]) {
    requestQueue[targetTabId].push(newRequest);
  } else {
    requestQueue[targetTabId] = [newRequest];
  }
  saveRequestQueue();
  return true;
}

function toggleToolbar(sender) {
  if (!isNaN(parseFloat(sender))) {
    const tabId = parseFloat(sender);
    // Ensure toolbarContentscript is injected in case tab was already open before install
    chrome.scripting
      .executeScript({
        target: { tabId: tabId },
        files: ['contentscripts/toolbarContentscript.js']
      })
      .catch(() => {})
      .finally(() => {
        safeTabSendMessage(tabId, { action: 'open-in-page-toolbar', tabId: tabId });
        safeTabSendMessage(tabId, { action: 'link-info-update', tabId: tabId });
        safeSendMessage({ action: 'link-info-update', tabId: tabId });
      });
  } else if (sender === 'close-in-page-toolbar') {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (tabs && tabs.length > 0) {
        safeTabSendMessage(tabs[0].id, { action: 'close-in-page-toolbar', tabId: tabs[0].id });
      }
    });
  } else if (sender === 'open-in-page-toolbar') {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (tabs && tabs.length > 0) {
        toggleToolbar(tabs[0].id);
      }
    });
  }
}

function replaceWithCnlPopup(requestDetails) {
  const options = {
    width: 430,
    height: 460,
    type: 'popup'
  };
  chrome.windows.create(options, (win) => {
    if (!win) return;
    chrome.tabs.query({ windowId: win.id }, (tabs) => {
      const setupTab = (tab) => {
        requestDetails.tabId = tab.id;
        const added = addCNLRequestToQueue(tab, requestDetails);
        if (!added) {
          chrome.windows.remove(win.id, chromeErrorCallback);
          return;
        }
        chrome.tabs.update(
          tab.id,
          { url: chrome.runtime.getURL('toolbar.html?id=' + tab.id + '&popup=true') },
          chromeErrorCallback
        );
      };

      if (!tabs || tabs.length === 0 || !tabs[0]) {
        chrome.tabs.create({ windowId: win.id }, setupTab);
      } else {
        setupTab(tabs[0]);
      }
    });
  });
}

function checkIfPopup(tab, timestampFirstCnlRequest) {
  if (!tab) return Promise.resolve(false);
  const candidate = popupCandidates[tab.id];
  const lastActiveTab = candidate ? candidate.lastActiveTab : null;
  const lastTabWidth = lastActiveTab != null ? lastActiveTab.width : -1;
  const lastTabHeight = lastActiveTab != null ? lastActiveTab.height : -1;
  const currentTabWidth = tab.width || -1;
  const currentTabHeight = tab.height || -1;
  const smallerThanPreviousTab =
    lastTabWidth + 100 > currentTabWidth && lastTabHeight + 100 > currentTabHeight;
  if (
    smallerThanPreviousTab ||
    (candidate && timestampFirstCnlRequest - candidate.creationTime < 10000)
  ) {
    return Promise.resolve(true);
  }
  return Promise.resolve(false);
}

function handleCnlNewTab(tab, requestDetails) {
  try {
    chrome.tabs.remove(tab.id, chromeErrorCallback);
  } catch (e) {}

  if (tab && tab.openerTabId) {
    chrome.tabs.get(tab.openerTabId, (openerTab) => {
      if (openerTab) {
        if (addCNLRequestToQueue(openerTab, requestDetails)) {
          toggleToolbar(openerTab.id);
        }
      }
    });
  } else {
    try {
      chrome.tabs.remove(requestDetails.tabId, chromeErrorCallback);
    } catch (e) {}
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (tabs && tabs.length > 0) {
        const activeTab = tabs[0];
        requestDetails.tabId = activeTab.id;
        if (addCNLRequestToQueue(activeTab, requestDetails)) {
          toggleToolbar(activeTab.id);
        }
      } else {
        replaceWithCnlPopup(requestDetails);
      }
    });
  }
}

function flashAddCrypted(details) {
  if (details.tabId !== undefined && details.tabId !== -1) {
    chrome.tabs.get(details.tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        replaceWithCnlPopup(details);
        return;
      }
      if (addCNLRequestToQueue(tab, details)) {
        toggleToolbar(tab.id);
      }
    });
  } else {
    replaceWithCnlPopup(details);
  }
}

function handleCnlWebRequest(requestDetails) {
  if (settings[STORAGE_KEYS.CLICKNLOAD_ACTIVE] === false) {
    return;
  }

  if (isJDCheckUrl(requestDetails.url)) {
    if (requestDetails.tabId !== undefined && requestDetails.tabId >= 0) {
      chrome.scripting
        .executeScript({
          target: { tabId: requestDetails.tabId },
          world: 'MAIN',
          func: () => {
            window.jdownloader = true;
          }
        })
        .catch(() => {});
    }
    return;
  }

  if (
    requestDetails.url.indexOf('127.0.0.1:9666/crossdomain.xml') !== -1 ||
    requestDetails.url.indexOf('localhost:9666/crossdomain.xml') !== -1 ||
    requestDetails.url.indexOf('?fromExtension') !== -1
  ) {
    return;
  }

  if (isFlashAddUrl(requestDetails.url) || isFlashAddCryptedUrl(requestDetails.url)) {
    if (requestDetails.type === 'main_frame') {
      chrome.tabs.get(requestDetails.tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          replaceWithCnlPopup(requestDetails);
          return;
        }
        checkIfPopup(tab, Date.now()).then((isPopup) => {
          if (isPopup) {
            chrome.tabs.remove(tab.id, chromeErrorCallback);
            replaceWithCnlPopup(requestDetails);
          } else {
            handleCnlNewTab(tab, requestDetails);
          }
        });
      });
    } else if (requestDetails.type === 'sub_frame') {
      if (requestDetails.tabId !== undefined && requestDetails.tabId >= 0) {
        chrome.tabs.get(requestDetails.tabId, (tab) => {
          if (chrome.runtime.lastError || !tab) {
            replaceWithCnlPopup(requestDetails);
            return;
          }
          chrome.windows.get(tab.windowId, { populate: true }, (win) => {
            if (win && win.type === 'popup') {
              replaceWithCnlPopup(requestDetails);
            } else {
              checkIfPopup(tab, Date.now()).then((isPopup) => {
                if (isPopup) {
                  replaceWithCnlPopup(requestDetails);
                } else {
                  flashAddCrypted(requestDetails);
                }
              });
            }
          });
        });
      }
    } else {
      flashAddCrypted(requestDetails);
    }
  }
}

// ============================================================================
// Context Menu & Link Queue Helpers
// ============================================================================
function queueContains(request, tabId) {
  const list = requestQueue[tabId];
  if (!Array.isArray(list) || list.length === 0) return false;
  return list.some(
    (value) =>
      request.type !== undefined &&
      request.type === value.type &&
      request.type === ITEM_TYPE.LINK &&
      request.content !== undefined &&
      request.content === value.content
  );
}

function addLinkToRequestQueue(link, tab) {
  if (!tab || tab.id === undefined) return;
  const time = Date.now();
  const id = '' + tab.id + time + Math.floor(Math.random() * 10000);
  if (!requestQueue[tab.id]) {
    requestQueue[tab.id] = [];
  }
  const newLink = {
    id: id,
    time: time,
    parent: { url: tab.url, title: tab.title, favIconUrl: tab.favIconUrl },
    content: link,
    type: ITEM_TYPE.LINK
  };

  if (!queueContains(newLink, tab.id)) {
    requestQueue[tab.id].push(newLink);
    saveRequestQueue();
    toggleToolbar(tab.id);
  }
}

function addTextToRequestQueue(previewText, content, tab) {
  if (!tab || tab.id === undefined) return;
  const time = Date.now();
  const id = '' + tab.id + time + Math.floor(Math.random() * 10000);
  if (!requestQueue[tab.id]) {
    requestQueue[tab.id] = [];
  }
  requestQueue[tab.id].push({
    id: id,
    time: time,
    parent: { url: tab.url, title: tab.title, favIconUrl: tab.favIconUrl },
    content: content,
    previewText: previewText,
    type: ITEM_TYPE.TEXT
  });
  saveRequestQueue();
  toggleToolbar(tab.id);
}

function initMenuItems() {
  chrome.contextMenus.removeAll(() => {
    if (chrome.runtime && chrome.runtime.lastError) {}
    if (!state.isConnected) return;

    chrome.contextMenus.create(
      {
        id: 'simple_menu_item',
        title: 'Mit JDownloader herunterladen',
        contexts: ['all']
      },
      chromeErrorCallback
    );
  });
}

function removeDialogFromAllTabs() {
  chrome.tabs.query({}, (tabs) => {
    if (!tabs) return;
    for (const tab of tabs) {
      safeTabSendMessage(tab.id, { action: 'remove-dialog' });
      if (requestQueue[tab.id]) {
        delete requestQueue[tab.id];
      }
    }
    saveRequestQueue();
  });
}

async function initConnected() {
  state.isConnected = true;
  updateBadge(state);
  initMenuItems();
  await syncCnlDeclarativeRules(settings[STORAGE_KEYS.CLICKNLOAD_ACTIVE] !== false);
}

async function initDisconnected() {
  state.isConnected = false;
  updateBadge(state);
  chrome.contextMenus.removeAll(chromeErrorCallback);
  // Keep DNR rules active if Click'n'Load is enabled soCNL buttons still open the toolbar (which prompts login or saves for later)
  await syncCnlDeclarativeRules(settings[STORAGE_KEYS.CLICKNLOAD_ACTIVE] !== false);
}

function injectContentScripts() {
  chrome.windows.getAll({ populate: true }, (windows) => {
    if (!windows || windows.length === 0) return;
    for (const win of windows) {
      if (!win.tabs) continue;
      for (const tab of win.tabs) {
        if (!tab.url) continue;
        const isBlockedUrl =
          (!tab.url.startsWith('http://') && !tab.url.startsWith('https://')) ||
          tab.url.startsWith('https://chrome.google.com/webstore/') ||
          tab.url.startsWith('https://chromewebstore.google.com/') ||
          tab.url.startsWith('https://microsoftedge.microsoft.com/addons/');
        if (isBlockedUrl) continue;

        chrome.scripting
          .executeScript({
            target: { tabId: tab.id },
            files: ['contentscripts/toolbarContentscript.js']
          })
          .catch(() => {});
      }
    }
  });
}

// ============================================================================
// Connection State Listener
// ============================================================================
myjdClient.addAPIStateChangeListener((apiState) => {
  const STATES = self.MYJD_CONNECTION_STATES;
  if (apiState === STATES.CONNECTED) {
    state.isConnected = true;
    updateBadge(state);
    safeSendMessage({
      name: 'myjd-toolbar',
      action: 'CONNECTION_STATE_CHANGE',
      data: 'CONNECTED'
    });
    safeSendMessage({
      name: 'myjd-toolbar',
      action: 'session-change',
      data: { isLoggedIn: true }
    });
  } else if (apiState === STATES.DISCONNECTED) {
    state.isConnected = false;
    updateBadge(state);
    safeSendMessage({
      name: 'myjd-toolbar',
      action: 'CONNECTION_STATE_CHANGE',
      data: 'DISCONNECTED'
    });
    safeSendMessage({
      name: 'myjd-toolbar',
      action: 'session-change',
      data: { isLoggedIn: false }
    });
  }
});

// ============================================================================
// Top-Level Chrome Event Listeners
// ============================================================================

// 1. WebRequest Listener (Captures POST bodies to 127.0.0.1:9666 / localhost:9666)
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    handleCnlWebRequest(details);
  },
  { urls: ['<all_urls>'] },
  ['requestBody']
);

// 2. Context Menu Listener
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  await ensureSessionStateLoaded();
  if (!tab || tab.id === undefined) return;

  if (info.menuItemId === 'simple_menu_item') {
    if (info.selectionText) {
      safeTabSendMessage(tab.id, { action: 'get-selection', tabId: tab.id });
    } else if (info.linkUrl) {
      addLinkToRequestQueue(info.linkUrl, tab);
    } else if (info.srcUrl) {
      addLinkToRequestQueue(info.srcUrl, tab);
    } else if (tab.url) {
      addLinkToRequestQueue(tab.url, tab);
    }
  }
});

// 3. Storage Change Listener
chrome.storage.onChanged.addListener((changes) => {
  if (!changes) return;
  if (changes[STORAGE_KEYS.CLICKNLOAD_ACTIVE]) {
    settings[STORAGE_KEYS.CLICKNLOAD_ACTIVE] = Boolean(
      changes[STORAGE_KEYS.CLICKNLOAD_ACTIVE].newValue
    );
    updateBadge(state);
    syncCnlDeclarativeRules(settings[STORAGE_KEYS.CLICKNLOAD_ACTIVE] !== false);
  }
});

// 4. Tabs Lifecycle Listeners
chrome.tabs.onCreated.addListener((tab) => {
  popupCandidates[tab.id] = {
    tab: tab,
    creationTime: Date.now(),
    lastActiveTab: previousActiveTab
  };
  previousActiveTab = tab;
  savePopupCandidates();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  delete requestQueue[tabId];
  saveRequestQueue();
  delete popupCandidates[tabId];
  savePopupCandidates();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tabInfo) => {
  await ensureSessionStateLoaded();
  if (popupCandidates[tabId] !== undefined && changeInfo.url !== undefined) {
    popupCandidates[tabId].tab = tabInfo;
    savePopupCandidates();
  }
});

// 5. Install / Startup Listeners
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'update' || details.reason === 'install') {
    injectContentScripts();
  }
  initializeServiceWorker();
});

chrome.runtime.onStartup.addListener(() => {
  initializeServiceWorker();
});

// ============================================================================
// Build dummycnl.jdownloader.org URL from CNL formData (Official MyJD Protocol)
// ============================================================================
function buildDummyCnlUrlFromFormData(formData) {
  if (!formData || typeof formData !== 'object') return '';
  const genericDummyCnl = Object.create(null);
  for (const [key, value] of Object.entries(formData)) {
    if (Array.isArray(value) && value[0] !== undefined) {
      genericDummyCnl[key] = value[0];
    } else {
      genericDummyCnl[key] = value;
    }
  }
  const hexDummyCnl = CryptoJS.enc.Utf8.parse(JSON.stringify(genericDummyCnl)).toString(
    CryptoJS.enc.Hex
  );
  return 'https://dummycnl.jdownloader.org/#' + encodeURIComponent(hexDummyCnl);
}

// ============================================================================
// Central Message Router (chrome.runtime.onMessage)
// ============================================================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request) return false;

  (async () => {
    await ensureSessionStateLoaded();
    await initSettings();
    const isLogged = await myjdClient.ensureSessionLoaded();
    state.isConnected = isLogged;

    const name = request.name;
    const action = request.action;

    if (name === 'myjd-toolbar') {
      switch (action) {
        case 'session-info': {
          sendResponse({
            data: {
              isLoggedIn: Boolean(isLogged),
              email: myjdClient.options ? myjdClient.options.email : undefined,
              clicknloadActive: settings[STORAGE_KEYS.CLICKNLOAD_ACTIVE] !== false
            }
          });
          return;
        }

        case 'login': {
          if (request.data && request.data.credentials) {
            try {
              await myjdClient.connect(request.data.credentials);
              await initSettings();
              await initConnected();
              injectContentScripts();
              const devices = await myjdClient.listDevices().catch(() => []);
              chrome.storage.local.set({ [STORAGE_KEYS.CACHED_DEVICE_LIST]: devices });
              sendResponse({ data: true, devices: devices });
              safeSendMessage({
                name: 'myjd-toolbar',
                action: 'session-change',
                data: { isLoggedIn: true }
              });
            } catch (error) {
              await initDisconnected();
              sendResponse({ data: false, error: error });
              safeSendMessage({
                name: 'myjd-toolbar',
                action: 'session-change',
                data: { isLoggedIn: false }
              });
            }
          } else {
            await initDisconnected();
            sendResponse({ error: 'Zugangsdaten fehlen' });
          }
          return;
        }

        case 'logout': {
          try {
            await myjdClient.disconnect();
            await initDisconnected();
            sendResponse({ data: true });
          } catch (error) {
            await initDisconnected();
            sendResponse({ data: false, error: error });
          }
          safeSendMessage({
            name: 'myjd-toolbar',
            action: 'session-change',
            data: { isLoggedIn: false }
          });
          return;
        }

        case 'devices-pull': {
          try {
            const devices = await myjdClient.listDevices();
            chrome.storage.local.set({ [STORAGE_KEYS.CACHED_DEVICE_LIST]: devices });
            sendResponse({ data: { devices: devices } });
            safeSendMessage({
              name: 'myjd-toolbar',
              action: 'devices-change',
              data: { devices: devices }
            });
          } catch (error) {
            sendResponse({ error: error });
          }
          return;
        }

        case 'add-link': {
          if (request.data && request.data.query && request.data.device) {
            try {
              const query = Object.assign({}, request.data.query);
              await myjdClient.send(request.data.device.id, '/linkgrabberv2/addLinks', [
                JSON.stringify(query)
              ]);
              sendResponse({ data: true });
            } catch (error) {
              sendResponse({ error: error });
            }
          } else {
            sendResponse({ error: 'Ungültige Anfrage' });
          }
          return;
        }

        case 'add-cnl': {
          if (request.data && request.data.query && request.data.device) {
            try {
              const query = Object.assign({}, request.data.query);
              if (request.data.formData && !query.links) {
                query.links = buildDummyCnlUrlFromFormData(request.data.formData);
              }
              query.permission = true;
              await myjdClient.send(request.data.device.id, '/linkgrabberv2/addLinks', [
                JSON.stringify(query)
              ]);
              sendResponse({ data: true });
            } catch (error) {
              sendResponse({ error: error });
            }
          } else {
            sendResponse({ error: 'Ungültige CNL-Anfrage' });
          }
          return;
        }

        case 'cnl-dom-intercept': {
          if (settings[STORAGE_KEYS.CLICKNLOAD_ACTIVE] === false) {
            sendResponse({ ignored: true });
            return;
          }
          const payload = request.data || {};
          const senderTab = sender && sender.tab ? sender.tab : null;
          const syntheticDetails = {
            url: payload.url || 'http://127.0.0.1:9666/flash/addcrypted2',
            tabId: senderTab ? senderTab.id : -1,
            type: 'sub_frame',
            requestBody: {
              formData: payload.formData || {}
            }
          };
          if (senderTab && senderTab.id >= 0) {
            if (addCNLRequestToQueue(senderTab, syntheticDetails)) {
              toggleToolbar(senderTab.id);
            }
          } else {
            replaceWithCnlPopup(syntheticDetails);
          }
          sendResponse({ ok: true });
          return;
        }

        case 'simulate-cnl-test': {
          // Built-in Click'n'Load test trigger from popup
          const testFormData = {
            jk: ["function f(){ return '31323334353637383930393837363534';}"],
            crypted: [
              'DRurBGEf2ntP7Z0WDkMP8e1ZeK7PswJGeBHCg4zEYXZSE3Qqxsbi5EF1KosgkKQ9SL8qOOUAI+eDPFypAtQS9A=='
            ],
            source: ['https://jdownloader.org/click-and-load-test'],
            package: ['Click\'n\'Load Testpaket'],
            passwords: ['testpasswort']
          };
          chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
            const activeTab = tabs && tabs[0];
            const details = {
              url: 'http://127.0.0.1:9666/flash/addcrypted2',
              tabId: activeTab ? activeTab.id : -1,
              type: 'xmlhttprequest',
              requestBody: { formData: testFormData }
            };
            if (
              activeTab &&
              activeTab.url &&
              (activeTab.url.startsWith('http://') || activeTab.url.startsWith('https://'))
            ) {
              if (addCNLRequestToQueue(activeTab, details)) {
                toggleToolbar(activeTab.id);
              }
            } else {
              replaceWithCnlPopup(details);
            }
          });
          sendResponse({ ok: true });
          return;
        }

        case 'link-info': {
          const tabId = request.data;
          const localRequestQueue = requestQueue[tabId];
          if (localRequestQueue) {
            // Pre-compute dummyCnlUrl for any CNL items
            for (const item of localRequestQueue) {
              if (
                item.type === ITEM_TYPE.CNL &&
                item.content &&
                item.content.requestBody &&
                item.content.requestBody.formData &&
                !item.content.dummyCnlUrl
              ) {
                item.content.dummyCnlUrl = buildDummyCnlUrlFromFormData(
                  item.content.requestBody.formData
                );
              }
            }
            sendResponse({ data: localRequestQueue });
          } else {
            sendResponse({ data: [] });
          }
          return;
        }

        case 'remove-all-requests': {
          if (request.data && request.data.tabId !== undefined) {
            delete requestQueue[request.data.tabId];
            saveRequestQueue();
          }
          sendResponse({});
          return;
        }

        case 'remove-request': {
          if (request.data && request.data.tabId !== undefined) {
            const tabQueue = requestQueue[request.data.tabId] || [];
            requestQueue[request.data.tabId] = tabQueue.filter(
              (localRequest) => localRequest.id !== request.data.requestId
            );
            saveRequestQueue();
          }
          sendResponse({});
          return;
        }

        case 'whoami': {
          sendResponse({
            username: myjdClient.options ? myjdClient.options.email : undefined
          });
          return;
        }

        case 'device-poll': {
          if (request.data && request.data.device) {
            const dev = request.data.device;
            try {
              const stats = await myjdClient.send(dev.id, '/polling/poll', [
                JSON.stringify({ jdState: true, aggregatedNumbers: true })
              ]);
              if (stats && stats.data && stats.data[0] && stats.data[1]) {
                const deviceStatus = {
                  state: stats.data[0].eventData.data,
                  eta: stats.data[1].eventData.data.eta,
                  speed: stats.data[1].eventData.data.downloadSpeed,
                  done: stats.data[1].eventData.data.loadedBytes,
                  total: stats.data[1].eventData.data.totalBytes
                };
                sendResponse({ data: deviceStatus });
                return;
              }
            } catch (error) {
              sendResponse({ error: error });
              return;
            }
          }
          sendResponse({});
          return;
        }

        case 'close-in-page-toolbar': {
          let tabid;
          if (request.data && request.data.tabId) {
            tabid = parseFloat(request.data.tabId);
          }
          if (tabid) {
            safeTabSendMessage(tabid, {
              action: 'close-in-page-toolbar',
              tabId: request.data.tabId
            });
            delete requestQueue[tabid];
            saveRequestQueue();
          } else {
            chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
              if (tabs && tabs[0] && tabs[0].id !== undefined) {
                delete requestQueue[tabs[0].id];
                saveRequestQueue();
                safeTabSendMessage(tabs[0].id, {
                  action: 'close-in-page-toolbar',
                  tabId: tabs[0].id
                });
              }
            });
          }
          sendResponse({});
          return;
        }

        default:
          sendResponse({});
          return;
      }
    }

    if (name === 'myjd-selection' && action === 'new-selection') {
      if (sender && sender.tab && request.data) {
        addTextToRequestQueue(request.data.text, request.data.html, sender.tab);
      }
      sendResponse({});
      return;
    }

    if (name === 'close-me') {
      try {
        if (request.data && request.data.tabId) {
          let tabId = Number.parseInt(request.data.tabId, 10);
          if (request.data.tabId === 'self' && sender && sender.tab) {
            tabId = sender.tab.id;
          }
          if (!isNaN(tabId)) {
            chrome.tabs.get(tabId, (tab) => {
              if (chrome.runtime.lastError || !tab) return;
              chrome.tabs.remove(tabId, chromeErrorCallback);
              chrome.windows.get(tab.windowId, { populate: true }, (win) => {
                if (chrome.runtime.lastError || !win || !win.tabs) return;
                const isNewTab = win.tabs.length === 1 && win.tabs[0].url === 'about:newtab';
                if (win.tabs.length === 0 || isNewTab) {
                  chrome.windows.remove(win.id, chromeErrorCallback);
                }
              });
            });
          }
        }
      } catch (e) {}
      sendResponse({});
      return;
    }

    if (name === 'cnl-support') {
      sendResponse({ data: { cnlSupported: true } });
      return;
    }

    sendResponse({});
  })();

  return true;
});

// ============================================================================
// Initial Service Worker Boot
// ============================================================================
async function initializeServiceWorker() {
  await ensureSessionStateLoaded();
  await initSettings();
  await syncCnlDeclarativeRules(settings[STORAGE_KEYS.CLICKNLOAD_ACTIVE] !== false);

  try {
    await myjdClient.connect();
    await initConnected();
  } catch (e) {
    await initDisconnected();
  }
}

initializeServiceWorker();
