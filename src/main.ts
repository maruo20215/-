import './style.css';
import { 
  GameState, 
  SongCard, 
  ItemCard, 
  ItemCode, 
  DanTier 
} from './types';
import { SONG_DATABASE, DAN_COMBO_DATA } from './data/songs';
import { GENRE_MAP, RANK_ORDER, DAN_ORDER, getDanidoujouTable } from './data/constants';
import { playSE, sound } from './audio';
import { 
  createInitialGameState, 
  generateSubDeck, 
  isCardPlayable, 
  getEffectiveBPM, 
  canUseItem,
  getCalculatedTable, 
  executeRoulette, 
  calculateGenreMatchup 
} from './game';
import { roomManager } from './room';

const state: GameState = createInitialGameState();
let playModeResolver: ((mode: 'manual' | 'auto') => void) | null = null;

// 音声初期化 (初回クリック・タッチ時)
const unlockAudio = () => { sound.unlock(); };
document.body.addEventListener('click', unlockAudio, { once: true });
document.body.addEventListener('touchstart', unlockAudio, { once: true });

// カスタムモーダル (window.alert / window.confirm の安全な代替)
function showCustomModal(
  title: string, 
  message: string, 
  options: { 
    confirmText?: string; 
    cancelText?: string; 
    showCancel?: boolean; 
  } = {}
): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.getElementById('custom-modal-overlay');
    const titleEl = document.getElementById('modal-title');
    const msgEl = document.getElementById('modal-message');
    const btnContainer = document.getElementById('modal-buttons');

    if (!overlay || !titleEl || !msgEl || !btnContainer) {
      resolve(true);
      return;
    }

    titleEl.innerText = title;
    msgEl.innerHTML = message;
    btnContainer.innerHTML = '';

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'action-btn';
    confirmBtn.innerText = options.confirmText || 'OK';
    confirmBtn.onclick = () => {
      playSE('don');
      overlay.style.display = 'none';
      resolve(true);
    };
    btnContainer.appendChild(confirmBtn);

    if (options.showCancel) {
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'action-btn pass-btn';
      cancelBtn.innerText = options.cancelText || 'キャンセル';
      cancelBtn.onclick = () => {
        playSE('ka');
        overlay.style.display = 'none';
        resolve(false);
      };
      btnContainer.appendChild(cancelBtn);
    }

    overlay.style.display = 'flex';
  });
}

// あべこべ発動用：手札から2枚選択するモーダル
function selectTwoCardsToExchange(cards: SongCard[]): Promise<SongCard[]> {
  return new Promise(resolve => {
    const overlay = document.getElementById('custom-modal-overlay');
    const titleEl = document.getElementById('modal-title');
    const msgEl = document.getElementById('modal-message');
    const btnContainer = document.getElementById('modal-buttons');

    if (!overlay || !titleEl || !msgEl || !btnContainer || cards.length < 2) {
      resolve(cards.slice(0, 2));
      return;
    }

    titleEl.innerText = "🌀 あべこべ発動！";
    msgEl.innerHTML = "<p>相手と交換する手札の楽曲を<strong>2枚</strong>選択してください：</p>";

    const listDiv = document.createElement('div');
    listDiv.className = 'exchange-card-list';

    let selectedUids: number[] = [];

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'action-btn';
    confirmBtn.innerText = "交換決定 (0/2)";
    confirmBtn.disabled = true;

    cards.forEach(card => {
      const cardEl = document.createElement('div');
      cardEl.className = `exchange-card-item type-${card.genre}`;
      cardEl.innerHTML = `
        <div style="font-weight:bold; color:#ffcc00;">${card.rank}</div>
        <div style="font-size:0.75rem; text-align:center;">${card.name}</div>
        <div style="font-size:0.65rem; color:#aaa;">${card.combo}C</div>
      `;
      cardEl.onclick = () => {
        playSE('select');
        const uid = card.uid || 0;
        if (selectedUids.includes(uid)) {
          selectedUids = selectedUids.filter(id => id !== uid);
          cardEl.classList.remove('selected');
        } else if (selectedUids.length < 2) {
          selectedUids.push(uid);
          cardEl.classList.add('selected');
        }
        confirmBtn.innerText = `交換決定 (${selectedUids.length}/2)`;
        confirmBtn.disabled = selectedUids.length !== 2;
      };
      listDiv.appendChild(cardEl);
    });

    msgEl.appendChild(listDiv);
    btnContainer.innerHTML = '';

    confirmBtn.onclick = () => {
      playSE('don');
      overlay.style.display = 'none';
      const chosen = cards.filter(c => selectedUids.includes(c.uid || 0));
      resolve(chosen.length === 2 ? chosen : cards.slice(0, 2));
    };
    btnContainer.appendChild(confirmBtn);

    overlay.style.display = 'flex';
  });
}

// ルームイベントリスナー
roomManager.onEvent(event => {
  if (event.type === 'guest_joined') {
    playSE('clear');
    updateRoomLobbyUI();
  } else if (event.type === 'room_updated') {
    updateRoomLobbyUI();
  } else if (event.type === 'host_started') {
    const data = event.data as { target: number };
    playSE('don');
    startGame(data.target);
  }
});

export function startGame(target: number) {
  playSE('don');
  state.target = target;
  state.turn = 0;
  state.p1Score = 0;
  state.cpuScore = 0;
  state.p1.doronTargetHiddenTurn = 0;
  state.p1.autoPlaySealedTurn = 0;
  state.cpu.doronTargetHiddenTurn = 0;
  state.cpu.autoPlaySealedTurn = 0;

  const startScreen = document.getElementById('start-screen');
  const roomScreen = document.getElementById('room-screen');
  const battleScreen = document.getElementById('battle-screen');
  if (startScreen) startScreen.style.display = 'none';
  if (roomScreen) roomScreen.style.display = 'none';
  if (battleScreen) battleScreen.style.display = 'flex';

  state.sharedMainDeck = [...SONG_DATABASE]
    .sort(() => Math.random() - 0.5)
    .map(c => ({ ...c, uid: Math.random() }));

  (['p1', 'cpu'] as const).forEach(p => {
    state[p].subDeck = generateSubDeck();
    state[p].mainHand = state.sharedMainDeck.splice(0, 5);
    state[p].subHand = state[p].subDeck.splice(0, 3);
    state[p].mainHand.forEach(c => { c.isNew = true; });
    state[p].subHand.forEach(c => { c.isNew = true; });
  });

  const logBox = document.getElementById('battle-log');
  if (logBox) logBox.innerHTML = '';

  startNewTurn();
}

export async function startNewTurn() {
  state.turn++;

  const n = Math.floor(Math.random() * 26 + 5) * 10;
  const m = Math.floor(Math.random() * 7 + 7) * 10;
  state.currentBpmMin = n;
  state.currentBpmMax = n + m;

  // ドロン持続ターンの更新
  if (state.p1.doronTargetHiddenTurn > 0) state.p1.doronTargetHiddenTurn--;
  if (state.p1.autoPlaySealedTurn > 0) state.p1.autoPlaySealedTurn--;
  if (state.cpu.doronTargetHiddenTurn > 0) state.cpu.doronTargetHiddenTurn--;
  if (state.cpu.autoPlaySealedTurn > 0) state.cpu.autoPlaySealedTurn--;

  const bpmDisplay = document.getElementById('bpm-target-display');
  if (bpmDisplay) {
    bpmDisplay.innerText = `${state.turn}ターン目： ${state.currentBpmMin} 〜 ${state.currentBpmMax}`;
  }
  updateUI();

  playSE('don');
  await showBanner(`Turn ${state.turn}`, `BPM指定: <span style="color:#00ffff">${state.currentBpmMin} 〜 ${state.currentBpmMax}</span>`, 2000);

  state.phase = 'SELECT_MAIN';
  updatePhaseUI();
}

