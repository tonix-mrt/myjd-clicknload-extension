'use strict';

(function () {
  const SAVE_FOR_LATER_DEVICE = { id: 'SaveForLaterDevice', name: 'Für später speichern' };
  const ASK_EVERY_TIME_DEVICE = { id: 'AskEveryTimeDevice', name: 'Jedes Mal fragen' };
  const LAST_USED_DEVICE = { id: 'LastUsedDevice', name: 'Zuletzt verwendetes Gerät' };

  let isLoggedIn = false;
  let devices = [];
  let savedItems = {};
  let activeTabName = 'tabDevices';

  // DOM Elements
  const accountEmailText = document.getElementById('accountEmailText');
  const statusBadge = document.getElementById('statusBadge');
  const logoutBtn = document.getElementById('logoutBtn');
  const mainTabs = document.getElementById('mainTabs');
  const popupAlert = document.getElementById('popupAlert');
  const popupSuccess = document.getElementById('popupSuccess');
  const cnlMasterToggle = document.getElementById('cnlMasterToggle');

  const loginView = document.getElementById('loginView');
  const emailInput = document.getElementById('emailInput');
  const passwordInput = document.getElementById('passwordInput');
  const connectBtn = document.getElementById('connectBtn');

  const tabDevices = document.getElementById('tabDevices');
  const tabSaved = document.getElementById('tabSaved');
  const tabSettings = document.getElementById('tabSettings');

  const reloadDevicesBtn = document.getElementById('reloadDevicesBtn');
  const devicesListContainer = document.getElementById('devicesListContainer');
  const manualLinksInput = document.getElementById('manualLinksInput');
  const manualPackageInput = document.getElementById('manualPackageInput');
  const sendManualLinksBtn = document.getElementById('sendManualLinksBtn');
  const testCnlBtn = document.getElementById('testCnlBtn');

  const savedCountBadge = document.getElementById('savedCountBadge');
  const clearSavedBtn = document.getElementById('clearSavedBtn');
  const savedListContainer = document.getElementById('savedListContainer');
  const sendSavedFooter = document.getElementById('sendSavedFooter');
  const sendAllSavedBtn = document.getElementById('sendAllSavedBtn');

  const prefDeviceSelect = document.getElementById('prefDeviceSelect');
  const settingShowDialog = document.getElementById('settingShowDialog');
  const settingCountdownActive = document.getElementById('settingCountdownActive');
  const settingCountdownSec = document.getElementById('settingCountdownSec');

  function showAlert(msg) {
    if (!msg) {
      popupAlert.classList.add('hidden');
      popupAlert.textContent = '';
      return;
    }
    popupSuccess.classList.add('hidden');
    popupAlert.textContent = typeof msg === 'string' ? msg : (msg.type || JSON.stringify(msg));
    popupAlert.classList.remove('hidden');
  }

  function showSuccess(msg) {
    popupAlert.classList.add('hidden');
    popupSuccess.textContent = msg;
    popupSuccess.classList.remove('hidden');
    setTimeout(() => {
      popupSuccess.classList.add('hidden');
    }, 2800);
  }

  function formatSpeed(bytesPerSec) {
    const bps = Number(bytesPerSec) || 0;
    if (bps <= 0) return '0 KB/s';
    if (bps >= 1024 * 1024) {
      return (bps / (1024 * 1024)).toFixed(2) + ' MB/s';
    }
    return (bps / 1024).toFixed(0) + ' KB/s';
  }

  function switchTab(tabId) {
    activeTabName = tabId;
    document.querySelectorAll('.nav-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
    });
    tabDevices.classList.toggle('hidden', tabId !== 'tabDevices');
    tabSaved.classList.toggle('hidden', tabId !== 'tabSaved');
    tabSettings.classList.toggle('hidden', tabId !== 'tabSettings');
  }

  function updateSessionUI(email) {
    if (isLoggedIn) {
      accountEmailText.textContent = email || 'Verbunden mit MyJDownloader';
      statusBadge.textContent = 'Online';
      statusBadge.className = 'badge-pill badge-online';
      logoutBtn.classList.remove('hidden');
      mainTabs.classList.remove('hidden');
      loginView.classList.add('hidden');
      switchTab(activeTabName);
    } else {
      accountEmailText.textContent = 'Nicht angemeldet';
      statusBadge.textContent = 'Offline';
      statusBadge.className = 'badge-pill badge-offline';
      logoutBtn.classList.add('hidden');
      mainTabs.classList.add('hidden');
      loginView.classList.remove('hidden');
      tabDevices.classList.add('hidden');
      tabSaved.classList.add('hidden');
      tabSettings.classList.add('hidden');
    }
  }

  function renderDevices() {
    devicesListContainer.innerHTML = '';

    if (devices.length === 0) {
      const empty = document.createElement('div');
      empty.style.color = 'var(--jd-muted)';
      empty.style.fontSize = '12px';
      empty.textContent = 'Kein aktiver JDownloader gefunden. Bitte starte JDownloader.';
      devicesListContainer.appendChild(empty);
      return;
    }

    for (const dev of devices) {
      const card = document.createElement('div');
      card.className = 'device-item';

      const left = document.createElement('div');
      const nameRow = document.createElement('div');
      nameRow.className = 'device-name';
      const dot = document.createElement('span');
      dot.className = 'device-dot';
      const nameSpan = document.createElement('span');
      nameSpan.textContent = dev.name;
      nameRow.appendChild(dot);
      nameRow.appendChild(nameSpan);

      const statsRow = document.createElement('div');
      statsRow.className = 'device-stats';
      statsRow.id = 'dev_stats_' + dev.id;
      statsRow.textContent = 'Verbunden • Bereit für Click\'n\'Load';

      left.appendChild(nameRow);
      left.appendChild(statsRow);

      const webBtn = document.createElement('a');
      webBtn.className = 'btn btn-secondary btn-sm';
      webBtn.href = 'https://my.jdownloader.org';
      webBtn.target = '_blank';
      webBtn.style.textDecoration = 'none';
      webBtn.textContent = 'Web UI ↗';

      card.appendChild(left);
      card.appendChild(webBtn);
      devicesListContainer.appendChild(card);

      // Poll live stats for device
      chrome.runtime.sendMessage(
        {
          name: 'myjd-toolbar',
          action: 'device-poll',
          data: { device: dev }
        },
        (resp) => {
          const el = document.getElementById('dev_stats_' + dev.id);
          if (!el || !resp || !resp.data) return;
          const st = resp.data.state || 'IDLE';
          const spd = formatSpeed(resp.data.speed);
          el.textContent = `Status: ${st} • Speed: ${spd}`;
        }
      );
    }
  }

  function populatePreferredDeviceDropdown(currentPref) {
    prefDeviceSelect.innerHTML = '';
    const builtIns = [ASK_EVERY_TIME_DEVICE, LAST_USED_DEVICE, SAVE_FOR_LATER_DEVICE];

    for (const item of builtIns) {
      const opt = document.createElement('option');
      opt.value = item.id;
      opt.textContent = item.name;
      prefDeviceSelect.appendChild(opt);
    }

    for (const dev of devices) {
      const opt = document.createElement('option');
      opt.value = dev.id;
      opt.textContent = 'Gerät: ' + dev.name;
      prefDeviceSelect.appendChild(opt);
    }

    if (currentPref && currentPref.id) {
      const exists = Array.from(prefDeviceSelect.options).some((o) => o.value === currentPref.id);
      if (!exists) {
        const customOpt = document.createElement('option');
        customOpt.value = currentPref.id;
        customOpt.textContent = 'Gerät: ' + (currentPref.name || currentPref.id);
        prefDeviceSelect.appendChild(customOpt);
      }
      prefDeviceSelect.value = currentPref.id;
    } else {
      prefDeviceSelect.value = ASK_EVERY_TIME_DEVICE.id;
    }
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

  function renderSavedItems() {
    const entries = Object.values(savedItems || {});
    savedCountBadge.textContent = String(entries.length);
    savedListContainer.innerHTML = '';

    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.style.color = 'var(--jd-muted)';
      empty.style.fontSize = '12px';
      empty.textContent = 'Keine lokal gespeicherten Pakete vorhanden.';
      savedListContainer.appendChild(empty);
      sendSavedFooter.classList.add('hidden');
      return;
    }

    sendSavedFooter.classList.remove('hidden');

    for (const item of entries) {
      const row = document.createElement('div');
      row.className = 'cnl-item';

      const info = document.createElement('div');
      info.className = 'cnl-item-info';

      const title = document.createElement('div');
      title.className = 'cnl-item-title';
      title.textContent =
        (item.content && item.content.package) ||
        (item.parent && item.parent.title) ||
        item.previewText ||
        item.content ||
        'CNL Paket';

      const meta = document.createElement('div');
      meta.className = 'cnl-item-meta';
      meta.textContent =
        (item.content && item.content.source) ||
        (item.parent && item.parent.url) ||
        'Click\'n\'Load';

      info.appendChild(title);
      info.appendChild(meta);

      const delBtn = document.createElement('button');
      delBtn.className = 'icon-btn';
      delBtn.innerHTML = '&#10005;';
      delBtn.title = 'Löschen';
      delBtn.addEventListener('click', () => {
        delete savedItems[item.id];
        chrome.storage.local.set({ CLIPBOARD_HISTORY: savedItems }, renderSavedItems);
      });

      row.appendChild(info);
      row.appendChild(delBtn);
      savedListContainer.appendChild(row);
    }
  }

  function refreshDevices() {
    chrome.runtime.sendMessage({ name: 'myjd-toolbar', action: 'devices-pull' }, (resp) => {
      if (resp && resp.data && Array.isArray(resp.data.devices)) {
        devices = resp.data.devices;
        renderDevices();
        chrome.storage.local.get(['DEFAULT_PREFERRED_JD'], (s) => {
          populatePreferredDeviceDropdown(s && s.DEFAULT_PREFERRED_JD);
        });
      }
    });
  }

  function loadAllState() {
    chrome.storage.local.get(
      [
        'CLICKNLOAD_ACTIVE',
        'ADD_LINKS_DIALOG_ACTIVE',
        'COUNTDOWN_ACTIVE',
        'COUNTDOWN_VALUE',
        'DEFAULT_PREFERRED_JD',
        'CACHED_DEVICE_LIST',
        'CLIPBOARD_HISTORY'
      ],
      (res) => {
        const data = res || {};
        cnlMasterToggle.checked =
          data.CLICKNLOAD_ACTIVE !== undefined ? Boolean(data.CLICKNLOAD_ACTIVE) : true;
        settingShowDialog.checked =
          data.ADD_LINKS_DIALOG_ACTIVE !== undefined ? Boolean(data.ADD_LINKS_DIALOG_ACTIVE) : true;
        settingCountdownActive.checked =
          data.COUNTDOWN_ACTIVE !== undefined ? Boolean(data.COUNTDOWN_ACTIVE) : true;
        settingCountdownSec.value =
          data.COUNTDOWN_VALUE !== undefined ? Number(data.COUNTDOWN_VALUE) : 3;

        if (Array.isArray(data.CACHED_DEVICE_LIST)) {
          devices = data.CACHED_DEVICE_LIST;
        }
        savedItems = data.CLIPBOARD_HISTORY || {};
        renderSavedItems();
        populatePreferredDeviceDropdown(data.DEFAULT_PREFERRED_JD);

        chrome.runtime.sendMessage({ name: 'myjd-toolbar', action: 'session-info' }, (session) => {
          isLoggedIn = Boolean(session && session.data && session.data.isLoggedIn);
          const email = session && session.data ? session.data.email : '';
          updateSessionUI(email);
          if (isLoggedIn) {
            renderDevices();
            refreshDevices();
          }
        });
      }
    );
  }

  // Event Listeners
  document.querySelectorAll('.nav-tab').forEach((tabBtn) => {
    tabBtn.addEventListener('click', () => {
      switchTab(tabBtn.getAttribute('data-tab'));
    });
  });

  cnlMasterToggle.addEventListener('change', () => {
    chrome.storage.local.set({ CLICKNLOAD_ACTIVE: cnlMasterToggle.checked });
  });

  connectBtn.addEventListener('click', () => {
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) {
      showAlert('Bitte E-Mail-Adresse und Passwort eingeben.');
      return;
    }
    showAlert('');
    connectBtn.disabled = true;
    connectBtn.textContent = 'Verbinde...';

    chrome.runtime.sendMessage(
      {
        name: 'myjd-toolbar',
        action: 'login',
        data: { credentials: { email: email, password: password } }
      },
      (resp) => {
        connectBtn.disabled = false;
        connectBtn.textContent = 'Anmelden';
        if (resp && resp.data === true) {
          isLoggedIn = true;
          if (Array.isArray(resp.devices)) {
            devices = resp.devices;
          }
          updateSessionUI(email);
          renderDevices();
          chrome.storage.local.get(['DEFAULT_PREFERRED_JD'], (s) => {
            populatePreferredDeviceDropdown(s && s.DEFAULT_PREFERRED_JD);
          });
          showSuccess('Erfolgreich mit MyJDownloader verbunden!');
        } else {
          showAlert('Anmeldung fehlgeschlagen. Bitte prüfe E-Mail & Passwort.');
        }
      }
    );
  });

  passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') connectBtn.click();
  });

  logoutBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ name: 'myjd-toolbar', action: 'logout' }, () => {
      isLoggedIn = false;
      devices = [];
      updateSessionUI('');
    });
  });

  reloadDevicesBtn.addEventListener('click', refreshDevices);

  sendManualLinksBtn.addEventListener('click', () => {
    const linksText = manualLinksInput.value.trim();
    if (!linksText) {
      showAlert('Bitte mindestens einen Link eingeben.');
      return;
    }
    if (devices.length === 0) {
      showAlert('Kein verbundener JDownloader verfügbar.');
      return;
    }
    const targetDevice = devices[0];
    const query = {
      links: linksText,
      permission: true
    };
    if (manualPackageInput.value.trim()) {
      query.packageName = manualPackageInput.value.trim();
    }

    sendManualLinksBtn.disabled = true;
    chrome.runtime.sendMessage(
      {
        name: 'myjd-toolbar',
        action: 'add-link',
        data: { device: targetDevice, query: query }
      },
      (resp) => {
        sendManualLinksBtn.disabled = false;
        if (resp && !resp.error) {
          manualLinksInput.value = '';
          manualPackageInput.value = '';
          showSuccess('Links an ' + targetDevice.name + ' gesendet!');
        } else {
          showAlert('Fehler beim Senden an JDownloader.');
        }
      }
    );
  });

  testCnlBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ name: 'myjd-toolbar', action: 'simulate-cnl-test' }, () => {
      window.close();
    });
  });

  clearSavedBtn.addEventListener('click', () => {
    savedItems = {};
    chrome.storage.local.set({ CLIPBOARD_HISTORY: {} }, renderSavedItems);
  });

  sendAllSavedBtn.addEventListener('click', async () => {
    const entries = Object.values(savedItems || {});
    if (entries.length === 0) return;
    if (devices.length === 0) {
      showAlert('Kein verbundener JDownloader zum Senden verfügbar.');
      return;
    }
    const targetDevice = devices[0];
    sendAllSavedBtn.disabled = true;

    try {
      for (const request of entries) {
        const query = { permission: true };
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
          if (request.content && request.content.source) {
            query.sourceUrl = request.content.source;
          }
          if (request.content && request.content.package) {
            query.packageName = request.content.package;
          }
        } else {
          query.links = request.content || '';
        }

        await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            {
              name: 'myjd-toolbar',
              action: 'add-link',
              data: { device: targetDevice, query: query }
            },
            resolve
          );
        });
      }

      savedItems = {};
      chrome.storage.local.set({ CLIPBOARD_HISTORY: {} }, () => {
        renderSavedItems();
        showSuccess('Alle gespeicherten Pakete an ' + targetDevice.name + ' gesendet!');
      });
    } catch (e) {
      showAlert('Fehler beim Senden gespeicherter Pakete.');
    } finally {
      sendAllSavedBtn.disabled = false;
    }
  });

  // Settings Listeners
  prefDeviceSelect.addEventListener('change', () => {
    const val = prefDeviceSelect.value;
    const text = prefDeviceSelect.options[prefDeviceSelect.selectedIndex].textContent.replace(
      /^Gerät:\s*/,
      ''
    );
    chrome.storage.local.set({
      DEFAULT_PREFERRED_JD: { id: val, name: text }
    });
  });

  settingShowDialog.addEventListener('change', () => {
    chrome.storage.local.set({ ADD_LINKS_DIALOG_ACTIVE: settingShowDialog.checked });
  });

  settingCountdownActive.addEventListener('change', () => {
    chrome.storage.local.set({ COUNTDOWN_ACTIVE: settingCountdownActive.checked });
  });

  settingCountdownSec.addEventListener('change', () => {
    const sec = Math.max(1, Math.min(30, Number(settingCountdownSec.value) || 3));
    settingCountdownSec.value = String(sec);
    chrome.storage.local.set({ COUNTDOWN_VALUE: sec });
  });

  loadAllState();
})();
