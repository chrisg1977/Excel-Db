import express from 'express';
import { config } from './config.js';
import { getMysqlPool, getPgPool } from './db.js';
import {
  handleCreateDiscrepancyEventRequest,
  handleCreateDiscrepancyEventReviewRequest,
  handleGetDiscrepancyEventRequest,
  handleListDiscrepancyEventsRequest
} from './eos-discrepancy-events.js';
import { handleProductionVisitsRequest } from './eos-production-visits.js';
import {
  handleGetAccountingPeriodSummaryRequest,
  handleListAccountingPeriodsRequest
} from './eos-periods.js';
import {
  handlePayrollDashboardDetailRequest,
  handlePayrollDashboardExportRequest,
  handlePayrollDashboardIssueRequest,
  handlePayrollFs3EmailRequest,
  handlePayrollDashboardOverviewRequest,
  handlePayrollDashboardStatusesRequest,
  handlePayrollDashboardTimesheetReviewRequest,
  handlePayrollDashboardTimesheetSaveRequest
} from './payroll-dashboard.js';
import {
  handleCreateReportHeaderRequest,
  handleGetReportSnapshotRequest,
  handleListReportsRequest
} from './eos-reports.js';
import {
  handleAbandonShiftSessionRequest,
  handleCreateShiftSessionRequest,
  handleSupersedeShiftSessionRequest,
  handleTakeoverShiftSessionRequest
} from './eos-shift-sessions.js';
import { runImport } from './importer.js';
import {
  handleDepartmentManagerResolutionPreviewRequest,
  handleDepartmentsRequest,
  handleEmployeesRequest,
  handleLeaveAvailabilityRequest,
  handleLocationsRequest
} from './master-data-read.js';

const app = express();
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
  } else {
    res.header('Access-Control-Allow-Origin', '*');
  }
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});
app.use(express.json({ limit: '1mb' }));

const logFatal = (label: string, error: unknown) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(`[od-importer] ${label}: ${message}`);
};

const describeError = (error: unknown) => {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  if (error instanceof Error) {
    const anyError = error as Error & {
      code?: string;
      errno?: number | string;
      syscall?: string;
      address?: string;
      port?: number | string;
      sqlMessage?: string;
      cause?: unknown;
    };
    const details = [
      anyError.message,
      anyError.sqlMessage,
      anyError.code ? `code=${anyError.code}` : '',
      anyError.errno ? `errno=${anyError.errno}` : '',
      anyError.syscall ? `syscall=${anyError.syscall}` : '',
      anyError.address ? `address=${anyError.address}` : '',
      anyError.port ? `port=${anyError.port}` : ''
    ].filter(Boolean);
    if (details.length) return details.join(' | ');
    if (anyError.cause) return describeError(anyError.cause);
    return anyError.name || 'Error';
  }
  if (typeof error === 'object') {
    const anyError = error as Record<string, unknown>;
    const details = [
      String(anyError.message || ''),
      String(anyError.sqlMessage || ''),
      anyError.code ? `code=${String(anyError.code)}` : '',
      anyError.errno ? `errno=${String(anyError.errno)}` : '',
      anyError.syscall ? `syscall=${String(anyError.syscall)}` : '',
      anyError.address ? `address=${String(anyError.address)}` : '',
      anyError.port ? `port=${String(anyError.port)}` : ''
    ].filter(Boolean);
    if (details.length) return details.join(' | ');
  }
  return String(error);
};

const extractErrorDetails = (error: unknown) => {
  if (!error || typeof error !== 'object') return {};
  const anyError = error as Record<string, unknown>;
  return {
    name: anyError.name ? String(anyError.name) : undefined,
    message: anyError.message ? String(anyError.message) : undefined,
    code: anyError.code ? String(anyError.code) : undefined,
    errno: anyError.errno ? String(anyError.errno) : undefined,
    syscall: anyError.syscall ? String(anyError.syscall) : undefined,
    address: anyError.address ? String(anyError.address) : undefined,
    port: anyError.port ? String(anyError.port) : undefined,
    sqlMessage: anyError.sqlMessage ? String(anyError.sqlMessage) : undefined,
    stack: anyError.stack ? String(anyError.stack) : undefined
  };
};

