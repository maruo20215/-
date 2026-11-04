export type RateTier = 
  | 'C-' | 'C' | 'C+'
  | 'B-' | 'B' | 'B+'
  | 'A-' | 'A' | 'A+'
  | 'S' | 'S+' | 'X';

export const RATE_TIER_ORDER: RateTier[] = [
  'C-', 'C', 'C+',
  'B-', 'B', 'B+',
  'A-', 'A', 'A+',
  'S', 'S+', 'X'
];

export interface UserProfile {
  rank: number;
  rankExp: number;
  rateTier: RateTier;
  ratePoints: number;
  matches: number;
  wins: number;
}

export interface MatchRewardResult {
  isWin: boolean;
  modeTarget: number;
  isOnline: boolean;
  isPractice: boolean;
  rankBefore: number;
  rankExpBefore: number;
  rankAfter: number;
  rankExpAfter: number;
  rankPointsGained: number;
  rankUpCount: number;
  rateTierBefore: RateTier;
  ratePointsBefore: number;
  rateTierAfter: RateTier;
  ratePointsAfter: number;
  rateDelta: number; // 0 if online or practice
  promoted: boolean;
  demoted: boolean;
}

const STORAGE_KEY = 'taiko_user_profile_v1';
const PRACTICE_MODE_KEY = 'taiko_practice_mode_active';

const DEFAULT_PROFILE: UserProfile = {
  rank: 1,
  rankExp: 0,
  rateTier: 'C-',
  ratePoints: 0,
  matches: 0,
  wins: 0
};

export function getUserProfile(): UserProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PROFILE };
    const parsed = JSON.parse(raw);
    return {
      rank: typeof parsed.rank === 'number' ? Math.max(1, Math.min(30, parsed.rank)) : 1,
      rankExp: typeof parsed.rankExp === 'number' ? Math.max(0, parsed.rankExp) : 0,
      rateTier: RATE_TIER_ORDER.includes(parsed.rateTier) ? parsed.rateTier : 'C-',
      ratePoints: typeof parsed.ratePoints === 'number' ? Math.max(0, parsed.ratePoints) : 0,
      matches: typeof parsed.matches === 'number' ? parsed.matches : 0,
      wins: typeof parsed.wins === 'number' ? parsed.wins : 0
    };
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

export function saveUserProfile(profile: UserProfile): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // ignore
  }
}

/**
 * ランク上昇に必要なポイント計算: 初項3, 公差2の等差数列
 * ランク1 -> 2: 3 pt
 * ランク2 -> 3: 5 pt
 * ランク R -> R+1: 2R + 1 pt
 */
export function getExpNeededForRank(rank: number): number {
  if (rank >= 30) return Infinity;
  return 2 * rank + 1;
}

/**
 * モード別ランクポイント獲得量:
 * かんたん(10000): 勝利+4, 敗北+1
 * ふつう(15000): 勝利+6, 敗北+2
 * むずかしい(20000): 勝利+8, 敗北+3
 */
export function getRankPointsGain(isWin: boolean, modeTarget: number): number {
  if (modeTarget <= 10000) {
    return isWin ? 4 : 1;
  } else if (modeTarget <= 15000) {
    return isWin ? 6 : 2;
  } else {
    return isWin ? 8 : 3;
  }
}

/**
 * モード別・レート帯別レート変動計算:
 * ふつう(15000)を基準とし:
 * C帯 (C-, C, C+): +30 / -15
 * B帯 (B-, B, B+): +20 / -12
 * A帯 (A-, A, A+): +15 / -9
 * S: +10 / -7
 * S+: +7 / -7
 * X: +3 / -5 (上限無制限)
 *
 * かんたん(10000): × 2/3
 * むずかしい(20000): × 4/3
 * 小数は第一位で四捨五入 (Math.round)
 */
