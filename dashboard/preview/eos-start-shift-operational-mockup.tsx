import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowDownToLine,
  Building2,
  CalendarClock,
  CheckCircle2,
  Clock3,
  CreditCard,
  Landmark,
  Receipt,
  ShieldAlert,
  User,
  Wallet,
} from "lucide-react";

// Standalone EOS operational mockup artifact.
// This file is not wired into the current dashboard runtime.
// TODO: Fold this structure into the live EOS frontend when the runtime surface is ready.

type IconComponent = React.ComponentType<{ className?: string }>;

type PaymentValues = {
  eposDentalZabbar: string;
  eposDentalQormi: string;
  eposPodo: string;
  eposBluM: string;
  eposBlum: string;
  eposCashlink: string;
  bov: string;
  bankTransfer: string;
  revolut: string;
  cheques: string;
  cashEnvelope: string;
};

type PaymentFieldConfig = {
  key: keyof PaymentValues;
  label: string;
  icon: IconComponent;
};

const formatMoney = (value: number | string) =>
  new Intl.NumberFormat("en-MT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  }).format(Number(value || 0));

const pad = (value: number) => String(value).padStart(2, "0");

const toDateInputValue = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const toDateTimeInputValue = (date: Date) =>
  `${toDateInputValue(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;

const buildDateTimeValue = (dateInput: string, timeInput: string) => `${dateInput}T${timeInput}`;

const departmentDefaults = {
  MDCZ: {
    label: "MDCZ - Dental Zabbar",
    paymentChannels: ["EPOS Dental Zabbar", "Cashlink", "BOV", "Bank transfer", "Revolut", "Cheques"],
  },
  MDCQ: {
    label: "MDCQ - Dental Qormi",
    paymentChannels: ["EPOS Dental Qormi", "BOV", "Bank transfer", "Revolut", "Cheques"],
  },
  MPLUS: {
    label: "MPLUS - BluM",
    paymentChannels: ["EPOS BluM", "EPOSBLuM", "Cashlink", "BOV", "Bank transfer", "Revolut", "Cheques"],
  },
  PODO: {
    label: "PODO",
    paymentChannels: ["EPOS PODO", "BOV", "Bank transfer", "Revolut", "Cheques"],
  },
} as const;

const clinicOptions = {
  MDCZ: "MDCZ - Dental Zabbar",
  MDCQ: "MDCQ - Dental Qormi",
  MPLUS: "MPLUS - BluM",
  PODO: "PODO",
} as const;

const overrideReasons = [
  "Counted cash does not match prior closing",
  "Float corrected before opening",
  "Prior shift handover issue",
  "Cash movement pending review",
];

const paymentFieldMapping: Record<string, PaymentFieldConfig> = {
  "EPOS Dental Zabbar": { key: "eposDentalZabbar", label: "EPOS Dental Zabbar", icon: CreditCard },
  "EPOS Dental Qormi": { key: "eposDentalQormi", label: "EPOS Dental Qormi", icon: CreditCard },
  "EPOS PODO": { key: "eposPodo", label: "EPOS PODO", icon: CreditCard },
  "EPOS BluM": { key: "eposBluM", label: "EPOS BluM", icon: CreditCard },
  EPOSBLuM: { key: "eposBlum", label: "EPOSBLuM", icon: CreditCard },
  Cashlink: { key: "eposCashlink", label: "EPOS Cashlink", icon: CreditCard },
  BOV: { key: "bov", label: "BOV", icon: Landmark },
  "Bank transfer": { key: "bankTransfer", label: "Bank transfer", icon: Landmark },
  Revolut: { key: "revolut", label: "Revolut", icon: Wallet },
  Cheques: { key: "cheques", label: "Cheques received", icon: Receipt },
};

const fieldClass = "h-11 rounded-xl border-slate-200 bg-white/90 shadow-sm";

export default function EOSStartShiftOperationalMockup() {
  const now = new Date();
  const today = toDateInputValue(now);
  const currentDateTime = toDateTimeInputValue(now);
  const defaultReportStart = buildDateTimeValue(today, "08:00");

  const [department, setDepartment] = useState<keyof typeof departmentDefaults>("MDCZ");
  const [clinic, setClinic] = useState<keyof typeof clinicOptions>("MDCZ");
  const [shiftDate, setShiftDate] = useState(today);
  const [openingTimestamp, setOpeningTimestamp] = useState(currentDateTime);
  const [lastShiftClosingCash, setLastShiftClosingCash] = useState("245.00");
  const [openingCashMatches, setOpeningCashMatches] = useState(true);
  const [actualOpeningCash, setActualOpeningCash] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideNote, setOverrideNote] = useState("");
  const [openingSaved, setOpeningSaved] = useState(false);
  const [openingSavedAt, setOpeningSavedAt] = useState<string | null>(null);
  const [reportStart, setReportStart] = useState(defaultReportStart);
  const [reportEnd, setReportEnd] = useState(currentDateTime);
  const [reportLoaded, setReportLoaded] = useState(false);
  const [reportLoadedAt, setReportLoadedAt] = useState<string | null>(null);
  const [paymentValues, setPaymentValues] = useState<PaymentValues>({
    eposDentalZabbar: "420.00",
    eposDentalQormi: "0.00",
    eposPodo: "45.00",
    eposBluM: "120.00",
    eposBlum: "80.00",
    eposCashlink: "60.00",
    bov: "310.00",
    bankTransfer: "180.00",
    revolut: "95.00",
    cheques: "60.00",
    cashEnvelope: "120.00",
  });

  const reportTotals = {
    cashboxExpenses: 37.0,
    sellTotal: 335.0,
    feeTotal: 845.0,
  };

  const markOpeningDirty = () => {
    setOpeningSaved(false);
    setOpeningSavedAt(null);
    setReportLoaded(false);
    setReportLoadedAt(null);
  };

  const markReportDirty = () => {
    setReportLoaded(false);
    setReportLoadedAt(null);
  };

  const visiblePaymentFields = useMemo(
    () =>
      departmentDefaults[department].paymentChannels
        .map((name) => paymentFieldMapping[name])
        .filter((field): field is PaymentFieldConfig => Boolean(field)),
    [department]
  );

  const openingCashValue = openingCashMatches ? Number(lastShiftClosingCash || 0) : Number(actualOpeningCash || 0);
  const paymentTotal = useMemo(
    () => visiblePaymentFields.reduce((sum, field) => sum + Number(paymentValues[field.key] || 0), 0),
    [paymentValues, visiblePaymentFields]
  );

  const totals = useMemo(() => {
    const expected = reportTotals.sellTotal + reportTotals.feeTotal;
    const actual =
      openingCashValue + paymentTotal + Number(paymentValues.cashEnvelope || 0) - reportTotals.cashboxExpenses;
    const discrepancy = Number((actual - expected).toFixed(2));
    return { expected, actual, discrepancy };
  }, [openingCashValue, paymentTotal, paymentValues.cashEnvelope]);

  const openingOverrideValid = openingCashMatches || Boolean(actualOpeningCash.trim() && overrideReason.trim());
  const canSaveOpening = Boolean(
    department && clinic && shiftDate && openingTimestamp && lastShiftClosingCash.trim() && openingOverrideValid
  );
  const autoManagerAlert = !openingCashMatches || totals.discrepancy !== 0;
  const readyToSubmit = openingSaved && reportLoaded && !autoManagerAlert;

  const handleSaveOpeningDetails = () => {
    if (!canSaveOpening) return;
    // TODO: Replace UI-only state with persisted shift-session creation.
    setOpeningSaved(true);
    setOpeningSavedAt(new Date().toLocaleString("en-MT"));
  };

  const handleLoadReport = () => {
    if (!openingSaved) return;
    // TODO: Replace UI-only flag with real EOS report extraction and audited session persistence.
    setReportLoaded(true);
    setReportLoadedAt(new Date().toLocaleString("en-MT"));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-white to-slate-200 p-6 md:p-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="rounded-3xl border border-slate-200 bg-white/85 p-6 shadow-xl backdrop-blur"
        >
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge className="rounded-full px-3 py-1 text-sm">EOS</Badge>
                  <Badge variant="outline" className="rounded-full px-3 py-1 text-sm">
                    Operational Shift Flow
                  </Badge>
                </div>
                <h1 className="text-3xl font-bold tracking-tight text-slate-900">EOS Start of Shift</h1>
                <p className="mt-2 max-w-3xl text-sm text-slate-600">
                  Open the shift first, then load the EOS report, reconcile the cash position, review exceptions,
                  and prepare the final report submission.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <StatusBadge active={openingSaved} activeLabel="Opening Saved" inactiveLabel="Opening Not Saved" />
                <StatusBadge active={reportLoaded} activeLabel="Report Loaded" inactiveLabel="Report Not Loaded" />
                <StatusBadge
                  active={totals.discrepancy !== 0}
                  activeLabel="Discrepancy Found"
                  inactiveLabel="Balanced"
                  activeTone="rose"
                  inactiveTone="emerald"
                />
                <StatusBadge
                  active={readyToSubmit}
                  activeLabel="Ready to Submit"
                  inactiveLabel="Not Ready"
                  activeTone="emerald"
                  inactiveTone="slate"
                />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-5">
              <ContextBox icon={Building2} label="Workstation" value="ZABBAR-RECEPTION-01" />
              <ContextBox icon={Building2} label="Reception / Location" value="Zabbar Reception" />
              <ContextBox icon={User} label="Current User" value="Christian Gauci" />
              <ContextBox icon={Building2} label="Department" value={departmentDefaults[department].label} />
              <ContextBox icon={CalendarClock} label="Clinic" value={clinicOptions[clinic]} />
            </div>
          </div>
        </motion.div>

        <div className="grid gap-6">
          <SectionCard
            step="Step 1"
            title="Open Shift"
            description="Create the opening shift session and confirm the cash handover before EOS loading is allowed."
          >
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div className="space-y-2">
                <Label>Department</Label>
                <Select
                  value={department}
                  onValueChange={(value) => {
                    setDepartment(value as keyof typeof departmentDefaults);
                    markOpeningDirty();
                  }}
                >
                  <SelectTrigger className={fieldClass}>
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(departmentDefaults).map(([key, value]) => (
                      <SelectItem key={key} value={key}>
                        {value.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Clinic</Label>
                <Select
                  value={clinic}
                  onValueChange={(value) => {
                    setClinic(value as keyof typeof clinicOptions);
                    markOpeningDirty();
                  }}
                >
                  <SelectTrigger className={fieldClass}>
                    <SelectValue placeholder="Select clinic" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(clinicOptions).map(([key, value]) => (
                      <SelectItem key={key} value={key}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Shift date</Label>
                <Input
                  className={fieldClass}
                  type="date"
                  value={shiftDate}
                  onChange={(event) => {
                    setShiftDate(event.target.value);
                    markOpeningDirty();
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label>Opening timestamp</Label>
                <Input
                  className={fieldClass}
                  type="datetime-local"
                  value={openingTimestamp}
                  onChange={(event) => {
                    setOpeningTimestamp(event.target.value);
                    markOpeningDirty();
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label>Last shift closing cash</Label>
                <Input
                  className={fieldClass}
                  value={lastShiftClosingCash}
                  onChange={(event) => {
                    setLastShiftClosingCash(event.target.value);
                    markOpeningDirty();
                  }}
                />
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-sm font-medium text-slate-900">Opening cash matches previous closing cash</div>
                  <div className="text-xs text-slate-500">
                    If this does not match, the opening requires an override reason.
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-slate-600">{openingCashMatches ? "Yes" : "No"}</span>
                  <Switch
                    checked={openingCashMatches}
                    onCheckedChange={(checked) => {
                      setOpeningCashMatches(checked);
                      markOpeningDirty();
                    }}
                  />
                </div>
              </div>

              {!openingCashMatches && (
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Actual opening cash</Label>
                    <Input
                      className={fieldClass}
                      value={actualOpeningCash}
                      onChange={(event) => {
                        setActualOpeningCash(event.target.value);
                        markOpeningDirty();
                      }}
                      placeholder="Enter actual opening cash"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Override reason</Label>
                    <Select
                      value={overrideReason}
                      onValueChange={(value) => {
                        setOverrideReason(value);
                        markOpeningDirty();
                      }}
                    >
                      <SelectTrigger className={fieldClass}>
                        <SelectValue placeholder="Select override reason" />
                      </SelectTrigger>
                      <SelectContent>
                        {overrideReasons.map((reason) => (
                          <SelectItem key={reason} value={reason}>
                            {reason}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <Label>Optional note</Label>
                    <Textarea
                      className="min-h-[108px] rounded-2xl border-slate-200 bg-white/90 shadow-sm"
                      value={overrideNote}
                      onChange={(event) => {
                        setOverrideNote(event.target.value);
                        markOpeningDirty();
                      }}
                      placeholder="Add any opening note that should travel with the shift session."
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="text-sm text-slate-600">
                Saving opening details creates the shift session and unlocks EOS report loading.
                {openingSavedAt ? ` Last saved: ${openingSavedAt}.` : ""}
              </div>
              <Button className="h-11 rounded-xl shadow-md" disabled={!canSaveOpening} onClick={handleSaveOpeningDetails}>
                Save Opening Details
              </Button>
            </div>
          </SectionCard>

          <SectionCard
            step="Step 2"
            title="Load EOS Report"
            description="Load the EOS report window after the shift opening has been saved."
            disabled={!openingSaved}
          >
            <Alert className="border-slate-200 bg-slate-50">
              <AlertTitle className="text-sm font-semibold text-slate-900">Audited report timing</AlertTitle>
              <AlertDescription className="mt-1 text-sm leading-6 text-slate-700">
                EOS report start and EOS report end are expected to default from prior report logic and be audited if amended.
              </AlertDescription>
            </Alert>

            <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto]">
              <div className="space-y-2">
                <Label>EOS report start</Label>
                <Input
                  className={fieldClass}
                  type="datetime-local"
                  value={reportStart}
                  disabled={!openingSaved}
                  onChange={(event) => {
                    setReportStart(event.target.value);
                    markReportDirty();
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label>EOS report end</Label>
                <Input
                  className={fieldClass}
                  type="datetime-local"
                  value={reportEnd}
                  disabled={!openingSaved}
                  onChange={(event) => {
                    setReportEnd(event.target.value);
                    markReportDirty();
                  }}
                />
              </div>

              <div className="flex items-end">
                <Button
                  className="h-11 w-full rounded-xl px-5 shadow-md md:w-auto"
                  disabled={!openingSaved}
                  onClick={handleLoadReport}
                >
                  <ArrowDownToLine className="mr-2 h-4 w-4" /> Obtain Open Dental report
                </Button>
              </div>
            </div>

            <div className="text-sm text-slate-600">
              {openingSaved
                ? reportLoaded
                  ? `Report loaded for ${clinicOptions[clinic]}. Last loaded: ${reportLoadedAt}.`
                  : "Opening saved. Load the EOS report when the report window is ready."
                : "Save opening details first to enable EOS report loading."}
            </div>
          </SectionCard>

          <SectionCard
            step="Step 3"
            title="Reconciliation"
            description="Separate manual inputs, system totals, and final reconciliation so the discrepancy position stays clear."
          >
            <div className="grid gap-6 xl:grid-cols-3">
              <Card className="rounded-3xl border-slate-200 shadow-md">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <CreditCard className="h-5 w-5" /> Manual Inputs
                  </CardTitle>
                  <CardDescription>Payment channels remain filtered by the selected department.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4">
                    {visiblePaymentFields.map((field) => (
                      <MoneyField
                        key={field.key}
                        label={field.label}
                        value={paymentValues[field.key]}
                        onChange={(value) => setPaymentValues((previous) => ({ ...previous, [field.key]: value }))}
                        icon={field.icon}
                        className={fieldClass}
                      />
                    ))}
                    <MoneyField
                      label="Cash envelope"
                      value={paymentValues.cashEnvelope}
                      onChange={(value) => setPaymentValues((previous) => ({ ...previous, cashEnvelope: value }))}
                      icon={Wallet}
                      className={fieldClass}
                    />
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-3xl border-slate-200 shadow-md">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Clock3 className="h-5 w-5" /> System-derived Totals
                  </CardTitle>
                  <CardDescription>These values are treated as system totals in the reconciliation view.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <SummaryRow label="Cashbox expenses total" value={reportTotals.cashboxExpenses} />
                  <SummaryRow label="Sell total" value={reportTotals.sellTotal} />
                  <SummaryRow label="Fee total" value={reportTotals.feeTotal} />
                  <Separator />
                  <SummaryRow label="Opening cash used" value={openingCashValue} />
                </CardContent>
              </Card>

              <Card className="rounded-3xl border-slate-200 shadow-md">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    {totals.discrepancy === 0 ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                    ) : (
                      <ShieldAlert className="h-5 w-5 text-rose-600" />
                    )}
                    Final Reconciliation
                  </CardTitle>
                  <CardDescription>Discrepancy updates live as manual inputs change.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <SummaryRow label="Expected total" value={totals.expected} strong />
                  <SummaryRow
                    label="Actual total"
                    value={totals.actual}
                    strong
                    description="Opening cash + payment channels + cash envelope - cashbox expenses"
                  />
                  <SummaryRow
                    label="Discrepancy"
                    value={totals.discrepancy}
                    strong
                    danger={totals.discrepancy !== 0}
                  />
                </CardContent>
              </Card>
            </div>
          </SectionCard>

          <SectionCard
            step="Step 4"
            title="Exceptions"
            description="Keep exception handling separate from the main reconciliation totals."
          >
            <div className="grid gap-4 md:grid-cols-3">
              <ExceptionCard
                title="Carry-forward rows"
                body="Placeholder for excluded grouped-visit rows that should carry forward to the next shift."
                footer="0 rows currently flagged"
              />
              <ExceptionCard
                title="Missing walkout rows"
                body='Placeholder for grouped visits that may later show walkout exceptions such as "NO WALK OUT PRINTED".'
                footer="No live walkout integration yet"
              />
              <ExceptionCard
                title="Manager alert status"
                body={
                  autoManagerAlert
                    ? "Manager alert would be raised because an opening override exists or the reconciliation is not balanced."
                    : "No manager alert would be raised from the current opening and reconciliation state."
                }
                footer={autoManagerAlert ? "Alert status: flagged" : "Alert status: clear"}
                tone={autoManagerAlert ? "rose" : "emerald"}
              />
            </div>

            {/* TODO: Replace these placeholders with persisted exception panels once EOS report storage exists. */}
          </SectionCard>

          <SectionCard
            step="Step 5"
            title="Submit EOS"
            description="Save, submit, and lock the EOS report after the report has been reviewed."
          >
            <Alert className={readyToSubmit ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"}>
              <AlertTitle className="text-sm font-semibold text-slate-900">
                {readyToSubmit ? "EOS can proceed to submission" : "EOS is still awaiting completion"}
              </AlertTitle>
              <AlertDescription className="mt-1 text-sm leading-6 text-slate-700">
                {readyToSubmit
                  ? "Opening is saved, the report is loaded, and the current reconciliation is balanced."
                  : "Opening must be saved, the report must be loaded, and discrepancies should be reviewed before final submission."}
              </AlertDescription>
            </Alert>

            <div className="flex flex-col gap-3 md:flex-row">
              {/* TODO: Replace these UI-only actions with EOS draft persistence, submission, and lock endpoints. */}
              <Button variant="outline" className="h-11 rounded-xl" disabled={!openingSaved}>
                Save draft
              </Button>
              <Button className="h-11 rounded-xl shadow-md" disabled={!openingSaved || !reportLoaded}>
                Submit EOS
              </Button>
              <Button variant="outline" className="h-11 rounded-xl" disabled={!openingSaved || !reportLoaded}>
                Lock report
              </Button>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

type StatusBadgeProps = {
  active: boolean;
  activeLabel: string;
  inactiveLabel: string;
  activeTone?: "emerald" | "rose" | "blue" | "slate";
  inactiveTone?: "emerald" | "rose" | "blue" | "slate";
};

function StatusBadge({
  active,
  activeLabel,
  inactiveLabel,
  activeTone = "blue",
  inactiveTone = "slate",
}: StatusBadgeProps) {
  const tone = active ? activeTone : inactiveTone;
  const className =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "rose"
        ? "border-rose-200 bg-rose-50 text-rose-700"
        : tone === "blue"
          ? "border-blue-200 bg-blue-50 text-blue-700"
          : "border-slate-200 bg-slate-100 text-slate-700";

  return (
    <Badge variant="outline" className={`rounded-full px-3 py-1 text-sm ${className}`}>
      {active ? activeLabel : inactiveLabel}
    </Badge>
  );
}

type ContextBoxProps = {
  icon: IconComponent;
  label: string;
  value: string;
};

function ContextBox({ icon: Icon, label, value }: ContextBoxProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        <Icon className="h-4 w-4" /> {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-slate-900">{value}</div>
    </div>
  );
}

type SectionCardProps = {
  step: string;
  title: string;
  description: string;
  disabled?: boolean;
  children: React.ReactNode;
};

function SectionCard({ step, title, description, disabled = false, children }: SectionCardProps) {
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
      <Card className={`rounded-3xl border-slate-200 shadow-lg ${disabled ? "opacity-60" : ""}`}>
        <CardHeader>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="rounded-full px-3 py-1 text-xs uppercase tracking-wide">
              {step}
            </Badge>
            {disabled && (
              <Badge
                variant="outline"
                className="rounded-full border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-700"
              >
                Locked until prior step is saved
              </Badge>
            )}
          </div>
          <CardTitle className="text-xl text-slate-900">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">{children}</CardContent>
      </Card>
    </motion.div>
  );
}

type MoneyFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  icon?: IconComponent;
  className?: string;
};

function MoneyField({ label, value, onChange, icon: Icon = Wallet, className = "" }: MoneyFieldProps) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="relative">
        <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input className={`${className} pl-9`} value={value} onChange={(event) => onChange(event.target.value)} />
      </div>
    </div>
  );
}

type SummaryRowProps = {
  label: string;
  value: number;
  strong?: boolean;
  danger?: boolean;
  description?: string;
};

function SummaryRow({ label, value, strong = false, danger = false, description }: SummaryRowProps) {
  return (
    <div className="rounded-2xl border border-slate-100 px-3 py-2">
      <div className="flex items-center justify-between gap-4">
        <span className={`text-sm ${strong ? "font-semibold text-slate-900" : "text-slate-600"}`}>{label}</span>
        <span
          className={`text-sm ${
            danger ? "font-bold text-rose-600" : strong ? "font-bold text-slate-900" : "font-medium text-slate-700"
          }`}
        >
          {formatMoney(value)}
        </span>
      </div>
      {description && <div className="mt-1 text-xs text-slate-500">{description}</div>}
    </div>
  );
}

type ExceptionCardProps = {
  title: string;
  body: string;
  footer: string;
  tone?: "slate" | "rose" | "emerald";
};

function ExceptionCard({ title, body, footer, tone = "slate" }: ExceptionCardProps) {
  const toneClasses =
    tone === "rose"
      ? "border-rose-200 bg-rose-50"
      : tone === "emerald"
        ? "border-emerald-200 bg-emerald-50"
        : "border-slate-200 bg-slate-50";

  return (
    <div className={`rounded-3xl border p-5 shadow-sm ${toneClasses}`}>
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      <div className="mt-2 text-sm leading-6 text-slate-700">{body}</div>
      <div className="mt-4 text-xs font-medium uppercase tracking-wide text-slate-500">{footer}</div>
    </div>
  );
}