function updateUI() {
  renderHand('p1-main-hand', state.p1.mainHand, 'main');
  renderHand('p1-sub-hand', state.p1.subHand, 'sub');

  const p1Percent = Math.min((state.p1Score / state.target) * 100, 100);
  const p1Fill = document.getElementById('p1-gauge-fill');
  const p1Text = document.getElementById('p1-gauge-text');
  if (p1Fill) p1Fill.style.width = `${p1Percent}%`;
  if (p1Text) p1Text.innerText = `${Math.floor(state.p1Score)} / ${state.target}`;

  // ドロン仕様：相手がドロンを使った場合、自分は相手のゲージ数値・たまり具合（パーセント幅）が完全に見えない
  const cpuFill = document.getElementById('cpu-gauge-fill');
  const cpuText = document.getElementById('cpu-gauge-text');
  const cpuPreview = document.getElementById('cpu-gauge-preview');

  if (state.p1.doronTargetHiddenTurn > 0) {
    if (cpuFill) cpuFill.style.width = '0%';
    if (cpuPreview) cpuPreview.style.display = 'none';
    if (cpuText) cpuText.innerText = `??? / ${state.target}`;
  } else {
    const cpuPercent = Math.min((state.cpuScore / state.target) * 100, 100);
    if (cpuFill) cpuFill.style.width = `${cpuPercent}%`;
    if (cpuText) cpuText.innerText = `${Math.floor(state.cpuScore)} / ${state.target}`;
  }

  const deckDisplay = document.getElementById('deck-count-display');
  if (deckDisplay) {
    deckDisplay.innerText = `山札: ${state.sharedMainDeck.length}枚`;
  }

  const subBadge = document.getElementById('sub-charge-badge');
  if (subBadge) {
    if (state.turn % 2 === 0) {
      subBadge.innerText = '【次回補充: 次ターン】';
      subBadge.style.color = '#ffaa00';
    } else {
      subBadge.innerText = '【今ターン補充完了】';
      subBadge.style.color = '#38ef7d';
    }
  }
}

function renderHand(containerId: string, cards: (SongCard | ItemCard)[], type: 'main' | 'sub') {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  cards.forEach(card => {
    const el = document.createElement('div');
    if (card.isNew) {
      el.classList.add('draw-anim');
      card.isNew = false;
    }

    if (type === 'main') {
      const song = card as SongCard;
      const playable = isCardPlayable(song, state.currentBpmMin, state.currentBpmMax);
      const danClass = song.dan ? `dan-${song.dan}` : '';
      const isSelected = state.p1.selectedMain?.uid === song.uid;

      el.className = `card type-${song.genre} ${isSelected ? 'selected' : ''} ${playable ? '' : 'unplayable'} ${danClass}`;
      el.innerHTML = `
        <div class="card-header">
          <span class="card-rank">${song.rank}</span>
          <span class="card-genre">${GENRE_MAP[song.genre] || "未設定"}</span>
        </div>
        <div class="card-title">${song.name}</div>
        <div class="card-stats">BPM: ${song.bpm}</div>
        <div class="card-combo">${song.combo} <span style="font-size:0.6em;">コンボ</span></div>
      `;

      el.onclick = () => {
        if (state.phase === 'SELECT_MAIN') {
          playSE('select');
          if (state.p1.selectedMain && state.p1.selectedMain.uid === song.uid) {
            state.p1.selectedMain = null;
          } else {
            state.p1.selectedMain = song;
          }
          updatePhaseUI();
        }
      };
    } else {
      const item = card as ItemCard;
      const isSelected = !!state.p1.selectedSubs.find(c => c.uid === item.uid);
      const usable = canUseItem(item, state.p1.selectedMain);

      el.className = `card card-sub star-${item.star} ${isSelected ? 'selected' : ''} ${!usable && state.phase === 'SELECT_SUB' ? 'unplayable' : ''}`;
      el.innerHTML = `
        <div class="search-icon">🔎</div>
        <div class="item-rarity">${item.name.split(' ')[0]}</div>
        <div class="card-title" style="color:#fff;">${item.name.split(' ')[1]}</div>
        <div class="card-stats">${item.desc}</div>
        <div class="sub-tooltip">${item.tooltip}</div>
      `;

      el.onclick = () => {
        if (state.phase === 'SELECT_SUB' && usable) {
          playSE('select');
          if (isSelected) {
            state.p1.selectedSubs = state.p1.selectedSubs.filter(c => c.uid !== item.uid);
          } else if (state.p1.selectedSubs.length < 1) { // 1ターンにつき最大1枚
            state.p1.selectedSubs = [item];
          }
          updatePhaseUI();
        }
      };
    }
    container.appendChild(el);
  });
}

function updatePhaseUI() {
  const text = document.getElementById('instruction-text');
  const actionBtn = document.getElementById('action-btn') as HTMLButtonElement | null;
  const passBtn = document.getElementById('pass-btn') as HTMLButtonElement | null;

  if (!actionBtn || !passBtn || !text) return;

  if (state.phase === 'SELECT_MAIN') {
    passBtn.style.display = 'inline-block';
    const sm = state.p1.selectedMain;
    if (sm) {
      if (isCardPlayable(sm, state.currentBpmMin, state.currentBpmMax)) {
        actionBtn.disabled = false;
        actionBtn.innerText = "楽曲決定";
        passBtn.innerText = "これを捨ててパス";
      } else {
        actionBtn.disabled = true;
        actionBtn.innerText = "BPM対象外";
        passBtn.innerText = "これを捨てて交換";
      }
    } else {
      actionBtn.disabled = true;
      actionBtn.innerText = "楽曲決定";
      passBtn.innerText = "出さずにパス";
    }
    text.innerText = "楽曲を選んでください";
  } else if (state.phase === 'SELECT_SUB') {
    text.innerText = `アイテム選択（${state.p1.selectedSubs.length}/1枚）`;
    actionBtn.disabled = false;
    actionBtn.innerText = "バトル開始！";
    passBtn.style.display = 'none';
  }
  updateUI();
}

export function executePassPhase() {
  playSE('don');
  if (state.phase === 'SELECT_MAIN') {
    if (state.p1.selectedMain) {
      state.p1.mainHand = state.p1.mainHand.filter(c => c.uid !== state.p1.selectedMain!.uid);
      drawCard('p1', 'main', 7);
      log(`YOUは ${state.p1.selectedMain.name} を捨てて引き直し、パスした。`);
    } else {
      log(`YOUは曲を出さずにパスした。`);
    }
    state.p1.selectedMain = null;
    state.p1.passed = true;
    proceedToSubPhase();
  } else if (state.phase === 'SELECT_SUB') {
    state.p1.selectedSubs = [];
    confirmPhase();
  }
}

