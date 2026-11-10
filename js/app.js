(function () {
  'use strict';

  var D = window.TunerData;
  var P = window.Pitch;

  var IN_TUNE_CENTS = 3;     // inden for ± dette = stemt
  var NEAR_CENTS = 12;       // inden for ± dette = tæt på
  var HOLD_MS = 700;         // så længe skal strengen være stemt før den får et flueben
  var STALE_MS = 350;        // uden lyd: vis aflæsningen nedtonet
  var RESET_MS = 2000;       // uden lyd: nulstil visningen
  var GATE_RMS = 0.006;      // støjgrænse
  var ANALYSE_EVERY_MS = 30;
  var GAUGE_DEG = 60;        // ±50 cent = ±60 grader
  var A4_MIN = 415, A4_MAX = 466;
  var STORE_KEY = 'stemmeapparat.settings.v1';

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    instruments: $('instruments'),
    tuning: $('tuning'),
    display: $('display'),
    noteName: $('note-name'),
    noteOctave: $('note-octave'),
    freq: $('freq'),
    cents: $('cents'),
    hint: $('hint'),
    needle: $('needle'),
    ticks: $('gauge-ticks'),
    zone: $('gauge-zone'),
    strings: $('strings'),
    mode: $('mode'),
    play: $('play'),
    stop: $('stop'),
    start: $('start'),
    startError: $('start-error'),
    a4Value: $('a4-value'),
    a4Up: $('a4-up'),
    a4Down: $('a4-down'),
    capo: $('capo'),
    capoValue: $('capo-value'),
    capoBadge: $('capo-badge'),
    neck: $('neck')
  };

  var state = {
    instrumentId: 'guitar',
    tuningId: 'standard',
    a4: 440,
    capo: 0,             // båndnummer for capo (0 = ingen)
    locked: null,       // indeks på låst streng (kor) eller null = auto
    listening: false,
    done: new Set()      // nøgler på strenge der er stemt
  };

  var targets = [];
  var range = { min: 60, max: 1000 };

  var audio = { ctx: null, stream: null, analyser: null, buf: null };

  var det = {
    history: [],
    lastHeard: 0,
    timer: 0,
    active: false,
    current: null,       // seneste målstreng
    holdKey: null,
    holdSince: 0,
    needle: 0,
    needleGoal: 0,
    suppressUntil: 0
  };

  // ---------- Indstillinger ----------

  function loadSettings() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (!s) return;
      if (typeof s.instrumentId === 'string') state.instrumentId = s.instrumentId;
      if (typeof s.tuningId === 'string') state.tuningId = s.tuningId;
      if (typeof s.a4 === 'number' && s.a4 >= A4_MIN && s.a4 <= A4_MAX) state.a4 = s.a4;
      if (typeof s.capo === 'number' && s.capo >= 0 && s.capo <= D.MAX_CAPO) state.capo = Math.round(s.capo);
    } catch (e) { /* ingen adgang til lager – brug standard */ }
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        instrumentId: state.instrumentId, tuningId: state.tuningId, a4: state.a4, capo: state.capo
      }));
    } catch (e) { /* ignorer */ }
  }

  // ---------- Stemninger ----------

  function instrument() {
    return D.INSTRUMENTS.find(function (i) { return i.id === state.instrumentId; }) || D.INSTRUMENTS[0];
  }

  function tuning() {
    var ins = instrument();
    return ins.tunings.find(function (t) { return t.id === state.tuningId; }) || ins.tunings[0];
  }

  function freqOf(target) { return D.noteFreq(target.midi, state.a4); }
  function cents(f, ref) { return 1200 * Math.log2(f / ref); }

  // Capo bruges kun på instrumenter med bånd, hvor det giver mening
  function capo() {
    return instrument().capo ? state.capo : 0;
  }

  function rebuildTargets() {
    var t = tuning();
    var shift = capo();
    state.instrumentId = instrument().id;
    state.tuningId = t.id;
    targets = [];
    t.courses.forEach(function (course, ci) {
      course.forEach(function (spec, ni) {
        targets.push({
          key: ci + ':' + ni, course: ci, index: ni,
          midi: D.parseNote(spec) + shift,
          label: D.transposeLabel(spec, shift),
          open: D.prettyNote(spec)
        });
      });
    });
    var freqs = targets.map(freqOf);
    range.min = Math.min.apply(null, freqs) * 0.7;   // ca. 6 halvtoner under dybeste streng
    range.max = Math.max.apply(null, freqs) * 1.45;  // ca. 6 halvtoner over lyseste streng
  }

  function pickTarget(f) {
    var best = null, bestAbs = Infinity;
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      if (state.locked !== null && t.course !== state.locked) continue;
      var c = Math.abs(cents(f, freqOf(t)));
      if (c < bestAbs) { bestAbs = c; best = t; }
    }
    return best;
  }

  // ---------- Rendering ----------

  function renderInstruments() {
    el.instruments.innerHTML = '';
    D.INSTRUMENTS.forEach(function (ins) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = ins.name;
      b.setAttribute('aria-pressed', String(ins.id === state.instrumentId));
      b.addEventListener('click', function () { setInstrument(ins.id); });
      el.instruments.appendChild(b);
    });
  }

  function renderTunings() {
    el.tuning.innerHTML = '';
    instrument().tunings.forEach(function (t) {
      var o = document.createElement('option');
      o.value = t.id;
      var notes = t.courses.map(function (c) { return D.prettyNote(c[0]).name; }).join(' ');
      o.textContent = t.name + ' (' + notes + ')';
      o.selected = t.id === state.tuningId;
      el.tuning.appendChild(o);
    });
  }

  function noteHtml(label, cls, key) {
    return '<span class="n ' + (cls || '') + '" data-key="' + key + '">' + label.name + '<sub>' + label.octave + '</sub></span>';
  }

  function renderStrings() {
    var t = tuning();
    var shift = capo();
    el.strings.style.setProperty('--count', t.courses.length);
    el.strings.innerHTML = '';
    var total = t.courses.length;
    t.courses.forEach(function (course, ci) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'string';
      b.dataset.course = ci;
      var notes = targets.filter(function (x) { return x.course === ci; });
      var html = '';
      notes.forEach(function (x) {
        html += noteHtml(x.label, x.index > 0 ? 'secondary-note' : '', x.key);
      });
      // Strenge nummereres traditionelt fra den lyseste (1) til den dybeste.
      // Med capo vises den løse streng, så man kan se hvilken streng det er.
      html += '<span class="num">' + (total - ci) + '. streng</span>';
      if (shift) html += '<span class="num">løs ' + notes[0].open.name + '</span>';
      b.innerHTML = html;
      b.setAttribute('aria-label', (total - ci) + '. streng, ' +
        notes.map(function (x) { return x.label.name + x.label.octave; }).join(' og ') +
        (shift ? ', med capo på ' + shift + '. bånd' : ''));
      b.addEventListener('click', function () { toggleLock(ci); });
      el.strings.appendChild(b);
    });
    updateStringStates();
  }

  function updateStringStates() {
    var buttons = el.strings.querySelectorAll('.string');
    buttons.forEach(function (b) {
      var ci = Number(b.dataset.course);
      var notes = b.querySelectorAll('.n');
      var allDone = true;
      notes.forEach(function (n) {
        var isDone = state.done.has(n.dataset.key);
        if (!isDone) allDone = false;
        n.classList.toggle('done', isDone);
        n.classList.toggle('current', !!(det.active && det.current && det.current.key === n.dataset.key && notes.length > 1));
      });
      b.classList.toggle('done', allDone);
      b.classList.toggle('locked', state.locked === ci);
      b.classList.toggle('active', !!(det.active && det.current && det.current.course === ci));
      b.setAttribute('aria-pressed', String(state.locked === ci));
    });
  }

  function renderMode() {
    var auto = state.locked === null;
    el.mode.setAttribute('aria-pressed', String(auto));
    el.mode.textContent = auto ? 'Auto' : 'Låst';
    el.mode.title = auto ? 'Finder automatisk den nærmeste streng' : 'Låst til én streng – tryk for auto';
  }

  function buildNeck() {
    var markers = { 3: 1, 5: 1, 7: 1, 9: 1, 12: 2 };
    var html = '';
    for (var f = 0; f <= D.MAX_CAPO; f++) {
      var dots = '';
      for (var d = 0; d < (markers[f] || 0); d++) dots += '<span class="dot"></span>';
      html += '<button type="button" role="radio" class="fret' + (f === 0 ? ' nut' : '') + '" data-fret="' + f + '"' +
        ' aria-label="' + (f === 0 ? 'Ingen capo' : 'Capo på ' + f + '. bånd') + '">' +
        '<span>' + (f === 0 ? 'Ingen' : f) + '</span>' +
        (f === 0 ? '' : '<span class="dots">' + dots + '</span>') + '</button>';
    }
    el.neck.innerHTML = html;
    el.neck.querySelectorAll('.fret').forEach(function (b) {
      b.addEventListener('click', function () { setCapo(Number(b.dataset.fret)); });
    });
    // Piletaster flytter capoen, som i en almindelig radiogruppe
    el.neck.addEventListener('keydown', function (e) {
      var step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      setCapo(Math.max(0, Math.min(D.MAX_CAPO, state.capo + step)));
      el.neck.querySelector('[data-fret="' + state.capo + '"]').focus();
    });
  }

  function renderCapo() {
    var supported = !!instrument().capo;
    var shift = capo();
    el.capo.hidden = !supported;
    el.capoValue.textContent = shift ? shift + '. bånd – stem med capoen på' : 'Ingen';
    el.capoValue.classList.toggle('on', shift > 0);
    el.capoBadge.hidden = !shift;
    el.capoBadge.textContent = 'Capo ' + shift;
    el.neck.querySelectorAll('.fret').forEach(function (b) {
      var on = Number(b.dataset.fret) === state.capo;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
  }

  function renderA4() {
    el.a4Value.textContent = state.a4;
    el.a4Down.disabled = state.a4 <= A4_MIN;
    el.a4Up.disabled = state.a4 >= A4_MAX;
  }

  function buildGauge() {
    var cx = 160, cy = 170, R = 140;
    function pt(deg, r) {
      var a = deg * Math.PI / 180;
      return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
    }
    var svg = '';
    for (var c = -50; c <= 50; c += 5) {
      var deg = c / 50 * GAUGE_DEG;
      var major = c % 10 === 0;
      var inner = c === 0 ? R - 22 : major ? R - 16 : R - 9;
      var a = pt(deg, inner), b = pt(deg, R);
      var cls = 'tick' + (major ? ' major' : '') + (c === 0 ? ' center' : '');
      svg += '<line class="' + cls + '" x1="' + a[0].toFixed(1) + '" y1="' + a[1].toFixed(1) +
        '" x2="' + b[0].toFixed(1) + '" y2="' + b[1].toFixed(1) + '"/>';
      if (c % 25 === 0) {
        var l = pt(deg, R + 14);
        svg += '<text class="tick-label" text-anchor="middle" dominant-baseline="middle" x="' + l[0].toFixed(1) +
          '" y="' + l[1].toFixed(1) + '">' + (c > 0 ? '+' + c : c === 0 ? '0' : '−' + Math.abs(c)) + '</text>';
      }
    }
    el.ticks.innerHTML = svg;
    var z = IN_TUNE_CENTS * 1.6 / 50 * GAUGE_DEG;
    var z1 = pt(-z, R + 8), z2 = pt(z, R + 8);
    el.zone.setAttribute('d', 'M' + z1[0] + ' ' + z1[1] + ' A' + (R + 8) + ' ' + (R + 8) + ' 0 0 1 ' + z2[0] + ' ' + z2[1]);
  }

  // ---------- Visning af aflæsning ----------

  function setIdleReading() {
    det.active = false;
    det.current = null;
    det.history.length = 0;
    det.holdKey = null;
    det.needleGoal = 0;
    el.display.removeAttribute('data-level');
    el.display.removeAttribute('data-over');
    el.display.dataset.state = state.listening ? 'listening' : 'off';
    if (state.locked !== null) {
      var t = targets.find(function (x) { return x.course === state.locked && x.index === 0; });
      el.noteName.textContent = t.label.name;
      el.noteOctave.textContent = t.label.octave;
      el.freq.textContent = freqOf(t).toFixed(2) + ' Hz';
    } else {
      el.noteName.textContent = '–';
      el.noteOctave.textContent = '';
      el.freq.innerHTML = '&nbsp;';
    }
    el.cents.innerHTML = '&nbsp;';
    el.hint.textContent = state.listening ? 'Slå en streng an' : '';
    updateStringStates();
  }

  function showReading(f, now) {
    var t = pickTarget(f);
    var c = cents(f, freqOf(t));
    var abs = Math.abs(c);
    var level = abs <= IN_TUNE_CENTS ? 'in' : abs <= NEAR_CENTS ? 'near' : 'far';

    det.active = true;
    det.current = t;
    det.needleGoal = Math.max(-50, Math.min(50, c));

    el.display.dataset.state = 'listening';
    el.display.dataset.level = level;
    if (abs > 50) el.display.dataset.over = c < 0 ? 'flat' : 'sharp';
    else el.display.removeAttribute('data-over');

    el.noteName.textContent = t.label.name;
    el.noteOctave.textContent = t.label.octave;

    var heard = D.midiToLabel(Math.round(69 + 12 * Math.log2(f / state.a4)));
    var targetText = t.label.name + t.label.octave;
    el.freq.textContent = f.toFixed(1) + ' Hz · mål ' + freqOf(t).toFixed(1) + ' Hz' +
      (heard.name + heard.octave !== targetText ? ' · hører ' + heard.name + heard.octave : '');

    var rounded = Math.round(c);
    el.cents.textContent = (rounded > 0 ? '+' : rounded < 0 ? '−' : '±') + Math.abs(rounded) + ' cent';
    el.hint.textContent = level === 'in' ? 'Stemt ✓' : c < 0 ? 'For lav – stram strengen' : 'For høj – løsn strengen';

    // Flueben når strengen har været stemt et øjeblik
    if (level !== 'in' || det.holdKey !== t.key) {
      det.holdKey = t.key;
      det.holdSince = level === 'in' ? now : 0;
    } else if (det.holdSince && now - det.holdSince >= HOLD_MS) {
      markDone(t);
      det.holdSince = 0;
    }
    updateStringStates();
  }

  function markDone(t) {
    var added = false;
    targets.forEach(function (x) {
      // Unisonstrenge på 12-strenget har samme tone; stem dem som én
      if (x.course === t.course && x.midi === t.midi && !state.done.has(x.key)) {
        state.done.add(x.key);
        added = true;
      }
    });
    if (added && navigator.vibrate) {
      try { navigator.vibrate(30); } catch (e) { /* ignorer */ }
    }
  }

  // ---------- Lyd ----------

  function ensureContext() {
    audio.ctx = window.AudioShared.getContext();
    return audio.ctx;
  }

  function startMic() {
    el.startError.hidden = true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showStartError('Browseren giver ikke adgang til mikrofonen. Åbn siden via https:// (eller localhost) i en nyere browser.');
      return;
    }
    el.start.disabled = true;
    el.start.textContent = 'Starter…';
    navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    }).then(function (stream) {
      var ctx = ensureContext();
      audio.stream = stream;
      var src = ctx.createMediaStreamSource(stream);
      var hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 20;
      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 4000;
      audio.analyser = ctx.createAnalyser();
      audio.analyser.fftSize = 16384;
      audio.analyser.smoothingTimeConstant = 0;
      audio.buf = new Float32Array(audio.analyser.fftSize);
      src.connect(hp);
      hp.connect(lp);
      lp.connect(audio.analyser);
      audio.source = src;

      state.listening = true;
      window.AudioShared.keepAwake('tuner', true);
      el.stop.hidden = false;
      setIdleReading();
      startLoops();
    }).catch(function (err) {
      var msg = 'Mikrofonen kunne ikke startes.';
      if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
        msg = 'Adgang til mikrofonen blev afvist. Giv siden lov til at bruge mikrofonen i browserens indstillinger, og prøv igen.';
      } else if (err && err.name === 'NotFoundError') {
        msg = 'Der blev ikke fundet nogen mikrofon.';
      }
      showStartError(msg);
    }).then(function () {
      el.start.disabled = false;
      el.start.textContent = 'Start mikrofon';
    });
  }

  function stopMic() {
    state.listening = false;
    window.AudioShared.keepAwake('tuner', false);
    clearInterval(det.timer);
    if (audio.stream) audio.stream.getTracks().forEach(function (tr) { tr.stop(); });
    if (audio.source) audio.source.disconnect();
    audio.stream = audio.source = audio.analyser = null;
    el.stop.hidden = true;
    setIdleReading();
    drawNeedle(0);
  }

  function showStartError(msg) {
    el.startError.textContent = msg;
    el.startError.hidden = false;
  }

  function median(arr) {
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function analyse(now) {
    if (now < det.suppressUntil) return;
    // Mens stemtonen spiller, ville stemmeapparatet bare måle den
    if (window.Drone && window.Drone.isPlaying()) {
      det.lastHeard = 0;
      return silence(now);
    }
    var buf = audio.buf;
    audio.analyser.getFloatTimeDomainData(buf);

    var n = Math.min(buf.length, 4096), sum = 0;
    for (var i = buf.length - n; i < buf.length; i++) sum += buf[i] * buf[i];
    var rms = Math.sqrt(sum / n);

    var res = rms >= GATE_RMS ? P.detectPitch(buf, audio.ctx.sampleRate, range.min, range.max) : null;
    if (!res) return silence(now);

    // Udglatning: median af de seneste målinger, nulstilles ved tonespring
    var m = 69 + 12 * Math.log2(res.freq / state.a4);
    if (det.history.length && Math.abs(m - median(det.history)) > 0.6) det.history.length = 0;
    det.history.push(m);
    if (det.history.length > 5) det.history.shift();
    if (det.history.length < 2) return;

    det.lastHeard = now;
    var f = state.a4 * Math.pow(2, (median(det.history) - 69) / 12);
    showReading(f, now);
  }

  function silence(now) {
    if (!det.active) return;
    var quiet = now - det.lastHeard;
    if (quiet > RESET_MS) setIdleReading();
    else if (quiet > STALE_MS) {
      // Enkelte udfald ignoreres; ved rigtig stilhed starter flueben-tælleren forfra
      el.display.dataset.state = 'stale';
      det.history.length = 0;
      det.holdKey = null;
    }
  }

  function drawNeedle(c) {
    el.needle.setAttribute('transform', 'rotate(' + (c / 50 * GAUGE_DEG).toFixed(2) + ' 160 170)');
  }

  // Analysen kører på en fast timer; nålen animeres pr. skærmopdatering.
  function startLoops() {
    clearInterval(det.timer);
    det.timer = setInterval(function () {
      if (state.listening && audio.analyser) analyse(performance.now());
    }, ANALYSE_EVERY_MS);
    requestAnimationFrame(animate);
  }

  function animate() {
    if (!state.listening) return;
    requestAnimationFrame(animate);
    det.needle += (det.needleGoal - det.needle) * 0.22;
    drawNeedle(det.needle);
  }

  function playTone() {
    var ctx = ensureContext();
    var course = state.locked !== null ? state.locked : det.current ? det.current.course : 0;
    var t = det.current && det.current.course === course ? det.current
      : targets.find(function (x) { return x.course === course && x.index === 0; });
    var f = freqOf(t);
    var dur = 2.5;
    var start = ctx.currentTime + 0.02;

    // Lidt overtoner gør tonen lettere at høre og sammenligne med
    var real = new Float32Array([0, 1, 0.45, 0.25, 0.12, 0.06]);
    var imag = new Float32Array(real.length);
    var osc = ctx.createOscillator();
    osc.setPeriodicWave(ctx.createPeriodicWave(real, imag));
    osc.frequency.value = f;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(0.28, start + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + dur + 0.05);

    // Undgå at appen "stemmer" efter sin egen referencetone
    det.suppressUntil = performance.now() + dur * 1000 + 200;
    el.noteName.textContent = t.label.name;
    el.noteOctave.textContent = t.label.octave;
    el.freq.textContent = 'Referencetone ' + f.toFixed(2) + ' Hz';
  }

  // ---------- Handlinger ----------

  function setInstrument(id) {
    if (id === state.instrumentId) return;
    state.instrumentId = id;
    state.tuningId = instrument().tunings[0].id;
    state.capo = 0;
    resetTuning();
    renderInstruments();
    renderTunings();
  }

  function setTuning(id) {
    state.tuningId = id;
    resetTuning();
  }

  function resetTuning() {
    state.locked = null;
    state.done.clear();
    rebuildTargets();
    saveSettings();
    renderStrings();
    renderMode();
    renderCapo();
    setIdleReading();
  }

  function setCapo(fret) {
    if (fret === state.capo) return;
    state.capo = fret;
    var locked = state.locked;
    resetTuning();
    // En låst streng er stadig den samme streng, bare med capo
    if (locked !== null) { state.locked = locked; renderMode(); setIdleReading(); }
  }

  function toggleLock(ci) {
    state.locked = state.locked === ci ? null : ci;
    det.history.length = 0;
    renderMode();
    if (!det.active) setIdleReading(); else updateStringStates();
  }

  function changeA4(delta) {
    state.a4 = Math.max(A4_MIN, Math.min(A4_MAX, state.a4 + delta));
    rebuildTargets();
    renderA4();
    saveSettings();
    if (!det.active) setIdleReading();
    document.dispatchEvent(new CustomEvent('a4change', { detail: state.a4 }));
  }

  el.tuning.addEventListener('change', function () { setTuning(el.tuning.value); });
  el.mode.addEventListener('click', function () {
    if (state.locked !== null) toggleLock(state.locked);
    else toggleLock(det.current ? det.current.course : 0);
  });
  el.play.addEventListener('click', playTone);
  el.start.addEventListener('click', startMic);
  el.stop.addEventListener('click', stopMic);
  el.a4Up.addEventListener('click', function () { changeA4(1); });
  el.a4Down.addEventListener('click', function () { changeA4(-1); });

  // ---------- Start ----------

  loadSettings();
  rebuildTargets();
  buildGauge();
  buildNeck();
  renderCapo();
  renderInstruments();
  renderTunings();
  renderStrings();
  renderMode();
  renderA4();
  setIdleReading();
  drawNeedle(0);

  // Bruges af fanebjælken: mikrofonen slukkes, når man forlader stemmeapparatet
  window.Tuner = {
    stop: function () { if (state.listening) stopMic(); },
    getA4: function () { return state.a4; }
  };
})();
