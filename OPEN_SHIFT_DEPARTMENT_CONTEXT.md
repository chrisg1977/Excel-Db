# Open Shift Department Context

## Purpose

This note explains how Open Shift determines department context while the page itself remains location-driven.

## Current State

- Open Shift is location-driven.
- Manager routing and discrepancy preview are department-driven.

## Short-Term Rule

- Zabbar defaults to `MDCZ`
- Qormi defaults to `MDCQ`
- this is temporary until AppHub or the active business workflow passes richer department context into Open Shift

## Medium-Term Rule

- department context should come from the active business workflow or AppHub entry point
- Open Shift should consume that context rather than infer it only from reception location

## Long-Term Rule

- support explicit department context for shared receptions that handle multiple departments
- Open Shift should be able to resolve the exact department being opened, even when one reception supports more than one department or business unit
