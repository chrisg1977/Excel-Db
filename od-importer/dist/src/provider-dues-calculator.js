const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const validateAmount = (name, value) => {
    if (!Number.isFinite(value) || value < 0) {
        throw new Error(`${name} must be a non-negative number`);
    }
};
const computeByRule = (amount, rule) => {
    if (rule.mode === 'FLAT') {
        validateAmount('percent', rule.percent);
        return round2((amount * rule.percent) / 100);
    }
    if (!rule.tiers.length) {
        throw new Error('TIERED rule must include at least one tier');
    }
    let remaining = amount;
    let prevUpper = 0;
    let total = 0;
    for (const tier of rule.tiers) {
        validateAmount('tier percent', tier.percent);
        const upper = tier.up_to_eur;
        if (upper === null) {
            total += (remaining * tier.percent) / 100;
            remaining = 0;
            break;
        }
        if (upper < prevUpper) {
            throw new Error('Tier up_to_eur values must be ascending');
        }
        const slice = Math.max(0, Math.min(remaining, upper - prevUpper));
        total += (slice * tier.percent) / 100;
        remaining -= slice;
        prevUpper = upper;
        if (remaining <= 0)
            break;
    }
    if (remaining > 0) {
        throw new Error('TIERED rule must end with up_to_eur = null to cover remaining amount');
    }
    return round2(total);
};
const roundCash = (value, unit, mode) => {
    if (value <= 0)
        return 0;
    if (mode === 'UP')
        return Math.ceil(value / unit) * unit;
    return Math.round(value / unit) * unit;
};
export const calculateProviderDues = (input) => {
    const bankFees = round2(input.bank_fees ?? 0);
    const cashUnit = input.cash_rounding_unit ?? 10;
    const cashRoundingMode = input.cash_rounding_mode ?? 'UP';
    validateAmount('provider_production_total', input.provider_production_total);
    validateAmount('lab_fees_total', input.lab_fees_total);
    validateAmount('bank_fees', bankFees);
    validateAmount('cash_rounding_unit', cashUnit);
    const productionDue = computeByRule(input.provider_production_total, input.production_rule);
    const labDue = computeByRule(input.lab_fees_total, input.lab_rule);
    const netDue = round2(productionDue - labDue);
    let officialAmount = 0;
    let bankTransferAmount = 0;
    let cashAmount = 0;
    const notes = [];
    if (input.is_subscribed_main_payroll) {
        const payslipValue = round2(input.payslip_value ?? 0);
        validateAmount('payslip_value', payslipValue);
        officialAmount = payslipValue;
        bankTransferAmount = 0;
        cashAmount = round2(netDue - payslipValue - bankFees);
        notes.push('Main payroll flow: official amount equals payslip value.');
    }
    else {
        const officialInput = round2(input.official_bank_transfer_input ?? 0);
        validateAmount('official_bank_transfer_input', officialInput);
        const provisionalCash = round2(netDue - officialInput - bankFees);
        const roundedCash = round2(roundCash(provisionalCash, cashUnit, cashRoundingMode));
        const adjustedBankTransfer = round2(netDue - bankFees - roundedCash);
        officialAmount = adjustedBankTransfer;
        bankTransferAmount = adjustedBankTransfer;
        cashAmount = roundedCash;
        notes.push('Non-main flow: cash derived after bank-fee deduction and rounded to configured unit.');
        notes.push('Bank transfer adjusted so cash + bank + bank fees = net due.');
    }
    if (cashAmount < 0) {
        notes.push('Cash amount is negative; review payslip/official amount and bank fees.');
    }
    return {
        production_due: productionDue,
        lab_due: labDue,
        net_due_before_settlement: netDue,
        official_amount: round2(officialAmount),
        cash_amount: round2(cashAmount),
        bank_transfer_amount: round2(bankTransferAmount),
        bank_fees_deducted_from_cash: bankFees,
        notes
    };
};
