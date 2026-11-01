/* Screens for patients, cases, history, live differential, examination, report. */
(function () {
  'use strict';
  var S = window.MBBS_SCREENS = window.MBBS_SCREENS || {};
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var ANS = [['pos', 'Yes'], ['neg', 'No'], ['unk', 'Unknown'], ['na', 'N/A']];
  var EXA = [['pos', 'Present'], ['neg', 'Absent']];
  var SEX = { M: 'Male', F: 'Female', O: 'Other' };
  var STATE_TXT = { pos: 'Yes', neg: 'No', unk: 'Unknown', na: 'N/A' };

  function newPid() {
    var d = new Date(); return 'CASE-' + d.toISOString().slice(0, 10).replace(/-/g, '') + '-' + Math.floor(100 + Math.random() * 900);
  }

  // ---------- New patient ----------
  S['new-patient'] = function () {
    return {
      title: 'New case',
      html: '<h1>New patient</h1><div class="notice warn">Use an anonymised ID. Avoid real names (see Settings for privacy limits).</div>' +
        '<div class="card">' +
        '<label>Case ID<input id="f-pid" class="inp" value="' + esc(newPid()) + '"></label>' +
        '<label>Age (years)<input id="f-age" class="inp" type="number" min="0" max="120" inputmode="decimal"></label>' +
        '<label>Sex<select id="f-sex" class="inp"><option value="">Select</option><option value="M">Male</option><option value="F">Female</option><option value="O">Other</option></select></label>' +
        '<label id="f-preg-wrap" hidden class="chk"><input type="checkbox" id="f-preg"> Pregnant or postpartum</label>' +
        '<label>Department<select id="f-dept" class="inp"><option value="general-medicine">General Medicine</option></select></label>' +
        '<label>Informant<select id="f-inf" class="inp"><option>Patient</option><option>Relative</option><option>Other</option></select></label>' +
        '<label>Reliability of history<select id="f-rel" class="inp"><option>Good</option><option>Fair</option><option>Poor</option></select></label>' +
        '<button class="btn" id="f-go">Start case</button><p class="muted" id="f-msg" role="alert"></p></div>',
      after: function () {
        fetch('departments.json').then(function (r) { return r.json(); }).then(function (d) {
          document.getElementById('f-dept').innerHTML = d.departments.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.name) + '</option>'; }).join('');
        });
        document.getElementById('f-sex').onchange = function () { document.getElementById('f-preg-wrap').hidden = this.value !== 'F'; };
        document.getElementById('f-go').onclick = function () {
          var pid = document.getElementById('f-pid').value.trim(), age = document.getElementById('f-age').value;
          if (!pid || age === '' || !document.getElementById('f-sex').value) { document.getElementById('f-msg').textContent = 'Enter case ID, age and sex.'; return; }
          var c = { id: 'c' + Date.now(), created: Date.now(), updated: Date.now(),
            patient: { pid: pid, age: parseFloat(age), sex: document.getElementById('f-sex').value, pregnant: document.getElementById('f-preg').checked,
              dept: document.getElementById('f-dept').selectedOptions[0].text, deptId: document.getElementById('f-dept').value, informant: document.getElementById('f-inf').value, reliability: document.getElementById('f-rel').value },
            findings: {}, vitals: {}, notes: {} };
          DB.put(c).then(function () { location.hash = '#case/' + c.id; }).catch(function () { document.getElementById('f-msg').textContent = 'Could not save. Storage may be blocked.'; });
        };
      }
    };
  };

  // ---------- Saved cases ----------
  S['saved-cases'] = function () {
    return {
      title: 'Saved cases',
      html: '<h1>Saved cases</h1><input class="inp" id="q" type="search" placeholder="Search by ID, department, sex"><div id="list"></div>' +
        '<h2>Backup</h2><div class="notice warn">Backup files are plain text (not encrypted). Store them safely.</div>' +
        '<div class="btn-row"><button class="btn btn-secondary" id="bk">Save backup file</button>' +
        '<label class="btn btn-secondary">Restore backup<input type="file" id="rs" accept=".json" hidden></label></div><p class="muted" id="bk-msg" role="status"></p>',
      after: function () {
        var all = [];
        function draw() {
          var q = document.getElementById('q').value.toLowerCase();
          var rows = all.filter(function (c) { return (c.patient.pid + ' ' + c.patient.dept + ' ' + (SEX[c.patient.sex] || '')).toLowerCase().indexOf(q) >= 0; })
            .sort(function (a, b) { return b.updated - a.updated; });
          document.getElementById('list').innerHTML = rows.length ? rows.map(function (c) {
            return '<div class="card row"><a href="#case/' + c.id + '"><strong>' + esc(c.patient.pid) + '</strong><br><span class="muted">' + esc(c.patient.age) + 'y ' + esc(SEX[c.patient.sex] || '') + ' · ' + esc(c.patient.dept) + ' · ' + new Date(c.updated).toLocaleDateString() + '</span></a>' +
              '<button class="btn btn-secondary btn-small" data-del="' + c.id + '">Delete</button></div>';
          }).join('') : '<p class="muted">No cases yet. Tap "New case" to start.</p>';
        }
        function reload() { DB.all().then(function (r) { all = r || []; draw(); }); }
        reload();
        document.getElementById('q').oninput = draw;
        document.getElementById('list').onclick = function (e) {
          var id = e.target.getAttribute('data-del');
          if (id && confirm('Delete this case permanently?')) DB.del(id).then(reload);
        };
        var m = document.getElementById('bk-msg');
        document.getElementById('bk').onclick = function () { DB.exportAll().then(function (n) { m.textContent = 'Saved ' + n + ' case(s) to a file in Downloads.'; }); };
        document.getElementById('rs').onchange = function () { DB.importFile(this.files[0]).then(function (n) { m.textContent = 'Restored ' + n + ' case(s).'; reload(); }).catch(function () { m.textContent = 'That file is not a valid backup.'; }); };
      }
    };
  };

  // ---------- Case workspace ----------
  S.case = function (id) {
    return {
      title: 'Case',
      html: '<div id="case-root"><p class="muted">Loading…</p></div>',
      after: function () {
        var root = document.getElementById('case-root');
        Promise.all([DB.get(id), Engine.load()]).then(function (r) {
          if (!r[0]) { root.innerHTML = '<div class="notice alert">Case not found.</div>'; return; }
          workspace(root, r[0]);
        }).catch(function () { root.innerHTML = '<div class="notice alert">Could not load the case or the clinical data files.</div>'; });
      }
    };
  };

  function workspace(root, c) {
    var tab = 'complaints', stage = 2, D = Engine.data(), showAll = false;
    function save() { c.updated = Date.now(); return DB.put(c); }
    function setAns(k, s, src) {
      var cur = c.findings[k];
      if (cur && cur.s === s) delete c.findings[k]; else c.findings[k] = { s: s, src: src };
      save(); draw();
    }
    function btns(k, opts, src) {
      var cur = (c.findings[k] || {}).s;
      return opts.map(function (o) { return '<button class="ans ' + (cur === o[0] ? 'on ' + o[0] : '') + '" data-act="ans" data-k="' + k + '" data-v="' + o[0] + '" data-src="' + src + '" aria-pressed="' + (cur === o[0]) + '">' + o[1] + '</button>'; }).join('');
    }
    function ddxCard(r) {
      var d = r.d;
      return '<div class="card ddx' + (d.cm ? ' cm' : '') + '"><strong>' + esc(d.name) + '</strong>' + (d.cm ? ' <span class="tag alert">cannot miss</span>' : '') + ' <span class="tag">suspected</span>' +
        '<p class="muted">Considered because: ' + esc(r.trig.join(', ')) + ' present.</p>' +
        (r.sup.length ? '<p><b>Supporting:</b> ' + esc(r.sup.join('; ')) + '</p>' : '<p class="muted">No specific supporting features recorded yet.</p>') +
        (r.against.length ? '<p><b>Against (weak, does not exclude):</b> ' + esc(r.against.join('; ')) + '</p>' : '') +
        (r.missing.length ? '<p><b>Not yet established:</b> ' + esc(r.missing.slice(0, 6).map(function (m) { return Engine.label(m.k); }).join('; ')) + '</p>' : '') +
        '<details><summary>Investigations, tools, alternatives</summary><p><b>May be considered:</b> ' + esc(d.inv) + '</p><p><b>Scoring tools:</b> ' + esc(d.tool) + '</p><p><b>Alternatives:</b> ' + esc(d.alt) + '</p></details></div>';
    }
    function group(title, arr, note) {
      return arr.length ? '<h2>' + title + '</h2>' + (note ? '<p class="muted">' + note + '</p>' : '') + arr.map(ddxCard).join('') : '';
    }
    function strip() {
      var fl = Engine.redFlags(c), dd = Engine.differential(c, 2), h = '';
      if (fl.length) h += '<div class="notice alert" role="alert"><strong>Urgent assessment alert</strong><ul>' + fl.map(function (f) { return '<li>' + esc(f.text) + '<br><span class="muted">Triggered by: ' + esc(f.why) + '</span></li>'; }).join('') + '</ul></div>';
      if (dd.list.length) {
        var top = dd.list.filter(function (r) { return !r.d.cm; }).slice(0, 3).map(function (r) { return r.d.name; });
        var cm = dd.groups.cm.map(function (r) { return r.d.name; });
        h += '<div class="card strip"><b>Live differential</b> (ordering aid, not probability)<br>' + (top.length ? esc(top.join(' · ')) : 'None yet') + (cm.length ? '<br><span class="alert-txt">Do not miss: ' + esc(cm.join(' · ')) + '</span>' : '') + '</div>';
      }
      return h;
    }
    function tabs() {
      return '<div class="tabs">' + [['complaints', 'Complaints'], ['history', 'History'], ['ddx', 'Differential'], ['exam', 'Exam'], ['report', 'Report']].map(function (t) {
        return '<button data-act="tab" data-v="' + t[0] + '" class="' + (tab === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</div>';
    }
    function tComplaints() {
      var v = Engine.view(c, 2), sys = Engine.systems(c), id = c.patient.deptId;
      var own = D.s.symptoms.filter(function (s) { return s.depts.indexOf(id) >= 0; });
      var all = showAll || !id || !own.length;
      var pool = all ? D.s.symptoms : D.s.symptoms.filter(function (s) { return s.depts.indexOf(id) >= 0 || v(s.id) === 'pos'; });
      return '<p class="muted">' + (all && id && !own.length ? 'No complaints are set up for ' + esc(c.patient.dept) + ' yet, so all are shown. ' : 'Complaints for ' + esc(c.patient.dept) + '. ') + 'Tap every presenting complaint; the differential updates immediately.</p><div class="chips">' +
        pool.map(function (s) { return '<button class="chip ' + (v(s.id) === 'pos' ? 'on' : '') + '" data-act="ans" data-k="' + s.id + '" data-v="pos" data-src="h" aria-pressed="' + (v(s.id) === 'pos') + '">' + esc(s.lbl) + '</button>'; }).join('') + '</div>' +
        (own.length ? '<div class="btn-row"><button class="btn btn-secondary btn-small" data-act="showall">' + (showAll ? 'Show only ' + esc(c.patient.dept) + ' complaints' : 'Show all complaints') + '</button></div>' : '') +
        (sys.length ? '<h2>Systems activated</h2><p><b>Primary:</b> ' + esc(sys[0]) + '</p><p><b>Related:</b> ' + esc(sys.slice(1).join(', ')) + '</p><p class="muted">Only questions relevant to your selected complaints are asked.</p>' : '');
    }
    function tHistory() {
      var qs = Engine.applicable(c), cov = Engine.coverage(c), by = {};
      qs.forEach(function (q) { (by[q.sys] = by[q.sys] || []).push(q); });
      var h = '<div class="notice ' + (cov.unanswered.length ? 'warn' : 'ok') + '">' + (qs.length ? cov.answered + ' of ' + cov.total + ' applicable questions answered. ' + (cov.unanswered.length ? 'History is INCOMPLETE. Unanswered is not the same as negative.' : 'All applicable questions answered.') : 'Select a complaint first.') + '</div>';
      Object.keys(by).forEach(function (s) {
        h += '<h2>' + esc(s) + '</h2>' + by[s].map(function (q) {
          return '<div class="card q"><p><b>' + esc(q.text) + '</b></p><p class="muted">Why ask: ' + esc(q.why) + '</p><div class="ansrow">' + btns(q.id, ANS, 'h') + '</div></div>';
        }).join('');
      });
      var N = c.notes, fld = [['pmh', 'Past history (illnesses, surgeries, transfusions)'], ['meds', 'Medicines (current, recent changes, OTC)'], ['allergy', 'Drug allergies / adverse reactions'], ['family', 'Family history'], ['personal', 'Personal history (diet, sleep, bowel/bladder, smoking, alcohol, occupation)'], ['obs', 'Menstrual / obstetric history (if applicable)'], ['ros', 'Review of systems (other systems)']];
      h += '<h2>Other history</h2>' + fld.map(function (f) { return '<label>' + f[1] + '<textarea class="inp" rows="2" data-note="' + f[0] + '">' + esc(N[f[0]] || '') + '</textarea></label>'; }).join('');
      return h;
    }
    function tDdx() {
      var dd = Engine.differential(c, stage), g = dd.groups;
      return '<div class="seg"><button data-act="stage" data-v="1" class="' + (stage === 1 ? 'on' : '') + '">History only</button><button data-act="stage" data-v="2" class="' + (stage === 2 ? 'on' : '') + '">History + exam</button></div>' +
        (dd.list.length ? '' : '<div class="notice warn">Select a presenting complaint to start the differential.</div>') +
        (dd.next.length ? '<div class="notice ok"><b>Most useful next steps:</b><ul>' + dd.next.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul></div>' : '') +
        (dd.why.length ? '<div class="notice warn"><b>Why this is still uncertain:</b><ul>' + dd.why.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul></div>' : '') +
        group('Cannot-miss conditions', g.cm, 'Shown whenever a related complaint is present, even if ranked low.') +
        group('Strongly supported', g.strong) + group('Common and plausible', g.plausible) + group('Other alternatives', g.other) +
        (dd.list.length >= 2 ? compare(dd.list.slice(0, 3)) : '') +
        '<div class="notice warn">' + esc(D.d.meta.validation) + ' ' + esc(D.d.meta.limits) + ' Rules v' + esc(D.d.meta.version) + ', review: ' + esc(D.d.meta.reviewDate) + '.</div>';
    }
    function compare(top) {
      var keys = {}; top.forEach(function (r) { Object.keys(r.d.f).forEach(function (k) { keys[k] = 1; }); });
      var v = Engine.view(c, stage);
      return '<h2>Compare top diagnoses</h2><div class="scroll"><table class="cmp"><tr><th>Feature</th>' + top.map(function (r) { return '<th>' + esc(r.d.name) + '</th>'; }).join('') + '<th>Patient</th></tr>' +
        Object.keys(keys).map(function (k) {
          return '<tr><td>' + esc(Engine.label(k)) + '</td>' + top.map(function (r) { return '<td>' + (r.d.f[k] ? 'Weight ' + r.d.f[k] : '–') + '</td>'; }).join('') + '<td>' + esc(STATE_TXT[v(k)] || 'Not asked') + '</td></tr>';
        }).join('') + '</table></div><p class="muted">Higher weight = more characteristic in teaching descriptions.</p>';
    }
    function tExam() {
      var vt = c.vitals, vf = [['temp', 'Temp °C'], ['pulse', 'Pulse /min'], ['sbp', 'BP systolic'], ['dbp', 'BP diastolic'], ['rr', 'Resp rate /min'], ['spo2', 'SpO2 %'], ['weight', 'Weight kg'], ['height', 'Height cm']];
      var bmi = vt.weight && vt.height ? (vt.weight / Math.pow(vt.height / 100, 2)).toFixed(1) : '';
      return '<h2>Vital signs</h2><div class="grid2">' + vf.map(function (f) { return '<label>' + f[1] + '<input class="inp" type="number" inputmode="decimal" data-vit="' + f[0] + '" value="' + esc(vt[f[0]] || '') + '"></label>'; }).join('') + '</div>' +
        (bmi ? '<p>BMI: <b>' + bmi + '</b></p>' : '') +
        '<h2>Examination findings</h2><p class="muted">Leave blank if not examined. Blank is never treated as normal.</p>' +
        Engine.applicableExam(c).map(function (e) { return '<div class="card q"><p><b>' + esc(e.lbl) + '</b> <span class="muted">(' + esc(e.sys) + ')</span></p><div class="ansrow">' + btns(e.id, EXA, 'e') + '</div></div>'; }).join('') +
        '<label>Other examination findings<textarea class="inp" rows="3" data-note="examtext">' + esc(c.notes.examtext || '') + '</textarea></label>';
    }
    function vivaQs(dd) {
      var t = dd.list.filter(function (r) { return !r.d.cm; }).slice(0, 2), q = [];
      t.forEach(function (r) { q.push('What features support ' + r.d.name + ' and what would argue against it?'); q.push('What investigations may be considered for ' + r.d.name + '?'); });
      if (t.length > 1) q.push('How would you distinguish ' + t[0].d.name + ' from ' + t[1].d.name + ' at the bedside?');
      if (dd.groups.cm.length) q.push('Which dangerous conditions must be excluded here, and why: ' + dd.groups.cm.map(function (r) { return r.d.name; }).join(', ') + '?');
      return q;
    }
    function presentation() {
      var v = Engine.view(c, 2), p = c.patient, pos = [], neg = [], vt = c.vitals, dd = Engine.differential(c, 2);
      Object.keys(c.findings).forEach(function (k) { var s = c.findings[k]; if (c.findings[k].src === 'h') { if (s.s === 'pos') pos.push(Engine.label(k)); if (s.s === 'neg') neg.push(Engine.label(k)); } });
      var ex = Object.keys(c.findings).filter(function (k) { return c.findings[k].src === 'e'; }).map(function (k) { return (c.findings[k].s === 'pos' ? '' : 'no ') + Engine.label(k); });
      var vs = ['temp', 'pulse', 'sbp', 'rr', 'spo2'].filter(function (k) { return vt[k]; }).map(function (k) { return k + ' ' + vt[k]; });
      return 'A ' + p.age + '-year-old ' + (SEX[p.sex] || '').toLowerCase() + ' presented with ' + (Engine.selected(c).map(function (s) { return s.lbl.toLowerCase(); }).join(', ') || 'no recorded complaint') + '. Pertinent positives: ' + (pos.join('; ') || 'none recorded') + '. Pertinent negatives: ' + (neg.join('; ') || 'none recorded') + '. ' +
        (vs.length ? 'Vitals: ' + vs.join(', ') + '. ' : 'Vitals not recorded. ') + (ex.length ? 'Examination: ' + ex.join('; ') + '. ' : 'Examination findings not recorded. ') +
        'Working differential: ' + (dd.list.slice(0, 4).map(function (r) { return r.d.name; }).join(', ') || 'not yet generated') + '.';
    }
    function dlist(stg) {
      var dd = Engine.differential(c, stg);
      return dd.list.length ? '<ol>' + dd.list.map(function (r) { return '<li>' + esc(r.d.name) + (r.d.cm ? ' (cannot miss)' : '') + ' — suspected' + (r.sup.length ? '; supported by: ' + esc(r.sup.join(', ')) : '') + '</li>'; }).join('') + '</ol>' : '<p>None generated.</p>';
    }
    function tReport() {
      var p = c.patient, N = c.notes, v = Engine.view(c, 2), qs = Engine.applicable(c), cov = Engine.coverage(c), fl = Engine.redFlags(c), vt = c.vitals, dd = Engine.differential(c, 2);
      var hopi = qs.filter(function (q) { return v(q.id) !== 'unasked'; }).map(function (q) { return '<li>' + esc(q.lbl) + ': <b>' + STATE_TXT[v(q.id)] + '</b></li>'; }).join('');
      var ex = D.s.exam.filter(function (e) { return v(e.id) !== 'unasked'; }).map(function (e) { return '<li>' + esc(e.lbl) + ': <b>' + (v(e.id) === 'pos' ? 'Present' : 'Absent') + '</b></li>'; }).join('');
      function sec(t, b) { return '<h3>' + t + '</h3>' + b; }
      function txt(k) { return '<p>' + (esc(N[k] || '') || '<i>Not recorded</i>') + '</p>'; }
      var vit = ['temp', 'pulse', 'sbp', 'dbp', 'rr', 'spo2', 'weight', 'height'].filter(function (k) { return vt[k]; }).map(function (k) { return k + ': ' + esc(vt[k]); }).join(' · ');
      return '<div id="rep" class="report"><h2>Clinical case report</h2><p class="muted">Educational document. Not a confirmed diagnosis. Date: ' + new Date().toLocaleDateString() + '</p>' +
        sec('Patient', '<p>' + esc(p.pid) + ' · ' + esc(p.age) + ' y · ' + esc(SEX[p.sex]) + (p.pregnant ? ' · pregnant/postpartum' : '') + ' · ' + esc(p.dept) + '<br>Informant: ' + esc(p.informant) + ' (reliability: ' + esc(p.reliability) + ')</p>') +
        sec('Chief complaints', '<p>' + (esc(Engine.selected(c).map(function (s) { return s.lbl; }).join(', ')) || '<i>None</i>') + '</p>') +
        sec('History of presenting illness (answered questions)', hopi ? '<ul>' + hopi + '</ul>' : '<p><i>None answered</i></p>') +
        sec('Unanswered relevant questions', cov.unanswered.length ? '<p>History incomplete. Not asked (not the same as negative):</p><ul>' + cov.unanswered.map(function (q) { return '<li>' + esc(q.lbl) + '</li>'; }).join('') + '</ul>' : '<p>All applicable questions answered.</p>') +
        sec('Past history', txt('pmh')) + sec('Medication history and allergies', txt('meds') + txt('allergy')) + sec('Family history', txt('family')) + sec('Personal history', txt('personal')) +
        (p.sex === 'F' ? sec('Menstrual / obstetric history', txt('obs')) : '') + sec('Review of systems', txt('ros')) +
        sec('Vital signs', '<p>' + (vit || '<i>Not recorded</i>') + '</p>') + sec('Examination findings', (ex ? '<ul>' + ex + '</ul>' : '<p><i>Not recorded</i></p>') + txt('examtext')) +
        sec('Red flags', fl.length ? '<ul>' + fl.map(function (f) { return '<li><b>' + esc(f.text) + '</b> (' + esc(f.why) + ')</li>'; }).join('') + '</ul>' : '<p>None detected from entered data. This is not reassurance if history or examination is incomplete.</p>') +
        sec('Differential: history only (Stage 1)', dlist(1)) + sec('Differential: after examination (Stage 2)', dlist(2)) +
        sec('Diagnostic uncertainty', dd.why.length ? '<ul>' + dd.why.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>' : '<p>None listed.</p>') +
        sec('Suggested next assessment', dd.next.length ? '<ul>' + dd.next.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>' : '<p>—</p>') +
        sec('Investigations that may be considered', dd.list.length ? '<ul>' + dd.list.slice(0, 4).map(function (r) { return '<li>' + esc(r.d.name) + ': ' + esc(r.d.inv) + '</li>'; }).join('') + '</ul>' : '<p>—</p>') +
        sec('Final clinical impression (clinician)', '<p>' + (esc(N.impression || '') || '<i>Not entered</i>') + '</p>') +
        sec('Case presentation', '<p>' + esc(presentation()) + '</p>') +
        sec('Viva questions', '<ul>' + vivaQs(dd).map(function (q) { return '<li>' + esc(q) + '</li>'; }).join('') + '</ul>') +
        '<p class="muted">Rules v' + esc(D.d.meta.version) + '. ' + esc(D.d.meta.validation) + '</p></div>';
    }
    function tReportTab() {
      return '<label>Final clinical impression (your own words)<textarea class="inp" rows="3" data-note="impression">' + esc(c.notes.impression || '') + '</textarea></label>' +
        '<div class="btn-row noprint"><button class="btn" data-act="print">Print / Save as PDF</button><button class="btn btn-secondary" data-act="copy">Copy case presentation</button></div><p class="muted noprint" id="rep-msg" role="status"></p>' + tReport();
    }
    function draw() {
      var p = c.patient;
      root.innerHTML = '<h1>' + esc(p.pid) + '</h1><p class="muted">' + esc(p.age) + ' y · ' + esc(SEX[p.sex]) + ' · ' + esc(p.dept) + '</p>' + strip() + tabs() +
        '<div class="tabbody">' + ({ complaints: tComplaints, history: tHistory, ddx: tDdx, exam: tExam, report: tReportTab }[tab])() + '</div>';
    }
    root.onclick = function (e) {
      var t = e.target.closest('[data-act]'); if (!t) return;
      var a = t.getAttribute('data-act');
      if (a === 'tab') { tab = t.getAttribute('data-v'); draw(); window.scrollTo(0, 0); }
      else if (a === 'stage') { stage = +t.getAttribute('data-v'); draw(); }
      else if (a === 'ans') setAns(t.getAttribute('data-k'), t.getAttribute('data-v'), t.getAttribute('data-src'));
      else if (a === 'showall') { showAll = !showAll; draw(); }
      else if (a === 'print') window.print();
      else if (a === 'copy') { var m = document.getElementById('rep-msg'); (navigator.clipboard ? navigator.clipboard.writeText(presentation()) : Promise.reject()).then(function () { m.textContent = 'Copied.'; }).catch(function () { m.textContent = 'Copy not available. Select the text in the report instead.'; }); }
    };
    root.onchange = function (e) {
      var n = e.target.getAttribute('data-note'), vi = e.target.getAttribute('data-vit');
      if (n) { c.notes[n] = e.target.value; save(); if (n === 'impression') draw(); }
      if (vi) { if (e.target.value === '') delete c.vitals[vi]; else c.vitals[vi] = parseFloat(e.target.value); save(); draw(); }
    };
    draw();
  }

  // ---------- Knowledge and learning ----------
  S.knowledge = function () {
    return { title: 'Knowledge', html: '<h1>Medical knowledge</h1><div class="notice warn">Short teaching summaries. Not clinically validated. Verify against your textbooks.</div><div id="kb">Loading…</div>',
      after: function () { Engine.load().then(function (D) {
        document.getElementById('kb').innerHTML = D.d.diseases.map(function (d) {
          return '<div class="card"><details><summary><b>' + esc(d.name) + '</b>' + (d.cm ? ' <span class="tag alert">cannot miss</span>' : '') + '</summary><p><b>Characteristic features (weight):</b> ' + esc(Object.keys(d.f).map(function (k) { return Engine.label(k) + ' (' + d.f[k] + ')'; }).join('; ')) + '</p><p><b>Investigations that may be considered:</b> ' + esc(d.inv) + '</p><p><b>Scoring tools:</b> ' + esc(d.tool) + '</p><p><b>Alternatives:</b> ' + esc(d.alt) + '</p></details></div>';
        }).join('') + '<p class="muted">Source: ' + esc(D.d.meta.source) + '</p>';
      }); } };
  };
  S.learning = function () {
    return { title: 'Learning', html: '<h1>MBBS viva and learning</h1><div class="card"><p>Open any case and use the <b>Differential</b> tab to compare diagnoses, then the <b>Report</b> tab for a case presentation and viva questions generated from that case.</p><p>Try sample cases:</p><ul><li>Male 45: cough, fever, productive cough, breathlessness, pain worse on deep breath. Then add crackles on exam.</li><li>Female 26: abdominal pain, missed period.</li><li>Female 40: sudden worst-ever headache.</li><li>Male 30: fever with chills, lives in a malaria area.</li></ul></div>' };
  };
})();
