/* Tonehøjde-detektion med YIN-algoritmen (de Cheveigné & Kawahara, 2002).
 * Finder grundfrekvensen i et lydudsnit, også når overtonerne er stærkere
 * end grundtonen, som det ofte er på guitar og bas. */
(function (global) {
  'use strict';

  var buffers = {};
  function scratch(name, size) {
    var b = buffers[name];
    if (!b || b.length < size) b = buffers[name] = new Float32Array(size);
    return b;
  }

  // Hvor mange samples der skal analyseres for at kunne finde minFreq.
  // Dybe toner (bas, kontrabas) halveres i samplerate for at spare regnekraft.
  function plan(sampleRate, minFreq) {
    var factor = minFreq < 60 && sampleRate >= 32000 ? 2 : 1;
    var sr = sampleRate / factor;
    var tauMax = Math.ceil(sr / minFreq);
    var win = Math.max(Math.ceil(tauMax * 1.2), Math.round(sr * 0.03));
    return { factor: factor, sr: sr, tauMax: tauMax, win: win, samples: (tauMax + win + 2) * factor };
  }

  /**
   * @param {Float32Array} input  lyd; de seneste samples ligger sidst
   * @param {number} sampleRate
   * @param {number} minFreq  laveste frekvens der søges efter (Hz)
   * @param {number} maxFreq  højeste frekvens der søges efter (Hz)
   * @returns {{freq:number, clarity:number}|null}
   */
  function detectPitch(input, sampleRate, minFreq, maxFreq, threshold) {
    threshold = threshold || 0.12;
    var p = plan(sampleRate, minFreq);
    var take = Math.min(input.length, p.samples);
    var start = input.length - take;
    var n = Math.floor(take / p.factor);
    var x = scratch('x', n);
    var i, mean = 0;

    if (p.factor === 1) {
      for (i = 0; i < n; i++) x[i] = input[start + i];
    } else {
      for (i = 0; i < n; i++) x[i] = 0.5 * (input[start + 2 * i] + input[start + 2 * i + 1]);
    }
    for (i = 0; i < n; i++) mean += x[i];
    mean /= n;
    for (i = 0; i < n; i++) x[i] -= mean;

    var tauMax = Math.min(p.tauMax, Math.floor(n / 2));
    var tauMin = Math.max(2, Math.floor(p.sr / maxFreq));
    if (tauMin >= tauMax) return null;
    var W = n - tauMax;

    // 1. Differensfunktion og 2. kumulativ middelnormalisering (CMNDF)
    var cmnd = scratch('cmnd', tauMax + 1);
    cmnd[0] = 1;
    var running = 0;
    for (var tau = 1; tau <= tauMax; tau++) {
      var s = 0;
      for (i = 0; i < W; i++) {
        var diff = x[i] - x[i + tau];
        s += diff * diff;
      }
      running += s;
      cmnd[tau] = running > 0 ? (s * tau) / running : 1;
    }

    // 3. Første dyk under tærsklen, fulgt ned til bunden
    var best = -1;
    for (tau = tauMin; tau <= tauMax; tau++) {
      if (cmnd[tau] < threshold) {
        while (tau + 1 <= tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;
        best = tau;
        break;
      }
    }
    // Ingen tydelig periode: brug globalt minimum, hvis det er rimeligt klart
    if (best < 0) {
      best = tauMin;
      for (tau = tauMin + 1; tau <= tauMax; tau++) if (cmnd[tau] < cmnd[best]) best = tau;
      if (cmnd[best] > 0.3) return null;
    }

    // 4. Parabolsk interpolation for præcision under ét sample
    var refined = best;
    if (best > 1 && best < tauMax) {
      var s0 = cmnd[best - 1], s1 = cmnd[best], s2 = cmnd[best + 1];
      var denom = s0 + s2 - 2 * s1;
      if (denom !== 0) refined = best + (s0 - s2) / (2 * denom);
    }

    return { freq: p.sr / refined, clarity: 1 - cmnd[best] };
  }

  global.Pitch = { detectPitch: detectPitch, plan: plan };
})(window);
