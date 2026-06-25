/**
 * Gamification Engine — XP, Streaks, Leaderboard
 * 
 * XP Values:
 *   - line_approved: 2 XP
 *   - line_corrected: 5 XP (corrections are harder)
 *   - page_completed: 50 XP bonus when all lines on a page are reviewed
 *   - streak_bonus: 10 XP per day of streak (awarded once per day)
 *   - daily_login: 5 XP (first activity of the day)
 * 
 * Levels: Fibonacci-ish progression
 *   Level 0 → 1: 100 XP
 *   Level 1 → 2: 200 XP (total: 300)
 *   Level 2 → 3: 400 XP (total: 700)
 *   Level 3 → 4: 700 XP (total: 1400)
 *   Level 4 → 5: 1200 XP (total: 2600)
 *   ...
 */

import { getDb } from "./db";
import { reviewActivities, userXpStats } from "../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";

// XP reward values
export const XP_VALUES = {
  line_approved: 2,
  line_corrected: 5,
  page_completed: 50,
  streak_bonus: 10, // per day of streak
  daily_login: 5,
} as const;

// Level thresholds (cumulative XP needed to reach each level)
const LEVEL_THRESHOLDS = [0, 100, 300, 700, 1400, 2600, 4500, 7500, 12000, 18500, 28000];

export function calculateLevel(totalXp: number): number {
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (totalXp >= LEVEL_THRESHOLDS[i]) return i;
  }
  return 0;
}

export function xpForNextLevel(currentLevel: number): number {
  if (currentLevel + 1 >= LEVEL_THRESHOLDS.length) return Infinity;
  return LEVEL_THRESHOLDS[currentLevel + 1];
}

export function xpProgressInLevel(totalXp: number, currentLevel: number): { current: number; needed: number } {
  const levelStart = LEVEL_THRESHOLDS[currentLevel] ?? 0;
  const levelEnd = LEVEL_THRESHOLDS[currentLevel + 1] ?? levelStart + 5000;
  return { current: totalXp - levelStart, needed: levelEnd - levelStart };
}

function getTodayStr(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function getYesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Award XP for a review activity and update user stats.
 * Returns the updated stats.
 */
export async function awardXp(params: {
  userId: number;
  projectId: number;
  documentId?: number;
  activityType: "line_approved" | "line_corrected" | "page_completed" | "streak_bonus" | "daily_login";
  metadata?: Record<string, unknown>;
}): Promise<{ xpEarned: number; totalXp: number; level: number; leveledUp: boolean; streak: number }> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const { userId, projectId, documentId, activityType, metadata } = params;
  const xpEarned = XP_VALUES[activityType];

  // Record the activity
  await db.insert(reviewActivities).values({
    userId,
    projectId,
    documentId: documentId ?? null,
    activityType,
    xpEarned,
    metadata: metadata ?? null,
  });

  // Get or create user stats
  const existing = await db
    .select()
    .from(userXpStats)
    .where(and(eq(userXpStats.userId, userId), eq(userXpStats.projectId, projectId)))
    .limit(1);

  const today = getTodayStr();
  const yesterday = getYesterdayStr();

  if (existing.length === 0) {
    // First activity ever — create stats
    const newTotalXp = xpEarned;
    const newLevel = calculateLevel(newTotalXp);
    await db.insert(userXpStats).values({
      userId,
      projectId,
      totalXp: newTotalXp,
      level: newLevel,
      linesReviewed: activityType === "line_approved" || activityType === "line_corrected" ? 1 : 0,
      correctionsMade: activityType === "line_corrected" ? 1 : 0,
      pagesCompleted: activityType === "page_completed" ? 1 : 0,
      currentStreak: 1,
      longestStreak: 1,
      lastActiveDate: today,
    });
    return { xpEarned, totalXp: newTotalXp, level: newLevel, leveledUp: newLevel > 0, streak: 1 };
  }

  const stats = existing[0];
  const oldLevel = stats.level;

  // Calculate streak
  let newStreak = stats.currentStreak;
  if (stats.lastActiveDate !== today) {
    // New day — check if streak continues
    if (stats.lastActiveDate === yesterday) {
      newStreak = stats.currentStreak + 1;
    } else {
      newStreak = 1; // streak broken
    }
  }

  const newTotalXp = stats.totalXp + xpEarned;
  const newLevel = calculateLevel(newTotalXp);
  const newLongest = Math.max(stats.longestStreak, newStreak);

  await db
    .update(userXpStats)
    .set({
      totalXp: newTotalXp,
      level: newLevel,
      linesReviewed: stats.linesReviewed + (activityType === "line_approved" || activityType === "line_corrected" ? 1 : 0),
      correctionsMade: stats.correctionsMade + (activityType === "line_corrected" ? 1 : 0),
      pagesCompleted: stats.pagesCompleted + (activityType === "page_completed" ? 1 : 0),
      currentStreak: newStreak,
      longestStreak: newLongest,
      lastActiveDate: today,
      updatedAt: new Date(),
    })
    .where(eq(userXpStats.id, stats.id));

  return {
    xpEarned,
    totalXp: newTotalXp,
    level: newLevel,
    leveledUp: newLevel > oldLevel,
    streak: newStreak,
  };
}

