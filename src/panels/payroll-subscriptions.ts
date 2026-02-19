import { definePanel } from '@directus/extensions-sdk';
import PanelComponent from './payroll-subscriptions.vue';

export default definePanel({
  id: 'payroll-subscriptions-panel',
  name: 'Payroll Subscriptions',
  icon: 'people',
  description: 'Manage employee payroll subscriptions and OpenDental sync',
  component: PanelComponent,
  options: null,
  query: null
});
