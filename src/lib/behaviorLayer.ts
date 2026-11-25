export interface Point2D {
  x: number;
  y: number;
}

export interface MouseTrajectoryStep {
  x: number;
  y: number;
  delayMs: number;
}

export interface ScrollImpulse {
  deltaY: number;
  pauseMs: number;
}

function seededPrng(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * Generates an organic cubic Bézier mouse path with Fitts's-law ease-in/ease-out
 * timing and subtle neuromuscular micro-jitter rather than linear teleportation.
 */
export function generateBezierMouseTrajectory(
  start: Point2D,
  end: Point2D,
  seed = 1,
  stepsCount?: number
): MouseTrajectoryStep[] {
  const rand = seededPrng(seed);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dist = Math.hypot(dx, dy);

  if (dist < 2) {
    return [{ x: Math.round(end.x), y: Math.round(end.y), delayMs: 25 }];
  }

  const steps = stepsCount ?? Math.max(10, Math.min(28, Math.round(dist / 24)));
  const perpX = -dy / dist;
  const perpY = dx / dist;

  const arcSign = rand() > 0.5 ? 1 : -1;
  const arcMagnitude = Math.min(95, Math.max(14, dist * (0.12 + rand() * 0.16))) * arcSign;

  const cp1: Point2D = {
    x: start.x + dx * (0.24 + rand() * 0.14) + perpX * arcMagnitude * (0.6 + rand() * 0.5),
    y: start.y + dy * (0.24 + rand() * 0.14) + perpY * arcMagnitude * (0.6 + rand() * 0.5),
  };

  const cp2: Point2D = {
    x: start.x + dx * (0.68 + rand() * 0.14) + perpX * arcMagnitude * (0.2 + rand() * 0.4),
    y: start.y + dy * (0.68 + rand() * 0.14) + perpY * arcMagnitude * (0.2 + rand() * 0.4),
  };

  const trajectory: MouseTrajectoryStep[] = [];
  for (let i = 1; i <= steps; i++) {
    const linearT = i / steps;
    // Ease-in-out cubic progression (slow start, brisk mid-flight, precision settle)
    const t =
      linearT < 0.5
        ? 4 * linearT * linearT * linearT
        : 1 - Math.pow(-2 * linearT + 2, 3) / 2;

    const u = 1 - t;
    const bx =
      u * u * u * start.x +
      3 * u * u * t * cp1.x +
      3 * u * t * t * cp2.x +
      t * t * t * end.x;
    const by =
      u * u * u * start.y +
      3 * u * u * t * cp1.y +
      3 * u * t * t * cp2.y +
      t * t * t * end.y;

    const isFinal = i === steps;
    const jitter = isFinal ? 0 : (rand() - 0.5) * 2.4;
    const delayMs = isFinal
      ? Math.round(28 + rand() * 35)
      : Math.round(9 + Math.abs(linearT - 0.5) * 24 + rand() * 11);

    trajectory.push({
      x: Math.round(bx + jitter),
      y: Math.round(by - jitter * 0.6),
      delayMs,
    });
  }

  return trajectory;
}

/**
 * Splits a scroll distance into natural wheel impulses with deceleration & reading pauses.
 */
export function generateNaturalScrollImpulses(
  totalDeltaY: number,
  seed = 1
): ScrollImpulse[] {
  const rand = seededPrng(seed);
  const absTotal = Math.abs(totalDeltaY);
  if (absTotal < 20) {
    return [{ deltaY: Math.round(totalDeltaY), pauseMs: 120 }];
  }

  const sign = totalDeltaY >= 0 ? 1 : -1;
  const segments = Math.max(3, Math.min(7, Math.round(absTotal / 85)));
  const rawWeights = Array.from({ length: segments }, (_v, idx) => {
    const midBias = 1 - Math.abs(idx / Math.max(1, segments - 1) - 0.45);
    return 0.6 + midBias + rand() * 0.5;
  });
  const weightSum = rawWeights.reduce((a, b) => a + b, 0);

  let remaining = absTotal;
  const impulses: ScrollImpulse[] = [];
  for (let i = 0; i < segments; i++) {
    const share =
      i === segments - 1
        ? remaining
        : Math.max(18, Math.round((rawWeights[i] / weightSum) * absTotal));
    remaining = Math.max(0, remaining - share);
    impulses.push({
      deltaY: sign * share,
      pauseMs: Math.round(65 + rand() * 145),
    });
  }
  return impulses;
}

/**
 * Generates variable inter-key delays for human-like typing cadence.
 */
export function generateTypingCadenceMs(text: string, seed = 1): number[] {
  const rand = seededPrng(seed);
  const delays: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    let base = 48 + rand() * 68;
    if (ch === ' ') base += 35 + rand() * 55;
    if (i > 0 && i % 7 === 0 && rand() > 0.65) {
      base += 110 + rand() * 120; // brief cognitive pause
    }
    delays.push(Math.round(base));
  }
  return delays;
}