export function getRatePointsChange(tier: RateTier, isWin: boolean, modeTarget: number): number {
  let baseWin = 0;
  let baseLoss = 0;

  if (tier.startsWith('C')) {
    baseWin = 30;
    baseLoss = -15;
  } else if (tier.startsWith('B')) {
    baseWin = 20;
    baseLoss = -12;
  } else if (tier.startsWith('A')) {
    baseWin = 15;
    baseLoss = -9;
  } else if (tier === 'S') {
    baseWin = 10;
    baseLoss = -7;
  } else if (tier === 'S+') {
    baseWin = 7;
    baseLoss = -7;
  } else if (tier === 'X') {
    baseWin = 3;
    baseLoss = -5;
  }

  const base = isWin ? baseWin : baseLoss;
  let mult = 1.0;
  if (modeTarget <= 10000) {
    mult = 2 / 3;
  } else if (modeTarget >= 20000) {
    mult = 4 / 3;
  }

  return Math.round(base * mult);
}

/**
 * 試合結果の適用:
 * - ランク: CPU戦・オンライン戦ともにポイント加算
 * - レート: CPU戦のみ変動
 *   - pointが100を超えると次の帯の30からスタート
 *   - pointが0を下回ると一つ下の帯の70に落ちる
 *   - X帯は上限無制限
 */
