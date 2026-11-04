import { 
  GameState, 
  SongCard, 
  ItemCard, 
  RouletteResult, 
  PlayerState,
  ItemCode
} from './types';
import { SONG_DATABASE, DAN_COMBO_DATA } from './data/songs';
import { ITEM_DATABASE } from './data/items';
import { ROULETTE_TABLE, getDanidoujouTable } from './data/constants';

export function createInitialPlayerState(): PlayerState {
  return {
    subDeck: [],
    mainHand: [],
    subHand: [],
    selectedMain: null,
    selectedSubs: [],
    passed: false,
    doronTargetHiddenTurn: 0,
    autoPlaySealedTurn: 0
  };
}

export function createInitialGameState(): GameState {
  return {
    turn: 0,
    target: 5000,
    p1Score: 0,
    cpuScore: 0,
    currentBpmMin: 0,
    currentBpmMax: 0,
    sharedMainDeck: [],
    p1: createInitialPlayerState(),
    cpu: createInitialPlayerState(),
    phase: 'SELECT_MAIN',
    roomInfo: null
  };
}

export function generateSubDeck(): ItemCard[] {
  const sub: ItemCard[] = [];
  const s1 = ITEM_DATABASE.filter(i => i.star === 1);
  const s2 = ITEM_DATABASE.filter(i => i.star === 2);
  const s3 = ITEM_DATABASE.filter(i => i.star === 3);
  const s4 = ITEM_DATABASE.filter(i => i.star === 4);
  const s5 = ITEM_DATABASE.filter(i => i.star === 5);

  for (let i = 0; i < 30; i++) {
    const r = Math.random() * 100;
    let item: ItemCard;
    if (r < 6.6 && s5.length > 0) item = s5[Math.floor(Math.random() * s5.length)];
    else if (r < 19.9 && s4.length > 0) item = s4[Math.floor(Math.random() * s4.length)]; 
    else if (r < 39.8 && s3.length > 0) item = s3[Math.floor(Math.random() * s3.length)]; 
    else if (r < 66.4 && s2.length > 0) item = s2[Math.floor(Math.random() * s2.length)]; 
    else item = s1[Math.floor(Math.random() * s1.length)];
    
    sub.push({ ...item, uid: Math.random() });
  }
  return sub;
}

export function isCardPlayable(card: SongCard, minBpm: number, maxBpm: number): boolean {
  if (card.name.includes("〆ドレー")) return true;
  if (String(card.bpm).includes('-')) {
    const parts = String(card.bpm).split('-');
    return (Number(parts[1]) >= minBpm && Number(parts[0]) <= maxBpm);
  }
  const bpm = Number(card.bpm);
  return bpm >= minBpm && bpm <= maxBpm;
}

export function getEffectiveBPM(card: SongCard | null): number {
  if (!card) return 0;
  if (card.name.includes("〆ドレー")) return 9999;
  if (String(card.bpm).includes('-')) {
    return Math.max(...String(card.bpm).split('-').map(Number));
  }
  return Number(card.bpm) || 0;
}

export function canUseItem(item: ItemCard, selectedMain: SongCard | null): boolean {
  if (item.code === 'danidoujou') {
    return !!selectedMain && !!DAN_COMBO_DATA[selectedMain.name];
  }
  if (item.code === 'mybachi_blue') {
    return !!selectedMain && selectedMain.genre === 2;
  }
  if (item.code === 'mybachi_red') {
    return !!selectedMain && selectedMain.genre === 3;
  }
  if (item.code === 'mybachi_yellow') {
    return !!selectedMain && selectedMain.genre === 1;
  }
  return true;
}

export function getCalculatedTable(card: SongCard, buffs: ItemCode[], debuffs: ItemCode[]) {
  const baseTable = ROULETTE_TABLE[card.rank] || ROULETTE_TABLE["地力B"];
  const table = JSON.parse(JSON.stringify(baseTable));

  let pBonus = 0;
  let fcBonus = 0;

  // キラキラカードの全良ボーナス
  if (card.dan === 'red') pBonus += 10;
  else if (card.dan === 'silver') pBonus += 15;
  else if (card.dan === 'gold') pBonus += 20;
  else if (card.dan === 'platinum') pBonus += 25;
  else if (card.dan === 'rainbow') pBonus += 30;

  // アイテムによる全良ボーナス
  if (buffs.includes('keita')) pBonus += 15;
  if (buffs.includes('yosuga')) pBonus += 15;
  if (buffs.includes('kirby')) pBonus += 7;

  // 公式マイバチによる全良・フルコンボーナス
  if (buffs.includes('mybachi_blue') && card.genre === 2) {
    pBonus += 15;
    fcBonus += 15;
  }
  if (buffs.includes('mybachi_red') && card.genre === 3) {
    pBonus += 15;
    fcBonus += 15;
  }
  if (buffs.includes('mybachi_yellow') && card.genre === 1) {
    pBonus += 15;
    fcBonus += 15;
  }

  // バチお先生（フルコン確率+14%）
  if (buffs.includes('bachio')) {
    fcBonus += 14;
  }

  // 相手からのデバフ
  if (debuffs.includes('detarame')) {
    table[0].p = Math.max(0, table[0].p - 3);
    table[1].p = Math.max(0, table[1].p - 5);
    table[2].p = Math.max(0, table[2].p - 7);
  } else if (debuffs.includes('kimagure')) {
    table[0].p = Math.max(0, table[0].p - 2);
    table[1].p = Math.max(0, table[1].p - 3);
    table[2].p = Math.max(0, table[2].p - 5);
  }

  if (pBonus > 0) {
    table[0].p += pBonus;
    const reduce = pBonus / 3;
    table[1].p = Math.max(0, table[1].p - reduce);
    table[2].p = Math.max(0, table[2].p - reduce);
  }

  if (fcBonus > 0) {
    table[1].p += fcBonus;
    const reduceFc = fcBonus / 2;
    table[2].p = Math.max(0, table[2].p - reduceFc);
  }

  table[3].p = Math.max(0, 100 - (table[0].p + table[1].p + table[2].p));
  return table;
}

