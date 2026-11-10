/* Akkordbibliotek.
 * Grebene beregnes ud fra instrumentets stemning, så de også passer til
 * alternative stemninger (DADGAD, Open G …) og ukulele. Capo håndteres ved at
 * finde det greb, der – spillet over capoen – lyder som den valgte akkord. */
(function () {
  'use strict';

  var A = window.AudioShared;
  var D = window.TunerData;
  var STORE_KEY = 'stemmeapparat.chords.v1';

  var ROOTS = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  var QUALITIES = [
    { id: 'maj', label: 'Dur', suffix: '', iv: [0, 4, 7], req: [0, 4] },
    { id: 'min', label: 'Mol', suffix: 'm', iv: [0, 3, 7], req: [0, 3] },
    { id: '7', label: '7', suffix: '7', iv: [0, 4, 7, 10], req: [0, 4, 10] },
    { id: 'maj7', label: 'maj7', suffix: 'maj7', iv: [0, 4, 7, 11], req: [0, 4, 11] },
    { id: 'm7', label: 'm7', suffix: 'm7', iv: [0, 3, 7, 10], req: [0, 3, 10] },
    { id: 'sus2', label: 'sus2', suffix: 'sus2', iv: [0, 2, 7], req: [0, 2] },
    { id: 'sus4', label: 'sus4', suffix: 'sus4', iv: [0, 5, 7], req: [0, 5] },
    { id: 'add9', label: 'add9', suffix: 'add9', iv: [0, 2, 4, 7], req: [0, 2, 4] },
    { id: '6', label: '6', suffix: '6', iv: [0, 4, 7, 9], req: [0, 4, 9] },
    { id: '9', label: '9', suffix: '9', iv: [0, 2, 4, 7, 10], req: [0, 2, 4, 10] },
    { id: 'dim', label: 'dim', suffix: 'dim', iv: [0, 3, 6], req: [0, 3, 6] },
    { id: 'm7b5', label: 'm7♭5', suffix: 'm7♭5', iv: [0, 3, 6, 10], req: [0, 3, 6, 10] },
    { id: 'dim7', label: 'dim7', suffix: 'dim7', iv: [0, 3, 6, 9], req: [0, 3, 6, 9] },
    { id: 'aug', label: 'aug', suffix: '+', iv: [0, 4, 8], req: [0, 4, 8] },
    { id: '5', label: '5 (power)', suffix: '5', iv: [0, 7], req: [0, 7], power: true }
  ];
  var INSTRUMENT_IDS = ['guitar', 'ukulele'];

  // De greb, man lærer først. De får forrang i standardstemning, så biblioteket
  // viser de velkendte former før andre (lige så korrekte) muligheder.
  var KNOWN = {
    '40,45,50,55,59,64': [
      'x32010', 'xx0232', '022100', '320003', 'x02220', '133211', 'x24442', 'x13331', '244322', 'x46664',
      'x02210', 'xx0231', '022000', 'x24432', '133111', 'x35543', '355333', '244222', 'x46654',
      'x02020', 'x21202', 'x32310', 'xx0212', '020100', '320001', '131211',
      'x32000', 'xx0222', 'xx3210', '320002', 'x02120', '021100',
      'x02010', 'xx0211', '020000', 'x20202', '131111',
      'xx0233', 'xx0230', 'x02230', 'x02200', '022200', 'x33011'
    ],
    '67,60,64,69': [
      '0003', '0232', '2010', '2000', '2220', '0432', '2210', '2100', '3211', '1402', '4442',
      '0212', '0001', '0100', '1202', '2223', '0211', '0000', '1110', '0002', '3331', '5433'
    ]
  };

  function degreeName(iv, q) {
    var map = { 0: '1', 1: '♭9', 2: q.id === 'sus2' ? '2' : '9', 3: '♭3', 4: '3', 5: '4', 6: '♭5',
      7: '5', 8: '♯5', 9: q.id === 'dim7' ? '♭♭7' : '6', 10: '♭7', 11: '7' };
    return map[iv];
  }

  // ---------- Greb-generator ----------

  /**
   * @param {number[]} open  løse strenges MIDI-toner, dybeste streng først
   * @param {number} rootPc  grundtone (0 = C)
   * @param {object} q       akkordtype
   * @param {number} maxFret højeste bånd der må bruges
   * @returns {{frets:number[], barre:object|null, minF:number, maxF:number, score:number}[]}
   */
  function voicings(open, rootPc, q, maxFret) {
    var n = open.length;
    var guitarLike = n >= 5;
    var pcs = q.iv.map(function (i) { return (rootPc + i) % 12; });
    function isTone(m) { return pcs.indexOf(m % 12) >= 0; }
    var minSounding = q.power ? 2 : guitarLike ? 4 : Math.min(3, n);
    var known = KNOWN[open.join(',')];
    var seen = {};
    var list = [];

    function evaluate(fr) {
      var key = fr.join(',');
      if (seen[key]) return;
      seen[key] = true;

      var first = -1, last = -1, count = 0, i;
      for (i = 0; i < n; i++) if (fr[i] >= 0) { if (first < 0) first = i; last = i; count++; }
      if (count < minSounding) return;
      // Dæmpede strenge kun i kanterne – en dæmpet streng i midten er svær at ramme
      for (i = first; i <= last; i++) if (fr[i] < 0) return;

      var present = {}, lowest = Infinity;
      for (i = 0; i < n; i++) {
        if (fr[i] < 0) continue;
        var m = open[i] + fr[i];
        present[((m - rootPc) % 12 + 12) % 12] = true;
        lowest = Math.min(lowest, m);
      }
      for (i = 0; i < q.req.length; i++) if (!present[q.req[i]]) return;
      // Guitar: grundtonen i bassen. Ukulele (ofte med høj G) har sjældent det.
      if (guitarLike && ((lowest - rootPc) % 12 + 12) % 12 !== 0) return;

      var fretted = fr.filter(function (f) { return f > 0; });
      var minF = fretted.length ? Math.min.apply(null, fretted) : 0;
      var maxF = fretted.length ? Math.max.apply(null, fretted) : 0;
      if (maxF - minF > 3) return;

      var fingers = fretted.length, barre = null;
      if (fingers > 4) {
        // Barré: pegefingeren ligger over alle strenge fra første forekomst af laveste bånd
        var from = fr.indexOf(minF), ok = true;
        for (i = from; i <= last; i++) if (fr[i] < minF) { ok = false; break; }
        if (!ok) return;
        fingers = 1 + fretted.filter(function (f) { return f > minF; }).length;
        if (fingers > 4) return;
        barre = { fret: minF, from: from, to: last };
      }

      var mutes = n - count;
      var opens = fr.filter(function (f) { return f === 0; }).length;
      var span = maxF - minF;
      var s = minF * 0.9 + span * span * 0.35 + fingers * 0.35 + (barre ? 1 : 0);
      s += q.power ? Math.max(0, count - 3) * 1.2 : mutes * (guitarLike ? 1.5 : 5);
      // Løse strenge hjælper i de lave greb, men blandet med høje bånd er de usædvanlige
      s += opens * (maxF <= 3 ? -0.3 : 0.4);
      q.iv.forEach(function (iv) { if (!present[iv]) s += 0.7; });
      var shape = fr.map(function (f) { return f < 0 ? 'x' : f; }).join('');
      if (known && known.indexOf(shape) >= 0) s -= 4;
      list.push({ frets: fr, barre: barre, minF: minF, maxF: maxF, score: s });
    }

    for (var lo = 1; lo + 3 <= Math.max(4, maxFret); lo++) {
      var opts = open.map(function (m) {
        var o = [-1];
        if (isTone(m)) o.push(0);
        for (var f = lo; f <= Math.min(lo + 3, maxFret); f++) if (isTone(m + f)) o.push(f);
        return o;
      });
      var cur = new Array(n);
      (function rec(i) {
        if (i === n) { evaluate(cur.slice()); return; }
        for (var k = 0; k < opts[i].length; k++) { cur[i] = opts[i][k]; rec(i + 1); }
      })(0);
    }
    list.sort(function (a, b) { return a.score - b.score; });
    return list.slice(0, 8);
  }

  // ---------- Tilstand ----------

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    instruments: $('chord-instruments'),
    tuning: $('chord-tuning'),
    name: $('chord-name'),
    tones: $('chord-tones'),
    play: $('chord-play'),
    svg: $('chord-diagram'),
    prev: $('var-prev'),
    next: $('var-next'),
    varLabel: $('var-label'),
    capoNote: $('chord-capo-note'),
    roots: $('chord-roots'),
    qualities: $('chord-qualities'),
    capo: $('chord-capo'),
    capoDown: $('chord-capo-down'),
    capoUp: $('chord-capo-up')
  };

  var state = { instrumentId: 'guitar', tuningId: 'standard', root: 0, quality: 'maj', capo: 0 };
  var variant = 0;
  var current = [];

  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (!s) return;
      if (INSTRUMENT_IDS.indexOf(s.instrumentId) >= 0) state.instrumentId = s.instrumentId;
      if (typeof s.tuningId === 'string') state.tuningId = s.tuningId;
      if (s.root >= 0 && s.root < 12) state.root = s.root;
      if (QUALITIES.some(function (q) { return q.id === s.quality; })) state.quality = s.quality;
      if (s.capo >= 0 && s.capo <= 9) state.capo = s.capo;
    } catch (e) { /* standard */ }
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignorer */ }
  }

  function instrument() {
    return D.INSTRUMENTS.find(function (i) { return i.id === state.instrumentId; });
  }
  function tuning() {
    var ins = instrument();
    return ins.tunings.find(function (t) { return t.id === state.tuningId; }) || ins.tunings[0];
  }
  function quality() {
    return QUALITIES.find(function (q) { return q.id === state.quality; });
  }
  function openMidis() {
    return tuning().courses.map(function (c) { return D.parseNote(c[0]); });
  }
  function shapeRoot() { return ((state.root - state.capo) % 12 + 12) % 12; }

  // ---------- Diagram ----------

  function drawDiagram(v) {
    var open = openMidis(), n = open.length, q = quality();
    var W = 240, left = 44, right = 200, top = 44, fretH = 38, rows = 5;
    var gap = (right - left) / (n - 1);
    var base = v.maxF <= 5 ? 1 : v.minF;
    var x = function (i) { return left + i * gap; };
    var y = function (f) { return top + (f - base + 0.5) * fretH; };
    var svg = '';

    for (var r = 0; r <= rows; r++) {
      svg += '<line class="cd-fret" x1="' + left + '" x2="' + right + '" y1="' + (top + r * fretH) + '" y2="' + (top + r * fretH) + '"/>';
    }
    for (var s = 0; s < n; s++) {
      svg += '<line class="cd-string" x1="' + x(s) + '" x2="' + x(s) + '" y1="' + top + '" y2="' + (top + rows * fretH) + '"/>';
    }
    if (base === 1) {
      svg += state.capo
        ? '<rect class="cd-capo" x="' + (left - 10) + '" y="' + (top - 7) + '" width="' + (right - left + 20) + '" height="10" rx="5"/>' +
          '<text class="cd-base" x="' + (left - 14) + '" y="' + (top + 3) + '" text-anchor="end">C' + state.capo + '</text>'
        : '<rect class="cd-nut" x="' + (left - 1) + '" y="' + (top - 5) + '" width="' + (right - left + 2) + '" height="6" rx="2"/>';
    } else {
      svg += '<text class="cd-base" x="' + (left - 12) + '" y="' + (top + fretH * 0.5 + 5) + '" text-anchor="end">' + base + '</text>';
    }

    if (v.barre) {
      svg += '<rect class="cd-barre" x="' + (x(v.barre.from) - 11) + '" y="' + (y(v.barre.fret) - 11) +
        '" width="' + (x(v.barre.to) - x(v.barre.from) + 22) + '" height="22" rx="11"/>';
    }

    for (s = 0; s < n; s++) {
      var f = v.frets[s];
      if (f < 0) {
        svg += '<text class="cd-mute" x="' + x(s) + '" y="' + (top - 14) + '" text-anchor="middle">×</text>';
        continue;
      }
      var iv = ((open[s] + f - shapeRoot()) % 12 + 12) % 12;
      var root = iv === 0;
      if (f === 0) {
        svg += '<circle class="cd-open' + (root ? ' root' : '') + '" cx="' + x(s) + '" cy="' + (top - 19) + '" r="6"/>';
      } else {
        svg += '<circle class="cd-dot' + (root ? ' root' : '') + '" cx="' + x(s) + '" cy="' + y(f) + '" r="11"/>' +
          '<text class="cd-deg" x="' + x(s) + '" y="' + (y(f) + 4) + '" text-anchor="middle">' + degreeName(iv, q) + '</text>';
      }
      // Den klingende tone under hver streng
      var name = ROOTS[(open[s] + f + state.capo) % 12];
      svg += '<text class="cd-note" x="' + x(s) + '" y="' + (top + rows * fretH + 20) + '" text-anchor="middle">' + name + '</text>';
    }
    el.svg.innerHTML = svg;
    el.svg.setAttribute('aria-label', 'Greb: ' + v.frets.map(function (f) { return f < 0 ? 'x' : f; }).join(' ') +
      (state.capo ? ', med capo på ' + state.capo + '. bånd' : ''));
  }

  // ---------- Rendering ----------

  function chordName(root) { return ROOTS[root] + quality().suffix; }

  function update() {
    var q = quality();
    current = voicings(openMidis(), shapeRoot(), q, 12 - state.capo);
    if (variant >= current.length) variant = 0;

    el.name.textContent = chordName(state.root);
    el.tones.textContent = 'Toner: ' + q.iv.map(function (i) { return ROOTS[(state.root + i) % 12]; }).join(' – ') +
      '   (' + q.iv.map(function (i) { return degreeName(i, q); }).join(' ') + ')';

    if (!current.length) {
      el.svg.innerHTML = '<text class="cd-empty" x="120" y="130" text-anchor="middle">Intet spilbart greb fundet</text>';
      el.varLabel.textContent = '';
    } else {
      drawDiagram(current[variant]);
      el.varLabel.textContent = 'Greb ' + (variant + 1) + ' af ' + current.length +
        (current[variant].minF > 4 ? ' · ' + current[variant].minF + '. bånd' : '');
    }
    el.prev.disabled = el.next.disabled = current.length < 2;
    el.play.disabled = !current.length;

    el.capoNote.hidden = !state.capo;
    if (state.capo) {
      el.capoNote.textContent = 'Med capo på ' + state.capo + '. bånd tager du grebet for ' +
        ROOTS[shapeRoot()] + q.suffix + ' – det lyder som ' + chordName(state.root) + '.';
    }
    el.capo.textContent = state.capo ? state.capo + '. bånd' : 'Ingen';
    el.capoDown.disabled = state.capo <= 0;
    el.capoUp.disabled = state.capo >= 9;

    el.roots.querySelectorAll('button').forEach(function (b) {
      b.setAttribute('aria-checked', String(Number(b.dataset.root) === state.root));
    });
    el.qualities.querySelectorAll('button').forEach(function (b) {
      b.setAttribute('aria-checked', String(b.dataset.q === state.quality));
    });
    el.instruments.querySelectorAll('button').forEach(function (b) {
      b.setAttribute('aria-checked', String(b.dataset.ins === state.instrumentId));
    });
  }

  function renderTunings() {
    el.tuning.innerHTML = instrument().tunings.map(function (t) {
      var notes = t.courses.map(function (c) { return D.prettyNote(c[0]).name; }).join(' ');
      return '<option value="' + t.id + '"' + (t.id === tuning().id ? ' selected' : '') + '>' + t.name + ' (' + notes + ')</option>';
    }).join('');
  }

  function build() {
    el.instruments.innerHTML = INSTRUMENT_IDS.map(function (id) {
      var ins = D.INSTRUMENTS.find(function (i) { return i.id === id; });
      return '<button type="button" role="radio" data-ins="' + id + '">' + ins.name + '</button>';
    }).join('');
    el.roots.innerHTML = ROOTS.map(function (r, i) {
      return '<button type="button" role="radio" class="note-btn" data-root="' + i + '">' + r + '</button>';
    }).join('');
    el.qualities.innerHTML = QUALITIES.map(function (q) {
      return '<button type="button" role="radio" class="chip" data-q="' + q.id + '">' + q.label + '</button>';
    }).join('');

    el.instruments.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        state.instrumentId = b.dataset.ins;
        state.tuningId = instrument().tunings[0].id;
        variant = 0; save(); renderTunings(); update();
      });
    });
    el.roots.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () { state.root = Number(b.dataset.root); variant = 0; save(); update(); });
    });
    el.qualities.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () { state.quality = b.dataset.q; variant = 0; save(); update(); });
    });
  }

  function strum() {
    var v = current[variant];
    if (!v) return;
    var open = openMidis();
    var t = A.getContext().currentTime + 0.03;
    var k = 0;
    v.frets.forEach(function (f, s) {
      if (f < 0) return;
      A.pluck(A.midiFreq(open[s] + f + state.capo), t + k * 0.035, 0.28);
      k++;
    });
  }

  el.tuning.addEventListener('change', function () { state.tuningId = el.tuning.value; variant = 0; save(); update(); });
  el.play.addEventListener('click', strum);
  el.prev.addEventListener('click', function () { variant = (variant - 1 + current.length) % current.length; update(); });
  el.next.addEventListener('click', function () { variant = (variant + 1) % current.length; update(); });
  el.capoDown.addEventListener('click', function () { state.capo = Math.max(0, state.capo - 1); variant = 0; save(); update(); });
  el.capoUp.addEventListener('click', function () { state.capo = Math.min(9, state.capo + 1); variant = 0; save(); update(); });

  load();
  build();
  renderTunings();
  update();

  window.Chords = { voicings: voicings, QUALITIES: QUALITIES };
})();
