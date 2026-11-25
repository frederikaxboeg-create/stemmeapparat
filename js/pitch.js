/* Tonehøjde-detektion i to trin.
 *
 * 1. Grovsøgning med YIN-algoritmen (de Cheveigné & Kawahara, 2002) på et
 *    nedsamplet signal (~12 kHz) med et langt vindue. Det er hurtigt og robust:
 *    YIN finder grundtonen, selv når overtonerne er stærkere end den (typisk på
 *    guitar og bas), og et langt vindue gør den mindre følsom over for støj.
 * 2. Finjustering i fuld samplerate: differensfunktionen beregnes kun omkring
 *    den fundne periode, over et vindue på op til 80 ms, og minimum findes med
 *    parabolsk interpolation. Det giver en præcision på en brøkdel af en cent
 *    og en rolig visning, også når strengen klinger ud. */
(function (global) {
  'use strict';

  var buffers = {};
  function scratch(name, size) {
    var b = buffers[name];
    if (!b || b.length < size) b = buffers[name] = new Float32Array(size);
    return b;
  }

  var COARSE_RATE = 12000;   // grovsøgningens samplerate (Hz)
  var COARSE_WIN = 0.06;     // grovsøgningens vindue (s)
  var FINE_WIN = 0.08;       // finjusteringens vindue (s)

  function factorFor(sampleRate) {
    return Math.max(1, Math.floor(sampleRate / COARSE_RATE));
  }

  // Antal samples der skal bruges for at kunne finde minFreq
  function plan(sampleRate, minFreq) {
    var factor = factorFor(sampleRate);
    var sr = sampleRate / factor;
    var tauMax = Math.ceil(sr / minFreq);
    var win = Math.max(Math.ceil(tauMax * 1.5), Math.round(sr * COARSE_WIN));
    return { factor: factor, sr: sr, tauMax: tauMax, win: win, samples: (tauMax + win + 2) * factor };
  }

  function coarse(x, n, sr, minFreq, maxFreq, threshold) {
    var tauMax = Math.min(Math.ceil(sr / minFreq), Math.floor(n / 2));
    var tauMin = Math.max(2, Math.floor(sr / maxFreq));
    if (tauMin >= tauMax) return null;
    var W = n - tauMax;
    var cmnd = scratch('cmnd', tauMax + 2);
    cmnd[0] = 1;
    var running = 0, i, tau;
    for (tau = 1; tau <= tauMax; tau++) {
      var s = 0;
      for (i = 0; i < W; i++) {
        var d = x[i] - x[i + tau];
        s += d * d;
      }
      running += s;
      cmnd[tau] = running > 0 ? (s * tau) / running : 1;
    }
    // Første dyk under tærsklen, fulgt ned til bunden
    var best = -1;
    for (tau = tauMin; tau <= tauMax; tau++) {
      if (cmnd[tau] < threshold) {
        while (tau + 1 <= tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;
        best = tau;
        break;
      }
    }
    if (best < 0) {
      best = tauMin;
      for (tau = tauMin + 1; tau <= tauMax; tau++) if (cmnd[tau] < cmnd[best]) best = tau;
      if (cmnd[best] > 0.35) return null;
    }
    var refined = best;
    if (best > 1 && best < tauMax) {
      var a = cmnd[best - 1], b = cmnd[best], c = cmnd[best + 1], den = a + c - 2 * b;
      if (den > 0) refined = best + (a - c) / (2 * den);
    }
    return { tau: refined, clarity: 1 - cmnd[best] };
  }

  // Finjustering: differensfunktionen i fuld opløsning omkring perioden T0
  function fine(input, sampleRate, T0, factor) {
    var len = input.length;
    var R = factor + 2;
    var lo = Math.max(2, Math.floor(T0) - R), hi = Math.ceil(T0) + R;
    var W = Math.min(Math.round(sampleRate * FINE_WIN), len - hi - 1);
    if (W < T0 * 1.5) return T0; // for lidt lyd: behold grovsvaret
    var start = len - W - hi - 1;
    var d = scratch('fine', hi - lo + 1);
    var tau, i, best = lo, bestVal = Infinity;
    for (tau = lo; tau <= hi; tau++) {
      var s = 0;
      for (i = 0; i < W; i++) {
        var v = input[start + i] - input[start + i + tau];
        s += v * v;
      }
      d[tau - lo] = s;
      if (s < bestVal) { bestVal = s; best = tau; }
    }
    if (best === lo || best === hi) return T0; // minimum ligger ikke inde i søgeområdet
    var a = d[best - 1 - lo], b = d[best - lo], c = d[best + 1 - lo], den = a + c - 2 * b;
    return den > 0 ? best + (a - c) / (2 * den) : best;
  }

  /**
   * @param {Float32Array} input  lyd; de seneste samples ligger sidst
   * @param {number} sampleRate
   * @param {number} minFreq  laveste frekvens der søges efter (Hz)
   * @param {number} maxFreq  højeste frekvens der søges efter (Hz)
   * @returns {{freq:number, clarity:number}|null}
   */
  function detectPitch(input, sampleRate, minFreq, maxFreq, threshold) {
    threshold = threshold || 0.15;
    var p = plan(sampleRate, minFreq);
    var take = Math.min(input.length, p.samples);
    var start = input.length - take;
    var n = Math.floor(take / p.factor);
    var x = scratch('x', n);
    var i, k, mean = 0;

    // Nedsampling med middelværdi (et simpelt lavpasfilter)
    for (i = 0; i < n; i++) {
      var s = 0, o = start + i * p.factor;
      for (k = 0; k < p.factor; k++) s += input[o + k];
      x[i] = s / p.factor;
      mean += x[i];
    }
    mean /= n;
    for (i = 0; i < n; i++) x[i] -= mean;

    var c = coarse(x, n, p.sr, minFreq, maxFreq, threshold);
    if (!c) return null;
    var period = fine(input, sampleRate, c.tau * p.factor, p.factor);
    var freq = sampleRate / period;
    if (freq < minFreq || freq > maxFreq) return null;
    return { freq: freq, clarity: c.clarity };
  }

  global.Pitch = { detectPitch: detectPitch, plan: plan };
})(window);