export function getIsPracticeMode(): boolean {
  try {
    return localStorage.getItem(PRACTICE_MODE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setIsPracticeMode(enabled: boolean): void {
  try {
    localStorage.setItem(PRACTICE_MODE_KEY, enabled ? 'true' : 'false');
  } catch {
    // ignore
  }
}

export function togglePracticeMode(): boolean {
  const next = !getIsPracticeMode();
  setIsPracticeMode(next);
  return next;
}

/**
 * 試合結果の適用:
 * - ランク: CPU戦・オンライン戦・練習戦共通でポイント加算
 * - レート: CPU通常戦のみ変動（オンラインまたは練習モード時は変動なし）
 *   - pointが100を超えると次の帯の30からスタート
 *   - pointが0を下回ると一つ下の帯の70に落ちる
 *   - X帯は上限無制限
 */
export function applyMatchResult(
  isWin: boolean, 
  modeTarget: number, 
  isOnline: boolean, 
  isPractice: boolean = false
): MatchRewardResult {
  const profile = getUserProfile();

  const rankBefore = profile.rank;
  const rankExpBefore = profile.rankExp;
  const rateTierBefore = profile.rateTier;
  const ratePointsBefore = profile.ratePoints;

  // 1. ランクポイント加算
  const rankPointsGained = getRankPointsGain(isWin, modeTarget);
  let curRank = profile.rank;
  let curExp = profile.rankExp + rankPointsGained;
  let rankUpCount = 0;

  while (curRank < 30) {
    const needed = getExpNeededForRank(curRank);
    if (curExp >= needed) {
      curExp -= needed;
      curRank++;
      rankUpCount++;
    } else {
      break;
    }
  }

  profile.rank = curRank;
  profile.rankExp = curExp;

  // 2. レート計算 (オンライン対戦、または練習モード時は完全変動なし)
  let rateDelta = 0;
  let promoted = false;
  let demoted = false;

  if (!isOnline && !isPractice) {
    rateDelta = getRatePointsChange(profile.rateTier, isWin, modeTarget);
    let newTier = profile.rateTier;
    let newPoints = profile.ratePoints + rateDelta;
    const tierIdx = RATE_TIER_ORDER.indexOf(profile.rateTier);

    if (newTier === 'X') {
      // X帯は上限無制限
      if (newPoints < 0) {
        // 0を下回るとS+の70に降格
        newTier = 'S+';
        newPoints = 70;
        demoted = true;
      }
    } else {
      if (newPoints > 100) {
        // 100を超えると、次のレート帯の30からスタート
        if (tierIdx < RATE_TIER_ORDER.length - 1) {
          newTier = RATE_TIER_ORDER[tierIdx + 1];
          newPoints = 30;
          promoted = true;
        } else {
          newPoints = 100;
        }
      } else if (newPoints < 0) {
        // 0を下回ると、一つ下の帯の70に落ちてしまう
        if (tierIdx > 0) {
          newTier = RATE_TIER_ORDER[tierIdx - 1];
          newPoints = 70;
          demoted = true;
        } else {
          // C-は最下層のため0でストップ
          newPoints = 0;
        }
      }
    }

    profile.rateTier = newTier;
    profile.ratePoints = newPoints;
  }

  // 練習モードは通算戦績に加算されない
  if (!isPractice) {
    profile.matches++;
    if (isWin) profile.wins++;
  }
  saveUserProfile(profile);

  return {
    isWin,
    modeTarget,
    isOnline,
    isPractice,
    rankBefore,
    rankExpBefore,
    rankAfter: profile.rank,
    rankExpAfter: profile.rankExp,
    rankPointsGained,
    rankUpCount,
    rateTierBefore,
    ratePointsBefore,
    rateTierAfter: profile.rateTier,
    ratePointsAfter: profile.ratePoints,
    rateDelta,
    promoted,
    demoted
  };
}

export interface MatchAbortResult {
  isOnline: boolean;
  isPractice: boolean;
  rateTierBefore: RateTier;
  ratePointsBefore: number;
  rateTierAfter: RateTier;
  ratePointsAfter: number;
  rateDelta: number;
  demoted: boolean;
}

/**
 * 試合中断（サレンダー・降伏）時の処理:
 * - ランクは変わらない
 * - レートは負けた判定で現在のレート帯に応じたポイントが減少 (A帯なら-9など、モード倍率適用)
 * - 0ptを下回ると前レート帯70ptへ降格
 * - 試合は負けた判定として通算戦績に加算 (matches + 1)
 * - ※練習モード時はレート変動も通算戦績加算も一切なし
 */
export function applyMatchAbort(
  modeTarget: number,
  isOnline: boolean,
  isPractice: boolean = false
): MatchAbortResult {
  const profile = getUserProfile();

  const rateTierBefore = profile.rateTier;
  const ratePointsBefore = profile.ratePoints;
  let rateDelta = 0;
  let demoted = false;

  if (!isPractice) {
    // 中断した試合は負けた判定 (通算試合数+1、勝利数は増えない)
    profile.matches++;

    // ランクは変わらない（rank, rankExp は操作しない）

    // レートは負け判定でレート帯に応じて減少 (CPU通常戦のみ)
    if (!isOnline) {
      rateDelta = getRatePointsChange(profile.rateTier, false, modeTarget);
      let newTier = profile.rateTier;
      let newPoints = profile.ratePoints + rateDelta;
      const tierIdx = RATE_TIER_ORDER.indexOf(profile.rateTier);

      if (newTier === 'X') {
        if (newPoints < 0) {
          newTier = 'S+';
          newPoints = 70;
          demoted = true;
        }
      } else {
        if (newPoints < 0) {
          if (tierIdx > 0) {
            newTier = RATE_TIER_ORDER[tierIdx - 1];
            newPoints = 70;
            demoted = true;
          } else {
            newPoints = 0;
          }
        }
      }

      profile.rateTier = newTier;
      profile.ratePoints = newPoints;
    }

    saveUserProfile(profile);
  }

  return {
    isOnline,
    isPractice,
    rateTierBefore,
    ratePointsBefore,
    rateTierAfter: profile.rateTier,
    ratePointsAfter: profile.ratePoints,
    rateDelta,
    demoted
  };
}

export type TierCategory = 'bronze' | 'silver' | 'gold' | 'platinum' | 'rainbow';

export function getTierCategory(tier: RateTier): TierCategory {
  if (tier.startsWith('C')) return 'bronze';
  if (tier.startsWith('B')) return 'silver';
  if (tier.startsWith('A')) return 'gold';
  if (tier === 'S' || tier === 'S+') return 'platinum';
  if (tier === 'X') return 'rainbow';
  return 'bronze';
}

export function getTierClass(tier: RateTier): string {
  const cat = getTierCategory(tier);
  return `tier-${cat}`;
}

export function getTierColor(tier: RateTier): string {
  if (tier.startsWith('C')) return '#cd7f32'; // 銅 (ブロンズ)
  if (tier.startsWith('B')) return '#d0d8e0'; // 銀 (シルバー)
  if (tier.startsWith('A')) return '#ffd700'; // 金 (ゴールド)
  if (tier === 'S' || tier === 'S+') return '#e0f2fe'; // プラチナ
  if (tier === 'X') return 'linear-gradient(90deg, #ff007f, #7928ca, #0070f3, #00dfd8)'; // レインボー
  return '#ffffff';
}
