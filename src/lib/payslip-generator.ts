/**
 * Payslip PDF Generator
 * Generates professional payslip PDFs from payroll_lines data
 */

import PDFDocument from 'pdfkit';
import { PassThrough } from 'stream';

export interface PayslipData {
  employee_id: number;
  employee_name: string;
  employee_id_number?: string;
  employment_number?: string;
  period: string; // YYYY-MM
  period_full: string; // e.g., "February 2026"
  
  // Employment
  payroll_type: string; // MAIN, PROVIDER, THIRDPARTY
  
  // Earnings
  basic_wage: number;
  hourly_rate: number;
  hours_worked: number;
  supervisor_bonus: number;
  performance_bonus: number;
  statutory_bonus_june?: number;
  weekly_allowance_march?: number;
  statutory_bonus_december?: number;
  weekly_allowance_september?: number;
  gross_earnings: number;
  
  // Deductions
  annual_leave_taken_hours: number;
  sick_leave_taken_hours: number;
  unpaid_leave_hours: number;
  
  ss_employee_contribution: number;
  ss_class_code: string;
  tax_deduction: number;
  supervisor_bonus_deduction?: number;
  performance_bonus_deduction?: number;
  total_deductions: number;
  
  // Net
  net_payment: number;
  
  // Leave entitlements (optional)
  vl_remaining?: number;
  sl_remaining?: number;
}

