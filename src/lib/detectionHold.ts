// A detected target can flicker: MindAR fires onTargetLost the instant
// tracking wobbles, which flashed the control panel away before the user
// could read or tap it. Keep each detection on screen for at least
// MIN_HOLD_MS from the moment it first appears. A different target
// replaces the held one immediately; re-finding the same target does not
// restart the clock, and a manual close clears the hold.
export const MIN_HOLD_MS = 1000;

export class DetectionHold {
  private index: number | null = null;
  private shownAt: number | null = null;

  // A target was found. Returns the index to show.
  found(index: number, now = Date.now()): number {
    if (this.index !== index) {
      this.index = index;
      this.shownAt = now;
    }
    return index;
  }

  // A target was lost. Returns how many ms to wait before clearing the
  // panel: 0 means the minimum hold already passed, null means nothing is
  // showing or a different target is showing.
  lost(index: number, now = Date.now()): number | null {
    if (this.index === null || this.index !== index || this.shownAt === null) return null;
    return Math.max(0, MIN_HOLD_MS - (now - this.shownAt));
  }

  // Forget the current detection (manual close, unmount, target list change).
  clear(): void {
    this.index = null;
    this.shownAt = null;
  }
}
