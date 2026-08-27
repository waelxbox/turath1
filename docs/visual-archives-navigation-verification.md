# Visual Archives Projects Navigation Verification

The Visual Workspace is mounted inside a project-scoped router. Its former `Link` target of `/dashboard` was therefore resolved relative to the project route as `/projects/{id}/dashboard`, which does not exist.

The control now uses a standard absolute anchor to `/dashboard`, allowing it to leave the project-scoped router. In the authenticated staging preview, clicking **Projects** from the `Testing` Visual Archives workspace navigated successfully to `/dashboard`. A short-lived owner-only staging session was used solely for this verification and will be cleared immediately afterward.
