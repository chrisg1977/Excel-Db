const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const roundCash = (value, unit, mode) => {
    if (mode === 'NONE')
        return round2(value);
    if (value <= 0)
        return 0;
    if (mode === 'UP')
        return round2(Math.ceil(value / unit) * unit);
    return round2(Math.round(value / unit) * unit);
};
const sum = (arr) => arr.reduce((a, b) => a + b, 0);
export const buildProviderPayslip = (input) => {
    const feeShareAmount = round2((input.total_fees * input.fee_share_percent) / 100);
    const totalLabFees = round2(sum(input.lab_fee_lines.map((r) => r.fee || 0)));
    const labShareAmount = round2((totalLabFees * input.lab_share_percent) / 100);
    const otherExpensesTotal = round2(sum(input.other_expense_lines.map((r) => r.amount || 0)));
    const bankFees = round2(input.bank_fees ?? 0);
    const settlementBase = round2(feeShareAmount -
        labShareAmount -
        otherExpensesTotal -
        input.payslip_value_or_bank_transfer -
        bankFees);
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
