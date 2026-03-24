import type { Request, Response } from 'express';
import type { Pool as PgPool } from 'pg';

type LocationRow = {
  id: string;
  code: string;
  name: string;
  phone_number: string;
  address_line_1: string | null;
  address_line_2: string | null;
  has_active_reception: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type DepartmentRow = {
  id: string;
  code: string;
  name: string;
  business_unit_id: string;
  location_id: string;
  default_reception_location_id: string;
  manager_responsible_employee_id: string | null;
  department_type: string;
  phone_number: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type EmployeeRow = {
  id: string;
  employee_code: string | null;
  first_name: string;
  last_name: string;
  display_name: string;
  phone_number: string | null;
  email: string | null;
  role: string;
  role_level: number;
  reports_to_employee_id: string | null;
  is_manager: boolean;
  is_active: boolean;
  is_provider: boolean;
  provider_ref: string | null;
  created_at: string;
  updated_at: string;
};

type LocationFilters = {
  has_active_reception?: boolean;
  is_active?: boolean;
};

type DepartmentFilters = {
  location_id?: string;
  default_reception_location_id?: string;
  is_active?: boolean;
};

type EmployeeFilters = {
  is_active?: boolean;
  is_manager?: boolean;
  is_provider?: boolean;
};

type LeaveRequestRow = {
  id: string;
  employee_id: string;
  leave_type: string;
  start_at: string;
  end_at: string;
  status: string;
  approved_by_employee_id: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

type ManagerResolutionRecipient = {
  id: string;
  employee_code: string | null;
  display_name: string;
  role: string;
  role_level: number;
  email: string | null;
  phone_number: string | null;
  is_manager: boolean;
  is_active: boolean;
};

type ManagerResolutionPreview = {
  department_id: string;
  at_datetime: string;
  responsible_manager: ManagerResolutionRecipient | null;
  primary_recipient: ManagerResolutionRecipient | null;
  fallback_recipient: ManagerResolutionRecipient | null;
  admin_summary_required: boolean;
  resolution_path: string;
};

type LeaveAvailabilityResponse = {
  employee_id: string;
  at_datetime: string;
  is_on_leave: boolean;
  matching_leave: LeaveRequestRow | null;
};

class ApiRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const getSingleQueryValue = (value: unknown, key: string): string | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  if (Array.isArray(value)) {
    throw new ApiRequestError(400, `Query parameter ${key} must be provided once`);
  }
  if (typeof value !== 'string') {
    throw new ApiRequestError(400, `Query parameter ${key} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const parseOptionalBoolean = (value: string | undefined, key: string): boolean | undefined => {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  throw new ApiRequestError(400, `Query parameter ${key} must be true, false, 1, or 0`);
};

const parseOptionalUuid = (value: string | undefined, key: string): string | undefined => {
  if (value === undefined) return undefined;
  if (!UUID_PATTERN.test(value)) {
    throw new ApiRequestError(400, `Query parameter ${key} must be a valid UUID`);
  }
  return value;
};

const parseRequiredUuidPathValue = (value: unknown, key: string): string => {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new ApiRequestError(400, `Path parameter ${key} must be a valid UUID`);
  }
  return value;
};

const parseRequiredUuidQueryValue = (value: string | undefined, key: string): string => {
  const parsed = parseOptionalUuid(value, key);
  if (!parsed) {
    throw new ApiRequestError(400, `Query parameter ${key} is required`);
  }
  return parsed;
};

const parsePreviewDateTime = (value: string | undefined): string => {
  if (value === undefined) {
    return new Date().toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiRequestError(400, 'Query parameter at_datetime must be a valid datetime');
  }
  return parsed.toISOString();
};

const parseOptionalStatusValue = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized || undefined;
};

const parseLocationFilters = (req: Request): LocationFilters => ({
  has_active_reception: parseOptionalBoolean(
    getSingleQueryValue(req.query.has_active_reception, 'has_active_reception'),
    'has_active_reception'
  ),
  is_active: parseOptionalBoolean(
    getSingleQueryValue(req.query.is_active, 'is_active'),
    'is_active'
  )
});

const parseDepartmentFilters = (req: Request): DepartmentFilters => ({
  location_id: parseOptionalUuid(
    getSingleQueryValue(req.query.location_id, 'location_id'),
    'location_id'
  ),
  default_reception_location_id: parseOptionalUuid(
    getSingleQueryValue(req.query.default_reception_location_id, 'default_reception_location_id'),
    'default_reception_location_id'
  ),
  is_active: parseOptionalBoolean(
    getSingleQueryValue(req.query.is_active, 'is_active'),
    'is_active'
  )
});

const parseEmployeeFilters = (req: Request): EmployeeFilters => ({
  is_active: parseOptionalBoolean(
    getSingleQueryValue(req.query.is_active, 'is_active'),
    'is_active'
  ),
  is_manager: parseOptionalBoolean(
    getSingleQueryValue(req.query.is_manager, 'is_manager'),
    'is_manager'
  ),
  is_provider: parseOptionalBoolean(
    getSingleQueryValue(req.query.is_provider, 'is_provider'),
    'is_provider'
  )
});

const appendCondition = (
  clauses: string[],
  params: unknown[],
  sqlLeftSide: string,
  value: unknown | undefined
) => {
  if (value === undefined) return;
  params.push(value);
  clauses.push(`${sqlLeftSide} = $${params.length}`);
};

const loadLocations = async (pg: PgPool, filters: LocationFilters): Promise<LocationRow[]> => {
  const clauses: string[] = [];
  const params: unknown[] = [];
  appendCondition(clauses, params, 'has_active_reception', filters.has_active_reception);
  appendCondition(clauses, params, 'is_active', filters.is_active);

  const query = `
    SELECT
      id,
      code,
      name,
      phone_number,
      address_line_1,
      address_line_2,
      has_active_reception,
      is_active,
      created_at::text AS created_at,
      updated_at::text AS updated_at
    FROM location
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY name ASC, code ASC
  `;

  const result = await pg.query<LocationRow>(query, params);
  return result.rows;
};

const loadDepartments = async (pg: PgPool, filters: DepartmentFilters): Promise<DepartmentRow[]> => {
  const clauses: string[] = [];
  const params: unknown[] = [];
  appendCondition(clauses, params, 'location_id', filters.location_id);
  appendCondition(clauses, params, 'default_reception_location_id', filters.default_reception_location_id);
  appendCondition(clauses, params, 'is_active', filters.is_active);

  const query = `
    SELECT
      id,
      code,
      name,
      business_unit_id,
      location_id,
      default_reception_location_id,
      manager_responsible_employee_id,
      department_type,
      phone_number,
      is_active,
      created_at::text AS created_at,
      updated_at::text AS updated_at
    FROM department
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY name ASC, code ASC
  `;

  const result = await pg.query<DepartmentRow>(query, params);
  return result.rows;
};

const loadEmployees = async (pg: PgPool, filters: EmployeeFilters): Promise<EmployeeRow[]> => {
  const clauses: string[] = [];
  const params: unknown[] = [];
  appendCondition(clauses, params, 'is_active', filters.is_active);
  appendCondition(clauses, params, 'is_manager', filters.is_manager);
  appendCondition(clauses, params, 'is_provider', filters.is_provider);

  const query = `
    SELECT
      id,
      employee_code,
      first_name,
      last_name,
      display_name,
      phone_number,
      email,
      role,
      role_level,
      reports_to_employee_id,
      is_manager,
      is_active,
      is_provider,
      provider_ref,
      created_at::text AS created_at,
      updated_at::text AS updated_at
    FROM employee
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY display_name ASC, last_name ASC, first_name ASC
  `;

  const result = await pg.query<EmployeeRow>(query, params);
  return result.rows;
};

const loadDepartmentById = async (pg: PgPool, departmentId: string): Promise<DepartmentRow | null> => {
  const result = await pg.query<DepartmentRow>(
    `
      SELECT
        id,
        code,
        name,
        business_unit_id,
        location_id,
        default_reception_location_id,
        manager_responsible_employee_id,
        department_type,
        phone_number,
        is_active,
        created_at::text AS created_at,
        updated_at::text AS updated_at
      FROM department
      WHERE id = $1
      LIMIT 1
    `,
    [departmentId]
  );

  return result.rows[0] ?? null;
};

const loadEmployeeById = async (pg: PgPool, employeeId: string): Promise<EmployeeRow | null> => {
  const result = await pg.query<EmployeeRow>(
    `
      SELECT
        id,
        employee_code,
        first_name,
        last_name,
        display_name,
        phone_number,
        email,
        role,
        role_level,
        reports_to_employee_id,
        is_manager,
        is_active,
        is_provider,
        provider_ref,
        created_at::text AS created_at,
        updated_at::text AS updated_at
      FROM employee
      WHERE id = $1
      LIMIT 1
    `,
    [employeeId]
  );

  return result.rows[0] ?? null;
};

const hasApprovedLeaveAt = async (
  pg: PgPool,
  employeeId: string,
  atDateTime: string
): Promise<boolean> => {
  const result = await pg.query<{ has_approved_leave: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM leave_request
        WHERE employee_id = $1
          AND status = 'approved'
          AND start_at <= $2::timestamptz
          AND end_at >= $2::timestamptz
      ) AS has_approved_leave
    `,
    [employeeId, atDateTime]
  );

  return result.rows[0]?.has_approved_leave === true;
};

const loadFallbackManager = async (
  pg: PgPool,
  baseRoleLevel: number,
  excludedEmployeeId: string,
  atDateTime: string
): Promise<EmployeeRow | null> => {
  const result = await pg.query<EmployeeRow>(
    `
      SELECT
        id,
        employee_code,
        first_name,
        last_name,
        display_name,
        phone_number,
        email,
        role,
        role_level,
        reports_to_employee_id,
        is_manager,
        is_active,
        is_provider,
        provider_ref,
        created_at::text AS created_at,
        updated_at::text AS updated_at
      FROM employee
      WHERE is_active = true
        AND is_manager = true
        AND id <> $1
        AND role_level >= $2
        AND NOT EXISTS (
          SELECT 1
          FROM leave_request
          WHERE leave_request.employee_id = employee.id
            AND leave_request.status = 'approved'
            AND leave_request.start_at <= $3::timestamptz
            AND leave_request.end_at >= $3::timestamptz
        )
      ORDER BY
        CASE WHEN role_level = $2 THEN 0 ELSE 1 END ASC,
        role_level ASC,
        display_name ASC
      LIMIT 1
    `,
    [excludedEmployeeId, baseRoleLevel, atDateTime]
  );

  return result.rows[0] ?? null;
};

const loadMatchingLeaveAt = async (
  pg: PgPool,
  employeeId: string,
  atDateTime: string,
  status: string
): Promise<LeaveRequestRow | null> => {
  const result = await pg.query<LeaveRequestRow>(
    `
      SELECT
        id,
        employee_id,
        leave_type,
        start_at::text AS start_at,
        end_at::text AS end_at,
        status,
        approved_by_employee_id,
        note,
        created_at::text AS created_at,
        updated_at::text AS updated_at
      FROM leave_request
      WHERE employee_id = $1
        AND status = $2
        AND start_at <= $3::timestamptz
        AND end_at >= $3::timestamptz
      ORDER BY start_at ASC, created_at ASC
      LIMIT 1
    `,
    [employeeId, status, atDateTime]
  );

  return result.rows[0] ?? null;
};

const toManagerResolutionRecipient = (
  employee: EmployeeRow | null
): ManagerResolutionRecipient | null => {
  if (!employee) return null;
  return {
    id: employee.id,
    employee_code: employee.employee_code,
    display_name: employee.display_name,
    role: employee.role,
    role_level: employee.role_level,
    email: employee.email,
    phone_number: employee.phone_number,
    is_manager: employee.is_manager,
    is_active: employee.is_active
  };
};

const buildManagerResolutionPreview = async (
  pg: PgPool,
  departmentId: string,
  atDateTime: string
): Promise<ManagerResolutionPreview> => {
  const department = await loadDepartmentById(pg, departmentId);
  if (!department) {
    throw new ApiRequestError(404, 'Department not found');
  }

  if (!department.manager_responsible_employee_id) {
    return {
      department_id: department.id,
      at_datetime: atDateTime,
      responsible_manager: null,
      primary_recipient: null,
      fallback_recipient: null,
      admin_summary_required: true,
      resolution_path: 'no_responsible_manager_configured'
    };
  }

  const responsibleManager = await loadEmployeeById(pg, department.manager_responsible_employee_id);
  if (!responsibleManager) {
    return {
      department_id: department.id,
      at_datetime: atDateTime,
      responsible_manager: null,
      primary_recipient: null,
      fallback_recipient: null,
      admin_summary_required: true,
      resolution_path: 'responsible_manager_not_found'
    };
  }

  const responsibleRecipient = toManagerResolutionRecipient(responsibleManager);

  if (!responsibleManager.is_active || !responsibleManager.is_manager) {
    const fallbackRecipient = responsibleManager.is_manager
      ? await loadFallbackManager(pg, responsibleManager.role_level, responsibleManager.id, atDateTime)
      : null;

    return {
      department_id: department.id,
      at_datetime: atDateTime,
      responsible_manager: responsibleRecipient,
      primary_recipient: fallbackRecipient ? toManagerResolutionRecipient(fallbackRecipient) : null,
      fallback_recipient: fallbackRecipient ? toManagerResolutionRecipient(fallbackRecipient) : null,
      admin_summary_required: true,
      resolution_path: fallbackRecipient
        ? fallbackRecipient.role_level === responsibleManager.role_level
          ? 'responsible_manager_inactive_fallback_peer'
          : 'responsible_manager_inactive_fallback_higher'
        : 'responsible_manager_inactive_no_fallback'
    };
  }

  const responsibleOnLeave = await hasApprovedLeaveAt(pg, responsibleManager.id, atDateTime);
  if (!responsibleOnLeave) {
    return {
      department_id: department.id,
      at_datetime: atDateTime,
      responsible_manager: responsibleRecipient,
      primary_recipient: responsibleRecipient,
      fallback_recipient: null,
      admin_summary_required: true,
      resolution_path: 'responsible_manager_available'
    };
  }

  // TODO: Improve fallback resolution with hierarchy-aware traversal via
  // reports_to_employee_id, business-unit scoping, and richer peer rules.
  const fallbackManager = await loadFallbackManager(
    pg,
    responsibleManager.role_level,
    responsibleManager.id,
    atDateTime
  );

  return {
    department_id: department.id,
    at_datetime: atDateTime,
    responsible_manager: responsibleRecipient,
    primary_recipient: fallbackManager ? toManagerResolutionRecipient(fallbackManager) : null,
    fallback_recipient: fallbackManager ? toManagerResolutionRecipient(fallbackManager) : null,
    admin_summary_required: true,
    resolution_path: fallbackManager
      ? fallbackManager.role_level === responsibleManager.role_level
        ? 'responsible_manager_on_leave_fallback_peer'
        : 'responsible_manager_on_leave_fallback_higher'
      : 'responsible_manager_on_leave_no_fallback'
  };
};

const handleRequestError = (res: Response, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const status = error instanceof ApiRequestError ? error.status : 500;
  return res.status(status).json({ ok: false, error: message });
};

export const handleLocationsRequest = async (pg: PgPool, req: Request, res: Response) => {
  try {
    // TODO: Align master-data read access with the final shared auth/role model.
    const filters = parseLocationFilters(req);
    const rows = await loadLocations(pg, filters);
    return res.json(rows);
  } catch (error) {
    return handleRequestError(res, error);
  }
};

export const handleDepartmentsRequest = async (pg: PgPool, req: Request, res: Response) => {
  try {
    // TODO: Align master-data read access with the final shared auth/role model.
    const filters = parseDepartmentFilters(req);
    const rows = await loadDepartments(pg, filters);
    return res.json(rows);
  } catch (error) {
    return handleRequestError(res, error);
  }
};

export const handleEmployeesRequest = async (pg: PgPool, req: Request, res: Response) => {
  try {
    // TODO: Align master-data read access with the final shared auth/role model.
    const filters = parseEmployeeFilters(req);
    const rows = await loadEmployees(pg, filters);
    return res.json(rows);
  } catch (error) {
    return handleRequestError(res, error);
  }
};

export const handleDepartmentManagerResolutionPreviewRequest = async (
  pg: PgPool,
  req: Request,
  res: Response
) => {
  try {
    // TODO: Align preview access with the final admin/developer auth model.
    const departmentId = parseRequiredUuidPathValue(req.params.id, 'id');
    const atDateTime = parsePreviewDateTime(
      getSingleQueryValue(req.query.at_datetime, 'at_datetime')
    );
    const preview = await buildManagerResolutionPreview(pg, departmentId, atDateTime);
    return res.json(preview);
  } catch (error) {
    return handleRequestError(res, error);
  }
};

export const handleLeaveAvailabilityRequest = async (
  pg: PgPool,
  req: Request,
  res: Response
) => {
  try {
    // TODO: Align leave-availability preview access with the final shared auth/role model.
    const employeeId = parseRequiredUuidQueryValue(
      getSingleQueryValue(req.query.employee_id, 'employee_id'),
      'employee_id'
    );
    const atDateTime = parsePreviewDateTime(
      getSingleQueryValue(req.query.at_datetime, 'at_datetime')
    );
    const status =
      parseOptionalStatusValue(getSingleQueryValue(req.query.status, 'status')) ?? 'approved';
    const matchingLeave = await loadMatchingLeaveAt(pg, employeeId, atDateTime, status);

    const response: LeaveAvailabilityResponse = {
      employee_id: employeeId,
      at_datetime: atDateTime,
      is_on_leave: matchingLeave !== null,
      matching_leave: matchingLeave
    };

    return res.json(response);
  } catch (error) {
    return handleRequestError(res, error);
  }
};
