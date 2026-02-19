import type { Pool as PgPool } from 'pg';

export type PayrollSubscription = {
  employee_id: number;
  payroll_type: 'MAIN' | 'PROVIDER' | 'THIRDPARTY';
  employment_number: string;
  active_from: string;
  active_to: string | null;
  is_sync_to_opendental: boolean;
};

export type EmployeePayrollInfo = {
  employee_id: number;
  od_user_num: number;
  subscriptions: PayrollSubscription[]; // Employee can be on multiple payrolls
};

/**
 * Get all active payroll subscriptions for an employee
 */
export const getEmployeeSubscriptions = async (
  pg: PgPool,
  employeeId: number,
  asOfDate?: string
): Promise<PayrollSubscription[]> => {
  const checkDate = asOfDate || new Date().toISOString().split('T')[0];

  const result = await pg.query(
    `SELECT 
      employee_id,
      payroll_type,
      employment_number,
      active_from,
      active_to
     FROM payroll_subscriptions
     WHERE employee_id = $1
       AND active_from <= $2
       AND (active_to IS NULL OR active_to >= $2)
     ORDER BY payroll_type`,
    [employeeId, checkDate]
  );

  return result.rows;
};

/**
 * Determine all payroll streams for a user (employee can be on multiple)
 */
export const determinePayrollStreams = async (
  pg: PgPool,
  odUserNum: number,
  asOfDate?: string
): Promise<EmployeePayrollInfo | null> => {
  // First, find the employee by OpenDental user mapping
  const mapResult = await pg.query(
    `SELECT directus_employee_id FROM od_user_map WHERE od_user_num = $1 AND is_active = TRUE LIMIT 1`,
    [odUserNum]
  );

  if (mapResult.rows.length === 0) {
    return null; // User not mapped
  }

  const employeeId = mapResult.rows[0].directus_employee_id;
  const subscriptions = await getEmployeeSubscriptions(pg, employeeId, asOfDate);

  if (subscriptions.length === 0) {
    return null; // Employee has no active subscriptions
  }

  return {
    employee_id: employeeId,
    od_user_num: odUserNum,
    subscriptions
  };
};
