import { definePanel } from '@directus/extensions-sdk';
import PanelComponent from './od-import.vue';

export default definePanel({
  id: 'od-import-panel',
  name: 'OpenDental Timesheet Import',
  icon: 'schedule',
  description: 'Import OpenDental clock events into Directus',
  component: PanelComponent,
  options: null,
  query: null
});
