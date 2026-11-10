/* Metronom.
 * Klikkene planlægges præcist i Web Audio-tidslinjen et øjeblik ude i fremtiden
 * ("lookahead"-planlægning), så takten ikke svajer, selv hvis browseren har travlt.
 * Grafikken følger med ved at aflæse, hvad der faktisk spilles lige nu. */
(function () {
  'use strict';

  var A = window.AudioShared;

  var MIN_BPM = 20, MAX_BPM = 300, MAX_BEATS = 16;
  var LOOKAHEAD_MS = 25;
  var SCHEDULE_AHEAD = 0.12;         // sekunder frem, når siden er synlig
  var SCHEDULE_AHEAD_HIDDEN = 1.2;   // baggrundsfaner får sjældnere timere
  var SWING_DEG = 30;
  var STORE_KEY = 'stemmeapparat.metronome.v1';

  // Betoning: 3 = stærk, 2 = middel, 1 = svag, 0 = stille
  var METERS = [
    { id: '2/4', beats: 2, unit: 4, accents: [3, 1] },
    { id: '3/4', beats: 3, unit: 4, accents: [3, 1, 1] },
    { id: '4/4', beats: 4, unit: 4, accents: [3, 1, 1, 1] },
    { id: '5/4', beats: 5, unit: 4, accents: [3, 1, 1, 2, 1] },
    { id: '6/8', beats: 6, unit: 8, accents: [3, 1, 1, 2, 1, 1] },
    { id: '7/8', beats: 7, unit: 8, accents: [3, 1, 2, 1, 2, 1, 1] },
    { id: '9/8', beats: 9, unit: 8, accents: [3, 1, 1, 2, 1, 1, 2, 1, 1] },
    { id: '12/8', beats: 12, unit: 8, accents: [3, 1, 1, 2, 1, 1, 2, 1, 1, 2, 1, 1] }
  ];

  var SUBDIVS = [
    { n: 1, label: '1', name: 'Ingen underdeling' },
    { n: 2, label: '2', name: 'Ottendedele' },
    { n: 3, label: '3', name: 'Trioler' },
    { n: 4, label: '4', name: 'Sekstendedele' }
  ];

  var SOUNDS = [
    { id: 'wood', name: 'Træblok' },
    { id: 'click', name: 'Klik' },
    { id: 'beep', name: 'Bip' },
    { id: 'cowbell', name: 'Koklokke' }
  ];

  var TEMPO_NAMES = [
    [40, 'Grave'], [60, 'Largo'], [66, 'Larghetto'], [76, 'Adagio'], [108, 'Andante'],
    [120, 'Moderato'], [156, 'Allegro'], [176, 'Vivace'], [200, 'Presto'], [Infinity, 'Prestissimo']
  ];

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    view: $('view-metronome'),
    main: $('met-main'),
    arm: $('pendulum-arm'),
    beats: $('met-beats'),
    bpm: $('bpm-value'),
    tempoName: $('tempo-name'),
    slider: $('bpm-slider'),
    down: $('bpm-down'),
    up: $('bpm-up'),
    tap: $('tap'),
    toggle: $('met-toggle'),
    meters: $('meters'),
    beatsValue: $('beats-value'),
    beatsDown: $('beats-down'),
    beatsUp: $('beats-up'),
    subdivs: $('subdivs'),
    sound: $('met-sound'),
    volume: $('met-volume'),
    trainerOn: $('trainer-on'),
    trainer: $('trainer'),
    trStep: $('tr-step'),
    trBars: $('tr-bars'),
    trTarget: $('tr-target'),
    trStatus: $('trainer-status')
  };

  var state = {
    bpm: 100,
    beats: 4,
    unit: 4,
    accents: [3, 1, 1, 1],
    subdiv: 1,
    sound: 'wood',
    volume: 0.8,
    running: false,
    trainer: { on: false, step: 5, bars: 4, target: 140 }
  };

  var sched = {
    timer: 0,
    nextTime: 0,
    beat: 0,
    sub: 0,
    queue: [],          // planlagte klik der endnu ikke er vist
    current: -1,        // slaget der vises som aktivt
    lastBeatTime: 0,
    lastBeatDur: 0.6,
    beatCount: 0
  };

  var master = null;
  var noiseBuffer = null;

  // ---------- Indstillinger ----------

  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (!s) return;
      if (s.bpm >= MIN_BPM && s.bpm <= MAX_BPM) state.bpm = Math.round(s.bpm);
      if (s.beats >= 1 && s.beats <= MAX_BEATS) state.beats = s.beats;
      if (s.unit === 4 || s.unit === 8) state.unit = s.unit;
      if (Array.isArray(s.accents) && s.accents.length === state.beats) state.accents = s.accents.map(function (a) { return Math.max(0, Math.min(3, a | 0)); });
      else state.accents = defaultAccents(state.beats, state.unit);
      if (SUBDIVS.some(function (d) { return d.n === s.subdiv; })) state.subdiv = s.subdiv;
      if (SOUNDS.some(function (d) { return d.id === s.sound; })) state.sound = s.sound;
      if (s.volume >= 0 && s.volume <= 1) state.volume = s.volume;
      if (s.trainer) {
        var t = s.trainer;
        state.trainer.on = !!t.on;
        if (t.step >= 1 && t.step <= 20) state.trainer.step = t.step;
        if (t.bars >= 1 && t.bars <= 32) state.trainer.bars = t.bars;
        if (t.target >= MIN_BPM && t.target <= MAX_BPM) state.trainer.target = t.target;
      }
    } catch (e) { /* standardindstillinger */ }
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        bpm: state.bpm, beats: state.beats, unit: state.unit, accents: state.accents,
        subdiv: state.subdiv, sound: state.sound, volume: state.volume, trainer: state.trainer
      }));
    } catch (e) { /* ignorer */ }
  }

  function defaultAccents(beats, unit) {
    var preset = METERS.find(function (m) { return m.beats === beats && m.unit === unit; });
    if (preset) return preset.accents.slice();
    var a = [];
    for (var i = 0; i < beats; i++) a.push(i === 0 ? 3 : 1);
    return a;
  }

  // ---------- Lyd ----------

  function audio() {
    var ctx = A.getContext();
    if (!master || master.context !== ctx) {
      master = ctx.createGain();
      master.connect(ctx.destination);
      noiseBuffer = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.05), ctx.sampleRate);
      var d = noiseBuffer.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    master.gain.value = state.volume * state.volume; // føles mere lineært
    return ctx;
  }

  function envelope(ctx, time, peak, decay) {
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(peak, time + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, time + decay);
    g.connect(master);
    return g;
  }

  function tone(ctx, time, type, freq, peak, decay, dest) {
    var o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.connect(dest || envelope(ctx, time, peak, decay));
    o.start(time);
    o.stop(time + decay + 0.02);
  }

  // level: 3 stærk, 2 middel, 1 svag; sub = underdelingsklik
  function playClick(time, level, sub) {
    var ctx = audio();
    var peak = sub ? 0.32 : [0, 0.5, 0.75, 1][level];
    var pitch = sub ? 0.85 : level === 3 ? 1.5 : level === 2 ? 1.22 : 1;

    switch (state.sound) {
      case 'click': {
        var n = ctx.createBufferSource();
        n.buffer = noiseBuffer;
        var bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 2600 * pitch;
        bp.Q.value = 2;
        n.connect(bp);
        bp.connect(envelope(ctx, time, peak * 1.6, 0.03));
        n.start(time);
        n.stop(time + 0.05);
        break;
      }
      case 'beep':
        tone(ctx, time, 'sine', 880 * pitch, peak * 0.7, 0.09);
        break;
      case 'cowbell': {
        var env = envelope(ctx, time, peak * 0.35, 0.22);
        var bp2 = ctx.createBiquadFilter();
        bp2.type = 'bandpass';
        bp2.frequency.value = 2600 * pitch;
        bp2.Q.value = 0.8;
        bp2.connect(env);
        tone(ctx, time, 'square', 540 * pitch, 0, 0.22, bp2);
        tone(ctx, time, 'square', 800 * pitch, 0, 0.22, bp2);
        break;
      }
      default: { // træblok: to inharmoniske deltoner med hurtigt henfald
        var e = envelope(ctx, time, peak * 0.9, 0.07);
        tone(ctx, time, 'sine', 820 * pitch, 0, 0.07, e);
        var e2 = envelope(ctx, time, peak * 0.3, 0.03);
        tone(ctx, time, 'sine', 820 * pitch * 2.73, 0, 0.03, e2);
      }
    }
  }

  // ---------- Planlægning ----------

  function scheduleAhead() {
    var ctx = A.getContext();
    var ahead = document.hidden ? SCHEDULE_AHEAD_HIDDEN : SCHEDULE_AHEAD;
    // Er vi kommet bagud (f.eks. efter at enheden har sovet), startes der forfra
    if (sched.nextTime < ctx.currentTime - 0.05) {
      sched.nextTime = ctx.currentTime + 0.05;
      sched.queue.length = 0;
    }
    while (sched.nextTime < ctx.currentTime + ahead) {
      var beat = sched.beat % state.beats;
      if (beat === 0 && sched.sub === 0) {
        if (sched.started) onBar();   // en ny takt begynder (ikke den allerførste)
        sched.started = true;
      }
      var level = state.accents[beat] || 0;
      var isSub = sched.sub > 0;
      if (level > 0) playClick(sched.nextTime, level, isSub);
      var beatDur = 60 / state.bpm;
      sched.queue.push({ time: sched.nextTime, beat: beat, sub: sched.sub, dur: beatDur });

      sched.nextTime += beatDur / state.subdiv;
      sched.sub++;
      if (sched.sub >= state.subdiv) {
        sched.sub = 0;
        sched.beat = (beat + 1) % state.beats;
      }
    }
    updateVisuals();
  }

  // ---------- Tempotræner ----------

  function onBar() {
    sched.bars++;
    var t = state.trainer;
    if (t.on && state.bpm !== t.target && sched.bars % t.bars === 0) {
      var dir = t.target > state.bpm ? 1 : -1;
      var next = state.bpm + dir * t.step;
      if ((dir > 0 && next > t.target) || (dir < 0 && next < t.target)) next = t.target;
      setBpm(next);
    }
    renderTrainerStatus();
  }

  function renderTrainer() {
    var t = state.trainer;
    el.trainerOn.checked = t.on;
    el.trainer.hidden = !t.on;
    el.trStep.textContent = t.step;
    el.trBars.textContent = t.bars;
    el.trTarget.textContent = t.target;
    renderTrainerStatus();
  }

  function renderTrainerStatus() {
    var t = state.trainer;
    if (!t.on) return;
    var dirWord = t.target >= (sched.startBpm || state.bpm) ? 'op' : 'ned';
    if (!state.running) {
      el.trStatus.textContent = 'Starter på ' + state.bpm + ' BPM og går ' + dirWord + ' mod ' + t.target +
        ' BPM med ' + t.step + ' BPM hver ' + (t.bars === 1 ? 'takt' : t.bars + '. takt') +
        '. Tempoet går tilbage til start, når du stopper.';
    } else if (state.bpm === t.target) {
      el.trStatus.textContent = 'Mål nået: ' + t.target + ' BPM 🎉';
    } else {
      var left = t.bars - (sched.bars % t.bars);
      el.trStatus.textContent = 'Takt ' + (sched.bars + 1) + ' · næste skift om ' + left + (left === 1 ? ' takt' : ' takter');
    }
  }

  function start() {
    var ctx = audio();
    sched.bars = 0;
    sched.started = false;
    sched.startBpm = state.bpm;
    sched.beat = 0;
    sched.sub = 0;
    sched.queue.length = 0;
    sched.beatCount = 0;
    sched.nextTime = ctx.currentTime + 0.08;
    state.running = true;
    clearInterval(sched.timer);
    sched.timer = setInterval(scheduleAhead, LOOKAHEAD_MS);
    scheduleAhead();
    requestAnimationFrame(animate);
    A.keepAwake('metronome', true);
    renderToggle();
  }

  function stop() {
    state.running = false;
    clearInterval(sched.timer);
    sched.queue.length = 0;
    sched.current = -1;
    A.keepAwake('metronome', false);
    // Tempotræneren starter forfra fra samme tempo næste gang
    if (state.trainer.on && sched.startBpm && state.bpm !== sched.startBpm) setBpm(sched.startBpm);
    sched.startBpm = 0;
    renderToggle();
    renderTrainerStatus();
    highlightBeat(-1);
    setArm(0);
  }

  function toggle() { if (state.running) stop(); else start(); }

  // ---------- Grafik ----------

  function updateVisuals() {
    if (!state.running) return;
    var now = A.audibleTime();
    var changed = false;
    while (sched.queue.length && sched.queue[0].time <= now) {
      var ev = sched.queue.shift();
      if (ev.sub === 0) {
        sched.current = ev.beat;
        sched.lastBeatTime = ev.time;
        sched.lastBeatDur = ev.dur;
        sched.beatCount++;
        changed = true;
      }
    }
    if (changed) highlightBeat(sched.current);
  }

  function animate() {
    if (!state.running) return;
    requestAnimationFrame(animate);
    updateVisuals();
    if (!sched.beatCount) return;
    // Pendulet står yderst på hvert slag og svinger over på det næste
    var phase = Math.min(1, Math.max(0, (A.audibleTime() - sched.lastBeatTime) / sched.lastBeatDur));
    var side = sched.beatCount % 2 ? -1 : 1;
    setArm(side * SWING_DEG * Math.cos(Math.PI * phase));
  }

  function setArm(deg) {
    el.arm.setAttribute('transform', 'rotate(' + deg.toFixed(2) + ' 120 122)');
  }

  function highlightBeat(i) {
    var bars = el.beats.children;
    for (var b = 0; b < bars.length; b++) {
      var on = b === i;
      bars[b].classList.toggle('on', on);
      // Genstart animationen, også når samme slag gentages (1 slag pr. takt)
      if (on) { bars[b].classList.remove('pulse'); void bars[b].offsetWidth; bars[b].classList.add('pulse'); }
    }
    el.main.classList.toggle('downbeat', i === 0);
  }

  // ---------- Rendering ----------

  var LEVEL_NAMES = ['stille', 'svag', 'middel', 'stærk'];

  function renderBeats() {
    el.beats.innerHTML = '';
    el.beats.style.setProperty('--beats', state.beats);
    state.accents.forEach(function (level, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'beat';
      b.dataset.level = level;
      b.setAttribute('aria-label', 'Slag ' + (i + 1) + ': ' + LEVEL_NAMES[level]);
      b.innerHTML = '<span class="bar"></span><span class="beat-num">' + (i + 1) + '</span>';
      b.addEventListener('click', function () {
        state.accents[i] = (state.accents[i] + 3) % 4; // stærk → middel → svag → stille → stærk
        b.dataset.level = state.accents[i];
        b.setAttribute('aria-label', 'Slag ' + (i + 1) + ': ' + LEVEL_NAMES[state.accents[i]]);
        save();
      });
      el.beats.appendChild(b);
    });
    if (state.running) highlightBeat(sched.current);
  }

  function renderMeters() {
    var id = state.beats + '/' + state.unit;
    el.meters.innerHTML = '';
    METERS.forEach(function (m) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = m.id;
      b.setAttribute('aria-pressed', String(m.id === id));
      b.addEventListener('click', function () { setMeter(m.beats, m.unit, m.accents.slice()); });
      el.meters.appendChild(b);
    });
    el.beatsValue.textContent = state.beats;
    el.beatsDown.disabled = state.beats <= 1;
    el.beatsUp.disabled = state.beats >= MAX_BEATS;
  }

  function renderSubdivs() {
    el.subdivs.innerHTML = '';
    SUBDIVS.forEach(function (d) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(d.n === state.subdiv));
      b.setAttribute('aria-label', d.name);
      b.title = d.name;
      b.innerHTML = subdivIcon(d.n);
      b.addEventListener('click', function () {
        state.subdiv = d.n;
        if (sched.sub >= d.n) sched.sub = 0;
        save();
        renderSubdivs();
      });
      el.subdivs.appendChild(b);
    });
  }

  // Små prikker der viser antal klik pr. slag; det første er større
  function subdivIcon(n) {
    var s = '<span class="sub-icon">';
    for (var i = 0; i < n; i++) s += '<i class="' + (i === 0 ? 'big' : '') + '"></i>';
    return s + '</span>';
  }

  function renderSounds() {
    el.sound.innerHTML = SOUNDS.map(function (s) {
      return '<option value="' + s.id + '"' + (s.id === state.sound ? ' selected' : '') + '>' + s.name + '</option>';
    }).join('');
  }

  function tempoName(bpm) {
    for (var i = 0; i < TEMPO_NAMES.length; i++) if (bpm < TEMPO_NAMES[i][0]) return TEMPO_NAMES[i][1];
    return '';
  }

  function renderBpm() {
    el.bpm.textContent = state.bpm;
    el.slider.value = state.bpm;
    el.tempoName.textContent = tempoName(state.bpm);
    el.down.disabled = state.bpm <= MIN_BPM;
    el.up.disabled = state.bpm >= MAX_BPM;
  }

  function renderToggle() {
    el.toggle.textContent = state.running ? 'Stop' : 'Start';
    el.toggle.classList.toggle('running', state.running);
    el.toggle.setAttribute('aria-pressed', String(state.running));
  }

  // ---------- Handlinger ----------

  function setBpm(v) {
    v = Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(v)));
    if (v === state.bpm) return;
    state.bpm = v;
    renderBpm();
    renderTrainerStatus();
    save();
  }

  function setMeter(beats, unit, accents) {
    state.beats = beats;
    state.unit = unit;
    state.accents = accents || defaultAccents(beats, unit);
    if (sched.beat >= beats) sched.beat = 0;
    save();
    renderMeters();
    renderBeats();
  }

  function changeBeats(delta) {
    var beats = Math.max(1, Math.min(MAX_BEATS, state.beats + delta));
    if (beats === state.beats) return;
    var accents = state.accents.slice(0, beats);
    while (accents.length < beats) accents.push(1);
    setMeter(beats, state.unit, accents);
  }

  // Tap tempo: gennemsnit af de seneste slag; en pause på over 2 sek. starter forfra
  var taps = [];
  function tap() {
    var now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
    taps.push(now);
    if (taps.length > 6) taps.shift();
    el.tap.classList.remove('pulse');
    void el.tap.offsetWidth;
    el.tap.classList.add('pulse');
    if (taps.length >= 2) {
      var avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
      setBpm(60000 / avg);
    }
  }

  // Hold +/− nede for at ændre tempoet hurtigt
  function repeatButton(btn, fn) {
    var t1 = 0, t2 = 0;
    function end() { clearTimeout(t1); clearInterval(t2); }
    btn.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      fn();
      t1 = setTimeout(function () { t2 = setInterval(fn, 70); }, 400);
    });
    ['pointerup', 'pointerleave', 'pointercancel', 'blur'].forEach(function (ev) { btn.addEventListener(ev, end); });
    // Tastatur (Enter/mellemrum) udløser click uden pointerdown
    btn.addEventListener('click', function (e) { if (e.detail === 0) fn(); });
  }

  repeatButton(el.down, function () { setBpm(state.bpm - 1); });
  repeatButton(el.up, function () { setBpm(state.bpm + 1); });
  el.slider.addEventListener('input', function () { setBpm(Number(el.slider.value)); });
  el.toggle.addEventListener('click', toggle);
  el.tap.addEventListener('click', tap);
  el.beatsDown.addEventListener('click', function () { changeBeats(-1); });
  el.beatsUp.addEventListener('click', function () { changeBeats(1); });
  el.sound.addEventListener('change', function () {
    state.sound = el.sound.value;
    save();
    if (!state.running) playClick(audio().currentTime + 0.02, 3, false); // smagsprøve
  });
  el.volume.addEventListener('input', function () {
    state.volume = Number(el.volume.value) / 100;
    if (master) master.gain.value = state.volume * state.volume;
    save();
  });

  el.trainerOn.addEventListener('change', function () {
    state.trainer.on = el.trainerOn.checked;
    if (state.trainer.on && state.running) sched.startBpm = sched.startBpm || state.bpm;
    save();
    renderTrainer();
  });
  var TR_LIMITS = { step: [1, 20], bars: [1, 32], target: [MIN_BPM, MAX_BPM] };
  el.trainer.querySelectorAll('[data-tr]').forEach(function (b) {
    b.addEventListener('click', function () {
      var k = b.dataset.tr, lim = TR_LIMITS[k];
      state.trainer[k] = Math.max(lim[0], Math.min(lim[1], state.trainer[k] + Number(b.dataset.d)));
      save();
      renderTrainer();
    });
  });

  document.addEventListener('keydown', function (e) {
    if (el.view.hidden || e.metaKey || e.ctrlKey || e.altKey) return;
    var tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.code === 'Space' && tag !== 'BUTTON') { e.preventDefault(); toggle(); }
    else if (e.key === 't' || e.key === 'T') tap();
    else if (e.key === 'ArrowUp' && tag !== 'BUTTON') { e.preventDefault(); setBpm(state.bpm + (e.shiftKey ? 5 : 1)); }
    else if (e.key === 'ArrowDown' && tag !== 'BUTTON') { e.preventDefault(); setBpm(state.bpm - (e.shiftKey ? 5 : 1)); }
  });

  // ---------- Start ----------

  load();
  el.volume.value = Math.round(state.volume * 100);
  renderBpm();
  renderMeters();
  renderBeats();
  renderSubdivs();
  renderSounds();
  renderToggle();
  renderTrainer();
  setArm(0);

  window.Metronome = {
    stop: stop,
    isRunning: function () { return state.running; },
    getBpm: function () { return state.bpm; }
  };
})();
