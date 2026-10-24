# MyJDownloader Click'n'Load (Manifest V3)

A lightweight, Manifest V3 browser extension for **Google Chrome** and **Microsoft Edge** that replicates the **Click'n'Load** functionality of the official MyJDownloader extension using the **MyJDownloader Cloud API**.

## Features

- **Click'n'Load Interception (`127.0.0.1:9666` & `localhost:9666`)**:
  - Intercepts `/jdcheck.js`, `/crossdomain.xml`, `/flash/add`, and `/flash/addcrypted2` requests via `declarativeNetRequest` (using CSP-safe local extension resources) and `webRequest`.
  - Automatically injects `window.jdownloader = true` when sites check for a running JDownloader instance.
  - Automatically closes blank Click'n'Load popup tabs/windows and displays a sleek in-page overlay in the active tab.
- **MyJDownloader Cloud API Integration**:
  - Full SHA-256 + AES-128-CBC + HMAC-SHA256 implementation (`https://api.jdownloader.org`).
  - Automatic session persistence, token refresh (`/my/reconnect`), and local direct connection probing (`*.mydns.jdownloader.org`).
  - Converts encrypted Click'n'Load payloads (`crypted`, `jk`, `k`, `source`, `passwords`, `package`) into the `https://dummycnl.jdownloader.org/#<hex>` format for `/linkgrabberv2/addLinks`.
- **In-Page Overlay & Popup UI**:
  - Device selection, configurable auto-send countdown timer, "Save for later" offline queue, and optional parameters (package name, destination folder, archive/download passwords, priority, autostart, auto-extract, deep decrypt).
  - Context menu integration (*"Mit JDownloader herunterladen"*).
  - Built-in 1-click **Click'n'Load Live Test** in the extension popup.

## Installation (Chrome / Edge)

1. Open `chrome://extensions` (Chrome) or `edge://extensions` (Edge).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this repository folder.
4. Click the extension icon in the toolbar and sign in with your **MyJDownloader** account.
