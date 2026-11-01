/* Local database (IndexedDB). All data stays on this phone. NOT encrypted. */
var DB = (function () {
  var dbp;
  function open() {
    return dbp || (dbp = new Promise(function (res, rej) {
      var r = indexedDB.open('mbbs-assistant', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('cases', { keyPath: 'id' }); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    }));
  }
  function tx(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction('cases', mode), rq = fn(t.objectStore('cases'));
        t.oncomplete = function () { res(rq && rq.result); };
        t.onerror = function () { rej(t.error); };
      });
    });
  }
  function exportAll() {
    return tx('readonly', function (s) { return s.getAll(); }).then(function (all) {
      var blob = new Blob([JSON.stringify({ app: 'mbbs-assistant', exported: new Date().toISOString(), cases: all })], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'mbbs-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      return all.length;
    });
  }
  function importFile(file) {
    return file.text().then(function (t) {
      var d = JSON.parse(t);
      if (!d.cases || !d.cases.length && d.app !== 'mbbs-assistant') throw new Error('Not a backup file');
      return Promise.all(d.cases.map(function (c) { return tx('readwrite', function (s) { return s.put(c); }); })).then(function () { return d.cases.length; });
    });
  }
  return {
    put: function (c) { return tx('readwrite', function (s) { return s.put(c); }); },
    get: function (id) { return tx('readonly', function (s) { return s.get(id); }); },
    all: function () { return tx('readonly', function (s) { return s.getAll(); }); },
    del: function (id) { return tx('readwrite', function (s) { return s.delete(id); }); },
    exportAll: exportAll, importFile: importFile
  };
})();
