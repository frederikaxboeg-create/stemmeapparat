/* Stemtone og drone: en vedvarende tone at stemme efter med øret
 * eller at øve skalaer og intonation over. */
(function () {
  'use strict';

  var A = window.AudioShared;
  var D = window.TunerData;
  var STORE_KEY = 'stemmeapparat.drone.v1';
  var NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  var SOUNDS = [
    { id: 'pure', name: 'Ren tone' },
    { id: 'organ', name: 'Orgel' },
    { id: 'strings', name: 'Strygere' },
    { id: 'reed', name: 'Harmonium' }
  ];

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    toggle: $('drone-toggle'),
    info: $('drone-info'),
    notes: $('drone-notes'),
    oct: $('drone-oct'),
    octDown: $('drone-oct-down'),
    octUp: $('drone-oct-up'),
    sound: $('drone-sound'),
    fifth: $('drone-fifth'),
    volume: $('drone-volume')
  };

  var state = { pc: 9, octave: 4, sound: 'pure', fifth: false, volume: 0.6 };
  var voice = null; // { out, oscs: [{osc, ratio}] }

  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (!s) return;
      if (s.pc >= 0 && s.pc < 12) state.pc = s.pc;
      if (s.octave >= 1 && s.octave <= 6) state.octave = s.octave;
      if (SOUNDS.some(function (x) { return x.id === s.sound; })) state.sound = s.sound;
      state.fifth = !!s.fifth;
      if (s.volume >= 0 && s.volume <= 1) state.volume = s.volume;
    } catch (e) { /* standard */ }
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignorer */ }
  }

  function midi() { return (state.octave + 1) * 12 + state.pc; }
  function freq() { return A.midiFreq(midi()); }

  // ---------- Lyd ----------

  // Klangene har forskellig styrke af natur; udlign dem så de lyder lige kraftige
  function level() {
    var v = state.volume * state.volume;
    return (state.sound === 'pure' ? 0.4 : state.sound === 'organ' ? 0.18 : 0.12) * v;
  }

  function makeOsc(ctx, f, dest) {
    var o = ctx.createOscillator();
    if (state.sound === 'organ') {
      o.setPeriodicWave(ctx.createPeriodicWave(
        new Float32Array([0, 1, 0.7, 0.15, 0.45, 0.05, 0.12, 0, 0.2]), new Float32Array(9)));
    } else if (state.sound === 'reed') {
      o.type = 'square';
    } else if (state.sound === 'strings') {
      o.type = 'sawtooth';
    } else {
      o.type = 'sine';
    }
    o.frequency.value = f;
    o.connect(dest);
    o.start();
    return o;
  }

  function start() {
    var ctx = A.getContext();
    var out = ctx.createGain();
    out.gain.value = 0;
    var tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = state.sound === 'strings' ? 2200 : state.sound === 'reed' ? 1600 : 8000;
    tone.Q.value = 0.5;
    tone.connect(out);
    out.connect(ctx.destination);

    // Kvinten stemmes rent (3:2), som man gør, når man øver intonation over en drone
    var ratios = state.fifth ? [1, 1.5] : [1];
    var oscs = [];
    ratios.forEach(function (r) {
      var mix = ctx.createGain();
      mix.gain.value = r === 1 ? 1 : 0.6;
      mix.connect(tone);
      oscs.push({ osc: makeOsc(ctx, freq() * r, mix), ratio: r });
      // Strygere: en let forstemt ekstra stemme giver et fyldigere "kor"
      if (state.sound === 'strings') {
        var o2 = makeOsc(ctx, freq() * r, mix);
        o2.detune.value = 7;
        oscs.push({ osc: o2, ratio: r });
      }
    });

    out.gain.setTargetAtTime(level(), ctx.currentTime, 0.04);
    voice = { out: out, oscs: oscs, ctx: ctx };
    render();
  }

  function stop() {
    if (!voice) return;
    var v = voice;
    voice = null;
    v.out.gain.setTargetAtTime(0, v.ctx.currentTime, 0.04);
    setTimeout(function () {
      v.oscs.forEach(function (o) { o.osc.stop(); });
      v.out.disconnect();
    }, 300);
    render();
  }

  // Ændringer mens den spiller: tonehøjde glider blødt, klang kræver genstart
  function retune() {
    if (!voice) return;
    var t = voice.ctx.currentTime;
    voice.oscs.forEach(function (o) { o.osc.frequency.setTargetAtTime(freq() * o.ratio, t, 0.02); });
  }
  function restart() { if (voice) { stop(); start(); } }

  // ---------- Brugerflade ----------

  function render() {
    var playing = !!voice;
    el.toggle.textContent = playing ? '■ Stop' : '▶ Spil';
    el.toggle.classList.toggle('running', playing);
    el.toggle.setAttribute('aria-pressed', String(playing));
    var label = D.midiToLabel(midi());
    el.info.textContent = NAMES[state.pc] + label.octave + ' · ' + freq().toFixed(2).replace('.', ',') + ' Hz' +
      (state.fifth ? ' + kvint' : '') + (playing ? ' · stemmeapparatet holder pause' : '');
    el.oct.textContent = state.octave;
    el.octDown.disabled = state.octave <= 1;
    el.octUp.disabled = state.octave >= 6;
    el.notes.querySelectorAll('button').forEach(function (b) {
      b.setAttribute('aria-checked', String(Number(b.dataset.pc) === state.pc));
    });
  }

  function build() {
    el.notes.innerHTML = NAMES.map(function (n, i) {
      return '<button type="button" role="radio" class="note-btn" data-pc="' + i + '">' + n + '</button>';
    }).join('');
    el.notes.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        state.pc = Number(b.dataset.pc);
        save(); retune(); render();
      });
    });
    el.sound.innerHTML = SOUNDS.map(function (s) {
      return '<option value="' + s.id + '"' + (s.id === state.sound ? ' selected' : '') + '>' + s.name + '</option>';
    }).join('');
    el.fifth.checked = state.fifth;
    el.volume.value = Math.round(state.volume * 100);
  }

  el.toggle.addEventListener('click', function () { if (voice) stop(); else start(); });
  el.octDown.addEventListener('click', function () { state.octave = Math.max(1, state.octave - 1); save(); retune(); render(); });
  el.octUp.addEventListener('click', function () { state.octave = Math.min(6, state.octave + 1); save(); retune(); render(); });
  el.sound.addEventListener('change', function () { state.sound = el.sound.value; save(); restart(); });
  el.fifth.addEventListener('change', function () { state.fifth = el.fifth.checked; save(); restart(); render(); });
  el.volume.addEventListener('input', function () {
    state.volume = Number(el.volume.value) / 100;
    save();
    if (voice) voice.out.gain.setTargetAtTime(level(), voice.ctx.currentTime, 0.03);
  });
  document.addEventListener('a4change', function () { retune(); render(); });

  load();
  build();
  render();

  window.Drone = { isPlaying: function () { return !!voice; }, stop: stop };
})();
