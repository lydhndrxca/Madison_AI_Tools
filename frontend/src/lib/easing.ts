/**
 * Easing and interpolation utilities.
 * Adapted from Robert Penner's easing equations.
 * All easing functions take t in [0,1] and return a value in [0,1]
 * (elastic/back may overshoot slightly).
 */

export function easeLinear(t: number) { return t; }

export function easeInQuad(t: number) { return t * t; }
export function easeOutQuad(t: number) { return t * (2 - t); }
export function easeInOutQuad(t: number) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }

export function easeInCubic(t: number) { return t * t * t; }
export function easeOutCubic(t: number) { return (--t) * t * t + 1; }
export function easeInOutCubic(t: number) { return t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1; }

export function easeInQuart(t: number) { return t * t * t * t; }
export function easeOutQuart(t: number) { return 1 - (--t) * t * t * t; }
export function easeInOutQuart(t: number) { return t < 0.5 ? 8 * t * t * t * t : 1 - 8 * (--t) * t * t * t; }

export function easeInSine(t: number) { return 1 - Math.cos((t * Math.PI) / 2); }
export function easeOutSine(t: number) { return Math.sin((t * Math.PI) / 2); }
export function easeInOutSine(t: number) { return -(Math.cos(Math.PI * t) - 1) / 2; }

export function easeInExpo(t: number) { return t === 0 ? 0 : Math.pow(2, 10 * (t - 1)); }
export function easeOutExpo(t: number) { return t === 1 ? 1 : 1 - Math.pow(2, -10 * t); }
export function easeInOutExpo(t: number) {
  if (t === 0 || t === 1) return t;
  return t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2;
}

export function easeOutBack(t: number, s = 1.70158) { return (--t) * t * ((s + 1) * t + s) + 1; }

export function easeOutElastic(t: number) {
  if (t === 0 || t === 1) return t;
  return Math.pow(2, -10 * t) * Math.sin((t - 0.075) * (2 * Math.PI) / 0.3) + 1;
}

export function easeOutBounce(t: number) {
  if (t < 1 / 2.75) return 7.5625 * t * t;
  if (t < 2 / 2.75) return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75;
  if (t < 2.5 / 2.75) return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375;
  return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375;
}

/** Scalar lerp */
export function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

/** Clamp value to [min, max] */
export function clamp(v: number, min: number, max: number) { return Math.min(max, Math.max(min, v)); }

/**
 * Exponential decay smoothing (frame-rate independent).
 * Great for smooth-following cameras and cursors.
 * `halflife` is in seconds -- how long it takes to close half the gap.
 */
export function expDecay(current: number, target: number, halflife: number, dt: number) {
  return target + (current - target) * Math.pow(2, -dt / halflife);
}
