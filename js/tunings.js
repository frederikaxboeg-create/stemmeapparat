/* Noder og stemninger for strengeinstrumenter.
 * Hver stemning er en liste af "kor" (courses) fra dybeste til lyseste streng.
 * Et kor er normalt én streng, men på 12-strenget guitar er det et par:
 * [grundstreng, oktav- eller unisonstreng]. */
(function (global) {
  'use strict';

  var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  var NOTE_INDEX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  function parseNote(spec) {
    var m = /^([A-G])([#b]?)(-?\d)$/.exec(spec);
    if (!m) throw new Error('Ugyldig node: ' + spec);
    var acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
    return (parseInt(m[3], 10) + 1) * 12 + NOTE_INDEX[m[1]] + acc;
  }

  function noteFreq(midi, a4) {
    return a4 * Math.pow(2, (midi - 69) / 12);
  }

  function pretty(name) {
    return name.replace('#', '♯').replace('b', '♭');
  }

  // "Eb2" -> { name: "E♭", octave: "2" }
  function prettyNote(spec) {
    var m = /^([A-G][#b]?)(-?\d)$/.exec(spec);
    return { name: pretty(m[1]), octave: m[2] };
  }

  var FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

  function midiToLabel(midi, preferFlats) {
    var names = preferFlats ? FLAT_NAMES : NOTE_NAMES;
    return { name: pretty(names[((midi % 12) + 12) % 12]), octave: String(Math.floor(midi / 12) - 1) };
  }

  // Flyt en node et antal halvtoner op (capo). Stemninger skrevet med ♭ beholder ♭.
  function transposeLabel(spec, semitones) {
    if (!semitones) return prettyNote(spec);
    return midiToLabel(parseNote(spec) + semitones, spec.indexOf('b') > 0);
  }

  function t(id, name, courses) {
    return {
      id: id,
      name: name,
      courses: courses.map(function (c) { return Array.isArray(c) ? c : [c]; })
    };
  }

  // 12-strenget: de fire dybe kor har en oktavstreng, de to lyse en unisonstreng.
  function twelve(notes) {
    return notes.map(function (n, i) {
      if (i >= 4) return [n, n];
      var m = /^([A-G][#b]?)(-?\d)$/.exec(n);
      return [n, m[1] + (parseInt(m[2], 10) + 1)];
    });
  }

  var INSTRUMENTS = [
    {
      id: 'guitar', name: 'Guitar', capo: true, tunings: [
        t('standard', 'Standard', ['E2', 'A2', 'D3', 'G3', 'B3', 'E4']),
        t('drop-d', 'Drop D', ['D2', 'A2', 'D3', 'G3', 'B3', 'E4']),
        t('half-down', 'Halv tone ned', ['Eb2', 'Ab2', 'Db3', 'Gb3', 'Bb3', 'Eb4']),
        t('whole-down', 'Hel tone ned', ['D2', 'G2', 'C3', 'F3', 'A3', 'D4']),
        t('drop-c', 'Drop C', ['C2', 'G2', 'C3', 'F3', 'A3', 'D4']),
        t('dadgad', 'DADGAD', ['D2', 'A2', 'D3', 'G3', 'A3', 'D4']),
        t('open-g', 'Open G', ['D2', 'G2', 'D3', 'G3', 'B3', 'D4']),
        t('open-d', 'Open D', ['D2', 'A2', 'D3', 'F#3', 'A3', 'D4']),
        t('open-e', 'Open E', ['E2', 'B2', 'E3', 'G#3', 'B3', 'E4'])
      ]
    },
    {
      id: 'guitar12', name: '12-strenget', capo: true, tunings: [
        t('standard', 'Standard', twelve(['E2', 'A2', 'D3', 'G3', 'B3', 'E4'])),
        t('half-down', 'Halv tone ned', twelve(['Eb2', 'Ab2', 'Db3', 'Gb3', 'Bb3', 'Eb4'])),
        t('drop-d', 'Drop D', twelve(['D2', 'A2', 'D3', 'G3', 'B3', 'E4'])),
        t('whole-down', 'Hel tone ned', twelve(['D2', 'G2', 'C3', 'F3', 'A3', 'D4']))
      ]
    },
    {
      id: 'bass', name: 'Bas', tunings: [
        t('standard4', '4-strenget standard', ['E1', 'A1', 'D2', 'G2']),
        t('drop-d4', '4-strenget Drop D', ['D1', 'A1', 'D2', 'G2']),
        t('half-down4', '4-strenget halv tone ned', ['Eb1', 'Ab1', 'Db2', 'Gb2']),
        t('standard5', '5-strenget standard', ['B0', 'E1', 'A1', 'D2', 'G2']),
        t('high-c5', '5-strenget høj C', ['E1', 'A1', 'D2', 'G2', 'C3']),
        t('standard6', '6-strenget standard', ['B0', 'E1', 'A1', 'D2', 'G2', 'C3'])
      ]
    },
    {
      id: 'ukulele', name: 'Ukulele', capo: true, tunings: [
        t('standard', 'Standard (høj G)', ['G4', 'C4', 'E4', 'A4']),
        t('low-g', 'Lav G', ['G3', 'C4', 'E4', 'A4']),
        t('d-tuning', 'D-stemning', ['A4', 'D4', 'F#4', 'B4']),
        t('baritone', 'Baryton', ['D3', 'G3', 'B3', 'E4'])
      ]
    },
    {
      id: 'violin', name: 'Violin', tunings: [
        t('standard', 'Standard', ['G3', 'D4', 'A4', 'E5'])
      ]
    },
    {
      id: 'viola', name: 'Bratsch', tunings: [
        t('standard', 'Standard', ['C3', 'G3', 'D4', 'A4'])
      ]
    },
    {
      id: 'cello', name: 'Cello', tunings: [
        t('standard', 'Standard', ['C2', 'G2', 'D3', 'A3'])
      ]
    },
    {
      id: 'contrabass', name: 'Kontrabas', tunings: [
        t('orchestra', 'Orkesterstemning', ['E1', 'A1', 'D2', 'G2']),
        t('solo', 'Solostemning', ['F#1', 'B1', 'E2', 'A2']),
        t('five', '5-strenget (lav B)', ['B0', 'E1', 'A1', 'D2', 'G2'])
      ]
    }
  ];

  global.TunerData = {
    NOTE_NAMES: NOTE_NAMES,
    INSTRUMENTS: INSTRUMENTS,
    parseNote: parseNote,
    noteFreq: noteFreq,
    prettyNote: prettyNote,
    midiToLabel: midiToLabel,
    transposeLabel: transposeLabel,
    MAX_CAPO: 12
  };
})(window);
