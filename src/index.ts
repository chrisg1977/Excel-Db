import SyncPreviewEndpoint from './endpoints/sync-preview';
import PublishEndpoint from './endpoints/publish';
import SocialSecuritySyncPreviewEndpoint from './endpoints/social-security-sync-preview';
import SocialSecurityPublishEndpoint from './endpoints/social-security-publish';
import TaxAdminPanel from './panels/tax-admin';
import AdminDashboardEndpoint from './endpoints/admin-dashboard';
import TimesheetsEndpoint from './endpoints/timesheets';
import OdImportPanel from './panels/od-import';
import PayrollSubscriptionsEndpoint from './endpoints/payroll-subscriptions';
import PayrollSubscriptionsPanel from './panels/payroll-subscriptions';
import WageCalculatorEndpoint from './endpoints/wage-calculator';
import FormGeneratorEndpoint from './endpoints/forms-generator';
import EmailAccountsEndpoint from './endpoints/email-accounts';
import EmailAccountsPanel from './panels/email-accounts';

export default [
  SyncPreviewEndpoint,
  PublishEndpoint,
  SocialSecuritySyncPreviewEndpoint,
  SocialSecurityPublishEndpoint,
  AdminDashboardEndpoint,
  TimesheetsEndpoint,
  TaxAdminPanel,
  OdImportPanel,
  PayrollSubscriptionsEndpoint,
  PayrollSubscriptionsPanel,
  WageCalculatorEndpoint,
  FormGeneratorEndpoint,
  EmailAccountsEndpoint,
  EmailAccountsPanel
];