export function confirmPhase() {
  playSE('don');
  if (state.phase === 'SELECT_MAIN') {
    state.p1.passed = false;
    proceedToSubPhase();
  } else if (state.phase === 'SELECT_SUB') {
    state.phase = 'BATTLE';
    const instrText = document.getElementById('instruction-text');
    const actionBtn = document.getElementById('action-btn') as HTMLButtonElement | null;
    const passBtn = document.getElementById('pass-btn') as HTMLButtonElement | null;
    if (instrText) instrText.innerText = "バトル進行中...";
    if (actionBtn) actionBtn.disabled = true;
    if (passBtn) passBtn.disabled = true;

    // CPUのサブカード選択 (1枚まで)
    state.cpu.selectedSubs = [];
    if (state.cpu.subHand.length > 0 && Math.random() > 0.4) {
      const usableSubs = state.cpu.subHand.filter(c => canUseItem(c, state.cpu.selectedMain));
      if (usableSubs.length > 0) {
        const picked = usableSubs[Math.floor(Math.random() * usableSubs.length)];
        state.cpu.selectedSubs = [picked];
        state.cpu.subHand = state.cpu.subHand.filter(c => c.uid !== picked.uid);
      }
    }
    state.p1.subHand = state.p1.subHand.filter(c => !state.p1.selectedSubs.includes(c));
    updateUI();
    executeBattle();
  }
}

function proceedToSubPhase() {
  state.phase = 'SELECT_SUB';
  const playableCpuCards = state.cpu.mainHand.filter(c => isCardPlayable(c, state.currentBpmMin, state.currentBpmMax));
  if (playableCpuCards.length > 0) {
    state.cpu.selectedMain = playableCpuCards[Math.floor(Math.random() * playableCpuCards.length)];
    state.cpu.passed = false;
    state.cpu.mainHand = state.cpu.mainHand.filter(c => c.uid !== state.cpu.selectedMain!.uid);
  } else {
    if (state.cpu.mainHand.length > 0) {
      const drop = state.cpu.mainHand[0];
      state.cpu.mainHand.shift();
      drawCard('cpu', 'main', 7);
      log(`CPUは ${drop.name} を捨てて交換し、パスした。`);
    }
    state.cpu.selectedMain = null;
    state.cpu.passed = true;
  }

  if (!state.p1.passed && state.p1.selectedMain) {
    state.p1.mainHand = state.p1.mainHand.filter(c => c.uid !== state.p1.selectedMain!.uid);
  }

  const p1Slot = document.getElementById('p1-slot');
  const cpuSlot = document.getElementById('cpu-slot');
  if (p1Slot) {
    p1Slot.innerHTML = state.p1.passed 
      ? '<div class="card type-1" style="background:rgba(0,0,0,0.5);"><div style="margin-top:50px; text-align:center;">PASS</div></div>' 
      : '<div class="card type-1" style="background:rgba(0,0,0,0.5);"><div style="margin-top:50px; text-align:center;">SET</div></div>';
  }
  if (cpuSlot) {
    cpuSlot.innerHTML = state.cpu.passed 
      ? '<div class="card type-1" style="background:rgba(0,0,0,0.5);"><div style="margin-top:50px; text-align:center;">PASS</div></div>' 
      : '<div class="card type-1" style="background:rgba(0,0,0,0.5);"><div style="margin-top:50px; text-align:center;">SET</div></div>';
  }

  updatePhaseUI();
}

async function showBanner(htmlContent: string, desc = '', duration: number | null = null) {
  const content = document.getElementById('banner-content');
  const fukkatsuBox = document.getElementById('fukkatsu-event-box');
  const bombBox = document.getElementById('bomb-event-box');
  const playBtns = document.getElementById('play-mode-btns');
  const title = document.getElementById('banner-title');
  const descEl = document.getElementById('banner-desc');
  const banner = document.getElementById('center-banner');

  if (content) content.style.display = 'block';
  if (fukkatsuBox) fukkatsuBox.style.display = 'none';
  if (bombBox) bombBox.style.display = 'none';
  if (playBtns) playBtns.style.display = 'none';

  if (title) title.innerHTML = htmlContent;
  if (descEl) descEl.innerHTML = desc;

  if (banner) {
    banner.style.display = 'block';
    if (duration) {
      await sleep(duration);
      banner.style.display = 'none';
    }
  }
}

function askPlayMode(card: SongCard, buffs: ItemCode[], enemyDebuffs: ItemCode[], elemMultiplier: number): Promise<'manual' | 'auto'> {
  return new Promise(resolve => {
    playModeResolver = resolve;

    const content = document.getElementById('banner-content');
    const fukkatsuBox = document.getElementById('fukkatsu-event-box');
    const bombBox = document.getElementById('bomb-event-box');
    const title = document.getElementById('banner-title');
    const desc = document.getElementById('banner-desc');
    const probBox = document.getElementById('prob-detail-box');
    const playBtns = document.getElementById('play-mode-btns');
    const banner = document.getElementById('center-banner');

    if (content) content.style.display = 'block';
    if (fukkatsuBox) fukkatsuBox.style.display = 'none';
    if (bombBox) bombBox.style.display = 'none';

    if (title) title.innerHTML = '演奏スタイルを選択';
    if (desc) desc.innerHTML = '';

    let detailHtml = '';
    if (buffs.includes('danidoujou') && DAN_COMBO_DATA[card.name]) {
      const dt = getDanidoujouTable(card);
      if (dt) {
        detailHtml = dt.map(item => {
          let multiDisplay = item.m;
          if (card.dan && (item.n === '全良' || item.n.includes('合格'))) multiDisplay += 0.2;
          if (buffs.includes('kanpeki')) {
            if (item.n === '全良' || item.n === '金合格') multiDisplay += 2.0;
            else if (item.n === '不合格') multiDisplay = -0.7;
          }
          if (item.c === 'rainbow') {
            return `<span class="rainbow-text">${item.n}: ${item.p}% (x${multiDisplay.toFixed(1)})</span>`;
          } else {
            return `<span style="color:${item.c}">${item.n}: ${item.p}% (x${multiDisplay.toFixed(1)})</span>`;
          }
        }).join('<br>');
      }
    } else {
      const t = getCalculatedTable(card, buffs, enemyDebuffs);
      const multiBonus = card.dan ? 0.2 : 0;
      const kanpekiBonus = buffs.includes('kanpeki') ? 2.0 : 0;
      const failMulti = buffs.includes('kanpeki') ? -0.7 : t[3].m;

      detailHtml = `
        <span style="color:#ffcc00">全良: ${t[0].p.toFixed(1)}% (x${(t[0].m + multiBonus + kanpekiBonus).toFixed(1)})</span><br>
        <span style="color:#aaff00">フル: ${t[1].p.toFixed(1)}% (x${(t[1].m + multiBonus + kanpekiBonus).toFixed(1)})</span><br>
        <span style="color:#00ffff">クリ: ${t[2].p.toFixed(1)}% (x${(t[2].m + multiBonus).toFixed(1)})</span><br>
        <span style="color:#ff5555">失敗: ${t[3].p.toFixed(1)}% (x${failMulti.toFixed(1)})</span>
      `;
    }

    if (probBox) probBox.innerHTML = detailHtml;

    // オート倍率: キラキラカードは通常1.2倍 + 今回のボーナス0.2倍で 1.4倍
    const autoBase = card.dan ? 1.4 : 1.0;
    const activeCombo = (buffs.includes('danidoujou') && DAN_COMBO_DATA[card.name]) ? DAN_COMBO_DATA[card.name] : card.combo;
    let autoGain = Math.floor(activeCombo * elemMultiplier * autoBase);
    
    // 速度倍率
    if (buffs.includes('speed_1_3')) autoGain = Math.floor(autoGain * 1.3);
    else if (buffs.includes('speed_1_2')) autoGain = Math.floor(autoGain * 1.2);
    else if (buffs.includes('speed_1_1')) autoGain = Math.floor(autoGain * 1.1);

    const autoBtn = document.getElementById('auto-btn') as HTMLButtonElement | null;

    if (autoBtn) {
      if (buffs.includes('danidoujou') || state.p1.autoPlaySealedTurn > 0) {
        const reason = buffs.includes('danidoujou') ? "段位道場により封印" : "ドロンにより封印中";
        autoBtn.innerHTML = `🤖 オート<br><span style="font-size:0.85rem; color:#ff5555;">${reason}</span>`;
        autoBtn.disabled = true;
      } else {
        autoBtn.innerHTML = `🤖 オート<br><span style="font-size:0.9rem; color:#ccc;">確実 (x${autoBase.toFixed(1)})</span><br><span class="blink-text" style="color:#00ffff; font-size:1.4rem; display:block; margin-top:5px; text-shadow:0 0 10px #00ffff;">+${autoGain} C</span>`;
        autoBtn.disabled = false;

        const prePercent = Math.min(((state.p1Score + autoGain) / state.target) * 100, 100);
        const preEl = document.getElementById('p1-gauge-preview');
        if (preEl) {
          preEl.style.width = `${prePercent}%`;
          preEl.style.display = 'block';
        }
      }
    }

    if (playBtns) playBtns.style.display = 'flex';
    if (banner) banner.style.display = 'block';
  });
}

