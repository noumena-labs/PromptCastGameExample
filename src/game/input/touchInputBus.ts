/**
 * Touch input bus — a tiny module-level mailbox that lets the React DOM
 * overlay (`TouchControls`) push joystick / look-pad / button state into the
 * R3F render loop (`LocalWizard`) without forcing a re-render every frame.
 *
 * Design notes:
 *   - State is mutated in place; consumers read via `getTouchInput()` once
 *     per frame inside `useFrame`.
 *   - Look deltas accumulate across events and are drained on read so a
 *     fast swipe is never lost between frames.
 *   - The `lmb` / `jump` flags are edge-style: held while pressed, false on
 *     release (matches how the existing mouse / keyboard handlers work).
 *   - There is exactly one consumer (the wizard) and exactly one producer
 *     surface (the touch overlay), so a global module-level singleton is
 *     simpler than weaving a context through R3F.
 */

export type TouchInputState = {
  /** Joystick left/right axis, [-1, 1]. 0 when no touch. */
  moveX: number;
  /** Joystick forward/back axis, [-1, 1]. Positive = forward (up on stick). */
  moveY: number;
  /** Look-pad accumulated pixel delta since last drain — X. */
  lookDX: number;
  /** Look-pad accumulated pixel delta since last drain — Y. */
  lookDY: number;
  /** Jump button currently held. */
  jump: boolean;
  /** Magic-missile (LMB-equivalent) button currently held. */
  lmb: boolean;
  /** True when at least one touch surface is active (used to skip pointer-lock). */
  active: boolean;
  /**
   * Queued slot-cast request from the HUD's tappable runestones. Drained by
   * `LocalWizard`'s frame loop, which has the camera/world/colliders needed
   * to resolve aim geometry. -1 means "no pending request".
   */
  pendingSlot: number;
  /** Queued sanctuary-enter request from the HUD's tap button. */
  pendingSanctuary: boolean;
};

const state: TouchInputState = {
  moveX: 0,
  moveY: 0,
  lookDX: 0,
  lookDY: 0,
  jump: false,
  lmb: false,
  active: false,
  pendingSlot: -1,
  pendingSanctuary: false,
};

export function setTouchMove(x: number, y: number): void {
  state.moveX = clamp(x, -1, 1);
  state.moveY = clamp(y, -1, 1);
}

export function clearTouchMove(): void {
  state.moveX = 0;
  state.moveY = 0;
}

export function addTouchLookDelta(dx: number, dy: number): void {
  state.lookDX += dx;
  state.lookDY += dy;
}

export function setTouchJump(pressed: boolean): void {
  state.jump = pressed;
}

export function setTouchLmb(pressed: boolean): void {
  state.lmb = pressed;
}

export function setTouchActive(active: boolean): void {
  state.active = active;
}

/**
 * Read-only snapshot. NOT a copy — callers must not mutate. Look deltas are
 * NOT drained here; use `drainTouchLook()` once per frame for that.
 */
export function getTouchInput(): Readonly<TouchInputState> {
  return state;
}

/**
 * Pull and zero the accumulated look deltas. Call once per frame.
 */
export function drainTouchLook(): { dx: number; dy: number } {
  const dx = state.lookDX;
  const dy = state.lookDY;
  state.lookDX = 0;
  state.lookDY = 0;
  return { dx, dy };
}

/**
 * Queue a slot cast (0..3) for the next frame. The HUD calls this when the
 * player taps a runestone; the wizard's frame loop drains the request via
 * `drainPendingSlotCast()` and runs the same aim-resolution / cast pipeline
 * the keyboard `Digit1`–`Digit4` handlers use.
 */
export function queueTouchSlotCast(slot: number): void {
  if (slot < 0 || slot > 3) return;
  state.pendingSlot = slot;
}

export function drainPendingSlotCast(): number {
  const slot = state.pendingSlot;
  state.pendingSlot = -1;
  return slot;
}

/**
 * Queue a Sanctuary-enter request for the next frame. Mirrors the keyboard
 * `KeyE` handler.
 */
export function queueTouchSanctuary(): void {
  state.pendingSanctuary = true;
}

export function drainPendingSanctuary(): boolean {
  const pending = state.pendingSanctuary;
  state.pendingSanctuary = false;
  return pending;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