process.on('uncaughtException', (error) => {
  logFatal('uncaughtException', error);
});

process.on('unhandledRejection', (reason) => {
  logFatal('unhandledRejection', reason);
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'od-importer' });
});

app.post('/api/od/timesheets/import', async (req, res) => {
  try {
    const pg = getPgPool();
    const mysql = getMysqlPool();
    const result = await runImport(pg, mysql, req.body);
    const mappedUsers = Array.isArray(result.diagnostics?.mapped_od_users)
      ? result.diagnostics.mapped_od_users
      : [];
    const responsePayload = result.message
      ? result
      : {
          ...result,
          message:
            mappedUsers.length === 0
              ? 'No active OpenDental user mappings found for the selected employees.'
              : result.total_events === 0
                ? 'No OpenDental clock events found for the selected employees in the selected date range.'
                : undefined
        };
    res.json(responsePayload);
  } catch (error) {
    const message = describeError(error);
    const details = extractErrorDetails(error);
    logFatal('timesheet import', error);
    res.status(400).json({
      ok: false,
      error: message || details.message || details.code || 'Timesheet import failed',
      error_details: details
    });
  }
});

app.get('/api/eos/production-visits', async (req, res) => {
  const mysql = getMysqlPool();
  return handleProductionVisitsRequest(mysql, req, res);
});

app.get('/api/locations', async (req, res) => {
  // Shared master-data read endpoint for physical/reception location lookups.
  const pg = getPgPool();
  return handleLocationsRequest(pg, req, res);
});

app.get('/api/departments', async (req, res) => {
  // Shared master-data read endpoint for department lookup and EOS assignment screens.
  const pg = getPgPool();
  return handleDepartmentsRequest(pg, req, res);
});

app.get('/api/departments/:id/manager-resolution-preview', async (req, res) => {
  // Developer/admin preview endpoint for department discrepancy-routing resolution.
  const pg = getPgPool();
  return handleDepartmentManagerResolutionPreviewRequest(pg, req, res);
});

app.get('/api/employees', async (req, res) => {
  // Shared master-data read endpoint for manager assignment and employee/provider lookup.
  const pg = getPgPool();
  return handleEmployeesRequest(pg, req, res);
});

app.get('/api/leave/availability', async (req, res) => {
  // Shared leave-availability preview endpoint for routing and staffing checks.
  const pg = getPgPool();
  return handleLeaveAvailabilityRequest(pg, req, res);
});

app.get('/payroll-dashboard/payroll/dashboard/overview', async (req, res) => {
  const pg = getPgPool();
  return handlePayrollDashboardOverviewRequest(pg, req, res);
});

app.get('/payroll-dashboard/payroll/dashboard/detail', async (req, res) => {
  const pg = getPgPool();
  return handlePayrollDashboardDetailRequest(pg, req, res);
});

app.get('/payroll-dashboard/payroll/dashboard/timesheet-review', async (req, res) => {
  const pg = getPgPool();
  return handlePayrollDashboardTimesheetReviewRequest(pg, req, res);
});

app.post('/payroll-dashboard/payroll/dashboard/timesheet-review/save', async (req, res) => {
  const pg = getPgPool();
  return handlePayrollDashboardTimesheetSaveRequest(pg, req, res);
});

app.get('/payroll-dashboard/payroll/dashboard/statuses', async (req, res) => {
  const pg = getPgPool();
  return handlePayrollDashboardStatusesRequest(pg, req, res);
});

app.post('/payroll-dashboard/payroll/dashboard/actions/issue', async (req, res) => {
  const pg = getPgPool();
  return handlePayrollDashboardIssueRequest(pg, req, res);
});

