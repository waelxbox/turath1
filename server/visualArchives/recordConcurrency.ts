export class VraRevisionConflictError extends Error {
  readonly currentRevision: number;

  constructor(currentRevision: number) {
    super("This record changed in another session. Reload it before saving so newer reviewed data is not overwritten.");
    this.name = "VraRevisionConflictError";
    this.currentRevision = currentRevision;
  }
}
