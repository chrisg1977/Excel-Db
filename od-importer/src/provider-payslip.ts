export type ProductionLine = {
  date: string; // YYYY-MM-DD
  day: string; // Mon, Tue...
  amount: number;
};

export type LabFeeLine = {
  date?: string;
  dentist?: string;
  patient?: string;
  job_number?: string;
  fee: number;
  note?: string;
};

export type OtherExpenseLine = {
  category: string; // fuel, uniforms, insurance, etc
  amount: number;
  note?: string;
};

export type ProviderPayslipInput = {
  period_label: string; // e.g. Jan-26
  provider_name: string;
  fee_share_percent: number;
  total_fees: number;
  production_lines: ProductionLine[];
  lab_fee_lines: LabFeeLine[];
  lab_share_percent: number;
  other_expense_lines: OtherExpenseLine[];
  payslip_value_or_bank_transfer: number;
  bank_fees?: number;
  previous_pending_cash?: number; // loan carried from earlier negative cash
  cash_rounding_unit?: number; // e.g. 10
  cash_rounding_mode?: 'UP' | 'NEAREST' | 'NONE';
};

export type ProviderPayslipOutput = {
  statement: {
    period_label: string;
    provider_name: string;
    style: {
      show_logo: false;
      show_employer_info: false;
      show_employee_info: false;
    };
  };
  left_column: {
    total_fees: number;
    rows: ProductionLine[];
  };
  middle_section: {
    fee_share_percent: number;
    fee_share_amount: number;
    lab_share_percent: number;
    lab_share_amount: number;
    other_expenses_total: number;
    payslip_value_or_bank_transfer: number;
    bank_fees: number;
    cash_before_pending: number;
    cash_after_pending_before_rounding: number;
    cash_final: number;
    pending_carried_in: number;
    pending_carried_out: number;
  };
  right_column: {
    other_expenses: OtherExpenseLine[];
  };
  lab_fees_section: {
    total_lab_fees: number;
    rows: LabFeeLine[];
  };
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const roundCash = (value: number, unit: number, mode: 'UP' | 'NEAREST' | 'NONE') => {
  if (mode === 'NONE') return round2(value);
  if (value <= 0) return 0;
  if (mode === 'UP') return round2(Math.ceil(value / unit) * unit);
  return round2(Math.round(value / unit) * unit);
};

const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);

export const buildProviderPayslip = (input: ProviderPayslipInput): ProviderPayslipOutput => {
  const feeShareAmount = round2((input.total_fees * input.fee_share_percent) / 100);
  const totalLabFees = round2(sum(input.lab_fee_lines.map((r) => r.fee || 0)));
  const labShareAmount = round2((totalLabFees * input.lab_share_percent) / 100);
  const otherExpensesTotal = round2(sum(input.other_expense_lines.map((r) => r.amount || 0)));
  const bankFees = round2(input.bank_fees ?? 0);

  const settlementBase = round2(
    feeShareAmount -
      labShareAmount -
      otherExpensesTotal -
      input.payslip_value_or_bank_transfer -
      bankFees
  );

  const pendingIn = round2(input.previous_pending_cash ?? 0);
  const cashAfterPending = round2(settlementBase - pendingIn);

  const roundingUnit = input.cash_rounding_unit ?? 10;
  const roundingMode = input.cash_rounding_mode ?? 'UP';

  const positiveCashForPayment = Math.max(0, cashAfterPending);
  const cashFinal = roundCash(positiveCashForPayment, roundingUnit, roundingMode);

  let pendingOut = 0;
  if (cashAfterPending < 0) {
    pendingOut = round2(Math.abs(cashAfterPending));
  }

  return {
    statement: {
      period_label: input.period_label,
      provider_name: input.provider_name,
      style: {
        show_logo: false,
        show_employer_info: false,
        show_employee_info: false
      }
    },
    left_column: {
      total_fees: round2(input.total_fees),
      rows: input.production_lines
    },
    middle_section: {
      fee_share_percent: input.fee_share_percent,
      fee_share_amount: feeShareAmount,
      lab_share_percent: input.lab_share_percent,
      lab_share_amount: labShareAmount,
      other_expenses_total: otherExpensesTotal,
      payslip_value_or_bank_transfer: round2(input.payslip_value_or_bank_transfer),
      bank_fees: bankFees,
      cash_before_pending: settlementBase,
      cash_after_pending_before_rounding: cashAfterPending,
      cash_final: cashFinal,
      pending_carried_in: pendingIn,
      pending_carried_out: pendingOut
    },
    right_column: {
      other_expenses: input.other_expense_lines
    },
    lab_fees_section: {
      total_lab_fees: totalLabFees,
      rows: input.lab_fee_lines
    }
  };
};
