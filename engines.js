/* Clinical engines: findings, cross-system, coverage, differential, red flags.
   Findings states: pos | neg | unk | na | unasked  (unasked is NEVER treated as negative). */
var Engine = (function () {
  var D = null, L = {}, Q = {};
  function use(d) {
    D = d; L = {}; Q = {};
    d.s.symptoms.forEach(function (x) { L[x.id] = x.lbl; });
    d.s.questions.forEach(function (x) { L[x.id] = x.lbl; Q[x.id] = x; });
    d.s.exam.forEach(function (x) { L[x.id] = x.lbl; Q[x.id] = x; });
    L.age_over_60 = 'Age 60 or over'; L.pregnant = 'Pregnancy'; L.female = 'Female sex';
    return D;
  }
  function load() {
    return Promise.all(['symptoms', 'diseases', 'red-flags', 'packs'].map(function (n) {
      return fetch(n + '.json').then(function (r) { return r.json(); });
    })).then(function (a) {
      var d = { s: a[0], d: a[1], r: a[2] };
      return Promise.all(a[3].packs.map(function (f) { return fetch(f).then(function (r) { return r.json(); }); })).then(function (ps) {
        ps.forEach(function (p) {
          (p.symptoms || []).forEach(function (x) {
            var ex = d.s.symptoms.filter(function (y) { return y.id === x.id; })[0];
            if (!ex) { d.s.symptoms.push(x); return; }
            x.depts.forEach(function (dp) { if (ex.depts.indexOf(dp) < 0) ex.depts.push(dp); });
          });
          (p.questions || []).forEach(function (x) { d.s.questions.push(x); });
          (p.exam || []).forEach(function (x) { d.s.exam.push(x); });
          (p.diseases || []).forEach(function (x) { d.d.diseases.push(x); });
          (p.flags || []).forEach(function (x) { d.r.flags.push(x); });
        });
        ps.forEach(function (p) {
          var pt = p.patch || {};
          Object.keys(pt.diseases || {}).forEach(function (id) {
            var x = d.d.diseases.filter(function (y) { return y.id === id; })[0]; if (!x) return;
            pt.diseases[id].triggers.forEach(function (t) { if (x.triggers.indexOf(t) < 0) x.triggers.push(t); });
            Object.keys(pt.diseases[id].f).forEach(function (k) { if (pt.diseases[id].f[k]) x.f[k] = pt.diseases[id].f[k]; });
          });
          Object.keys(pt.questions || {}).forEach(function (id) {
            var x = d.s.questions.filter(function (y) { return y.id === id; })[0]; if (!x) return;
            pt.questions[id].forEach(function (w) { if (x.when.indexOf(w) < 0) x.when.push(w); });
          });
          Object.keys(pt.exam || {}).forEach(function (id) {
            var x = d.s.exam.filter(function (y) { return y.id === id; })[0]; if (!x) return;
            pt.exam[id].forEach(function (w) { if (x.when.indexOf(w) < 0) x.when.push(w); });
          });
        });
        return use(d);
      });
    });
  }
  function view(c, stage) {
    var f = c.findings || {}, p = c.patient || {}, der = {}, age = parseFloat(p.age);
    if (p.sex) der.female = p.sex === 'F' ? 'pos' : 'neg';
    if (!isNaN(age)) der.age_over_60 = age >= 60 ? 'pos' : 'neg';
    if (p.pregnant) der.pregnant = 'pos';
    return function (k) {
      if (der[k]) return der[k];
      var x = f[k]; if (!x) return 'unasked';
      if (stage === 1 && x.src === 'e') return 'unasked';
      return x.s;
    };
  }
  function selected(c) { var v = view(c, 2); return D.s.symptoms.filter(function (s) { return v(s.id) === 'pos'; }); }
  function systems(c) {
    var out = [];
    selected(c).forEach(function (s) { s.systems.forEach(function (x) { if (out.indexOf(x) < 0) out.push(x); }); });
    return out;
  }
  function applicable(c) {
    var v = view(c, 2), sx = (c.patient || {}).sex, sel = selected(c).map(function (s) { return s.id; });
    return D.s.questions.filter(function (q) {
      if (q.sex && q.sex !== sx) return false;
      if (!q.when.length) return true;
      if (q.when.indexOf('*') >= 0) return sel.length > 0;
      return q.when.some(function (w) { return sel.indexOf(w) >= 0; });
    });
  }
  function applicableExam(c) {
    var sel = selected(c).map(function (s) { return s.id; }), f = c.findings || {};
    return D.s.exam.filter(function (x) { return f[x.id] || !x.when || !x.when.length || x.when.some(function (w) { return sel.indexOf(w) >= 0; }); });
  }
  function coverage(c) {
    var v = view(c, 2), qs = applicable(c);
    var un = qs.filter(function (q) { return v(q.id) === 'unasked'; });
    return { total: qs.length, answered: qs.length - un.length, unanswered: un };
  }
  function differential(c, stage) {
    var v = view(c, stage), sex = (c.patient || {}).sex, res = [];
    D.d.diseases.forEach(function (d) {
      if (d.sex && d.sex !== sex) return;
      var trig = d.triggers.filter(function (k) { return v(k) === 'pos'; });
      if (!trig.length) return;
      var r = { d: d, score: 0, sup: [], against: [], missing: [], trig: trig.map(function (k) { return L[k]; }) };
      Object.keys(d.f).forEach(function (k) {
        var w = d.f[k], st = v(k);
        if (st === 'pos') { r.score += w; r.sup.push(L[k]); }
        else if (st === 'neg' && w >= 2) { r.score -= 1; r.against.push(L[k] + ' (reported absent)'); }
        else if ((st === 'unasked' || st === 'unk') && Q[k]) r.missing.push({ k: k, w: w });
      });
      res.push(r);
    });
    res.sort(function (a, b) { return b.score - a.score; });
    var g = {
      strong: res.filter(function (r) { return !r.d.cm && r.score >= 6; }),
      cm: res.filter(function (r) { return r.d.cm; }),
      plausible: res.filter(function (r) { return !r.d.cm && r.score >= 1 && r.score < 6; }),
      other: res.filter(function (r) { return !r.d.cm && r.score < 1; })
    };
    var acc = {};
    res.slice(0, 5).forEach(function (r) { r.missing.forEach(function (m) { acc[m.k] = (acc[m.k] || 0) + m.w; }); });
    var next = Object.keys(acc).sort(function (a, b) { return acc[b] - acc[a]; }).slice(0, 3).map(function (k) { return Q[k].text || L[k]; });
    var why = [], norules = selected(c).filter(function (s) {
      return !D.d.diseases.some(function (x) { return x.triggers.indexOf(s.id) >= 0; });
    }).map(function (s) { return s.lbl; });
    if (norules.length) why.push('No diagnostic rules written yet for: ' + norules.join(', ') + '. Use your own history and examination reasoning for these.');
    if (res.length > 1 && res[0].score - res[1].score <= 2) why.push('The top two possibilities carry similar weight.');
    var cov = coverage(c); if (cov.unanswered.length) why.push(cov.unanswered.length + ' applicable question(s) not yet answered.');
    if (stage === 2 && !Object.keys(c.findings || {}).some(function (k) { return c.findings[k].src === 'e'; })) why.push('No examination findings entered yet.');
    return { list: res, groups: g, next: next, why: why, norules: norules };
  }
  function redFlags(c) {
    var v = view(c, 2), p = c.patient || {}, vt = c.vitals || {}, out = [];
    D.r.flags.forEach(function (f) {
      if (f.sex && f.sex !== p.sex) return;
      if (!f.all.every(function (k) { return v(k) === 'pos'; })) return;
      var hit = [];
      if (f.anyOf) { hit = f.anyOf.filter(function (k) { return v(k) === 'pos'; }); if (!hit.length) return; }
      out.push({ text: f.text, why: f.all.concat(hit).map(function (k) { return L[k]; }).join(' + ') });
    });
    var spo2 = parseFloat(vt.spo2), rr = parseFloat(vt.rr), sbp = parseFloat(vt.sbp);
    if (spo2 < 90) out.push({ text: 'Severe hypoxia (SpO2 below 90%)', why: 'SpO2 ' + spo2 + '%' });
    else if (spo2 < 94) out.push({ text: 'Low oxygen saturation (below 94%)', why: 'SpO2 ' + spo2 + '%' });
    if (sbp < 90) out.push({ text: 'Hypotension (systolic below 90)', why: 'SBP ' + sbp });
    var q = [rr >= 22, sbp <= 100, v('confusion') === 'pos'].filter(Boolean).length;
    if (q >= 2) out.push({ text: 'qSOFA 2 or more: possible sepsis, assess urgently', why: 'qSOFA is a bedside risk screen in suspected infection, not a diagnosis' });
    return out;
  }
  return { load: load, use: use, view: view, selected: selected, systems: systems, applicable: applicable, applicableExam: applicableExam,
           coverage: coverage, differential: differential, redFlags: redFlags, label: function (k) { return L[k] || k; },
           data: function () { return D; } };
})();
if (typeof module !== 'undefined') module.exports = Engine;
