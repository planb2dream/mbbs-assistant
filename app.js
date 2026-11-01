/* MBBS Clinical Assistant - Phase 1 (app shell)
   This file controls: screens, navigation, offline status, updates.
   Later phases add engines in /engines and /storage. */
(function () {
  'use strict';

  // ---------- Feature tracker (we update this every phase) ----------
  var PHASES = [
    { n: 1, name: 'App shell, offline caching, updates', done: true },
    { n: 2, name: 'Patient registration and local database', done: true },
    { n: 3, name: 'History taking (core)', done: true },
    { n: 4, name: 'Cross-system activation', done: true },
    { n: 5, name: 'Coverage checker', done: true },
    { n: 6, name: 'Live differential', done: true },
    { n: 7, name: 'Red flags', done: true },
    { n: 8, name: 'Examination (core)', done: true },
    { n: 9, name: 'Comparison and reasoning', done: true },
    { n: 10, name: 'Report and print to PDF', done: true },
    { n: 11, name: 'Knowledge and viva (starter)', done: true },
    { n: 12, name: 'PIN lock, encryption, validation', done: false }
  ];

  var MENU = [
    { id: 'new-patient', label: 'New patient (history to report)', phase: 1 },
    { id: 'saved-cases', label: 'Saved cases and backup', phase: 1 },
    { id: 'knowledge', label: 'Medical knowledge', phase: 1 },
    { id: 'learning', label: 'MBBS viva and learning', phase: 1 },
    { id: 'settings', label: 'Settings', phase: 1 }
  ];

  var screenEl = document.getElementById('screen');
  var titleEl = document.getElementById('topbar-title');
  var netPill = document.getElementById('net-pill');
  var updateBanner = document.getElementById('update-banner');
  var waitingWorker = null;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- Screens ----------
  var screens = window.MBBS_SCREENS = window.MBBS_SCREENS || {};

  screens.home = function () {
    var doneCount = PHASES.filter(function (p) { return p.done; }).length;
    var items = MENU.map(function (m) {
      var ready = true;
      var tag = ready ? '<span class="tag done">Ready</span>' : '<span class="tag soon">Phase ' + m.phase + '</span>';
      return '<li><a href="#' + m.id + '"><span>' + esc(m.label) + '</span>' + tag + '</a></li>';
    }).join('');
    return {
      title: 'Home',
      html:
        '<h1>Clinical history and differential diagnosis</h1>' +
        '<p class="muted">An offline learning tool for MBBS students. It supports your clinical thinking. It does not replace a doctor\'s judgement.</p>' +
        '<div class="notice warn"><strong>Educational use only.</strong> Starter clinical content: 18 complaints and 42 conditions across several departments. Not for real patient decisions until reviewed by qualified doctors.</div>' +
        '<div class="card"><ul class="menu-list">' + items + '</ul></div>' +
        '<p class="muted">Build progress: ' + doneCount + ' of ' + PHASES.length + ' phases complete.</p>'
    };
  };

  screens.settings = function () {
    return {
      title: 'Settings',
      html:
        '<h1>Settings</h1>' +
        '<h2>App status</h2>' +
        '<div class="card"><dl class="kv" id="status-list"><dt>Loading…</dt><dd></dd></dl></div>' +
        '<div class="btn-row">' +
          '<button class="btn" id="btn-check">Check for update</button>' +
          '<button class="btn btn-secondary" id="btn-persist">Protect stored data</button>' +
        '</div>' +
        '<p class="muted" id="settings-msg" role="status"></p>' +
        '<h2>Privacy</h2>' +
        '<div class="notice warn">Patient data stays on this phone. The local database is <strong>not encrypted</strong> by default, so anyone who can open this app can read saved cases. Use a phone screen lock. Use anonymised identifiers instead of real names. PIN lock and encrypted backup are planned in Phase 12.</div>',
      after: function () {
        refreshStatus();
        document.getElementById('btn-check').addEventListener('click', checkForUpdate);
        document.getElementById('btn-persist').addEventListener('click', requestPersist);
      }
    };
  };

  // Placeholder for screens not built yet
  function comingSoon(id) {
    var item = MENU.filter(function (m) { return m.id === id; })[0];
    var label = item ? item.label : 'This screen';
    var phase = item ? item.phase : '?';
    return {
      title: label,
      html: '<h1>' + esc(label) + '</h1><div class="notice warn">Not built yet. Planned for Phase ' + esc(phase) + '.</div>'
    };
  }

  // ---------- Router ----------
  function route() {
    var parts = ((location.hash || '#home').slice(1) || 'home').split('/');
    var id = parts[0];
    var screen = (screens[id] || function () { return comingSoon(id); })(parts[1]);
    titleEl.textContent = screen.title === 'Home' ? 'MBBS Clinical Assistant' : screen.title;
    screenEl.innerHTML = screen.html;
    if (screen.after) screen.after();
    document.querySelectorAll('.tabbar a').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-tab') === id);
    });
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);

  // ---------- Online / offline indicator ----------
  function updateNet() {
    var on = navigator.onLine;
    netPill.textContent = on ? 'Online' : 'Offline';
    netPill.className = 'net-pill ' + (on ? 'online' : 'offline');
  }
  window.addEventListener('online', updateNet);
  window.addEventListener('offline', updateNet);

  // ---------- Status panel ----------
  function setMsg(t) { var m = document.getElementById('settings-msg'); if (m) m.textContent = t; }

  function refreshStatus() {
    var list = document.getElementById('status-list');
    if (!list) return;
    var rows = [];
    function row(k, v) { rows.push('<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>'); }
    row('App version', typeof APP_VERSION !== 'undefined' ? APP_VERSION : 'unknown');
    row('Installed as app', (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) ? 'Yes' : 'No (running in browser)');
    row('Connection now', navigator.onLine ? 'Online' : 'Offline');
    row('Service worker', 'serviceWorker' in navigator ? (navigator.serviceWorker.controller ? 'Active' : 'Not yet controlling') : 'Not supported');

    var tasks = [];
    if ('caches' in window) {
      tasks.push(caches.keys().then(function (keys) {
        var mine = keys.filter(function (k) { return k.indexOf('mbbs-assistant-') === 0; });
        if (!mine.length) { row('Offline files', 'None saved yet'); return; }
        return caches.open(mine[0]).then(function (c) { return c.keys(); }).then(function (reqs) {
          row('Offline files saved', reqs.length + ' files');
          row('Offline ready', reqs.length >= 15 ? 'Yes' : 'No');
        });
      }));
    }
    if (navigator.storage && navigator.storage.persisted) {
      tasks.push(navigator.storage.persisted().then(function (p) { row('Data protected from auto-clean', p ? 'Yes' : 'No'); }));
    }
    Promise.all(tasks).then(function () { list.innerHTML = rows.join(''); });
  }

  function requestPersist() {
    if (!(navigator.storage && navigator.storage.persist)) { setMsg('This browser does not support protected storage.'); return; }
    navigator.storage.persist().then(function (ok) {
      setMsg(ok ? 'Done. Android will not auto-delete this app\'s data when space is low.' : 'Not granted. Installing the app to your home screen usually helps.');
      refreshStatus();
    });
  }

  // ---------- Updates ----------
  function showUpdate(worker) { waitingWorker = worker; updateBanner.hidden = false; }

  function checkForUpdate() {
    if (!('serviceWorker' in navigator)) return;
    setMsg('Checking…');
    navigator.serviceWorker.getRegistration().then(function (reg) {
      if (!reg) { setMsg('Offline engine is not registered yet. Reload the page once.'); return; }
      return reg.update().then(function () {
        setTimeout(function () {
          setMsg(reg.waiting ? 'A new version is ready. Tap "Update now" at the top.' : (navigator.onLine ? 'You have the latest version.' : 'You are offline, so updates cannot be checked.'));
        }, 1200);
      });
    }).catch(function () { setMsg('Could not check. Are you online?'); });
  }

  document.getElementById('update-now').addEventListener('click', function () {
    if (waitingWorker) waitingWorker.postMessage('SKIP_WAITING');
  });

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('service-worker.js').then(function (reg) {
      if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);
      reg.addEventListener('updatefound', function () {
        var nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', function () {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdate(nw);
        });
      });
    }).catch(function (e) { console.error('Service worker failed:', e); });

    var reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (reloading) return; reloading = true; location.reload();
    });
  }

  // ---------- Start ----------
  updateNet();
  route();
  registerServiceWorker();
})();
