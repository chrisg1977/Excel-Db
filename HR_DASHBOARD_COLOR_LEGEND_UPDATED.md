## 🎨 **UPDATED COLOR CODING LEGEND - HR DASHBOARD**

**Updated:** 2026-02-19  
**Changes:** Separated Trainee Dental Assistant from Receptionist + Added Housekeeping & Maintenance categories

---

## **Position Categories & Colors**

| Color | Hex Code | Category | Count | Examples |
|-------|----------|----------|-------|----------|
| 🔵 Blue | #2E5090 | **DENTIST** | 11 | 2. Dental Surgeon, 5. Dental Hygenist |
| 🟠 Orange | #D97C3A | **RECEPTIONIST/TRAINEE** | 2 | 9. Receptionist, Trainee Receptionist |
| 🟣 Purple | #5B4D82 | **ASSISTANT** | 11 | 7. Sup. Dental Assistant, 8. Dental Assistant, **10. Trainee Dental Assistant** |
| 🟢 Green | #2D8659 | **MANAGER** | 2 | 4. CLINICAL Manager, 3. OFFICE Manager |
| 🟤 Brown | #8B7355 | **MAINTENANCE** | 1 | 13. Maintenance (e.g., Ramkrishna/2025003) |
| 🟣 Mauve | #C47ACC | **HOUSEKEEPING** | 0 | *Ready for future employees* |
| ⚪ Gray | #808080 | **OTHER** | 1 | Principal, etc. |

---

## **Key Changes**

### ✅ **Trainee Separation**
- ✅ **"Trainee Dental Assistant"** now → **ASSISTANT category** (Purple)
- ✅ **"Trainee Receptionist"** stays → **RECEPTIONIST_TRAINEE category** (Orange)

**Why?** Trainees can be in different departments. Their base category determines their color.

### ✅ **New Categories Added**
- ✅ **MAINTENANCE** (Brown #8B7355) - Currently 1 employee (Ramkrishna Acharya)
- ✅ **HOUSEKEEPING** (Mauve #C47ACC) - Reserved for future employees

---

## **Filter Options Available**

### **Designation Filter** (4 Active + 2 Future)
```
Active Categories:
├─ DENTIST (11 employees) - Blue
├─ ASSISTANT (11 employees) - Purple
├─ Manager (2 employees) - Green
├─ Receptionist/Trainee (2 employees) - Orange
├─ Maintenance (1 employee) - Brown
└─ Other (1 employee) - Gray

Future Categories:
└─ Housekeeping (0 employees) - Mauve [Ready]
```

### **Combined with Other Filters**

Example: "Show me all CURRENT FT Maltese ASSISTANTS"
```
Status: CURRENT (27 total)
↓
Employment Type: FT (16 total)
↓
Nationality: MALTESE (18 total)
↓
Designation: ASSISTANT (11 total)
=
Result: ~5-6 employees matching all criteria (Purple rows)
```

---

## **Dashboard Employee Distribution**

### **By Designation** (6 categories)
```
DENTIST ............... 11 employees (Blue) 🔵
ASSISTANT ............. 11 employees (Purple) 🟣
Manager ............... 2 employees (Green) 🟢
Receptionist/Trainee .. 2 employees (Orange) 🟠
Maintenance ........... 1 employee (Brown) 🟤
Other ................. 1 employee (Gray) ⚪
────────────────────────────────────
TOTAL ................. 28 employees
```

### **By Status** (2 categories)
```
CURRENT ............... 27 employees (Active now)
PROSPECTIVE ........... 1 employee (Future start date)
```

### **By Employment Type** (3 categories)
```
FT (including FT_RED) .. 16 employees
PT (including PT_CASUAL) 5 employees
Self_Employed ......... 6 employees
(1 without type assigned)
```

### **By Nationality** (3 categories)
```
MALTESE ............... 18 employees
OTHER ................. 7 employees
EU .................... 3 employees
```

---

## **Ready for Implementation**

- ✅ Database views updated
- ✅ Colors properly assigned
- ✅ Filter counts accurate
- ✅ Trainee categories separated
- ✅ Maintenance & Housekeeping categories ready

**Next Step:** Enable `vw_hr_employee_dashboard` in Directus Data Model to see the new categorization!

