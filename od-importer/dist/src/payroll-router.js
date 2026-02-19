/**
 * Get all active payroll subscriptions for an employee
 */
export const getEmployeeSubscriptions = async (pg, employeeId, asOfDate) => {
    const checkDate = asOfDate || new Date().toISOString().split('T')[0];
    const result = await pg.query(`SELECT 
      employee_id,
      payroll_type,
      employment_number,
      active_from,
      active_to
     FROM payroll_subscriptions
     WHERE employee_id = $1
       AND active_from <= $2
       AND (active_to IS NULL OR active_to >= $2)
     ORDER BY payroll_type`, [employeeId, checkDate]);
    return result.rows;
};
/**
 * Determine all payroll streams for a user (employee can be on multiple)
 */
export const determinePayrollStreams = async (pg, odUserNum, asOfDate) => {
    // First, find the employee by OpenDental user mapping
    const mapResult = await pg.query(`SELECT directus_employee_id FROM od_user_map WHERE od_user_num = $1 AND is_active = TRUE LIMIT 1`, [odUserNum]);
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
