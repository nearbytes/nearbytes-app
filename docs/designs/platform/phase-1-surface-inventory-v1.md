# Phase 1 Surface Inventory v1

## Purpose

Define the current shared UI surface inventory that Phase 1 must preserve from the same shared codebase on desktop and phone.

This document is the canonical answer to "what counts as the same UI?" for Phase 1. It intentionally describes a shared navigation inventory rather than assuming a URL-router-first application, because the current Nearbytes app is mount-centric and panel or dialog-driven.

## Interpretation Rules

- the current product term is `hub`; current code may still refer to `volume` or `mount`
- a shared surface is defined by the user-visible entry point and workflow, not by whether it currently lives behind a URL route, mount selection, side panel, or dialog
- a host missing runtime support still renders the same shared surface from the same shared source files; unsupported actions resolve through capability states inside that surface
- host-only system intake such as OS deep-link reception may differ by platform, but the destination product surface and workflow remain shared

## Current Navigation Baseline

The current app shell is state-driven rather than route-driven.

The primary navigation baseline is:

- hub selection in the shared workspace shell
- create and join entry points in that same shell
- active-hub workspace panes, side panels, and dialogs

Future URL routing is allowed, but it does not change the requirement that desktop and phone preserve the same shared navigation inventory and surface entry points.

## Shared Workspace Surfaces

The current shared workspace inventory that Phase 1 must preserve is:

- hub rail and active-hub selection shell
- files pane
- chat pane
- preview pane
- timeline panel
- join hub dialog
- share hub dialog
- identity manager
- create chooser
- sources and integrations panel
- storage location panel
- per-hub storage location dialog
- event flow inspection panel
- reset dialog

These surfaces define the minimum shared UI inventory that must exist on desktop and phone from the same shared source tree.

## Shared Settings And Integration Surfaces

Phase 1 shared UI also includes the settings and integration affordances that currently hang off the shell and side panels.

That shared inventory includes:

- identity selection and identity publication flows
- join-link parse, preview, and open flows
- source discovery and default-destination configuration surfaces
- storage location configuration surfaces
- LAN peer status and sync action surfaces
- provider-account, managed-share, and incoming-share status or action rows where those surfaces already exist in shared UI

Phone Phase 1 may leave some of these actions unsupported at runtime, but it may not remove the corresponding shared surfaces from the phone build.

## Desktop Legacy-Backed Runtime Actions

The following runtime-backed actions remain desktop-preservation obligations in Phase 1 even when phone support is deferred:

- provider account setup and session management
- managed-share and incoming-share runtime actions
- roots and storage-location management runtime actions
- directory chooser and reveal-in-file-manager actions
- updater state, install, and release-page actions
- deep-link system intake and handoff into the shared UI
- clipboard image helpers
- runtime log access
- desktop debug and automation hooks
- destructive local-data deletion during reset

These actions may stay host-backed on desktop. They do not justify removing or forking the shared UI surfaces that expose them.

## Phase 1 Gate Impact

Phase 1 is incomplete if any of the shared workspace, settings, or integration surfaces in this document are:

- absent from phone because runtime support is missing
- reimplemented through phone-only or desktop-only feature code
- downgraded into a different workflow owner outside the shared browser app-core for shared-surface semantics

This document defines the surface-presence baseline. `phase-1-capability-matrix-v1.md` defines how much runtime support each host provides for that same inventory.