/* Øvelog: tidtager, dagligt mål, statistik, kalender og eksport.
 * Alt gemmes lokalt på enheden. */
(function () {
  'use strict';

  var STORE_KEY = 'stemmeapparat.practice.v1';
  var MIN_SAVE_SEC = 10;
  var WEEKS = 16;
  var RING = 2 * Math.PI * 27;

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    timer: $('pr-timer'),
    note: $('pr-note'),
    suggestions: $('pr-suggestions'),
    live: $('pr-live'),
    toggle: $('pr-toggle'),
    reset: $('pr-reset'),
    save: $('pr-save'),
    ring: $('goal-ring'),
    goalText: $('goal-text'),
    goalMin: $('goal-min'),
    goalDown: $('goal-down'),
    goalUp: $('goal-up'),
    stats: $('pr-stats'),
    heatmap: $('pr-heatmap'),
    sessions: $('pr-sessions'),
    exportBtn: $('pr-export')
  };

  var data = {
    sessions: [],   // { id, start, dur (sek.), note, bpm }
    goal: 20,       // minutter pr. dag
    timer: { running: false, resumedAt: 0, acc: 0, sessionStart: 0, maxBpm: 0 }
  };

  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (!s) return;
      if (Array.isArray(s.sessions)) data.sessions = s.sessions.filter(function (x) { return x && x.start && x.dur > 0; });
      if (s.goal >= 5 && s.goal <= 240) data.goal = s.goal;
      if (s.timer) data.timer = Object.assign(data.timer, s.timer);
      if (typeof s.note === 'string') el.note.value = s.note;
    } catch (e) { /* tom log */ }
  }
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        sessions: data.sessions, goal: data.goal, timer: data.timer, note: el.note.value
      }));
    } catch (e) { /* ignorer */ }
  }

  // ---------- Tid ----------

  function elapsed() {
    var t = data.timer;
    return t.acc + (t.running ? (Date.now() - t.resumedAt) / 1000 : 0);
  }

  function fmtClock(sec) {
    sec = Math.floor(sec);
    var h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
    var mm = h ? String(m).padStart(2, '0') : String(m);
    return (h ? h + ':' : '') + mm + ':' + String(s).padStart(2, '0');
  }

  function fmtMin(min) {
    min = Math.round(min);
    if (min < 60) return min + ' min';
    return Math.floor(min / 60) + ' t ' + (min % 60 ? (min % 60) + ' min' : '');
  }

  function dayKey(d) {
    d = new Date(d);
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }
  function startOfDay(d) { d = new Date(d); d.setHours(0, 0, 0, 0); return d; }
  function startOfWeek(d) { // mandag
    d = startOfDay(d);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
  }

  // Minutter pr. dag, inkl. den igangværende tidtagning
  function minutesByDay() {
    var map = {};
    data.sessions.forEach(function (s) {
      var k = dayKey(s.start);
      map[k] = (map[k] || 0) + s.dur / 60;
    });
    var live = elapsed();
    if (live > 0) {
      var k = dayKey(Date.now());
      map[k] = (map[k] || 0) + live / 60;
    }
    return map;
  }

  // ---------- Handlinger ----------

  function toggle() {
    var t = data.timer;
    if (t.running) {
      t.acc = elapsed();
      t.running = false;
    } else {
      if (!t.acc) { t.sessionStart = Date.now(); t.maxBpm = 0; }
      t.resumedAt = Date.now();
      t.running = true;
    }
    save();
    render();
  }

  function reset(skipConfirm) {
    if (!skipConfirm && elapsed() > 60 && !confirm('Vil du nulstille tidtagningen uden at gemme?')) return;
    data.timer = { running: false, resumedAt: 0, acc: 0, sessionStart: 0, maxBpm: 0 };
    save();
    render();
  }

  function saveSession() {
    var dur = Math.round(elapsed());
    if (dur < MIN_SAVE_SEC) { el.live.textContent = 'Øv lidt længere, før du gemmer 🙂'; return; }
    data.sessions.push({
      id: Date.now().toString(36),
      start: data.timer.sessionStart || Date.now() - dur * 1000,
      dur: dur,
      note: el.note.value.trim(),
      bpm: data.timer.maxBpm || null
    });
    reset(true);
    el.live.textContent = 'Gemt: ' + fmtMin(dur / 60) + ' 👏';
  }

  function removeSession(id) {
    var s = data.sessions.find(function (x) { return x.id === id; });
    if (!s || !confirm('Slet øvepasset fra ' + new Date(s.start).toLocaleDateString('da-DK') + ' (' + fmtMin(s.dur / 60) + ')?')) return;
    data.sessions = data.sessions.filter(function (x) { return x.id !== id; });
    save();
    render();
  }

  function exportCsv() {
    var rows = [['dato', 'starttid', 'minutter', 'hvad', 'hoejeste_bpm']];
    data.sessions.slice().sort(function (a, b) { return a.start - b.start; }).forEach(function (s) {
      var d = new Date(s.start);
      rows.push([
        d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'),
        String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'),
        (s.dur / 60).toFixed(1),
        '"' + (s.note || '').replace(/"/g, '""') + '"',
        s.bpm || ''
      ]);
    });
    var blob = new Blob(['﻿' + rows.map(function (r) { return r.join(';'); }).join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'oevelog.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ---------- Rendering ----------

  function renderTimer() {
    var t = data.timer, sec = elapsed();
    el.timer.textContent = fmtClock(sec);
    el.timer.classList.toggle('running', t.running);
    el.toggle.textContent = t.running ? 'Pause' : sec > 0 ? 'Fortsæt' : 'Start';
    el.save.disabled = sec < 1;
    el.reset.disabled = sec < 1;

    // Registrér metronomtempoet, mens man øver
    if (t.running && window.Metronome && window.Metronome.isRunning()) {
      var bpm = window.Metronome.getBpm();
      if (bpm > (t.maxBpm || 0)) { t.maxBpm = bpm; save(); }
    }
    if (t.running) {
      el.live.textContent = t.maxBpm ? 'Højeste metronomtempo i dette pas: ' + t.maxBpm + ' BPM' : 'Tiden kører – også hvis du skifter fane';
    }
  }

  function renderGoal(byDay) {
    var today = byDay[dayKey(Date.now())] || 0;
    var p = Math.min(1, today / data.goal);
    el.ring.style.strokeDasharray = RING.toFixed(1);
    el.ring.style.strokeDashoffset = (RING * (1 - p)).toFixed(1);
    el.ring.classList.toggle('done', p >= 1);
    el.goalText.textContent = p >= 1
      ? 'Dagens mål er nået! ' + fmtMin(today) + ' 🎉'
      : fmtMin(today) + ' af ' + data.goal + ' min i dag';
    el.goalMin.textContent = data.goal;
  }

  function streak(byDay) {
    var d = startOfDay(Date.now()), n = 0;
    if (!(byDay[dayKey(d)] >= 1)) d.setDate(d.getDate() - 1); // i dag tæller først, når man har øvet
    while (byDay[dayKey(d)] >= 1) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  function renderStats(byDay) {
    var weekStart = startOfWeek(Date.now()), week = 0, total = 0;
    Object.keys(byDay).forEach(function (k) { total += byDay[k]; });
    for (var i = 0; i < 7; i++) {
      var d = new Date(weekStart); d.setDate(d.getDate() + i);
      week += byDay[dayKey(d)] || 0;
    }
    var st = streak(byDay);
    var tiles = [
      ['I dag', fmtMin(byDay[dayKey(Date.now())] || 0)],
      ['Denne uge', fmtMin(week)],
      ['Stime', st + (st === 1 ? ' dag' : ' dage') + (st >= 3 ? ' 🔥' : '')],
      ['I alt', fmtMin(total)]
    ];
    el.stats.innerHTML = tiles.map(function (t) {
      return '<div class="stat"><div class="stat-label">' + t[0] + '</div><div class="stat-value">' + t[1] + '</div></div>';
    }).join('');
  }

  function renderHeatmap(byDay) {
    var start = startOfWeek(Date.now());
    start.setDate(start.getDate() - (WEEKS - 1) * 7);
    var today = startOfDay(Date.now()).getTime();
    var html = '';
    for (var w = 0; w < WEEKS; w++) {
      for (var d = 0; d < 7; d++) {
        var day = new Date(start); day.setDate(start.getDate() + w * 7 + d);
        var min = byDay[dayKey(day)] || 0;
        var lvl = min <= 0 ? 0 : min < 15 ? 1 : min < 30 ? 2 : min < 60 ? 3 : 4;
        var future = day.getTime() > today;
        var label = day.toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'short' }) + ': ' + (min ? fmtMin(min) : 'ingen øvning');
        html += '<span class="hm' + (future ? ' future' : '') + (day.getTime() === today ? ' today' : '') +
          '" data-l="' + lvl + '" style="grid-column:' + (w + 1) + ';grid-row:' + (d + 1) + '"' +
          (future ? '' : ' title="' + label + '"') + '></span>';
      }
    }
    el.heatmap.innerHTML = html;
  }

  function dayLabel(ts) {
    var d = startOfDay(ts).getTime(), today = startOfDay(Date.now()).getTime();
    var time = new Date(ts).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
    if (d === today) return 'I dag ' + time;
    if (d === today - 86400000) return 'I går ' + time;
    return new Date(ts).toLocaleDateString('da-DK', { day: 'numeric', month: 'short' }) + ' ' + time;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }

  function renderSessions() {
    var list = data.sessions.slice().sort(function (a, b) { return b.start - a.start; }).slice(0, 25);
    if (!list.length) {
      el.sessions.innerHTML = '<li class="empty small muted">Ingen øvepas endnu. Tryk Start, når du begynder at øve.</li>';
    } else {
      el.sessions.innerHTML = list.map(function (s) {
        return '<li><div class="s-main"><span class="s-dur">' + fmtMin(s.dur / 60) + '</span>' +
          '<span class="s-note">' + (s.note ? esc(s.note) : '<span class="muted">Øvning</span>') + '</span></div>' +
          '<div class="s-meta small muted">' + dayLabel(s.start) + (s.bpm ? ' · ' + s.bpm + ' BPM' : '') + '</div>' +
          '<button type="button" class="s-del" data-id="' + s.id + '" aria-label="Slet øvepas">×</button></li>';
      }).join('');
      el.sessions.querySelectorAll('.s-del').forEach(function (b) {
        b.addEventListener('click', function () { removeSession(b.dataset.id); });
      });
    }
    el.exportBtn.disabled = !data.sessions.length;

    var seen = {}, notes = [];
    data.sessions.slice().reverse().forEach(function (s) {
      if (s.note && !seen[s.note]) { seen[s.note] = 1; notes.push(s.note); }
    });
    el.suggestions.innerHTML = notes.slice(0, 12).map(function (n) { return '<option value="' + esc(n) + '">'; }).join('');
  }

  function render() {
    var byDay = minutesByDay();
    renderTimer();
    renderGoal(byDay);
    renderStats(byDay);
    renderHeatmap(byDay);
    renderSessions();
  }

  // Opdatér hvert sekund mens tiden kører; kalender og statistik hvert halve minut
  var lastFull = 0;
  setInterval(function () {
    if (!data.timer.running) return;
    renderTimer();
    if (Date.now() - lastFull > 30000 && !document.getElementById('view-practice').hidden) {
      lastFull = Date.now();
      var byDay = minutesByDay();
      renderGoal(byDay);
      renderStats(byDay);
    }
  }, 1000);

  el.toggle.addEventListener('click', toggle);
  el.reset.addEventListener('click', function () { reset(false); });
  el.save.addEventListener('click', saveSession);
  el.exportBtn.addEventListener('click', exportCsv);
  el.note.addEventListener('change', save);
  el.goalDown.addEventListener('click', function () { data.goal = Math.max(5, data.goal - 5); save(); render(); });
  el.goalUp.addEventListener('click', function () { data.goal = Math.min(240, data.goal + 5); save(); render(); });
  document.addEventListener('viewchange', function (e) { if (e.detail === 'practice') render(); });

  load();
  render();

  window.Practice = { isRunning: function () { return data.timer.running; } };
})();