export function executeRoulette(
  card: SongCard, 
  buffs: ItemCode[], 
  debuffs: ItemCode[], 
  mode: 'manual' | 'auto',
  onSkip?: () => void
): RouletteResult {
  // 段位道場発動時
  if (buffs.includes('danidoujou') && DAN_COMBO_DATA[card.name]) {
    const dt = getDanidoujouTable(card);
    if (dt) {
      const rand = Math.random() * 100;
      let acc = 0;
      let res = dt[dt.length - 1];
      for (let i = 0; i < dt.length; i++) {
        acc += dt[i].p;
        if (rand <= acc) {
          res = dt[i];
          break;
        }
      }

      let multi = res.m;
      // キラキラカードの全良、フルコンボ、クリアしたときの増える倍率を＋0.2倍
      if (card.dan && (res.n === '全良' || res.n.includes('合格'))) {
        multi += 0.2;
      }
      // かんぺき効果
      if (buffs.includes('kanpeki')) {
        if (res.n === '全良' || res.n === '金合格') {
          multi += 2.0;
        } else if (res.n === '不合格') {
          multi = -0.7;
        }
      }

      return { 
        resultName: res.n, 
        resultMulti: multi, 
        color: res.c || '#fff', 
        isRainbow: res.c === 'rainbow' 
      };
    }
  }

  if (mode === 'auto') {
    let autoMulti = card.dan ? 1.4 : 1.0; // 段位カードは元々の1.2倍に+0.2倍ボーナスで1.4倍
    return { 
      resultName: 'オートクリア', 
      resultMulti: autoMulti, 
      color: '#00ffff', 
      isRainbow: false 
    };
  }

  const table = getCalculatedTable(card, buffs, debuffs);
  const rand = Math.random() * 100;
  let acc = 0;
  let res = table[3];
  for (let i = 0; i < 4; i++) {
    acc += table[i].p;
    if (rand <= acc) {
      res = table[i];
      break;
    }
  }

  let multi = res.m;

  // キラキラカードの全良、フルコンボ、クリアしたときの増える倍率を＋0.2倍
  if (card.dan && (res.n === '全良' || res.n === 'フルコン' || res.n === 'クリア')) {
    multi += 0.2;
  }

  // かんぺき：フルコンボ、全良した時の倍率がそれぞれ+2.0倍になるが、クリア失敗したときの倍率は-0.7倍になる
  if (buffs.includes('kanpeki')) {
    if (res.n === '全良' || res.n === 'フルコン') {
      multi += 2.0;
    } else if (res.n === '失敗') {
      multi = -0.7;
    }
  }

  // 演奏スキップ（失敗時1.0倍救済）
  if (res.n === '失敗' && buffs.includes('skip')) {
    multi = 1.0;
    if (onSkip) onSkip();
  }

  const color = res.n === '全良' 
    ? '#ffcc00' 
    : res.n === 'フルコン' 
    ? '#aaff00' 
    : res.n === 'クリア' 
    ? '#00ffff' 
    : '#ff5555';

  return { 
    resultName: res.n, 
    resultMulti: multi, 
    color, 
    isRainbow: false 
  };
}

export function calculateGenreMatchup(p1Genre: number | string, cpuGenre: number | string): { p1Elem: number; cpuElem: number } {
  let p1Elem = 1.0;
  let cpuElem = 1.0;

  if (p1Genre !== "" && cpuGenre !== "") {
    const g1 = Number(p1Genre);
    const g2 = Number(cpuGenre);
    if ((g1 === 1 && g2 === 4) || (g1 === 4 && g2 === 2) || (g1 === 2 && g2 === 1)) {
      p1Elem = 1.2;
      cpuElem = 0.8;
    } else if ((g2 === 1 && g1 === 4) || (g2 === 4 && g1 === 2) || (g2 === 2 && g1 === 1)) {
      cpuElem = 1.2;
      p1Elem = 0.8;
    }
  }

  return { p1Elem, cpuElem };
}
