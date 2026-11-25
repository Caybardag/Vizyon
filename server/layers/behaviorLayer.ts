import type { Locator, Page } from 'playwright-core';
import {
  generateBezierMouseTrajectory,
  generateNaturalScrollImpulses,
  generateTypingCadenceMs,
  type Point2D,
} from '../../src/lib/behaviorLayer';

/**
 * Moves the virtual pointer along an organic cubic Bézier curve with Fitts's-law
 * acceleration and micro-jitter instead of a linear teleportation jump.
 */
export async function humanMoveMouse(
  page: Page,
  from: Point2D,
  to: Point2D,
  seed: number
): Promise<Point2D> {
  const steps = generateBezierMouseTrajectory(from, to, seed);
  for (const step of steps) {
    await page.mouse.move(step.x, step.y).catch(() => undefined);
    if (step.delayMs > 0) {
      await page.waitForTimeout(step.delayMs).catch(() => undefined);
    }
  }
  return to;
}

/**
 * Scrolls with multi-impulse deceleration rather than constant pixel jumps.
 */
export async function humanScroll(
  page: Page,
  totalDeltaY: number,
  seed: number
): Promise<void> {
  const impulses = generateNaturalScrollImpulses(totalDeltaY, seed);
  for (const imp of impulses) {
    await page.mouse.wheel(0, imp.deltaY).catch(() => undefined);
    await page.waitForTimeout(imp.pauseMs).catch(() => undefined);
  }
}

/**
 * Approaches a visible element along a Bézier arc before clicking it.
 */
export async function humanClickLocator(
  page: Page,
  locator: Locator,
  lastCursor: Point2D,
  seed: number,
  timeoutMs = 4500
): Promise<Point2D> {
  const box = await locator.boundingBox({ timeout: 1500 }).catch(() => null);
  if (box && box.width > 4 && box.height > 4) {
    const offsetX = 0.35 + ((seed % 30) / 100);
    const offsetY = 0.35 + (((seed * 7) % 30) / 100);
    const target: Point2D = {
      x: Math.round(box.x + box.width * offsetX),
      y: Math.round(box.y + box.height * offsetY),
    };
    await humanMoveMouse(page, lastCursor, target, seed);
    await page.waitForTimeout(55 + (seed % 70)).catch(() => undefined);
    await page.mouse.down().catch(() => undefined);
    await page.waitForTimeout(40 + (seed % 45)).catch(() => undefined);
    await page.mouse.up().catch(() => undefined);
    return target;
  }

  await locator.click({ timeout: timeoutMs }).catch(() => undefined);
  return lastCursor;
}

export async function humanTypeText(
  page: Page,
  text: string,
  seed: number
): Promise<void> {
  const delays = generateTypingCadenceMs(text, seed);
  for (let i = 0; i < text.length; i++) {
    await page.keyboard.type(text[i]).catch(() => undefined);
    await page.waitForTimeout(delays[i] ?? 75).catch(() => undefined);
  }
}