export function resolvePlayMode(mode: 'manual' | 'auto') {
  playSE('ka');
  const banner = document.getElementById('center-banner');
  const preview = document.getElementById('p1-gauge-preview');
  if (banner) banner.style.display = 'none';
  if (preview) preview.style.display = 'none';
  if (playModeResolver) {
    playModeResolver(mode);
    playModeResolver = null;
  }
}

function setBadge(slotId: string, text: string, color: string) {
  const badge = document.getElementById(slotId + '-badge');
  if (badge) {
    badge.innerText = text;
    badge.style.background = color;
    badge.style.color = '#fff';
    badge.style.display = 'block';
  }
}

function renderSubSlots(player: 'p1' | 'cpu') {
  const slots = document.getElementById(`${player}-sub-slots`);
  if (!slots) return;
  slots.innerHTML = '';
  state[player].selectedSubs.forEach(sub => {
    const el = document.createElement('div');
    el.className = `card card-sub star-${sub.star} slide-up-sub`;
    el.innerHTML = `<div class="card-title" style="color:#fff;">${sub.name.split(' ')[1]}</div><div class="card-stats">${sub.desc}</div>`;
    slots.appendChild(el);
  });
}

function playBombEvent(): Promise<number> {
  return new Promise(resolve => {
    let count = 0;
    playSE('fail');
    const banner = document.getElementById('center-banner');
    const content = document.getElementById('banner-content');
    const fukkatsu = document.getElementById('fukkatsu-event-box');
    const bombBox = document.getElementById('bomb-event-box');

    if (content) content.style.display = 'none';
    if (fukkatsu) fukkatsu.style.display = 'none';
    if (bombBox) bombBox.style.display = 'block';
    if (banner) banner.style.display = 'block';

    const btn = document.getElementById('renda-btn');
    if (btn) {
      btn.onclick = () => {
        count++;
        playSE('don');
      };
    }

    let timeLeft = 5.0;
    const timerEl = document.getElementById('bomb-timer');
    const timerId = setInterval(() => {
      timeLeft -= 0.1;
      if (timerEl) timerEl.innerText = Math.max(0, timeLeft).toFixed(1);
      if (timeLeft <= 0.01) {
        clearInterval(timerId);
        if (banner) banner.style.display = 'none';
        resolve(count * 5);
      }
    }, 100);
  });
}

