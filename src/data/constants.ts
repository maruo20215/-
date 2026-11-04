import { RouletteItem, SongCard, SongRank } from '../types';

export const GENRE_MAP: Record<string | number, string> = {
  1: '🔴 物量',
  2: '🔵 技術',
  3: '🟢 総合',
  4: '🟣 局所難',
  5: '🌀 特殊',
  "": "未設定"
};

export const RANK_ORDER: Record<SongRank, number> = {
  "SS": 9,
  "地力S+": 8,
  "個人差S+": 7,
  "地力S": 6,
  "個人差S": 5,
  "地力A+": 4,
  "個人差A+": 3,
  "地力A": 2,
  "個人差A": 1,
  "地力B": 0
};

export const DAN_ORDER: Record<string, number> = {
  "rainbow": 5,
  "platinum": 4,
  "gold": 3,
  "silver": 2,
  "red": 1
};

export const ROULETTE_TABLE: Record<SongRank, RouletteItem[]> = {
  "SS":       [ { n: "全良", p: 3, m: 4.0 }, { n: "フルコン", p: 15, m: 2.0 }, { n: "クリア", p: 42, m: 1.1 }, { n: "失敗", p: 40, m: -0.5 } ],
  "地力S+":    [ { n: "全良", p: 4, m: 3.5 }, { n: "フルコン", p: 16, m: 1.8 }, { n: "クリア", p: 42, m: 1.1 }, { n: "失敗", p: 38, m: -0.5 } ],
  "個人差S+":  [ { n: "全良", p: 5, m: 3.0 }, { n: "フルコン", p: 17, m: 1.6 }, { n: "クリア", p: 42, m: 1.1 }, { n: "失敗", p: 36, m: -0.5 } ],
  "地力S":     [ { n: "全良", p: 6, m: 2.5 }, { n: "フルコン", p: 18, m: 1.5 }, { n: "クリア", p: 42, m: 1.1 }, { n: "失敗", p: 34, m: -0.5 } ],
  "個人差S":   [ { n: "全良", p: 7, m: 2.2 }, { n: "フルコン", p: 19, m: 1.4 }, { n: "クリア", p: 42, m: 1.1 }, { n: "失敗", p: 32, m: -0.5 } ],
  "地力A+":    [ { n: "全良", p: 8, m: 2.0 }, { n: "フルコン", p: 20, m: 1.3 }, { n: "クリア", p: 42, m: 1.1 }, { n: "失敗", p: 30, m: -0.5 } ],
  "個人差A+":  [ { n: "全良", p: 9, m: 1.8 }, { n: "フルコン", p: 21, m: 1.2 }, { n: "クリア", p: 42, m: 1.1 }, { n: "失敗", p: 28, m: -0.5 } ],
  "地力A":     [ { n: "全良", p: 10, m: 1.6 }, { n: "フルコン", p: 22, m: 1.1 }, { n: "クリア", p: 42, m: 1.1 }, { n: "失敗", p: 26, m: -0.5 } ],
  "個人差A":   [ { n: "全良", p: 11, m: 1.5 }, { n: "フルコン", p: 23, m: 1.1 }, { n: "クリア", p: 42, m: 1.1 }, { n: "失敗", p: 24, m: -0.5 } ],
  "地力B":     [ { n: "全良", p: 12, m: 1.4 }, { n: "フルコン", p: 24, m: 1.1 }, { n: "クリア", p: 42, m: 1.1 }, { n: "失敗", p: 22, m: -0.5 } ]
};

export function getDanidoujouTable(card: SongCard): RouletteItem[] | null {
  if (card.dan === 'red') {
    return [
      { n: "全良", p: 3, m: 1.3, c: 'rainbow' },
      { n: "金合格", p: 10, m: 1.1, c: '#ffcc00' },
      { n: "赤合格", p: 25, m: 1.0, c: '#ff5555' },
      { n: "不合格", p: 62, m: -0.3, c: '#5555ff' }
    ];
  } else if (card.dan === 'silver' || card.dan === 'platinum') {
    return [
      { n: "全良", p: 2, m: 2.0, c: 'rainbow' },
      { n: "金合格", p: 6, m: 1.5, c: '#ffcc00' },
      { n: "赤合格", p: 10, m: 1.2, c: '#ff5555' },
      { n: "不合格", p: 82, m: -0.2, c: '#5555ff' }
    ];
  } else if (card.dan === 'gold' || card.dan === 'rainbow') {
    return [
      { n: "全良", p: 1, m: 10.0, c: 'rainbow' },
      { n: "赤合格", p: 9, m: 3.0, c: '#ff5555' },
      { n: "不合格", p: 90, m: -0.1, c: '#5555ff' }
    ];
  }
  return null;
}
