import { definePanel } from '@directus/extensions-sdk';
import PanelComponent from './email-accounts.vue';

export default definePanel({
  id: 'email-accounts-panel',
  name: 'Email Accounts',
  icon: 'alternate_email',
  description: 'Connect and monitor mailboxes used for automated email reading (admin only)',
  component: PanelComponent,
  options: null,
  query: null
});