async function executeBattle() {
  const p1M = state.p1.selectedMain;
  const cpuM = state.cpu.selectedMain;

  renderSubSlots('p1');
  renderSubSlots('cpu');

  const p1Buffs = state.p1.selectedSubs.map(s => s.code);
  const cpuBuffs = state.cpu.selectedSubs.map(s => s.code);

  // あべこべ処理 (手持ちの曲カードを2枚交換)
  if (p1Buffs.includes('abekobe') && state.p1.mainHand.length >= 2 && state.cpu.mainHand.length >= 2) {
    log("YOUのあべこべ発動！交換するカードを選択します。");
    const chosenP1 = await selectTwoCardsToExchange(state.p1.mainHand);
    
    // CPUの手札からランダムに2枚選出
    const shuffledCpuHand = [...state.cpu.mainHand].sort(() => Math.random() - 0.5);
    const chosenCpu = shuffledCpuHand.slice(0, 2);

    // 交換実行
    state.p1.mainHand = state.p1.mainHand.filter(c => !chosenP1.some(p => p.uid === c.uid)).concat(chosenCpu);
    state.cpu.mainHand = state.cpu.mainHand.filter(c => !chosenCpu.some(p => p.uid === c.uid)).concat(chosenP1);

    log(`交換成立！相手から [${chosenCpu.map(c => c.name).join(', ')}] を奪取！`);
    playSE('clear');
    updateUI();
    await sleep(1500);
  }

  if (cpuBuffs.includes('abekobe') && state.cpu.mainHand.length >= 2 && state.p1.mainHand.length >= 2) {
    const chosenCpu = state.cpu.mainHand.slice(0, 2);
    const shuffledP1Hand = [...state.p1.mainHand].sort(() => Math.random() - 0.5);
    const chosenP1 = shuffledP1Hand.slice(0, 2);

    state.p1.mainHand = state.p1.mainHand.filter(c => !chosenP1.some(p => p.uid === c.uid)).concat(chosenCpu);
    state.cpu.mainHand = state.cpu.mainHand.filter(c => !chosenCpu.some(p => p.uid === c.uid)).concat(chosenP1);

    log(`相手のあべこべ発動！手札の [${chosenP1.map(c => c.name).join(', ')}] が奪われた！`);
    playSE('fail');
    updateUI();
    await sleep(1500);
  }

  // 即時系アイテム
  let itemUsed = false;
  (['p1', 'cpu'] as const).forEach(p => {
    state[p].selectedSubs.forEach(sub => {
      if (sub.code === 'hs2') {
        state[`${p}Score`] += 200;
        showEffect('+200', `${p}-slot`, '#00ff00');
        log(`${p.toUpperCase()}のHS2.0発動！(+200点)`);
        itemUsed = true;
        playSE('clear');
      }
      if (sub.code === 'hs3') {
        state[`${p}Score`] += 300;
        showEffect('+300', `${p}-slot`, '#00ff00');
        log(`${p.toUpperCase()}のHS3.0発動！(+300点)`);
        itemUsed = true;
        playSE('clear');
      }
      if (sub.code === 'hs4') {
        state[`${p}Score`] += 400;
        showEffect('+400', `${p}-slot`, '#00ff00');
        log(`${p.toUpperCase()}のHS4.0発動！(+400点)`);
        itemUsed = true;
        playSE('clear');
      }
      if (sub.code === 'makina') {
        drawCard(p, 'sub', 5);
        drawCard(p, 'sub', 5);
        drawCard(p, 'sub', 5);
        log(`${p.toUpperCase()}のまきな発動！3枚ドロー！`);
        itemUsed = true;
        playSE('clear');
      }
      // ドロン新仕様：自分のゲージを相手に3ターン隠し、相手のオートプレイを3ターン封印！
      if (sub.code === 'doron') {
        const opponent = p === 'p1' ? 'cpu' : 'p1';
        state[opponent].doronTargetHiddenTurn = 3;
        state[opponent].autoPlaySealedTurn = 3;
        log(`${p.toUpperCase()}のドロン発動！相手に自分のゲージを3ターン隠蔽し、相手のオートを封印！`);
        itemUsed = true;
        playSE('fail');
      }
    });
  });

  if (itemUsed) {
    updateUI();
    await sleep(1500);
  }

  // 爆弾音符
  const p1Bomb = state.p1.selectedSubs.find(s => s.code === 'bomb');
  const cpuBomb = state.cpu.selectedSubs.find(s => s.code === 'bomb');
  if (p1Bomb) {
    const dmg = await playBombEvent();
    state.cpuScore = Math.max(0, state.cpuScore - dmg);
    showEffect(`-${dmg}`, 'cpu-slot', 'red');
    log(`YOUの爆弾音符！CPUに${dmg}ダメージ！`);
    playSE('fail');
    updateUI();
    await sleep(1000);
  }
  if (cpuBomb) {
    const dmg = Math.floor(Math.random() * 20 + 20) * 5;
    await showBanner(`<span style="color:red">相手の爆弾音符発動！</span>`, `連打ダメージが飛んでくる！`, 2000);
    state.p1Score = Math.max(0, state.p1Score - dmg);
    showEffect(`-${dmg}`, 'p1-slot', 'red');
    log(`相手の爆弾音符！YOUに${dmg}ダメージ！`);
    playSE('fail');
    updateUI();
    await sleep(1000);
  }

  if (!p1M && !cpuM) {
    playSE('fail');
    await showBanner('両者パス！', 'ターンを終了します', 2000);
    return resetTurn();
  }

  playSE('don');
  if (p1M) {
    const danClass = p1M.dan ? `dan-${p1M.dan}` : '';
    const slot = document.getElementById('p1-slot');
    if (slot) {
      slot.innerHTML = `
        <div class="matchup-badge" id="p1-badge"></div>
        <div class="card type-${p1M.genre} ${danClass}">
          <div class="card-header"><span class="card-rank">${p1M.rank}</span><span class="card-genre">${GENRE_MAP[p1M.genre] || "未設定"}</span></div>
          <div class="card-title">${p1M.name}</div>
          <div class="card-combo">${p1M.combo} <span style="font-size:0.6em;">コンボ</span></div>
        </div>
      `;
    }
  }
  if (cpuM) {
    const danClass = cpuM.dan ? `dan-${cpuM.dan}` : '';
    const slot = document.getElementById('cpu-slot');
    if (slot) {
      slot.innerHTML = `
        <div class="matchup-badge" id="cpu-badge"></div>
        <div class="card type-${cpuM.genre} ${danClass}">
          <div class="card-header"><span class="card-rank">${cpuM.rank}</span><span class="card-genre">${GENRE_MAP[cpuM.genre] || "未設定"}</span></div>
          <div class="card-title">${cpuM.name}</div>
          <div class="card-combo">${cpuM.combo} <span style="font-size:0.6em;">コンボ</span></div>
        </div>
      `;
    }
  }

  await showBanner('楽曲オープン！', '', 1500);

  let p1Elem = 1.0;
  let cpuElem = 1.0;
  if (p1M && cpuM) {
    const matchup = calculateGenreMatchup(p1M.genre, cpuM.genre);
    p1Elem = matchup.p1Elem;
    cpuElem = matchup.cpuElem;
    if (p1Elem > 1.0) {
      setBadge('p1', '有利 (x1.2)', '#ff0000');
      setBadge('cpu', '不利 (x0.8)', '#0000ff');
    } else if (cpuElem > 1.0) {
      setBadge('cpu', '有利 (x1.2)', '#ff0000');
      setBadge('p1', '不利 (x0.8)', '#0000ff');
    } else {
      setBadge('p1', '等倍 (x1.0)', '#555');
      setBadge('cpu', '等倍 (x1.0)', '#555');
    }
  }

  const p1Debuffs = state.cpu.selectedSubs.map(s => s.code);
  const cpuDebuffs = state.p1.selectedSubs.map(s => s.code);

  let first: 'p1' | 'cpu' = 'p1';
  const p1HasDan = p1Buffs.includes('danidoujou') && !!p1M && !!DAN_COMBO_DATA[p1M.name];
  const cpuHasDan = cpuBuffs.includes('danidoujou') && !!cpuM && !!DAN_COMBO_DATA[cpuM.name];

  if (p1HasDan && !cpuHasDan) {
    first = 'p1';
  } else if (!p1HasDan && cpuHasDan) {
    first = 'cpu';
  } else if (p1M && cpuM) {
    first = (getEffectiveBPM(cpuM) > getEffectiveBPM(p1M) || (getEffectiveBPM(cpuM) === getEffectiveBPM(p1M) && cpuM.combo > p1M.combo)) ? 'cpu' : 'p1';
  } else if (!p1M) {
    first = 'cpu';
  }

  if (p1M && cpuM) {
    await showBanner(`<span style="color:#ffcc00">${first === 'p1' ? 'YOU' : 'CPU'}</span> !`, '先攻判定', 1800);
  }

  let p1Gain = 0;
  let cpuGain = 0;

  if (first === 'p1') {
    if (p1M) p1Gain = await processTurn('p1', p1M, p1Elem, p1Buffs, p1Debuffs);
    if (state.p1Score >= state.target) {
      updateUI();
      return endGame('YOU WIN!! (先攻逃げ切り)');
    }
    if (cpuM) cpuGain = await processTurn('cpu', cpuM, cpuElem, cpuBuffs, cpuDebuffs);
  } else {
    if (cpuM) cpuGain = await processTurn('cpu', cpuM, cpuElem, cpuBuffs, cpuDebuffs);
    if (state.cpuScore >= state.target) {
      updateUI();
      return endGame('相手 WIN... (先攻逃げ切り)');
    }
    if (p1M) p1Gain = await processTurn('p1', p1M, p1Elem, p1Buffs, p1Debuffs);
  }

  // 代行新仕様：そのターンだけ相手が獲得したポイントを自分にも反映させる
  if (p1Buffs.includes('daikou') && cpuGain > 0) {
    state.p1Score += cpuGain;
    showEffect(`+${cpuGain}`, 'p1-slot', '#00ff00');
    log(`YOUの代行発動！相手が獲得した+${cpuGain}点を自分にも加算！`);
    playSE('clear');
  }
  if (cpuBuffs.includes('daikou') && p1Gain > 0) {
    state.cpuScore += p1Gain;
    showEffect(`+${p1Gain}`, 'cpu-slot', '#00ff00');
    log(`相手の代行発動！YOUが獲得した+${p1Gain}点を相手にも加算！`);
    playSE('clear');
  }

  updateUI();

  if (state.p1Score >= state.target || state.cpuScore >= state.target) {
    if (state.p1Score >= state.target && state.cpuScore >= state.target) {
      if (state.p1Score > state.cpuScore) endGame('YOU WIN!!');
      else if (state.cpuScore > state.p1Score) endGame('相手 WIN...');
      else endGame('引き分け！');
    } else if (state.p1Score >= state.target) {
      endGame('YOU WIN!!');
    } else {
      endGame('相手 WIN...');
    }
    return;
  }
  resetTurn();
}

