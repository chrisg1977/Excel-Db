import { definePanel } from '@directus/extensions-sdk';
import PanelComponent from './tax-admin.vue';

export default definePanel({
  id: 'tax-admin-panel',
  name: 'Tax Administration',
  icon: 'account_balance',
  description: 'Manage tax synchronization and publishing',
  component: PanelComponent,
  options: null,
  query: null
});
