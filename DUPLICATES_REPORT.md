# OpenDental Payroll Mapping — Duplicates Report

## Summary

**Main Payroll Employees:** 21 total | **3 PayrollID duplicates** (multiple UserNum mapping same PayrollID)
**Provider Payroll:** 14 total | **1 provider_id duplicate** (multiple UserNum mapping same provider_id)

---

## Main Payroll Duplicates

### Duplicate 1: PayrollID `2026003` (Katrina Bonavia)
- **EmployeeNum:** 25
- **UserNum 48:** `zzzKatrina`
- **UserNum 27:** `Katrina B`

**Issue:** Same employee, possibly two OpenDental accounts or stale duplicate.

**Action Required:** 
- Keep the primary UserNum (recommend 27 based on naming).
- Deactivate or merge the duplicate in OpenDental.

---

### Duplicate 2: PayrollID `2024005` (Andreya Gauci)
- **EmployeeNum:** 49
- **UserNum 39:** `Andreya Gauci`
- **UserNum 49:** `zzzAndreya`
- **UserNum 18:** `9Mariah HYG` ⚠️ **NAME MISMATCH**

**Issue:** Three UserNum all mapping to same PayrollID, but UserNum 18 has completely different name (Mariah HYG).

**Action Required:**
- Keep UserNum 49 (primary based on naming convention).
- UserNum 18 is likely a shared account or data error—verify manually.
- Deactivate others.

---

### Duplicate 3: PayrollID `2023007` (Aisha Haneena)
- **EmployeeNum:** 34
- **UserNum 38:** `Aisha`
- **UserNum 50:** `zzzAishathul` ⚠️ **DIFFERENT FIRST NAME**

**Issue:** Two UserNum with different first names (Aisha vs Aishathul).

**Action Required:**
- Keep UserNum 38 (Aisha, primary).
- UserNum 50 appears to be a duplicate account—verify and deactivate.

---

## Provider Payroll Duplicates

### Duplicate: provider_id `2025008` (Ryan Camilleri)
- **ProvNum:** (not shown in query; likely same)
- **UserNum 52:** `7Ryan`
- **UserNum 51:** `7 Ryan`

**Issue:** Minimal difference (space in UserName); likely duplicate account.

**Action Required:**
- Keep UserNum 52 (primary).
- Deactivate UserNum 51.

---

## Recommendations

1. **Create a cleanup query** in OpenDental to identify which UserNum should be the "primary" per PayrollID/CustomID.
2. **Deactivate secondary accounts** to prevent timesheet confusion.
3. **Update `od_payroll_mapping_seed.sql`** to keep only primary mappings once you confirm.

### Query to Find All Duplicates (Updated)

```sql
-- Main Payroll Duplicates
SELECT 
    PayrollID,
    COUNT(DISTINCT UserNum) AS user_count,
    STRING_AGG(DISTINCT u.UserName, ', ') AS user_names
FROM employee e
JOIN userod u ON u.EmployeeNum = e.EmployeeNum
WHERE e.IsHidden = 0 AND e.PayrollID IS NOT NULL AND TRIM(e.PayrollID) <> ''
GROUP BY PayrollID
HAVING COUNT(DISTINCT UserNum) > 1;

-- Provider Duplicates
SELECT 
    CustomID,
    COUNT(DISTINCT UserNum) AS user_count,
    STRING_AGG(DISTINCT u.UserName, ', ') AS user_names
FROM provider p
JOIN userod u ON u.ProvNum = p.ProvNum
WHERE p.IsHidden = 0 AND p.CustomID IS NOT NULL AND TRIM(p.CustomID) <> ''
GROUP BY CustomID
HAVING COUNT(DISTINCT UserNum) > 1;
```

---

## Resolution Status

✅ **Marked Removed (IsHidden=1 in OpenDental):**
- UserNum 51 (7 Ryan, ProvNum 29) — hidden account, duplicate of UserNum 52

**Remaining Duplicates for Manual Verification:**
- PayrollID 2026003 (Katrina Bonavia) — UserNum 27 vs 48
- PayrollID 2024005 (Andreya Gauci) — UserNum 18, 39, 49
- PayrollID 2023007 (Aisha Haneena) — UserNum 38 vs 50