async function processTurn(
  player: 'p1' | 'cpu', 
  card: SongCard, 
  elemMultiplier: number, 
  buffs: ItemCode[], 
  debuffs: ItemCode[]
): Promise<number> {
  const isP1 = player === 'p1';

  let activeCombo = card.combo;
  if (buffs.includes('danidoujou') && DAN_COMBO_DATA[card.name]) {
    activeCombo = DAN_COMBO_DATA[card.name];
    await showBanner(`<span style="color:#ffcc00">段位道場発動！</span>`, `超大博打！コンボ数が ${activeCombo} に確定！`, 2000);
  }

  await showBanner(
    `<span style="color:${isP1 ? '#ffcc00' : '#0088ff'}">【${isP1 ? 'YOU' : '相手'} のターン】</span>`,
    `<span class="banner-song-name">${card.name}</span><br><span class="banner-combo">${activeCombo} コンボ</span>`,
    3000
  );

  let mode: 'manual' | 'auto';
  let resultName = '';
  let resultMulti = 1.0;
  let color = '#fff';
  let isRainbowText = false;

  if (isP1) {
    mode = await askPlayMode(card, buffs, debuffs, elemMultiplier);
    let res = executeRoulette(card, buffs, debuffs, mode, () => log("演奏スキップで失敗を回避！"));

    // 失敗時のみ復活連打のダイアログを出す
    if (buffs.includes('fukkatsu') && (res.resultName === '失敗' || res.resultName === '不合格')) {
      const banner = document.getElementById('center-banner');
      const content = document.getElementById('banner-content');
      const bombBox = document.getElementById('bomb-event-box');
      const fukkatsuTitle = document.getElementById('fukkatsu-title');
      const fukkatsuBox = document.getElementById('fukkatsu-event-box');

      if (content) content.style.display = 'none';
      if (bombBox) bombBox.style.display = 'none';
      if (fukkatsuTitle) fukkatsuTitle.innerText = `今の結果: ${res.resultName}`;
      if (fukkatsuBox) fukkatsuBox.style.display = 'block';
      if (banner) banner.style.display = 'block';

      playSE('ka');

      const retry = await new Promise<boolean>(r => {
        const retryBtn = document.getElementById('retry-btn');
        const keepBtn = document.getElementById('keep-btn');
        if (retryBtn) retryBtn.onclick = () => { playSE('don'); r(true); };
        if (keepBtn) keepBtn.onclick = () => { playSE('don'); r(false); };
      });

      if (banner) banner.style.display = 'none';
      if (retry) {
        log("復活連打でルーレットをやり直した！");
        res = executeRoulette(card, buffs, debuffs, mode, () => log("演奏スキップで失敗を回避！"));
      }
    }
    resultName = res.resultName;
    resultMulti = res.resultMulti;
    color = res.color;
    isRainbowText = res.isRainbow;
  } else {
    // 相手がドロンでオート封印されている場合は強制マニュアル
    mode = (buffs.includes('danidoujou') || state.cpu.autoPlaySealedTurn > 0 || Math.random() > 0.15) ? 'manual' : 'auto';
    const res = executeRoulette(card, buffs, debuffs, mode, () => log("相手は演奏スキップで失敗を回避！"));
    resultName = res.resultName;
    resultMulti = res.resultMulti;
    color = res.color;
    isRainbowText = res.isRainbow;
  }

  if (resultName === '全良' || resultName.includes('合格')) playSE('clear');
  else if (resultName === '失敗' || resultName === '不合格') playSE('fail');
  else playSE('don');

  const resultSpan = isRainbowText
    ? `<span class="banner-result-text rainbow-text">${resultName}</span>`
    : `<span class="banner-result-text" style="color:${color};">${resultName}</span>`;

  await showBanner(resultSpan, `倍率 x${resultMulti.toFixed(1)}`, 2000);

  let gain = Math.floor(activeCombo * elemMultiplier * resultMulti);

  // 演奏速度倍率 (×1.1, ×1.2, ×1.3)
  if (gain > 0) {
    let speedMulti = 1.0;
    if (buffs.includes('speed_1_3')) speedMulti = 1.3;
    else if (buffs.includes('speed_1_2')) speedMulti = 1.2;
    else if (buffs.includes('speed_1_1')) speedMulti = 1.1;

    if (speedMulti > 1.0) {
      const added = Math.floor(gain * (speedMulti - 1.0));
      gain += added;
      log(`${isP1 ? 'YOU' : '相手'}の演奏速度倍率発動！(×${speedMulti.toFixed(1)})`);
    }

    // 双打 (増加量2倍)
    if (buffs.includes('souda')) {
      gain = gain * 2;
      log(`${isP1 ? 'YOU' : '相手'}の双打発動！増加量2倍！`);
    }
  }

  // スコアへの加算（ここで1回だけ確実に加算）
  if (isP1) state.p1Score = Math.max(0, state.p1Score + gain);
  else state.cpuScore = Math.max(0, state.cpuScore + gain);

  const gainText = gain >= 0 ? `+${gain}` : `${gain}`;
  const gainColor = gain >= 0 ? '#00ff00' : '#ff3333';
  showEffect(gainText, isP1 ? 'p1-slot' : 'cpu-slot', gainColor);
  log(`${isP1 ? 'YOU' : '相手'}: ${resultName} (${gainText}点)`);
  updateUI();

  await sleep(1000);
  return gain;
}

async function resetTurn() {
  state.p1.selectedMain = null;
  state.p1.selectedSubs = [];
  state.p1.passed = false;
  state.cpu.selectedMain = null;
  state.cpu.selectedSubs = [];
  state.cpu.passed = false;

  const p1Slot = document.getElementById('p1-slot');
  const cpuSlot = document.getElementById('cpu-slot');
  const p1SubSlots = document.getElementById('p1-sub-slots');
  const cpuSubSlots = document.getElementById('cpu-sub-slots');
  const p1Badge = document.getElementById('p1-badge');
  const cpuBadge = document.getElementById('cpu-badge');
  const passBtn = document.getElementById('pass-btn') as HTMLButtonElement | null;

  if (p1Slot) p1Slot.innerHTML = '<div class="matchup-badge" id="p1-badge"></div>Player Field';
  if (cpuSlot) cpuSlot.innerHTML = '<div class="matchup-badge" id="cpu-badge"></div>CPU Field';
  if (p1SubSlots) p1SubSlots.innerHTML = '';
  if (cpuSubSlots) cpuSubSlots.innerHTML = '';
  if (p1Badge) p1Badge.style.display = 'none';
  if (cpuBadge) cpuBadge.style.display = 'none';
  if (passBtn) passBtn.disabled = false;

  log("=== 楽曲ドロー ===");
  drawCard('p1', 'main', 7);
  drawCard('cpu', 'main', 7);

  // サブカードの補充は2ターンに1度行う
  if (state.turn % 2 === 0) {
    log("=== アイテム補充（2ターンに1回） ===");
    drawCard('p1', 'sub', 5);
    drawCard('cpu', 'sub', 5);
  }

  startNewTurn();
}

async function drawCard(player: 'p1' | 'cpu', type: 'main' | 'sub', limit: number) {
  const hand = type === 'main' ? state[player].mainHand : state[player].subHand;
  let deck = type === 'main' ? state.sharedMainDeck : state[player].subDeck;

  if (deck.length === 0) {
    if (type === 'main') {
      log(`共通の山札が再構築されました。`);
      state.sharedMainDeck = [...SONG_DATABASE]
        .sort(() => Math.random() - 0.5)
        .map(c => ({ ...c, uid: Math.random() }));
      deck = state.sharedMainDeck;
    } else {
      log(`${player.toUpperCase()}のアイテム山札が再構築されました。`);
      state[player].subDeck = generateSubDeck();
      deck = state[player].subDeck;
    }
  }

  if (hand.length >= limit) {
    if (player === 'p1') {
      const discardConfirm = await showCustomModal(
        '手札上限',
        `手札が上限(${limit}枚)です。一番古いカードを捨てて新しいカードを引きますか？`,
        { confirmText: '捨てる', cancelText: '破棄しない', showCancel: true }
      );
      if (discardConfirm) {
        hand.shift();
        const c = deck.pop();
        if (c) {
          c.isNew = true;
          hand.push(c as never);
        }
      }
    } else {
      hand.shift();
      const c = deck.pop();
      if (c) {
        c.isNew = true;
        hand.push(c as never);
      }
    }
  } else {
    if (deck.length > 0) {
      const c = deck.pop();
      if (c) {
        c.isNew = true;
        hand.push(c as never);
      }
    }
  }
}

