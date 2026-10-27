/* Saturday Gridiron - main.js
   Loaded last: settings, renderer, screens, then the title screen. */
(function () {
  'use strict';
  var SG = window.SG;
  if (!document.querySelector('meta[name="viewport"]')) {
    var vm = document.createElement('meta');
    vm.name = 'viewport';
    vm.content = 'width=device-width,initial-scale=1,viewport-fit=cover';
    (document.head || document.documentElement).appendChild(vm);
  }
  SG.L.loadSettings();
  SG.L.load();
  SG.F.init(document.getElementById('cv'));
  SG.UI.init();
  SG.UI.show('title');
})();