app.get('/payroll-dashboard/payroll/dashboard/export.csv', async (req, res) => {
  const pg = getPgPool();
  return handlePayrollDashboardExportRequest(pg, req, res);
});

app.post('/payroll-dashboard/payroll/fs3/actions/send', async (req, res) => {
  const pg = getPgPool();
  return handlePayrollFs3EmailRequest(pg, req, res);
});

app.post('/api/eos/discrepancy-events', async (req, res) => {
  // First EOS discrepancy-event persistence endpoint. Queue creation and delivery
  // stay out of scope here until the shared notification flow is implemented.
  const pg = getPgPool();
  return handleCreateDiscrepancyEventRequest(pg, req, res);
});

app.get('/api/eos/discrepancy-events', async (req, res) => {
  // Management retrieval list for EOS discrepancy events.
  const pg = getPgPool();
  return handleListDiscrepancyEventsRequest(pg, req, res);
});

app.get('/api/eos/discrepancy-events/:id', async (req, res) => {
  // Management retrieval detail for one EOS discrepancy event.
  const pg = getPgPool();
  return handleGetDiscrepancyEventRequest(pg, req, res);
});

app.get('/api/eos/periods', async (req, res) => {
  // First accounting-period dashboard list endpoint for management/month-end retrieval.
  const pg = getPgPool();
  return handleListAccountingPeriodsRequest(pg, req, res);
});

app.get('/api/eos/periods/:id/summary', async (req, res) => {
  // First accounting-period summary endpoint using scoped aggregate KPIs only.
  const pg = getPgPool();
  return handleGetAccountingPeriodSummaryRequest(pg, req, res);
});

app.post('/api/eos/discrepancy-events/:id/review', async (req, res) => {
  // First manager-review write endpoint for EOS discrepancy events.
  const pg = getPgPool();
  return handleCreateDiscrepancyEventReviewRequest(pg, req, res);
});

app.post('/api/eos/reports', async (req, res) => {
  // First EOS report persistence slice: save only the report header and resolve
  // the accounting period from report_start_at. Rows/summary/audit follow later.
  const pg = getPgPool();
  return handleCreateReportHeaderRequest(pg, req, res);
});

app.get('/api/eos/reports', async (req, res) => {
  // First management retrieval list for saved EOS report headers.
  const pg = getPgPool();
  return handleListReportsRequest(pg, req, res);
});

app.get('/api/eos/reports/:id', async (req, res) => {
  // First management retrieval detail endpoint for one saved EOS report snapshot.
  const pg = getPgPool();
  return handleGetReportSnapshotRequest(pg, req, res);
});

app.post('/api/eos/shift-sessions', async (req, res) => {
  // First EOS persistence endpoint: create a new shift session or return the
  // documented location-based ownership/conflict contract for the active shift.
  const pg = getPgPool();
  return handleCreateShiftSessionRequest(pg, req, res);
});

app.post('/api/eos/shift-sessions/:id/takeover', async (req, res) => {
  // Explicit manager takeover route for an active location-owned EOS shift session.
  const pg = getPgPool();
  return handleTakeoverShiftSessionRequest(pg, req, res);
});

app.post('/api/eos/shift-sessions/:id/abandon', async (req, res) => {
  // Explicit manager-only route to abandon an unresolved prior EOS shift session.
  const pg = getPgPool();
  return handleAbandonShiftSessionRequest(pg, req, res);
});

app.post('/api/eos/shift-sessions/:id/supersede', async (req, res) => {
  // Explicit manager-only route to supersede an unresolved prior shift and start a new one.
  const pg = getPgPool();
  return handleSupersedeShiftSessionRequest(pg, req, res);
});

const server = app.listen(config.port, () => {
  console.log(`od-importer listening on port ${config.port}`);
});

server.on('error', (error) => {
  logFatal('server error', error);
});
