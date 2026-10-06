/* Tab: Risico — placeholder, wordt vervangen door de volledige implementatie. */
(function () {
  'use strict';
  const H = window.HC;
  H.tabs.register({
    id: 'risico', label: 'Risico', short: 'Risico', order: 50, icon: 'dice',
    render(root, ctx) {
      const { h, ui } = ctx;
      root.appendChild(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Risico'))));
      root.appendChild(ui.note('Dit tabblad wordt nog gebouwd.'));
    }
  });
})();