export async function surrender() {
  const confirmed = await showCustomModal(
    '対戦中断',
    '対戦を中断しますか？',
    { confirmText: '中断する', cancelText: '続ける', showCancel: true }
  );
  if (confirmed) {
    if (roomManager.currentRoom) {
      returnToRoomLobby();
    } else {
      location.reload();
    }
  }
}

// 試合終了：部屋があれば部屋は解散せず残ったままロビーへ戻れる
async function endGame(msg: string) {
  playSE('clear');
  await sleep(1500);

  if (roomManager.currentRoom) {
    const action = await showCustomModal(
      'ゲーム終了',
      `<strong>${msg}</strong><br><br>対戦お疲れ様でした！部屋に戻って続けて対戦しますか？`,
      { confirmText: '部屋のロビーに戻る', cancelText: '部屋を退出する', showCancel: true }
    );
    if (action) {
      returnToRoomLobby();
    } else {
      roomManager.leaveRoom();
      location.reload();
    }
  } else {
    const rematch = await showCustomModal(
      'ゲーム終了',
      `<strong>${msg}</strong><br><br>対戦お疲れ様でした！もう一度遊びますか？`,
      { confirmText: 'もう一度遊ぶ', cancelText: 'タイトルへ戻る', showCancel: true }
    );
    if (rematch) {
      startGame(state.target);
    } else {
      location.reload();
    }
  }
}

// 部屋作成フロー（インモーダル対応）
export function openCreateRoomModal() {
  playSE('select');
  const modal = document.getElementById('create-room-modal');
  const input = document.getElementById('create-room-name-input') as HTMLInputElement | null;
  const err = document.getElementById('create-room-error');
  if (err) err.style.display = 'none';
  if (input) {
    const defaultName = `ドン勝部屋_${Math.floor(100 + Math.random() * 900)}`;
    input.value = defaultName;
    setTimeout(() => {
      input.focus();
      input.select();
    }, 100);
  }
  if (modal) modal.style.display = 'flex';
}

export function closeCreateRoomModal() {
  playSE('ka');
  const modal = document.getElementById('create-room-modal');
  if (modal) modal.style.display = 'none';
}

export function confirmCreateRoom() {
  const input = document.getElementById('create-room-name-input') as HTMLInputElement | null;
  const err = document.getElementById('create-room-error');
  const roomName = input ? input.value.trim() : '';

  if (!roomName) {
    if (err) {
      err.innerText = '部屋の名前を入力してください';
      err.style.display = 'block';
    }
    return;
  }

  closeCreateRoomModal();
  playSE('clear');
  roomManager.createRoom(roomName);
  showRoomScreen();
}

// 部屋検索・入室フロー（インモーダル対応）
export function openJoinRoomModal() {
  playSE('select');
  const modal = document.getElementById('join-room-modal');
  const input = document.getElementById('join-room-pin-input') as HTMLInputElement | null;
  const err = document.getElementById('join-room-error');
  if (err) err.style.display = 'none';
  if (input) {
    input.value = '';
    setTimeout(() => input.focus(), 100);
  }
  renderActiveRoomsInModal();
  if (modal) modal.style.display = 'flex';
}

export function closeJoinRoomModal() {
  playSE('ka');
  const modal = document.getElementById('join-room-modal');
  if (modal) modal.style.display = 'none';
}

export function confirmJoinRoom(targetPin?: string) {
  const input = document.getElementById('join-room-pin-input') as HTMLInputElement | null;
  const err = document.getElementById('join-room-error');
  const pin = (typeof targetPin === 'string' ? targetPin : (input ? input.value : '')).trim();

  if (!pin) {
    if (err) {
      err.innerText = '5桁のパスワードを入力してください';
      err.style.display = 'block';
    }
    return;
  }

  const res = roomManager.joinRoom(pin);
  if (res.success) {
    playSE('clear');
    closeJoinRoomModal();
    showRoomScreen();
  } else {
    playSE('fail');
    if (err) {
      err.innerText = res.error || '入室できませんでした';
      err.style.display = 'block';
    }
  }
}

export function renderActiveRoomsInModal() {
  const container = document.getElementById('active-rooms-container');
  if (!container) return;
  const rooms = roomManager.getActiveRooms();

  if (rooms.length === 0) {
    container.innerHTML = `<div style="color:#888; font-size:0.85rem; padding:8px 0; text-align:center;">現在募集中の部屋はありません。<br>パスワードを入力するか、新しく部屋を作成してください。</div>`;
    return;
  }

  container.innerHTML = rooms.map(r => {
    const isFull = !!r.guestId;
    const statusText = isFull ? '対戦中' : '募集中';
    const statusColor = isFull ? '#ff4444' : '#38ef7d';
    return `
      <div class="quick-room-item" onclick="window.confirmJoinRoom('${r.password}')">
        <div>
          <div style="font-weight:bold; color:#ffcc00;">${r.roomName}</div>
          <div style="font-size:0.8rem; color:#aaa;">PIN: <span style="font-family:monospace; color:#fff; font-weight:bold;">${r.password}</span></div>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:0.8rem; color:${statusColor}; font-weight:bold; border:1px solid ${statusColor}; padding:2px 8px; border-radius:10px;">${statusText}</span>
          <button class="action-btn" style="padding:4px 10px; font-size:0.8rem; margin:0;" onclick="event.stopPropagation(); window.confirmJoinRoom('${r.password}')">入室</button>
        </div>
      </div>
    `;
  }).join('');
}

export function showRoomScreen() {
  const startScreen = document.getElementById('start-screen');
  const battleScreen = document.getElementById('battle-screen');
  const roomScreen = document.getElementById('room-screen');

  if (startScreen) startScreen.style.display = 'none';
  if (battleScreen) battleScreen.style.display = 'none';
  if (roomScreen) roomScreen.style.display = 'flex';

  updateRoomLobbyUI();
}

export function returnToRoomLobby() {
  roomManager.resetRoomToLobby();
  showRoomScreen();
}

export function leaveRoomToTitle() {
  playSE('ka');
  roomManager.leaveRoom();
  const roomScreen = document.getElementById('room-screen');
  const startScreen = document.getElementById('start-screen');
  if (roomScreen) roomScreen.style.display = 'none';
  if (startScreen) startScreen.style.display = 'flex';
}

function updateRoomLobbyUI() {
  const room = roomManager.currentRoom;
  if (!room) return;

  const roomTitle = document.getElementById('room-name-display');
  const roomPw = document.getElementById('room-pw-display');
  const roomStatus = document.getElementById('room-status-display');
  const hostControl = document.getElementById('host-difficulty-selection');
  const guestControl = document.getElementById('guest-waiting-message');

  if (roomTitle) roomTitle.innerText = `部屋名：${room.roomName}`;
  if (roomPw) roomPw.innerText = room.password;

  const isGuestConnected = !!room.guestId;

  if (roomStatus) {
    if (isGuestConnected) {
      roomStatus.className = 'room-status-badge status-ready';
      roomStatus.innerText = `対戦相手が参加中（${room.guestName || 'ゲスト'}）`;
    } else {
      roomStatus.className = 'room-status-badge status-waiting';
      roomStatus.innerText = '対戦相手の入室を待っています...';
    }
  }

  // 部屋を立てた側（ホスト）のみが難易度を選択してゲームへ移行できる
  if (roomManager.isHost) {
    if (hostControl) hostControl.style.display = 'block';
    if (guestControl) guestControl.style.display = 'none';
  } else {
    if (hostControl) hostControl.style.display = 'none';
    if (guestControl) guestControl.style.display = 'block';
  }
}

