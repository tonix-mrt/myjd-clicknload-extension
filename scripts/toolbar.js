'use strict';

(function () {
  const SAVE_FOR_LATER_ID = 'SaveForLaterDevice';
  const ASK_EVERY_TIME_ID = 'AskEveryTimeDevice';
  const LAST_USED_ID = 'LastUsedDevice';

  const urlParams = new URLSearchParams(window.location.search);
  const instanceId = urlParams.get('id');
  const isPopup = urlParams.get('popup') === 'true';

  let isLoggedIn = false;
  let devices = [];
  let requestQueue = [];
  let countdownTimer = null;
  let countdownRemaining = -1;
  let editMode = false;

  let settings = {
    ADD_LINKS_DIALOG_ACTIVE: true,
    COUNTDOWN_ACTIVE: true,
    COUNTDOWN_VALUE: 3,
    DEFAULT_PREFERRED_JD: { id: ASK_EVERY_TIME_ID, name: 'Jedes Mal fragen' },
    ADD_LINK_CACHED_OPTIONS: {}
  };

  // DOM Elements
  const connectionBadge = document.getElementById('connectionBadge');
  const headerSubtitle = document.getElementById('headerSubtitle');
  const closeBtn = document.getElementById('closeBtn');
  const alertBox = document.getElementById('alertBox');
  const successBox = document.getElementById('successBox');
  const loginSection = document.getElementById('loginSection');
  const loginEmail = document.getElementById('loginEmail');
  const loginPass = document.getElementById('loginPass');
  const loginBtn = document.getElementById('loginBtn');
  const saveOfflineBtn = document.getElementById('saveOfflineBtn');
  const countdownBanner = document.getElementById('countdownBanner');
  const countdownSeconds = document.getElementById('countdownSeconds');
  const stopCountdownBtn = document.getElementById('stopCountdownBtn');
  const queueCount = document.getElementById('queueCount');
  const queueList = document.getElementById('queueList');
  const sendConfigSection = document.getElementById('sendConfigSection');
  const deviceSelect = document.getElementById('deviceSelect');
  const refreshDevicesBtn = document.getElementById('refreshDevicesBtn');
  const toggleOptionsBtn = document.getElementById('toggleOptionsBtn');
  const optionalFieldsPanel = document.getElementById('optionalFieldsPanel');
  const footerActions = document.getElementById('footerActions');
  const cancelBtn = document.getElementById('cancelBtn');
  const sendBtn = document.getElementById('sendBtn');

  // Optional fields
  const optPackageName = document.getElementById('optPackageName');
  const optSaveTo = document.getElementById('optSaveTo');
  const optArchivePw = document.getElementById('optArchivePw');
  const optDownloadPw = document.getElementById('optDownloadPw');
  const optComment = document.getElementById('optComment');
  const optPriority = document.getElementById('optPriority');
  const optAutoStart = document.getElementById('optAutoStart');
  const optAutoExtract = document.getElementById('optAutoExtract');
  const optDeepDecrypt = document.getElementById('optDeepDecrypt');
  const optOverwritePackagizer = document.getElementById('optOverwritePackagizer');

  function showError(msg) {
    if (!msg) {
      alertBox.classList.add('hidden');
      alertBox.textContent = '';
      return;
    }
    alertBox.textContent = typeof msg === 'string' ? msg : (msg.type || JSON.stringify(msg));
    alertBox.classList.remove('hidden');
  }

  function stopCountdown() {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    countdownRemaining = -1;
    countdownBanner.classList.add('hidden');
  }

  function startCountdown() {
    stopCountdown();
    if (!isLoggedIn || editMode || !settings.COUNTDOWN_ACTIVE) return;
    const selectedDeviceId = deviceSelect.value;
    if (!selectedDeviceId) return;

    countdownRemaining = Math.max(1, Number(settings.COUNTDOWN_VALUE) || 3);
    countdownSeconds.textContent = String(countdownRemaining);
    countdownBanner.classList.remove('hidden');

    countdownTimer = setInterval(() => {
      countdownRemaining--;
      if (countdownRemaining <= 0) {
        stopCountdown();
        sendAllRequests();
      } else {
        countdownSeconds.textContent = String(countdownRemaining);
      }
    }, 1000);
  }

  function buildDummyCnlUrl(formData) {
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

  function renderQueue() {
    queueCount.textContent = String(requestQueue.length);
    queueList.innerHTML = '';

    if (requestQueue.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.style.color = 'var(--jd-muted)';
      emptyEl.style.fontSize = '12px';
      emptyEl.textContent = 'Keine offenen Click\'n\'Load-Anfragen.';
      queueList.appendChild(emptyEl);
      return;
    }

    for (const item of requestQueue) {
      const row = document.createElement('div');
      row.className = 'cnl-item';

      const info = document.createElement('div');
      info.className = 'cnl-item-info';

      const titleRow = document.createElement('div');
      titleRow.className = 'cnl-item-title';

      const tag = document.createElement('span');
      if (item.type === 'cnl') {
        const hasCrypted =
          item.content &&
          item.content.requestBody &&
          item.content.requestBody.formData &&
          item.content.requestBody.formData.crypted;
        tag.className = hasCrypted ? 'cnl-tag encrypted' : 'cnl-tag';
        tag.textContent = hasCrypted ? 'CNL AES' : 'CNL';
      } else {
        tag.className = 'cnl-tag';
        tag.textContent = item.type === 'link' ? 'LINK' : 'TEXT';
      }
      titleRow.appendChild(tag);

      const titleText = document.createElement('span');
      if (item.type === 'cnl') {
        titleText.textContent =
          (item.content && item.content.package) ||
          (item.parent && item.parent.title) ||
          'Click\'n\'Load Paket';
      } else {
        titleText.textContent = item.previewText || item.content || 'Link';
      }
      titleRow.appendChild(titleText);

      const metaRow = document.createElement('div');
      metaRow.className = 'cnl-item-meta';
      const sourceUrl =
        (item.content && item.content.source) ||
        (item.parent && item.parent.url) ||
        '';
      const pwInfo =
        item.content && item.content.passwords && item.content.passwords.length > 0
          ? ' • Passwort enthalten'
          : '';
      metaRow.textContent = (sourceUrl || 'Lokaler Click\'n\'Load Hook') + pwInfo;

      info.appendChild(titleRow);
      info.appendChild(metaRow);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'icon-btn';
      removeBtn.title = 'Aus Liste entfernen';
      removeBtn.innerHTML = '&#10005;';
      removeBtn.addEventListener('click', () => {
        stopCountdown();
        removeRequestById(item.id);
      });

      row.appendChild(info);
      row.appendChild(removeBtn);
      queueList.appendChild(row);
    }
  }

  function renderDevices() {
    deviceSelect.innerHTML = '';

    for (const dev of devices) {
      const opt = document.createElement('option');
      opt.value = dev.id;
      opt.textContent = dev.name + ' (Online)';
      deviceSelect.appendChild(opt);
    }

    const saveOpt = document.createElement('option');
    saveOpt.value = SAVE_FOR_LATER_ID;
    saveOpt.textContent = 'Für später speichern (Lokal in Extension)';
    deviceSelect.appendChild(saveOpt);

    // Apply preferred device selection logic
    const pref = settings.DEFAULT_PREFERRED_JD;
    const lastUsed =
      settings.ADD_LINK_CACHED_OPTIONS && settings.ADD_LINK_CACHED_OPTIONS.device;

    let targetId = null;
    if (pref && pref.id) {
      if (pref.id === LAST_USED_ID && lastUsed && lastUsed.id) {
        targetId = lastUsed.id;
      } else if (pref.id === SAVE_FOR_LATER_ID) {
        targetId = SAVE_FOR_LATER_ID;
      } else if (pref.id === ASK_EVERY_TIME_ID) {
        editMode = true;
        targetId = devices[0] ? devices[0].id : SAVE_FOR_LATER_ID;
      } else {
        targetId = pref.id;
      }
    }

    if (targetId && Array.from(deviceSelect.options).some((o) => o.value === targetId)) {
      deviceSelect.value = targetId;
    } else if (devices.length > 0) {
      deviceSelect.value = devices[0].id;
    } else {
      deviceSelect.value = SAVE_FOR_LATER_ID;
    }
  }

  function updateAuthUI() {
    if (isLoggedIn) {
      connectionBadge.textContent = 'Verbunden';
      connectionBadge.className = 'badge-pill badge-online';
      loginSection.classList.add('hidden');
      sendConfigSection.classList.remove('hidden');
      footerActions.classList.remove('hidden');
    } else {
      connectionBadge.textContent = 'Nicht angemeldet';
      connectionBadge.className = 'badge-pill badge-offline';
      loginSection.classList.remove('hidden');
      sendConfigSection.classList.add('hidden');
      footerActions.classList.add('hidden');
      stopCountdown();
    }
  }

  function removeRequestById(requestId) {
    chrome.runtime.sendMessage(
      {
        name: 'myjd-toolbar',
        action: 'remove-request',
        data: { tabId: instanceId, requestId: requestId }
      },
      () => {
        requestQueue = requestQueue.filter((r) => r.id !== requestId);
        renderQueue();
        if (requestQueue.length === 0) {
          closeDialog();
        }
      }
    );
  }

  function closeDialog() {
    stopCountdown();
    chrome.runtime.sendMessage({
      name: 'myjd-toolbar',
      action: 'close-in-page-toolbar',
      data: { tabId: instanceId }
    });
    chrome.runtime.sendMessage({
      name: 'myjd-toolbar',
      action: 'remove-all-requests',
      data: { tabId: instanceId }
    });
    if (isPopup || window.parent === window) {
      chrome.runtime.sendMessage({
        name: 'close-me',
        data: { tabId: instanceId || 'self' }
      });
    }
  }

  function saveRequestsForLater(callback) {
    chrome.storage.local.get(['CLIPBOARD_HISTORY'], (res) => {
      const history = (res && res.CLIPBOARD_HISTORY) || {};
      for (const req of requestQueue) {
        history[req.id] = req;
      }
      chrome.storage.local.set({ CLIPBOARD_HISTORY: history }, () => {
        if (callback) callback();
      });
    });
  }

  async function sendAllRequests() {
    stopCountdown();
    showError('');
    if (requestQueue.length === 0) {
      closeDialog();
      return;
    }

    const selectedDeviceId = deviceSelect.value || SAVE_FOR_LATER_ID;
    if (selectedDeviceId === SAVE_FOR_LATER_ID) {
      saveRequestsForLater(() => {
        successBox.textContent = 'Pakete für später gespeichert!';
        successBox.classList.remove('hidden');
        setTimeout(closeDialog, 700);
      });
      return;
    }

    const selectedDevice = devices.find((d) => d.id === selectedDeviceId) || {
      id: selectedDeviceId,
      name: 'JDownloader'
    };

    sendBtn.disabled = true;
    sendBtn.textContent = 'Sende an ' + selectedDevice.name + '...';

    try {
      for (const request of requestQueue) {
        const query = {};

        if (optComment.value.trim()) query.comment = optComment.value.trim();
        if (optSaveTo.value.trim()) query.destinationFolder = optSaveTo.value.trim();
        if (optArchivePw.value.trim()) query.extractPassword = optArchivePw.value.trim();
        if (optDownloadPw.value.trim()) query.downloadPassword = optDownloadPw.value.trim();
        if (optPackageName.value.trim()) query.packageName = optPackageName.value.trim();
        if (optPriority.value && optPriority.value !== 'DEFAULT') {
          query.priority = optPriority.value;
        }
        if (optAutoStart.checked) query.autostart = true;
        if (optAutoExtract.checked) query.autoExtract = true;
        if (optDeepDecrypt.checked) query.deepDecrypt = true;
        if (optOverwritePackagizer.checked) query.overwritePackagizerRules = true;

        if (request.type === 'cnl') {
          if (
            request.content &&
            request.content.requestBody &&
            request.content.requestBody.formData
          ) {
            query.links =
              request.content.dummyCnlUrl ||
              buildDummyCnlUrl(request.content.requestBody.formData);
          }
          if (request.content && request.content.url) {
            query.sourceUrl = request.content.url;
          }
          if (request.parent && request.parent.url) {
            query.sourceUrl = request.parent.url;
          }
          if (request.content && request.content.source) {
            query.sourceUrl = request.content.source;
          }
          if (request.content && request.content.urls) {
            query.links = (query.links ? query.links + '\r\n' : '') + request.content.urls;
          }
          if (request.content && request.content.passwords) {
            const pws = Array.isArray(request.content.passwords)
              ? request.content.passwords.join(' ')
              : String(request.content.passwords);
            if (pws) {
              query.downloadPassword = query.downloadPassword
                ? query.downloadPassword + ' ' + pws
                : pws;
            }
          }
          if (!query.packageName && request.content && request.content.package) {
            query.packageName = request.content.package;
          }
          query.permission = true;
        } else {
          query.links = '';
          if (request.previewText) {
            query.links = request.previewText + '\n\n';
          }
          query.links += request.content || '';
          if (request.parent && request.parent.url) {
            query.sourceUrl = request.parent.url;
          }
        }

        const resp = await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            {
              name: 'myjd-toolbar',
              action: 'add-link',
              data: {
                device: selectedDevice,
                query: query
              }
            },
            resolve
          );
        });

        if (resp && resp.error) {
          throw resp.error;
        }
      }

      // Persist last used device
      chrome.storage.local.set({
        ADD_LINK_CACHED_OPTIONS: {
          device: selectedDevice,
          autoStart: optAutoStart.checked,
          autoExtract: optAutoExtract.checked,
          deepDecrypt: optDeepDecrypt.checked,
          overwritePackagizer: optOverwritePackagizer.checked
        }
      });

      successBox.textContent = 'Erfolgreich an ' + selectedDevice.name + ' gesendet!';
      successBox.classList.remove('hidden');
      setTimeout(closeDialog, 700);
    } catch (err) {
      showError('Fehler beim Senden: ' + (err.type || err.message || JSON.stringify(err)));
      sendBtn.disabled = false;
      sendBtn.textContent = 'An JDownloader senden';
    }
  }

  function loadQueue(callback) {
    chrome.runtime.sendMessage(
      {
        name: 'myjd-toolbar',
        action: 'link-info',
        data: instanceId
      },
      (resp) => {
        requestQueue = (resp && Array.isArray(resp.data)) ? resp.data : [];
        renderQueue();
        if (callback) callback();
      }
    );
  }

  function refreshDevicesList(callback) {
    chrome.runtime.sendMessage(
      {
        name: 'myjd-toolbar',
        action: 'devices-pull'
      },
      (resp) => {
        if (resp && resp.data && Array.isArray(resp.data.devices)) {
          devices = resp.data.devices;
        }
        renderDevices();
        if (callback) callback();
      }
    );
  }

  function initialize() {
    chrome.storage.local.get(
      [
        'ADD_LINKS_DIALOG_ACTIVE',
        'COUNTDOWN_ACTIVE',
        'COUNTDOWN_VALUE',
        'DEFAULT_PREFERRED_JD',
        'CACHED_DEVICE_LIST',
        'ADD_LINK_CACHED_OPTIONS'
      ],
      (stored) => {
        const res = stored || {};
        if (res.ADD_LINKS_DIALOG_ACTIVE !== undefined) {
          settings.ADD_LINKS_DIALOG_ACTIVE = Boolean(res.ADD_LINKS_DIALOG_ACTIVE);
        }
        if (res.COUNTDOWN_ACTIVE !== undefined) {
          settings.COUNTDOWN_ACTIVE = Boolean(res.COUNTDOWN_ACTIVE);
        }
        if (res.COUNTDOWN_VALUE !== undefined) {
          settings.COUNTDOWN_VALUE = Number(res.COUNTDOWN_VALUE) || 3;
        }
        if (res.DEFAULT_PREFERRED_JD !== undefined) {
          settings.DEFAULT_PREFERRED_JD = res.DEFAULT_PREFERRED_JD;
        }
        if (res.ADD_LINK_CACHED_OPTIONS) {
          settings.ADD_LINK_CACHED_OPTIONS = res.ADD_LINK_CACHED_OPTIONS;
          optAutoStart.checked = Boolean(res.ADD_LINK_CACHED_OPTIONS.autoStart);
          optAutoExtract.checked = Boolean(res.ADD_LINK_CACHED_OPTIONS.autoExtract);
          optDeepDecrypt.checked = Boolean(res.ADD_LINK_CACHED_OPTIONS.deepDecrypt);
          optOverwritePackagizer.checked = Boolean(res.ADD_LINK_CACHED_OPTIONS.overwritePackagizer);
        }
        if (Array.isArray(res.CACHED_DEVICE_LIST)) {
          devices = res.CACHED_DEVICE_LIST;
        }

        chrome.runtime.sendMessage(
          { name: 'myjd-toolbar', action: 'session-info' },
          (sessionResp) => {
            isLoggedIn = Boolean(sessionResp && sessionResp.data && sessionResp.data.isLoggedIn);
            if (sessionResp && sessionResp.data && sessionResp.data.email) {
              headerSubtitle.textContent = sessionResp.data.email;
            }
            updateAuthUI();
            renderDevices();

            loadQueue(() => {
              if (isLoggedIn) {
                refreshDevicesList(() => {
                  if (!settings.ADD_LINKS_DIALOG_ACTIVE && devices.length > 0 && !editMode) {
                    sendAllRequests();
                  } else if (settings.COUNTDOWN_ACTIVE && !editMode) {
                    startCountdown();
                  }
                });
              }
            });
          }
        );
      }
    );
  }

  // Event Listeners
  closeBtn.addEventListener('click', closeDialog);
  cancelBtn.addEventListener('click', closeDialog);
  sendBtn.addEventListener('click', sendAllRequests);

  stopCountdownBtn.addEventListener('click', () => {
    editMode = true;
    stopCountdown();
    optionalFieldsPanel.classList.remove('hidden');
  });

  toggleOptionsBtn.addEventListener('click', () => {
    editMode = true;
    stopCountdown();
    optionalFieldsPanel.classList.toggle('hidden');
  });

  deviceSelect.addEventListener('change', () => {
    editMode = true;
    stopCountdown();
  });

  refreshDevicesBtn.addEventListener('click', () => {
    stopCountdown();
    refreshDevicesList();
  });

  saveOfflineBtn.addEventListener('click', () => {
    saveRequestsForLater(() => {
      successBox.textContent = 'Pakete für später gespeichert!';
      successBox.classList.remove('hidden');
      setTimeout(closeDialog, 700);
    });
  });

  loginBtn.addEventListener('click', () => {
    const email = loginEmail.value.trim();
    const password = loginPass.value;
    if (!email || !password) {
      showError('Bitte E-Mail und Passwort eingeben.');
      return;
    }
    showError('');
    loginBtn.disabled = true;
    loginBtn.textContent = 'Verbinde...';

    chrome.runtime.sendMessage(
      {
        name: 'myjd-toolbar',
        action: 'login',
        data: { credentials: { email: email, password: password } }
      },
      (resp) => {
        loginBtn.disabled = false;
        loginBtn.textContent = 'Anmelden';
        if (resp && resp.data === true) {
          isLoggedIn = true;
          headerSubtitle.textContent = email;
          if (Array.isArray(resp.devices)) {
            devices = resp.devices;
          }
          updateAuthUI();
          renderDevices();
        } else {
          showError('Anmeldung fehlgeschlagen. Bitte Zugangsdaten prüfen.');
        }
      }
    );
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg) return;
    if (msg.action === 'link-info-update' && String(msg.tabId) === String(instanceId)) {
      loadQueue();
    } else if (msg.action === 'session-change' && msg.data) {
      isLoggedIn = Boolean(msg.data.isLoggedIn);
      updateAuthUI();
      if (isLoggedIn) {
        refreshDevicesList();
      }
    }
  });

  initialize();
})();
