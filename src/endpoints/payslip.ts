/**
 * Payslip Endpoint
 * GET /payroll/payslip/:emp_id/:year/:month
 * Generates and downloads a payslip PDF for an employee
 */

import { defineEndpoint } from '@directus/extensions-sdk';
import type { Router } from 'express';
import { generatePayslip } from '../lib/payslip-generator.js';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export default defineEndpoint((router: Router, { database, logger }: any) => {
  /**
   * GET /payroll/payslip/:emp_id/:year/:month
   * Download payslip PDF for an employee
   */
  router.get('/payroll/payslip/:emp_id/:year/:month', async (req: any, res: any) => {
    try {
      const empId = Number(req.params.emp_id);
      const year = Number(req.params.year);
      const month = Number(req.params.month);

      if (!Number.isFinite(empId) || !Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
        return res.status(400).json({ error: 'Invalid parameters' });
      }

      // Find payroll line for this employee and period
      const payrollLine = await database('payroll_lines')
        .join('payroll_entries', 'payroll_lines.payroll_entry_id', '=', 'payroll_entries.id')
        .where('payroll_lines.emp_id', empId)
        .where('payroll_entries.payroll_year', year)
        .where('payroll_entries.payroll_month', month)
        .select('payroll_lines.*', 'payroll_entries.period_from', 'payroll_entries.period_to', 'payroll_entries.payroll_month')
        .first();

      if (!payrollLine) {
        return res.status(404).json({
          error: 'Payslip not found',
          message: `No payroll line found for employee ${empId} for ${year}-${String(month).padStart(2, '0')}`
        });
      }

      // Fetch employee information
      const employee = await database('vw_employee_current')
        .where('emp_id', empId)
        .first();

      if (!employee) {
        return res.status(404).json({ error: 'Employee not found' });
      }

      // Fetch leave entitlements for display (optional)
      let vl_remaining = null;
      let sl_remaining = null;

      try {
        const leaveBalance = await database('leave_balance')
          .where('emp_id', empId)
          .where('payroll_year', year)
          .first();

        if (leaveBalance) {
          vl_remaining = leaveBalance.vl_remaining_hours;
          sl_remaining = leaveBalance.sl_remaining_hours;
        }
      } catch (e) {
        logger.debug('Leave balance not available:', e);
      }

      // Build payslip data
      const monthName = MONTHS[month - 1] || 'Unknown';
      const payslipData = {
        employee_id: empId,
        employee_name: `${employee.name || employee.first_name || ''} ${employee.surname || ''}`.trim(),
        employee_id_number: employee.identity_card_number || '',
        employment_number: payrollLine.notes?.includes('subscription') ? 'TBD' : '',
        period: `${year}-${String(month).padStart(2, '0')}`,
        period_full: `${monthName} ${year}`,
        
        payroll_type: payrollLine.notes?.includes('MAIN') ? 'MAIN' : 
                     payrollLine.notes?.includes('PROVIDER') ? 'PROVIDER' : 
                     payrollLine.notes?.includes('THIRDPARTY') ? 'THIRDPARTY' : 'MAIN',
        
        // Earnings
        basic_wage: payrollLine.gross_earnings - (payrollLine.supervisor_bonus || 0) - (payrollLine.performance_bonus || 0) - 
                    (payrollLine.statutory_bonus_june || 0) - (payrollLine.weekly_allowance_march || 0) - 
                    (payrollLine.statutory_bonus_december || 0) - (payrollLine.weekly_allowance_september || 0) +
                    (payrollLine.supervisor_bonus_deduction || 0) + (payrollLine.performance_bonus_deduction || 0),
        hourly_rate: payrollLine.hourly_rate,
        hours_worked: payrollLine.hours_worked,
        supervisor_bonus: payrollLine.supervisor_bonus || 0,
        performance_bonus: payrollLine.performance_bonus || 0,
        statutory_bonus_june: payrollLine.statutory_bonus_june || 0,
        weekly_allowance_march: payrollLine.weekly_allowance_march || 0,
        statutory_bonus_december: payrollLine.statutory_bonus_december || 0,
        weekly_allowance_september: payrollLine.weekly_allowance_september || 0,
        gross_earnings: payrollLine.gross_earnings,
        
        // Leave
        annual_leave_taken_hours: payrollLine.annual_leave_taken_hours || 0,
        sick_leave_taken_hours: payrollLine.sick_leave_taken_hours || 0,
        unpaid_leave_hours: payrollLine.unpaid_leave_hours || 0,
        
        // Deductions
        ss_employee_contribution: payrollLine.ss_employee_contribution || 0,
        ss_class_code: payrollLine.ss_class_code || 'N/A',
        tax_deduction: payrollLine.tax_deduction || 0,
        supervisor_bonus_deduction: payrollLine.supervisor_bonus_deduction || 0,
        performance_bonus_deduction: payrollLine.performance_bonus_deduction || 0,
        total_deductions: payrollLine.total_deductions,
        
        // Net
        net_payment: payrollLine.net_payment,
        
        // Leave balance
        vl_remaining,
        sl_remaining
      };

      // Generate PDF
      const pdfBuffer = await generatePayslip(payslipData);

      // Return as downloadable PDF
      const filename = `Payslip_${employee.surname || 'Unknown'}_${year}${String(month).padStart(2, '0')}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      res.send(pdfBuffer);
    } catch (error) {
      logger.error('Payslip generation error:', error);
      res.status(500).json({
        error: 'Failed to generate payslip',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * POST /payroll/bulk-payslips
   * Generate payslips for all employees in a month (returns info about generated files)
   */
  router.post('/payroll/bulk-payslips', async (req: any, res: any) => {
    try {
      const { year, month } = req.body;

      if (!year || !month) {
        return res.status(400).json({ error: 'Year and month are required' });
      }

      const payroll_year = Number(year);
      const payroll_month = Number(month);

      if (!Number.isFinite(payroll_year) || !Number.isFinite(payroll_month) || payroll_month < 1 || payroll_month > 12) {
        return res.status(400).json({ error: 'Invalid year or month' });
      }

      // Fetch all payroll lines for this period
      const payrollLines = await database('payroll_lines')
        .join('payroll_entries', 'payroll_lines.payroll_entry_id', '=', 'payroll_entries.id')
        .where('payroll_entries.payroll_year', payroll_year)
        .where('payroll_entries.payroll_month', payroll_month)
        .select('payroll_lines.*', 'payroll_entries.period_from', 'payroll_entries.period_to');

      if (!payrollLines || payrollLines.length === 0) {
        return res.status(404).json({
          error: 'No payroll data found',
          message: `No payroll lines found for ${payroll_year}-${String(payroll_month).padStart(2, '0')}`
        });
      }

      const results = [];
      const errors = [];

      // Generate payslips for each employee
      for (const line of payrollLines) {
        try {
          const employee = await database('vw_employee_current')
            .where('emp_id', line.emp_id)
            .first();

          if (!employee) {
            errors.push({ emp_id: line.emp_id, reason: 'Employee not found' });
            continue;
          }

          const monthName = MONTHS[payroll_month - 1] || 'Unknown';
          const payslipData = {
            employee_id: line.emp_id,
            employee_name: `${employee.name || employee.first_name || ''} ${employee.surname || ''}`.trim(),
            employee_id_number: employee.identity_card_number || '',
            period: `${payroll_year}-${String(payroll_month).padStart(2, '0')}`,
            period_full: `${monthName} ${payroll_year}`,
            payroll_type: 'MAIN',
            basic_wage: line.gross_earnings - (line.supervisor_bonus || 0) - (line.performance_bonus || 0),
            hourly_rate: line.hourly_rate,
            hours_worked: line.hours_worked,
            supervisor_bonus: line.supervisor_bonus || 0,
            performance_bonus: line.performance_bonus || 0,
            statutory_bonus_june: line.statutory_bonus_june || 0,
            weekly_allowance_march: line.weekly_allowance_march || 0,
            statutory_bonus_december: line.statutory_bonus_december || 0,
            weekly_allowance_september: line.weekly_allowance_september || 0,
            gross_earnings: line.gross_earnings,
            annual_leave_taken_hours: line.annual_leave_taken_hours || 0,
            sick_leave_taken_hours: line.sick_leave_taken_hours || 0,
            unpaid_leave_hours: line.unpaid_leave_hours || 0,
            ss_employee_contribution: line.ss_employee_contribution || 0,
            ss_class_code: line.ss_class_code || 'N/A',
            tax_deduction: line.tax_deduction || 0,
            supervisor_bonus_deduction: line.supervisor_bonus_deduction || 0,
            performance_bonus_deduction: line.performance_bonus_deduction || 0,
            total_deductions: line.total_deductions,
            net_payment: line.net_payment
          };

          const pdfBuffer = await generatePayslip(payslipData);
          const filename = `Payslip_${employee.surname || 'Unknown'}_${payroll_year}${String(payroll_month).padStart(2, '0')}.pdf`;

          results.push({
            emp_id: line.emp_id,
            employee_name: payslipData.employee_name,
            filename,
            size_bytes: pdfBuffer.length,
            gross_earnings: line.gross_earnings,
            net_payment: line.net_payment
          });
        } catch (empError) {
          errors.push({
            emp_id: line.emp_id,
            reason: empError instanceof Error ? empError.message : 'Generation failed'
          });
        }
      }

      res.json({
        ok: true,
        period: `${payroll_year}-${String(payroll_month).padStart(2, '0')}`,
        summary: {
          total_payroll_lines: payrollLines.length,
          successfully_generated: results.length,
          failed: errors.length
        },
        results,
        errors: errors.length > 0 ? errors : undefined
      });
    } catch (error) {
      logger.error('Bulk payslip generation error:', error);
      res.status(500).json({
        error: 'Failed to generate payslips',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
});