export function hostStartRoomGame(target: number) {
  playSE('don');
  roomManager.startGameAsHost(target);
  startGame(target);
}

export function copyRoomPassword() {
  const room = roomManager.currentRoom;
  if (!room) return;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(room.password).then(() => {
      playSE('clear');
      showCustomModal('コピー完了', `パスワード <strong>${room.password}</strong> をクリップボードにコピーしました！`);
    });
  } else {
    showCustomModal('パスワード', `パスワード: <strong>${room.password}</strong>`);
  }
}

export function openCardList() {
  const start = document.getElementById('start-screen');
  const list = document.getElementById('card-list-screen');
  if (start) start.style.display = 'none';
  if (list) list.style.display = 'flex';
  renderCardList();
}

export function closeCardList() {
  const start = document.getElementById('start-screen');
  const list = document.getElementById('card-list-screen');
  if (list) list.style.display = 'none';
  if (start) start.style.display = 'flex';
}

export function openRule() {
  const start = document.getElementById('start-screen');
  const rule = document.getElementById('rule-screen');
  if (start) start.style.display = 'none';
  if (rule) rule.style.display = 'flex';
}

export function closeRule() {
  const start = document.getElementById('start-screen');
  const rule = document.getElementById('rule-screen');
  if (rule) rule.style.display = 'none';
  if (start) start.style.display = 'flex';
}

export function renderCardList() {
  const sortSelect = document.getElementById('sort-select') as HTMLSelectElement | null;
  const genreSelect = document.getElementById('genre-filter-select') as HTMLSelectElement | null;
  const danSelect = document.getElementById('dan-filter-select') as HTMLSelectElement | null;
  const searchInput = document.getElementById('search-card-input') as HTMLInputElement | null;
  const countBadge = document.getElementById('card-count-badge');

  const sortType = sortSelect ? sortSelect.value : 'rank';
  const genreFilter = genreSelect ? genreSelect.value : 'all';
  const danFilter = danSelect ? danSelect.value : 'all';
  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

  let list = [...SONG_DATABASE];

  // 検索フィルター
  if (query) {
    list = list.filter(c => c.name.toLowerCase().includes(query));
  }

  // 系統フィルター
  if (genreFilter !== 'all') {
    const targetGenre = Number(genreFilter);
    list = list.filter(c => c.genre === targetGenre);
  }

  // 段位枠フィルター
  if (danFilter !== 'all') {
    if (danFilter === 'normal') {
      list = list.filter(c => !c.dan);
    } else {
      list = list.filter(c => c.dan === danFilter);
    }
  }

  // ソート
  list.sort((a, b) => {
    if (sortType === 'rank') {
      return (RANK_ORDER[b.rank] || 0) - (RANK_ORDER[a.rank] || 0) || b.combo - a.combo;
    } else if (sortType === 'genre') {
      return (Number(a.genre) || 0) - (Number(b.genre) || 0) || b.combo - a.combo;
    } else if (sortType === 'combo') {
      return b.combo - a.combo;
    } else if (sortType === 'rarity') {
      return (DAN_ORDER[b.dan as DanTier] || 0) - (DAN_ORDER[a.dan as DanTier] || 0) || (RANK_ORDER[b.rank] || 0) - (RANK_ORDER[a.rank] || 0);
    }
    return 0;
  });

  if (countBadge) {
    countBadge.innerText = `${list.length} / ${SONG_DATABASE.length}曲`;
  }

  const container = document.getElementById('card-list-container');
  if (!container) return;
  container.innerHTML = '';

  if (list.length === 0) {
    container.innerHTML = `<div style="color:#aaa; font-size:1.2rem; width:100%; text-align:center; margin-top:50px;">一致する楽曲が見つかりませんでした</div>`;
    return;
  }

  list.forEach(card => {
    const el = document.createElement('div');
    const danClass = card.dan ? `dan-${card.dan}` : '';
    el.className = `card type-${card.genre} ${danClass} static-card`;
    el.innerHTML = `
      <div class="card-header">
        <span class="card-rank">${card.rank}</span>
        <span class="card-genre">${GENRE_MAP[card.genre] || "未設定"}</span>
      </div>
      <div class="card-title">${card.name}</div>
      <div class="card-stats">BPM: ${card.bpm}</div>
      <div class="card-combo">${card.combo} <span style="font-size:0.6em;">コンボ</span></div>
    `;
    container.appendChild(el);
  });
}

function showEffect(text: string, slotId: string, color = 'red') {
  const slot = document.getElementById(slotId);
  if (!slot) return;
  const rect = slot.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'effect-text';
  el.innerText = text;
  el.style.color = color;
  el.style.left = `${rect.left + rect.width / 2}px`;
  el.style.top = `${rect.top}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

function log(msg: string) {
  const box = document.getElementById('battle-log');
  if (box) {
    box.innerHTML += `<p>${msg}</p>`;
    box.scrollTop = box.scrollHeight;
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// エンターキーでモーダル確定
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    const createInput = document.getElementById('create-room-name-input');
    if (createInput) {
      createInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') confirmCreateRoom();
      });
    }

    const joinInput = document.getElementById('join-room-pin-input');
    if (joinInput) {
      joinInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') confirmJoinRoom();
      });
    }
  });
}

// グローバルスコープへバインド (HTML onclick からも直接呼び出し可能に)
declare global {
  interface Window {
    startGame: typeof startGame;
    openCreateRoomModal: typeof openCreateRoomModal;
    closeCreateRoomModal: typeof closeCreateRoomModal;
    confirmCreateRoom: typeof confirmCreateRoom;
    openJoinRoomModal: typeof openJoinRoomModal;
    closeJoinRoomModal: typeof closeJoinRoomModal;
    confirmJoinRoom: typeof confirmJoinRoom;
    renderActiveRoomsInModal: typeof renderActiveRoomsInModal;
    hostStartRoomGame: typeof hostStartRoomGame;
    copyRoomPassword: typeof copyRoomPassword;
    leaveRoomToTitle: typeof leaveRoomToTitle;
    openCardList: typeof openCardList;
    closeCardList: typeof closeCardList;
    openRule: typeof openRule;
    closeRule: typeof closeRule;
    surrender: typeof surrender;
    renderCardList: typeof renderCardList;
    resolvePlayMode: typeof resolvePlayMode;
    confirmPhase: typeof confirmPhase;
    executePassPhase: typeof executePassPhase;
  }
}

window.startGame = startGame;
window.openCreateRoomModal = openCreateRoomModal;
window.closeCreateRoomModal = closeCreateRoomModal;
window.confirmCreateRoom = confirmCreateRoom;
window.openJoinRoomModal = openJoinRoomModal;
window.closeJoinRoomModal = closeJoinRoomModal;
window.confirmJoinRoom = confirmJoinRoom;
window.renderActiveRoomsInModal = renderActiveRoomsInModal;
window.hostStartRoomGame = hostStartRoomGame;
window.copyRoomPassword = copyRoomPassword;
window.leaveRoomToTitle = leaveRoomToTitle;
window.openCardList = openCardList;
window.closeCardList = closeCardList;
window.openRule = openRule;
window.closeRule = closeRule;
window.surrender = surrender;
window.renderCardList = renderCardList;
window.resolvePlayMode = resolvePlayMode;
window.confirmPhase = confirmPhase;
window.executePassPhase = executePassPhase;
