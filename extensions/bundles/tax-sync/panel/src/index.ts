import { definePanel } from '@directus/extensions-sdk';
import { h } from 'vue';

const PanelComponent = {
  name: 'TaxSyncPanelScaffold',
  setup() {
    return () =>
      h('div', { style: 'padding:12px;' }, [
        h('h3', { style: 'margin:0 0 6px;' }, 'Tax Sync Panel'),
        h('p', { style: 'margin:0;' }, 'Scaffold panel is ready.')
      ]);
  }
};

export default definePanel({
  id: 'tax-sync-panel-scaffold',
  name: 'Tax Sync Panel',
  icon: 'sync',
  description: 'Scaffold panel for tax sync bundle',
  component: PanelComponent,
  options: null,
  query: null
});
