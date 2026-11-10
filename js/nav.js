/* Fanebjælken nederst: skifter mellem værktøjerne. */
(function () {
  'use strict';

  var STORE_KEY = 'stemmeapparat.view';
  // onHide: hvad der skal slukkes, når man forlader fanen (mikrofonen især).
  // Metronom og drone må gerne spille videre i baggrunden.
  var VIEWS = {
    tuner: { title: 'Stemmeapparat', hash: 'stem', onHide: function () { if (window.Tuner) window.Tuner.stop(); } },
    metronome: { title: 'Metronom', hash: 'metronom' },
    chords: { title: 'Akkorder', hash: 'akkorder' },
    ear: { title: 'Gehørtræning', hash: 'gehoer', onHide: function () { if (window.Ear) window.Ear.stop(); } },
    practice: { title: 'Øvelog', hash: 'oevelog' }
  };
  Object.keys(VIEWS).forEach(function (k) { VIEWS[k].el = document.getElementById('view-' + k); });

  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tabbar [role="tab"]'));
  var title = document.getElementById('view-title');
  var a4 = document.getElementById('a4-control');
  var current = null;

  function show(name, fromHash) {
    if (!VIEWS[name] || name === current) return;
    if (current && VIEWS[current].onHide) VIEWS[current].onHide();
    current = name;
    Object.keys(VIEWS).forEach(function (k) { VIEWS[k].el.hidden = k !== name; });
    tabs.forEach(function (t) {
      var on = t.dataset.view === name;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    title.textContent = VIEWS[name].title;
    a4.hidden = name !== 'tuner';
    document.title = VIEWS[name].title;
    if (!fromHash) history.replaceState(null, '', '#' + VIEWS[name].hash);
    window.scrollTo(0, 0);
    document.dispatchEvent(new CustomEvent('viewchange', { detail: name }));
    try { localStorage.setItem(STORE_KEY, name); } catch (e) { /* ignorer */ }
  }

  function fromHash() {
    var h = location.hash.replace('#', '');
    return Object.keys(VIEWS).find(function (k) { return VIEWS[k].hash === h; });
  }

  tabs.forEach(function (t, i) {
    t.addEventListener('click', function () { show(t.dataset.view); });
    t.addEventListener('keydown', function (e) {
      var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      var next = tabs[(i + d + tabs.length) % tabs.length];
      next.focus();
      show(next.dataset.view);
    });
  });
  window.addEventListener('hashchange', function () { var v = fromHash(); if (v) show(v, true); });

  var initial = fromHash();
  if (!initial) {
    try { initial = localStorage.getItem(STORE_KEY); } catch (e) { /* ignorer */ }
  }
  show(VIEWS[initial] ? initial : 'tuner', !!fromHash());

  window.Nav = { show: show, current: function () { return current; } };
})();
