/**
 * Convert timesheet events (IN/OUT clock pairs) to shifted hours
 * Assuming: IN at 08:00, OUT at 16:30 = 8.5 hours
 */
export const aggregateClockEventsToHours = (events) => {
    const eventsByDate = new Map();
    for (const event of events) {
        const dateLocal = event.event_datetime.slice(0, 10);
        const time = new Date(event.event_datetime);
        if (!eventsByDate.has(dateLocal)) {
            eventsByDate.set(dateLocal, {});
        }
        const dayEvents = eventsByDate.get(dateLocal);
        if (event.status === 'IN') {
            dayEvents.in = time;
        }
        else {
            dayEvents.out = time;
        }
    }
    const result = [];
    for (const [date, times] of eventsByDate.entries()) {
        if (times.in && times.out) {
            const diffMs = times.out.getTime() - times.in.getTime();
            const hours = diffMs / (1000 * 60 * 60);
            if (hours > 0) {
                result.push({ date, hours });
            }
        }
    }
    return result.sort((a, b) => a.date.localeCompare(b.date));
};
/**
 * Insert a payroll line item into timesheet for MAIN payroll routing
 */
export const insertMainPayrollLine = async (pg, payrollId, directusEmployeeId, date, hours) => {
    const result = await pg.query(`INSERT INTO payroll_lines (employee_id, pay_date, hours_worked, status)
     SELECT $1, $2, $3, 'DRAFT'
     WHERE EXISTS (
       SELECT 1 FROM od_employee_link 
       WHERE directus_employee_id = $1 AND od_payroll_id = $4
     )
     RETURNING id`, [directusEmployeeId, date, hours, payrollId]);
    return result.rows.length > 0 ? Number(result.rows[0].id) : -1;
};
/**
 * Insert a provider payment record for PROVIDER payroll routing
 */
export const insertProviderPayment = async (pg, providerId, directusEmployeeId, date, hours, paymentMethod) => {
    const result = await pg.query(`INSERT INTO provider_payments (provider_id, payment_date, hours, payment_method, notes)
     SELECT $1, $2, $3, $4, 'From OpenDental timesheet'
     WHERE EXISTS (
       SELECT 1 FROM od_provider_link 
       WHERE od_provider_id = $1
     )
     RETURNING id`, [providerId, date, hours, paymentMethod]);
    return result.rows.length > 0 ? Number(result.rows[0].id) : -1;
};