/**
 * Check if this is the user's first activity today (for daily login bonus).
 */
export async function isFirstActivityToday(userId: number, projectId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return true;

  const stats = await db
    .select({ lastActiveDate: userXpStats.lastActiveDate })
    .from(userXpStats)
    .where(and(eq(userXpStats.userId, userId), eq(userXpStats.projectId, projectId)))
    .limit(1);

  if (stats.length === 0) return true;
  return stats[0].lastActiveDate !== getTodayStr();
}

/**
 * Get user's XP stats for a project.
 */
export async function getUserStats(userId: number, projectId: number) {
  const db = await getDb();
  if (!db) return null;

  const stats = await db
    .select()
    .from(userXpStats)
    .where(and(eq(userXpStats.userId, userId), eq(userXpStats.projectId, projectId)))
    .limit(1);

  if (stats.length === 0) {
    return {
      totalXp: 0,
      level: 0,
      linesReviewed: 0,
      correctionsMade: 0,
      pagesCompleted: 0,
      currentStreak: 0,
      longestStreak: 0,
      lastActiveDate: null,
      progress: { current: 0, needed: 100 },
    };
  }

  const s = stats[0];
  const today = getTodayStr();
  const yesterday = getYesterdayStr();

  // Check if streak is still active (last active was today or yesterday)
  let activeStreak = s.currentStreak;
  if (s.lastActiveDate !== today && s.lastActiveDate !== yesterday) {
    activeStreak = 0; // streak has expired
  }

  return {
    totalXp: s.totalXp,
    level: s.level,
    linesReviewed: s.linesReviewed,
    correctionsMade: s.correctionsMade,
    pagesCompleted: s.pagesCompleted,
    currentStreak: activeStreak,
    longestStreak: s.longestStreak,
    lastActiveDate: s.lastActiveDate,
    progress: xpProgressInLevel(s.totalXp, s.level),
  };
}

/**
 * Get project leaderboard (top contributors by XP).
 */
export async function getLeaderboard(projectId: number, limit = 10) {
  const db = await getDb();
  if (!db) return [];

  const { users } = await import("../drizzle/schema");

  const results = await db
    .select({
      userId: userXpStats.userId,
      totalXp: userXpStats.totalXp,
      level: userXpStats.level,
      linesReviewed: userXpStats.linesReviewed,
      pagesCompleted: userXpStats.pagesCompleted,
      currentStreak: userXpStats.currentStreak,
      userName: users.name,
    })
    .from(userXpStats)
    .innerJoin(users, eq(users.id, userXpStats.userId))
    .where(eq(userXpStats.projectId, projectId))
    .orderBy(desc(userXpStats.totalXp))
    .limit(limit);

  return results.map((r, i) => ({
    rank: i + 1,
    userId: r.userId,
    name: r.userName ?? "Anonymous",
    totalXp: r.totalXp,
    level: r.level,
    linesReviewed: r.linesReviewed,
    pagesCompleted: r.pagesCompleted,
    currentStreak: r.currentStreak,
  }));
}

/**
 * Award streak bonus if applicable (call once per session start).
 */
export async function maybeAwardStreakBonus(userId: number, projectId: number): Promise<number> {
  const isFirst = await isFirstActivityToday(userId, projectId);
  if (!isFirst) return 0;

  // Award daily login
  const loginResult = await awardXp({ userId, projectId, activityType: "daily_login" });

  // If streak > 1, also award streak bonus
  if (loginResult.streak > 1) {
    const streakResult = await awardXp({
      userId,
      projectId,
      activityType: "streak_bonus",
      metadata: { streakDays: loginResult.streak },
    });
    return XP_VALUES.daily_login + XP_VALUES.streak_bonus;
  }

  return XP_VALUES.daily_login;
}
