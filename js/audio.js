/* Fælles lydkontekst for stemmeapparat og metronom, og en hjælper der holder
 * skærmen tændt, mens et af værktøjerne er i brug. */
(function (global) {
  'use strict';

  var ctx = null;

  function getContext() {
    if (!ctx || ctx.state === 'closed') {
      var Ctx = global.AudioContext || global.webkitAudioContext;
      ctx = new Ctx({ latencyHint: 'interactive' });
    }
    // iPhone bruger også tilstanden "interrupted" (opkald, låst skærm, anden app)
    if (ctx.state !== 'running') ctx.resume().catch(function () { /* prøves igen senere */ });
    return ctx;
  }

  // Skal kaldes direkte i et tryk: mobilbrowsere tillader kun, at lyd startes af
  // brugeren. En lydløs mini-lyd "låser op" for lyden på iPhone.
  function unlock() {
    var c = getContext();
    try {
      var b = c.createBuffer(1, 1, c.sampleRate);
      var s = c.createBufferSource();
      s.buffer = b;
      s.connect(c.destination);
      s.start(0);
    } catch (e) { /* ignorer */ }
    return c;
  }

  // Sidste udvej når lyden er gået i stå: luk konteksten og lav en ny
  function resetContext() {
    if (ctx) { try { ctx.close(); } catch (e) { /* ignorer */ } }
    ctx = null;
    return getContext();
  }

  // Væk lyden igen, når man vender tilbage til appen
  function wake() { if (ctx && ctx.state !== 'running') ctx.resume().catch(function () {}); }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) wake(); });
  global.addEventListener('pageshow', wake);
  global.addEventListener('focus', wake);

  // Tidspunktet (i kontekstens tid) for den lyd der lige nu kommer ud af højttaleren
  function audibleTime() {
    if (!ctx) return 0;
    if (ctx.getOutputTimestamp) {
      var ts = ctx.getOutputTimestamp();
      if (ts && ts.contextTime > 0) return ts.contextTime;
    }
    return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
  }

  // ---------- Hold skærmen tændt ----------
  var reasons = {};
  var sentinel = null;
  var pending = false;

  function updateWakeLock() {
    var want = Object.keys(reasons).length > 0;
    if (want && !sentinel && !pending && 'wakeLock' in navigator && !document.hidden) {
      pending = true;
      navigator.wakeLock.request('screen').then(function (s) {
        sentinel = s;
        s.addEventListener('release', function () { sentinel = null; });
        if (!Object.keys(reasons).length) { s.release(); }
      }).catch(function () { /* ikke tilladt – ingen skade sket */ })
        .then(function () { pending = false; });
    } else if (!want && sentinel) {
      sentinel.release();
      sentinel = null;
    }
  }

  function keepAwake(reason, on) {
    if (on) reasons[reason] = true;
    else delete reasons[reason];
    updateWakeLock();
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) updateWakeLock();
  });

  // ---------- Plukket streng (Karplus-Strong) ----------
  // En kort støjimpuls sendes rundt i en forsinkelseslinje med et blødt filter,
  // hvilket lyder overraskende meget som en guitarstreng.
  var pluckCache = {};

  function pluckBuffer(freq) {
    var c = getContext();
    var key = c.sampleRate + ':' + freq.toFixed(2);
    if (pluckCache[key]) return pluckCache[key];
    var sr = c.sampleRate;
    var period = sr / freq;
    var N = Math.max(2, Math.floor(period - 0.5));
    var n = Math.round(sr * 2.6);
    var buf = c.createBuffer(1, n, sr);
    var d = buf.getChannelData(0);
    var prev = 0, i;
    for (i = 0; i < N + 1 && i < n; i++) {
      var r = Math.random() * 2 - 1;
      prev = 0.6 * r + 0.4 * prev;   // blødere anslag
      d[i] = prev;
    }
    var damp = freq < 150 ? 0.997 : 0.996;
    for (i = N + 1; i < n; i++) d[i] = damp * 0.5 * (d[i - N] + d[i - N - 1]);
    var peak = 0;
    for (i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
    for (i = 0; i < n; i++) d[i] /= peak || 1;
    // Løkkens reelle periode er N + 0,5 sample; afspilningshastigheden retter tonehøjden præcist
    var entry = { buffer: buf, rate: (N + 0.5) / period };
    pluckCache[key] = entry;
    return entry;
  }

  function pluck(freq, when, gain) {
    var c = getContext();
    var p = pluckBuffer(freq);
    var src = c.createBufferSource();
    src.buffer = p.buffer;
    src.playbackRate.value = p.rate;
    var g = c.createGain();
    var t = Math.max(when || 0, c.currentTime);
    var dur = p.buffer.duration / p.rate;
    g.gain.setValueAtTime(gain == null ? 0.35 : gain, t);
    g.gain.setTargetAtTime(0, t + dur - 0.3, 0.08);
    src.connect(g);
    g.connect(c.destination);
    src.start(t);
    src.stop(t + dur);
    return t + dur;
  }

  // ---------- Mikrofon ----------
  function openMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject(Object.assign(new Error('unsupported'), { name: 'NotSupportedError' }));
    }
    unlock(); // mens vi stadig er inde i brugerens tryk
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    }).then(function (stream) {
      var c = getContext();
      c.resume().catch(function () {});
      var src = c.createMediaStreamSource(stream);
      var hp = c.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 20;
      var analyser = c.createAnalyser();
      analyser.fftSize = 16384;
      analyser.smoothingTimeConstant = 0;
      src.connect(hp);
      hp.connect(analyser);
      return {
        analyser: analyser,
        buffer: new Float32Array(analyser.fftSize),
        sampleRate: c.sampleRate,
        stop: function () {
          stream.getTracks().forEach(function (t) { t.stop(); });
          src.disconnect();
        }
      };
    });
  }

  function micErrorText(err) {
    if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
      return 'Adgang til mikrofonen blev afvist. Giv siden lov til at bruge mikrofonen i browserens indstillinger, og prøv igen.';
    }
    if (err && err.name === 'NotFoundError') return 'Der blev ikke fundet nogen mikrofon.';
    if (err && err.name === 'NotSupportedError') return 'Browseren giver ikke adgang til mikrofonen. Åbn siden via https:// (eller localhost).';
    return 'Mikrofonen kunne ikke startes.';
  }

  function a4() {
    return global.Tuner && global.Tuner.getA4 ? global.Tuner.getA4() : 440;
  }

  function midiFreq(midi) {
    return a4() * Math.pow(2, (midi - 69) / 12);
  }

  global.AudioShared = {
    getContext: getContext,
    unlock: unlock,
    resetContext: resetContext,
    audibleTime: audibleTime,
    keepAwake: keepAwake,
    pluck: pluck,
    openMic: openMic,
    micErrorText: micErrorText,
    midiFreq: midiFreq
  };
})(window);
