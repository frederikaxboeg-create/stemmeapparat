/* Installérbar app: registrerer service workeren og viser en "Installér"-knap,
 * når browseren tilbyder det (Chrome, Edge, Android). På iPhone installeres via
 * Del-menuen → "Føj til hjemmeskærm". */
(function () {
  'use strict';

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* kører fint uden */ });
    });
  }

  var btn = document.getElementById('install');
  var deferred = null;

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
    btn.hidden = false;
  });

  btn.addEventListener('click', function () {
    if (!deferred) return;
    deferred.prompt();
    deferred.userChoice.then(function () { deferred = null; btn.hidden = true; });
  });

  window.addEventListener('appinstalled', function () { btn.hidden = true; });
})();
