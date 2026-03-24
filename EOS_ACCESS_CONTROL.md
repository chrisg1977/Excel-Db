# EOS Access Control

## Purpose

This note defines the first role-level access model for EOS operational use, historical retrieval, and month-end period control.

## Roles

### Reception / Operational User

Can:
- create shift sessions
- generate current EOS reports
- submit current EOS reports
- resume their own active EOS for the same location
- use Emergency Handover Mode when manager is unavailable, with mandatory reason/notes and pending manager review

Cannot:
- lock EOS reports
- retrieve historical saved EOS reports
- close accounting periods
- take over another user's active EOS in the same location
- bypass, abandon, or supersede another user's unresolved EOS shift

### Supervisor

Can:
- create shift sessions
- generate current EOS reports
- submit current EOS reports
- lock EOS reports
- resume their own active EOS for the same location
- use Emergency Handover Mode when manager is unavailable, with pending manager review

Cannot:
- close accounting periods
- take over another user's active EOS in the same location unless business later classifies supervisors as management-or-higher
- abandon or supersede another user's unresolved EOS shift unless business later classifies supervisors as management-or-higher

Historical retrieval:
- optional by business decision
- default recommendation: no broad historical access unless explicitly approved

### Management

Can:
- create shift sessions
- generate current EOS reports
- submit EOS reports
- lock EOS reports
- retrieve historical saved EOS reports
- close accounting periods
- explicitly take over another user's active EOS in the same location with a required reason and audit trail
- mark another user's unresolved EOS shift as abandoned with a required reason and audit trail
- supersede another user's unresolved EOS shift, start a new one, and keep the old/new shift link with audit
- review and resolve emergency handover closures

### Admin

Can:
- perform all EOS actions
- manage exception cases, recovery, and support tasks
- explicitly take over another user's active EOS in the same location with audit
- mark unresolved EOS shifts abandoned with audit
- supersede unresolved EOS shifts with audit
- review and resolve emergency handover closures

## Capability Matrix

| Action | Reception / Operational | Supervisor | Management | Admin |
|---|---|---|---|---|
| Create shift sessions | Yes | Yes | Yes | Yes |
| Resume own active EOS in same location | Yes | Yes | Yes | Yes |
| Use Emergency Handover Mode when manager unavailable | Yes, exception only | Yes, exception only | Yes | Yes |
| Generate EOS reports | Yes | Yes | Yes | Yes |
| Submit EOS reports | Yes | Yes | Yes | Yes |
| Lock EOS reports | No | Yes | Yes | Yes |
| Take over another user's active EOS in same location | No | No by default | Yes | Yes |
| Mark another user's unresolved EOS abandoned | No | No by default | Yes | Yes |
| Supersede another user's unresolved EOS and start a new one | No | No by default | Yes | Yes |
| Review emergency handover closures | No | No by default | Yes | Yes |
| Retrieve historical EOS reports | No | Optional / restricted | Yes | Yes |
| Close accounting periods | No | No | Yes | Yes |

## Notes

- EOS concurrency is location-based: multiple active EOS sessions may exist in different locations, but only one active open EOS session may exist per `location_code`.
- The active EOS is owned by the user who created it until an audited manager/admin takeover occurs.
- If a previous shift in the same location is still unresolved, operational users must not open a blind replacement shift.
- Emergency Handover Mode is the only operational-user exception when manager is unavailable; it creates a temporary closure pending manager review, not a normal EOS close.
- Same-level different-user access to an already-open EOS for the same location should be blocked, not shared.
- Manager takeover must require a reason and should present the visible UI label `Amending EOS of [USER]`.
- Manager-only unresolved-shift options are: resume with takeover, mark abandoned, or supersede and start a new shift. Each path must be audited.
- Emergency handover values must clearly separate temporary previous-shift closure values from new-shift starting values.
- Historical retrieval should stay separate from the operational EOS screen.
- Closed accounting periods are read-only.
- Final enforcement should align to the app-wide identity and role model once the user source is finalized.
