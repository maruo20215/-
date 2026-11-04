export type DanTier = 'red' | 'silver' | 'gold' | 'platinum' | 'rainbow';

export type SongRank = 
  | 'SS' 
  | '地力S+' 
  | '個人差S+' 
  | '地力S' 
  | '個人差S' 
  | '地力A+' 
  | '個人差A+' 
  | '地力A' 
  | '個人差A' 
  | '地力B';

export type GenreId = 1 | 2 | 3 | 4 | 5 | '';

export interface SongCard {
  name: string;
  rank: SongRank;
  genre: GenreId;
  bpm: number | string;
  combo: number;
  dan?: DanTier;
  uid?: number;
  isNew?: boolean;
}

export type ItemCode = 
  | 'danidoujou' 
  | 'doron' 
  | 'fukkatsu' 
  | 'makina' 
  | 'daikou' 
  | 'souda' 
  | 'hs4' 
  | 'hs3' 
  | 'hs2'
  | 'keita' 
  | 'yosuga' 
  | 'skip' 
  | 'bomb' 
  | 'detarame' 
  | 'kimagure' 
  | 'kirby' 
  | 'bachio'
  | 'mybachi_blue'
  | 'mybachi_red'
  | 'mybachi_yellow'
  | 'abekobe'
  | 'kanpeki'
  | 'speed_1_1'
  | 'speed_1_2'
  | 'speed_1_3';

export interface ItemCard {
  id: string;
  name: string;
  desc: string;
  tooltip: string;
  star: 1 | 2 | 3 | 4 | 5;
  code: ItemCode;
  uid?: number;
  isNew?: boolean;
}

export interface RouletteItem {
  n: string;
  p: number;
  m: number;
  c?: string;
}

export interface RouletteResult {
  resultName: string;
  resultMulti: number;
  color: string;
  isRainbow: boolean;
}

export interface PlayerState {
  subDeck: ItemCard[];
  mainHand: SongCard[];
  subHand: ItemCard[];
  selectedMain: SongCard | null;
  selectedSubs: ItemCard[];
  passed: boolean;
  doronTargetHiddenTurn: number; // 相手のゲージが自分に見えなくなっている残りターン (相手がドロン発動時)
  autoPlaySealedTurn: number;    // オート演奏が封印されている残りターン (相手がドロン発動時)
}

export type GamePhase = 'SELECT_MAIN' | 'SELECT_SUB' | 'BATTLE';

export interface RoomInfo {
  roomName: string;
  password: string;
  isHost: boolean;
  isOnline: boolean;
  guestJoined: boolean;
}

export interface GameState {
  turn: number;
  target: number;
  p1Score: number;
  cpuScore: number;
  currentBpmMin: number;
  currentBpmMax: number;
  sharedMainDeck: SongCard[];
  p1: PlayerState;
  cpu: PlayerState;
  phase: GamePhase;
  roomInfo: RoomInfo | null;
}