export const generatePayslip = async (data: PayslipData): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    try {
      const buffers: Buffer[] = [];
      const stream = new PassThrough();
      
      stream.on('data', (chunk: Buffer) => buffers.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(buffers)));
      stream.on('error', reject);

      const doc = new PDFDocument({
        size: 'A4',
        margin: 40,
        bufferPages: true
      });

      doc.pipe(stream);

      // Header
      doc
        .fontSize(20)
        .font('Helvetica-Bold')
        .text('PAYSLIP', { align: 'center' })
        .moveDown(0.5);

      doc
        .fontSize(10)
        .font('Helvetica')
        .text(`Period: ${data.period_full} (${data.period})`, { align: 'center' })
        .moveDown(1);

      // Employee Information
      doc
        .fontSize(11)
        .font('Helvetica-Bold')
        .text('Employee Information', {})
        .moveDown(0.3);

      doc
        .fontSize(9)
        .font('Helvetica')
        .text(`Name: ${data.employee_name}`)
        .text(`Employee ID: ${data.employee_id}`)
        .text(`Payroll Type: ${data.payroll_type}`)
        .text(`SS Class: ${data.ss_class_code}`)
        .moveDown(1);

      // Earnings Section
      doc
        .fontSize(11)
        .font('Helvetica-Bold')
        .text('EARNINGS', {})
        .moveDown(0.3);

      const earningsData = [
        ['Description', 'Amount (€)'],
        ['Basic Wage', `${data.basic_wage.toFixed(2)}`],
        ['Hours Worked', `${data.hours_worked}`],
        ['Hourly Rate', `${data.hourly_rate.toFixed(2)}`]
      ];

      if (data.supervisor_bonus && data.supervisor_bonus > 0) {
        earningsData.push(['Supervisor Bonus', `${data.supervisor_bonus.toFixed(2)}`]);
      }

      if (data.performance_bonus && data.performance_bonus > 0) {
        earningsData.push(['Performance Bonus', `${data.performance_bonus.toFixed(2)}`]);
      }

      if (data.statutory_bonus_june && data.statutory_bonus_june > 0) {
        earningsData.push(['Statutory Bonus (June)', `${data.statutory_bonus_june.toFixed(2)}`]);
      }

      if (data.statutory_bonus_december && data.statutory_bonus_december > 0) {
        earningsData.push(['Statutory Bonus (December)', `${data.statutory_bonus_december.toFixed(2)}`]);
      }

      if (data.weekly_allowance_march && data.weekly_allowance_march > 0) {
        earningsData.push(['Weekly Allowance (March)', `${data.weekly_allowance_march.toFixed(2)}`]);
      }

      if (data.weekly_allowance_september && data.weekly_allowance_september > 0) {
        earningsData.push(['Weekly Allowance (September)', `${data.weekly_allowance_september.toFixed(2)}`]);
      }

      earningsData.push(['─────────────────────', '────────────']);
      earningsData.push(['GROSS EARNINGS', `${data.gross_earnings.toFixed(2)}`]);

      drawTable(doc, earningsData, 50, 300, 250);

      doc.moveDown(2);

      // Deductions Section
      doc
        .fontSize(11)
        .font('Helvetica-Bold')
        .text('DEDUCTIONS', {})
        .moveDown(0.3);

      const deductionsData = [
        ['Description', 'Amount (€)']
      ];

      if (data.annual_leave_taken_hours > 0) {
        deductionsData.push(['Annual Leave Taken (hrs)', `${data.annual_leave_taken_hours}`]);
      }

      if (data.sick_leave_taken_hours > 0) {
        deductionsData.push(['Sick Leave Taken (hrs)', `${data.sick_leave_taken_hours}`]);
      }

      if (data.unpaid_leave_hours > 0) {
        deductionsData.push(['Unpaid Leave (hrs)', `${data.unpaid_leave_hours}`]);
      }

      if (data.supervisor_bonus_deduction && data.supervisor_bonus_deduction > 0) {
        deductionsData.push(['Supervisor Bonus Deduction', `(${data.supervisor_bonus_deduction.toFixed(2)})`]);
      }

      if (data.performance_bonus_deduction && data.performance_bonus_deduction > 0) {
        deductionsData.push(['Performance Bonus Deduction', `(${data.performance_bonus_deduction.toFixed(2)})`]);
      }

      deductionsData.push(['Social Security (Employee)', `(${data.ss_employee_contribution.toFixed(2)})`]);
      deductionsData.push(['Income Tax', `(${data.tax_deduction.toFixed(2)})`]);
      deductionsData.push(['─────────────────────', '────────────']);
      deductionsData.push(['TOTAL DEDUCTIONS', `(${data.total_deductions.toFixed(2)})`]);

      drawTable(doc, deductionsData, 50, 450, 250);

      doc.moveDown(2);

      // Summary Section
      doc
        .fontSize(12)
        .font('Helvetica-Bold')
        .text(`NET PAYMENT: €${data.net_payment.toFixed(2)}`, {
          align: 'right',
          boxOptions: { borderColor: '#000000', borderWidth: 2 }
        })
        .moveDown(1);

      // Leave Balance (optional)
      if (data.vl_remaining !== undefined || data.sl_remaining !== undefined) {
        doc
          .fontSize(10)
          .font('Helvetica-Bold')
          .text('Leave Balance', {})
          .moveDown(0.3);

        if (data.vl_remaining !== undefined) {
          doc
            .fontSize(9)
            .font('Helvetica')
            .text(`Annual Leave Remaining: ${data.vl_remaining.toFixed(2)} hours`);
        }

        if (data.sl_remaining !== undefined) {
          doc
            .fontSize(9)
            .font('Helvetica')
            .text(`Sick Leave Remaining: ${data.sl_remaining.toFixed(2)} hours`);
        }

        doc.moveDown(1);
      }

      // Footer
      doc
        .fontSize(8)
        .font('Helvetica')
        .text('This payslip is confidential. Please contact HR if there are any discrepancies.', {
          align: 'center',
          fill: true
        });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
};

/**
 * Helper: Draw a simple table
 */
const drawTable = (
  doc: any, // PDFKit.PDFDocument
  data: string[][],
  x: number,
  y: number,
  width: number
) => {
  const cellHeight = 20;
  const colWidths = [width * 0.65, width * 0.35];

  let currentY = y;

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const isHeader = i === 0;
    const isTotal = row[0].includes('─') || row[0].includes('GROSS') || row[0].includes('NET') || row[0].includes('TOTAL');

    if (isTotal) {
      doc.moveTo(x, currentY).lineTo(x + width, currentY).stroke();
      currentY += 5;
    }

    if (isHeader) {
      doc.font('Helvetica-Bold').fontSize(10);
    } else if (isTotal) {
      doc.font('Helvetica-Bold').fontSize(10);
    } else {
      doc.font('Helvetica').fontSize(9);
    }

    // Column 1 (Description)
    doc.text(row[0], x + 5, currentY, { width: colWidths[0] - 10 });

    // Column 2 (Amount) - right aligned
    doc.text(row[1], x + colWidths[0] + 5, currentY, {
      width: colWidths[1] - 10,
      align: 'right'
    });

    currentY += cellHeight;
  }
};
