/* Gehørtræning: genkend intervaller og akkordtyper, eller ram en tone
 * med stemmen/instrumentet (appen lytter med mikrofonen). */
(function () {
  'use strict';

  var A = window.AudioShared;
  var P = window.Pitch;
  var STORE_KEY = 'stemmeapparat.ear.v1';

  var INTERVALS = [
    { st: 1, name: 'Lille sekund', short: 'l2' },
    { st: 2, name: 'Stor sekund', short: 'S2' },
    { st: 3, name: 'Lille terts', short: 'l3' },
    { st: 4, name: 'Stor terts', short: 'S3' },
    { st: 5, name: 'Kvart', short: '4' },
    { st: 6, name: 'Tritonus', short: 'Tri' },
    { st: 7, name: 'Kvint', short: '5' },
    { st: 8, name: 'Lille sekst', short: 'l6' },
    { st: 9, name: 'Stor sekst', short: 'S6' },
    { st: 10, name: 'Lille septim', short: 'l7' },
    { st: 11, name: 'Stor septim', short: 'S7' },
    { st: 12, name: 'Oktav', short: '8' }
  ];
  var CHORDS = [
    { id: 'maj', name: 'Dur', iv: [0, 4, 7] },
    { id: 'min', name: 'Mol', iv: [0, 3, 7] },
    { id: 'dim', name: 'Formindsket', iv: [0, 3, 6] },
    { id: 'aug', name: 'Forstørret', iv: [0, 4, 8] },
    { id: 'sus4', name: 'Sus4', iv: [0, 5, 7] },
    { id: '7', name: 'Dominant 7', iv: [0, 4, 7, 10] },
    { id: 'maj7', name: 'Stor 7 (maj7)', iv: [0, 4, 7, 11] },
    { id: 'm7', name: 'Mol 7 (m7)', iv: [0, 3, 7, 10] }
  ];
  var DIRECTIONS = [
    { id: 'up', name: 'Op' },
    { id: 'down', name: 'Ned' },
    { id: 'harm', name: 'Samtidig' },
    { id: 'mix', name: 'Blandet' }
  ];
  var MODES = [
    { id: 'interval', name: 'Intervaller', help: 'Lyt til de to toner og vælg intervallet. Tip: kvarten lyder som starten af "Here comes the bride", den store sekst som "My Bonnie".' },
    { id: 'chord', name: 'Akkorder', help: 'Lyt til akkorden og vælg typen. Dur lyder lyst, mol mørkt, formindsket spændt og forstørret svævende.' },
    { id: 'match', name: 'Ram tonen', help: 'Lyt til tonen, tryk "Lyt", og syng eller spil den. Hold den inden for den grønne zone et øjeblik.' }
  ];
  var RANGES = [
    { id: 'low', name: 'Dyb (E2–E4)', lo: 40, hi: 64 },
    { id: 'mid', name: 'Mellem (C3–C5)', lo: 48, hi: 72 },
    { id: 'high', name: 'Lys (G3–G5)', lo: 55, hi: 79 }
  ];
  var NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    view: $('view-ear'),
    modes: $('ear-modes'),
    correct: $('ear-correct'),
    total: $('ear-total'),
    streak: $('ear-streak'),
    best: $('ear-best'),
    prompt: $('ear-prompt'),
    feedback: $('ear-feedback'),
    answers: $('ear-answers'),
    match: $('ear-match'),
    needle: $('match-needle'),
    readout: $('match-readout'),
    matchError: $('match-error'),
    replay: $('ear-replay'),
    listen: $('ear-listen'),
    next: $('ear-next'),
    intervalOpts: $('ear-interval-opts'),
    direction: $('ear-direction'),
    chordOpts: $('ear-chord-opts'),
    range: $('match-range'),
    anyOctave: $('match-any-octave'),
    help: $('ear-help')
  };

  var state = {
    mode: 'interval',
    intervals: [3, 4, 5, 7, 12],
    chords: ['maj', 'min'],
    direction: 'up',
    range: 'mid',
    anyOctave: true,
    best: { interval: 0, chord: 0, match: 0 }
  };
  var score = { correct: 0, total: 0, streak: 0 };
  var task = null;   // aktuel opgave
  var mic = null, micTimer = 0, matchHold = 0, matchHist = [];

  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (!s) return;
      if (MODES.some(function (m) { return m.id === s.mode; })) state.mode = s.mode;
      if (Array.isArray(s.intervals) && s.intervals.length >= 2) state.intervals = s.intervals;
      if (Array.isArray(s.chords) && s.chords.length >= 2) state.chords = s.chords;
      if (DIRECTIONS.some(function (d) { return d.id === s.direction; })) state.direction = s.direction;
      if (RANGES.some(function (r) { return r.id === s.range; })) state.range = s.range;
      if (typeof s.anyOctave === 'boolean') state.anyOctave = s.anyOctave;
      if (s.best) state.best = Object.assign(state.best, s.best);
    } catch (e) { /* standard */ }
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignorer */ }
  }

  function rand(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function noteName(m) { return NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); }

  // ---------- Lyd ----------

  function playNotes(notes, harmonic) {
    var t = A.getContext().currentTime + 0.05;
    notes.forEach(function (m, i) {
      A.pluck(A.midiFreq(m), harmonic ? t + i * 0.012 : t + i * 0.75, 0.32);
    });
  }

  function playTask() {
    if (!task) return;
    if (task.kind === 'interval') playNotes(task.notes, task.dir === 'harm');
    else if (task.kind === 'chord') playNotes(task.notes, true);
    else playNotes([task.midi], false);
  }

  // ---------- Opgaver ----------

  function newTask() {
    el.feedback.innerHTML = '&nbsp;';
    el.feedback.className = 'ear-feedback';
    if (state.mode === 'interval') {
      var iv = pick(state.intervals);
      var dir = state.direction === 'mix' ? pick(['up', 'down', 'harm']) : state.direction;
      var root = rand(48, 79 - iv);
      var notes = dir === 'down' ? [root + iv, root] : [root, root + iv];
      task = { kind: 'interval', answer: iv, notes: notes, dir: dir, answered: false };
      el.prompt.textContent = 'Hvilket interval? ' + (dir === 'up' ? '(opad)' : dir === 'down' ? '(nedad)' : '(samtidigt)');
    } else if (state.mode === 'chord') {
      var chosen = pick(state.chords);
      var c = CHORDS.find(function (x) { return x.id === chosen; });
      var r = rand(48, 64);
      task = { kind: 'chord', answer: c.id, notes: c.iv.map(function (i) { return r + i; }), answered: false };
      el.prompt.textContent = 'Hvilken slags akkord?';
    } else {
      var range = RANGES.find(function (x) { return x.id === state.range; });
      var m = rand(range.lo, range.hi);
      task = { kind: 'match', midi: m, answered: false };
      el.prompt.innerHTML = 'Ram tonen <b class="match-target">' + noteName(m) + '</b>';
      matchHold = 0;
      matchHist = [];
      setNeedle(null);
    }
    renderAnswers();
    el.replay.disabled = false;
    el.next.textContent = 'Spring over';
    playTask();
  }

  function answer(value, btn) {
    if (!task || task.answered) return;
    var ok = value === task.answer;
    if (!ok) {
      // Forkert svar tæller som forsøg; man må prøve igen, men stimen er brudt
      btn.classList.add('wrong');
      btn.disabled = true;
      if (!task.missed) { task.missed = true; score.total++; score.streak = 0; }
      el.feedback.textContent = 'Ikke helt – lyt igen og prøv en anden';
      el.feedback.className = 'ear-feedback bad';
      renderScore();
      return;
    }
    task.answered = true;
    btn.classList.add('right');
    if (!task.missed) { score.correct++; score.total++; score.streak++; }
    recordBest();
    el.feedback.textContent = task.missed ? 'Ja, det var den!' : pick(['Rigtigt! 🎉', 'Flot hørt!', 'Præcis!', 'Godt gået!']);
    el.feedback.className = 'ear-feedback good';
    el.next.textContent = 'Næste';
    renderScore();
    if (!task.missed) setTimeout(function () { if (task && task.answered && !el.view.hidden) newTask(); }, 1300);
  }

  function recordBest() {
    if (score.streak > (state.best[state.mode] || 0)) { state.best[state.mode] = score.streak; save(); }
  }

  // ---------- Ram tonen (mikrofon) ----------

  function startListening() {
    el.matchError.hidden = true;
    el.listen.disabled = true;
    A.openMic().then(function (m) {
      mic = m;
      el.listen.disabled = false;
      el.listen.textContent = '■ Stop';
      el.listen.classList.add('running');
      A.keepAwake('ear', true);
      micTimer = setInterval(analyse, 40);
    }).catch(function (err) {
      el.listen.disabled = false;
      el.matchError.textContent = A.micErrorText(err);
      el.matchError.hidden = false;
    });
  }

  function stopListening() {
    clearInterval(micTimer);
    if (mic) mic.stop();
    mic = null;
    A.keepAwake('ear', false);
    el.listen.textContent = '🎤 Lyt';
    el.listen.classList.remove('running');
    setNeedle(null);
  }

  function analyse() {
    if (!mic || !task || task.kind !== 'match') return;
    mic.analyser.getFloatTimeDomainData(mic.buffer);
    var b = mic.buffer, sum = 0;
    for (var i = b.length - 2048; i < b.length; i++) sum += b[i] * b[i];
    var res = Math.sqrt(sum / 2048) > 0.008 ? P.detectPitch(b, mic.sampleRate, 65, 1100) : null;
    if (!res) { matchHold = 0; matchHist = []; setNeedle(null); return; }

    var heard = 69 + 12 * Math.log2(res.freq / A.midiFreq(69));
    matchHist.push(heard);
    if (matchHist.length > 4) matchHist.shift();
    var m = matchHist.slice().sort(function (a, c) { return a - c; })[matchHist.length >> 1];
    var diff = m - task.midi;
    if (state.anyOctave) diff = diff - 12 * Math.round(diff / 12);
    var cents = diff * 100;
    setNeedle(cents, m);

    if (Math.abs(cents) <= 25 && !task.answered) {
      matchHold += 40;
      if (matchHold >= 600) {
        task.answered = true;
        score.correct++; score.total++; score.streak++;
        recordBest();
        renderScore();
        el.feedback.textContent = 'Ramt! 🎯';
        el.feedback.className = 'ear-feedback good';
        el.next.textContent = 'Næste';
        setTimeout(function () { if (task && task.answered && !el.view.hidden) newTask(); }, 1200);
      }
    } else {
      matchHold = 0;
    }
  }

  function setNeedle(cents, heardMidi) {
    if (cents == null) {
      el.needle.style.opacity = '0.25';
      el.needle.style.left = '50%';
      el.readout.innerHTML = mic ? 'Syng eller spil tonen …' : '&nbsp;';
      el.match.removeAttribute('data-level');
      return;
    }
    var c = Math.max(-100, Math.min(100, cents));
    el.needle.style.opacity = '1';
    el.needle.style.left = (50 + c / 2) + '%';
    var abs = Math.abs(cents);
    el.match.dataset.level = abs <= 25 ? 'in' : abs <= 60 ? 'near' : 'far';
    el.readout.textContent = 'Du rammer ' + noteName(Math.round(heardMidi)) + ' · ' +
      (abs <= 25 ? 'lige på!' : cents < 0 ? Math.round(abs) + ' cent for lavt' : Math.round(abs) + ' cent for højt');
  }

  // ---------- Rendering ----------

  function renderScore() {
    el.correct.textContent = score.correct;
    el.total.textContent = score.total;
    el.streak.textContent = score.streak;
    el.best.textContent = state.best[state.mode] || 0;
  }

  function renderAnswers() {
    el.match.hidden = state.mode !== 'match';
    el.listen.hidden = state.mode !== 'match';
    if (state.mode === 'match' || !task) { el.answers.innerHTML = ''; return; }
    var opts = state.mode === 'interval'
      ? INTERVALS.filter(function (i) { return state.intervals.indexOf(i.st) >= 0; }).map(function (i) { return { v: i.st, label: i.name }; })
      : CHORDS.filter(function (c) { return state.chords.indexOf(c.id) >= 0; }).map(function (c) { return { v: c.id, label: c.name }; });
    el.answers.innerHTML = '';
    opts.forEach(function (o) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'answer';
      b.textContent = o.label;
      b.addEventListener('click', function () { answer(o.v, b); });
      el.answers.appendChild(b);
    });
  }

  function renderMode() {
    el.modes.querySelectorAll('button').forEach(function (b) {
      b.setAttribute('aria-checked', String(b.dataset.mode === state.mode));
    });
    document.querySelectorAll('[data-ear]').forEach(function (f) { f.hidden = f.dataset.ear !== state.mode; });
    el.help.textContent = MODES.find(function (m) { return m.id === state.mode; }).help;
    task = null;
    score = { correct: 0, total: 0, streak: 0 };
    el.prompt.textContent = 'Tryk på "Ny opgave" for at begynde';
    el.feedback.innerHTML = '&nbsp;';
    el.replay.disabled = true;
    el.next.textContent = 'Ny opgave';
    if (state.mode !== 'match' && mic) stopListening();
    setNeedle(null);
    renderAnswers();
    renderScore();
  }

  function toggleChip(list, value, btn, min) {
    var i = list.indexOf(value);
    if (i >= 0) {
      if (list.length <= min) return; // mindst to valgmuligheder
      list.splice(i, 1);
    } else list.push(value);
    btn.setAttribute('aria-pressed', String(i < 0));
    save();
    if (task && !task.answered) newTask(); else renderAnswers();
  }

  function build() {
    el.modes.innerHTML = MODES.map(function (m) {
      return '<button type="button" role="radio" data-mode="' + m.id + '">' + m.name + '</button>';
    }).join('');
    el.modes.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () { state.mode = b.dataset.mode; save(); renderMode(); });
    });

    el.intervalOpts.innerHTML = INTERVALS.map(function (i) {
      return '<button type="button" class="chip" data-st="' + i.st + '" aria-pressed="' + (state.intervals.indexOf(i.st) >= 0) + '">' + i.name + '</button>';
    }).join('');
    el.intervalOpts.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () { toggleChip(state.intervals, Number(b.dataset.st), b, 2); });
    });

    el.chordOpts.innerHTML = CHORDS.map(function (c) {
      return '<button type="button" class="chip" data-id="' + c.id + '" aria-pressed="' + (state.chords.indexOf(c.id) >= 0) + '">' + c.name + '</button>';
    }).join('');
    el.chordOpts.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () { toggleChip(state.chords, b.dataset.id, b, 2); });
    });

    el.direction.innerHTML = DIRECTIONS.map(function (d) {
      return '<button type="button" role="radio" data-dir="' + d.id + '">' + d.name + '</button>';
    }).join('');
    el.direction.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        state.direction = b.dataset.dir; save(); renderDirection();
      });
    });
    renderDirection();

    el.range.innerHTML = RANGES.map(function (r) {
      return '<option value="' + r.id + '"' + (r.id === state.range ? ' selected' : '') + '>' + r.name + '</option>';
    }).join('');
    el.anyOctave.checked = state.anyOctave;
  }

  function renderDirection() {
    el.direction.querySelectorAll('button').forEach(function (b) {
      b.setAttribute('aria-checked', String(b.dataset.dir === state.direction));
    });
  }

  el.next.addEventListener('click', function () {
    if (task && !task.answered && task.kind !== 'match') { score.total++; score.streak = 0; renderScore(); }
    newTask();
  });
  el.replay.addEventListener('click', playTask);
  el.listen.addEventListener('click', function () { if (mic) stopListening(); else startListening(); });
  el.range.addEventListener('change', function () { state.range = el.range.value; save(); if (task) newTask(); });
  el.anyOctave.addEventListener('change', function () { state.anyOctave = el.anyOctave.checked; save(); });

  load();
  build();
  renderMode();

  window.Ear = { stop: function () { if (mic) stopListening(); } };
})();
