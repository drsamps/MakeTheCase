# Position Tracking UI State Note (2026-02-23)

## Issue
In the assignment UI, "Enable position tracking" could appear checked even when `section_cases.position_tracking_enabled` was actually `0` in the database.

## Root Cause
`components/Dashboard.tsx` auto-forced `position_tracking_enabled` to `true` when positions existed for assigned scenarios, instead of reflecting the persisted DB value.

## Impact
Instructors believed tracking was enabled, but student chat behavior followed DB state and correctly hid initial position buttons.

## Fix
- Dashboard now reads `position_tracking_enabled` and `track_position_change` using normalized flag parsing.
- Dashboard no longer auto-enables tracking based on "positions exist".
- Student chat logic continues to gate on real assignment settings.

## Guardrail
For assignment settings UI, always display persisted values exactly as stored. Do not derive toggle state from related data presence.
