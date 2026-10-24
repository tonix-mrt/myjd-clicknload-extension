'use strict';

if (typeof browser !== 'undefined' && typeof chrome === 'undefined') {
  var chrome = browser;
}

if (window.myJDAddLinksToolbarInjected !== true) {
  window.myJDAddLinksToolbarInjected = true;

  let toolbarUI = null;

  function createIFrame(tabId) {
    let iframe = document.getElementById('myjd_toolbar_' + tabId);
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.setAttribute(
        'style',
        'overflow:hidden; height: 480px; max-height: 92vh; margin: 0px; padding: 0px; position: fixed; right: 12px; top: 12px; width: 410px; z-index: 2147483647; border: 0px; background: transparent; color-scheme: normal;'
      );
      iframe.setAttribute('id', 'myjd_toolbar_' + tabId);
      iframe.setAttribute('frameborder', '0');
      iframe.setAttribute('allowtransparency', 'true');
      iframe.setAttribute('src', chrome.runtime.getURL('toolbar.html') + '?id=' + encodeURIComponent(tabId));
    }
    return iframe;
  }

  function appendIFrame(tabId) {
    if (!document.body) {
      document.addEventListener(
        'DOMContentLoaded',
        function () {
          appendIFrame(tabId);
        },
        { once: true }
      );
      return;
    }
    if (toolbarUI && toolbarUI.iframe) {
      if (!toolbarUI.visible) {
        document.body.appendChild(toolbarUI.iframe);
        toolbarUI.visible = true;
      }
    } else {
      const iframe = createIFrame(tabId);
      toolbarUI = { iframe: iframe, visible: true };
      document.body.appendChild(iframe);
    }
  }

  function removeIFrame() {
    if (!toolbarUI) return;
    try {
      if (toolbarUI.iframe && toolbarUI.iframe.parentNode) {
        toolbarUI.iframe.parentNode.removeChild(toolbarUI.iframe);
      }
    } catch (e) {}
    toolbarUI.iframe = null;
    toolbarUI.visible = false;
  }

  if (window.parent === window) {
    try {
      chrome.runtime.sendMessage(
        { name: 'myjd-toolbar', action: 'tab-contentscript-injected' },
        function () {
          if (chrome.runtime && chrome.runtime.lastError) {}
        }
      );
    } catch (e) {}

    chrome.runtime.onMessage.addListener(function (msg) {
      if (!msg || !msg.action) return;
      if (msg.action === 'open-in-page-toolbar') {
        appendIFrame(msg.tabId);
      } else if (msg.action === 'close-in-page-toolbar' || msg.action === 'remove-dialog') {
        removeIFrame();
      } else if (msg.action === 'get-selection') {
        const selection = window.getSelection();
        const text = selection ? selection.toString() : '';
        let html = '';
        if (selection && selection.rangeCount > 0) {
          const container = document.createElement('div');
          for (let i = 0; i < selection.rangeCount; i++) {
            container.appendChild(selection.getRangeAt(i).cloneContents());
          }
          html = container.innerHTML;
        }
        chrome.runtime.sendMessage(
          {
            name: 'myjd-selection',
            action: 'new-selection',
            data: { text: text, html: html || text }
          },
          function () {
            if (chrome.runtime && chrome.runtime.lastError) {}
          }
        );
      }
    });
  }
}
