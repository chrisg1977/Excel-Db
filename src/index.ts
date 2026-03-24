import SyncPreviewEndpoint from './endpoints/sync-preview';
import PublishEndpoint from './endpoints/publish';
import SocialSecuritySyncPreviewEndpoint from './endpoints/social-security-sync-preview';
import SocialSecurityPublishEndpoint from './endpoints/social-security-publish';
import TaxAdminPanel from './panels/tax-admin';
import AdminDashboardEndpoint from './endpoints/admin-dashboard';
import TimesheetsEndpoint from './endpoints/timesheets';
import OdLaunchAuthEndpoint from './endpoints/od-launch-auth';
import OdImportPanel from './panels/od-import';
import PayrollSubscriptionsEndpoint from './endpoints/payroll-subscriptions';
import PayrollSubscriptionsPanel from './panels/payroll-subscriptions';
import WageCalculatorEndpoint from './endpoints/wage-calculator';
import FormGeneratorEndpoint from './endpoints/forms-generator';
import EcotaxSettingsEndpoint from './endpoints/ecotax-settings';
import EmployeeFormEndpoint from './endpoints/employee-form';
import HandoverEndpoint from './endpoints/handover';

export default [
  SyncPreviewEndpoint,
  PublishEndpoint,
  SocialSecuritySyncPreviewEndpoint,
  SocialSecurityPublishEndpoint,
  AdminDashboardEndpoint,
  TimesheetsEndpoint,
  OdLaunchAuthEndpoint,
  TaxAdminPanel,
  OdImportPanel,
  PayrollSubscriptionsEndpoint,
  PayrollSubscriptionsPanel,
  WageCalculatorEndpoint,
  FormGeneratorEndpoint,
  EcotaxSettingsEndpoint,
  EmployeeFormEndpoint,
  HandoverEndpoint
];
