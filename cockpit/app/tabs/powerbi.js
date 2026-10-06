/* Tab: Power BI — placeholder, wordt vervangen door de volledige implementatie. */
(function () {
  'use strict';
  const H = window.HC;
  H.tabs.register({
    id: 'powerbi', label: 'Power BI', short: 'Power BI', order: 80, icon: 'pbi',
    render(root, ctx) {
      const { h, ui } = ctx;
      root.appendChild(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Power BI'))));
      root.appendChild(ui.note('Dit tabblad wordt nog gebouwd.'));
    }
  });
})();
