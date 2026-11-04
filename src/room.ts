export interface RoomData {
  roomName: string;
  password: string;
  hostId: string;
  guestId: string | null;
  guestName: string | null;
  targetScore: number | null;
  status: 'waiting' | 'ready' | 'playing' | 'finished';
  lastActive: number;
}

export type RoomEventCallback = (event: {
  type: 'guest_joined' | 'host_started' | 'room_updated' | 'peer_action';
  data?: unknown;
}) => void;

class RoomManager {
  private channel: BroadcastChannel | null = null;
  public myId: string;
  public currentRoom: RoomData | null = null;
  public isHost: boolean = false;
  private listeners: RoomEventCallback[] = [];

  constructor() {
    this.myId = 'user_' + Math.floor(Math.random() * 1000000).toString();
    try {
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        this.channel = new BroadcastChannel('taiko_card_battle_rooms');
        this.channel.onmessage = (msg) => this.handleMessage(msg.data);
      }
    } catch {
      console.warn("BroadcastChannel not supported, falling back to local simulation");
    }

    // Storageイベントリスナー (別タブとの同期用)
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => {
        if (e.key && e.key.startsWith('taiko_room_') && this.currentRoom) {
          if (e.newValue) {
            try {
              const updated = JSON.parse(e.newValue) as RoomData;
              if (updated.password === this.currentRoom.password) {
                this.currentRoom = updated;
                this.notify({ type: 'room_updated', data: updated });
              }
            } catch {
              // parse error ignored
            }
          }
        }
      });
    }
  }

  public onEvent(cb: RoomEventCallback) {
    this.listeners.push(cb);
  }

  private notify(event: { type: 'guest_joined' | 'host_started' | 'room_updated' | 'peer_action'; data?: unknown }) {
    this.listeners.forEach(cb => cb(event));
  }

  private handleMessage(payload: { type: string; password?: string; data?: unknown }) {
    if (!this.currentRoom) return;

    if (payload.password === this.currentRoom.password) {
      if (payload.type === 'guest_join') {
        const joinData = payload.data as { guestId: string; guestName: string };
        if (this.isHost) {
          this.currentRoom.guestId = joinData.guestId;
          this.currentRoom.guestName = joinData.guestName;
          this.currentRoom.status = 'ready';
          this.saveRoom(this.currentRoom);
          this.broadcast({
            type: 'room_sync',
            password: this.currentRoom.password,
            data: this.currentRoom
          });
          this.notify({ type: 'guest_joined', data: this.currentRoom });
        }
      } else if (payload.type === 'room_sync') {
        const synced = payload.data as RoomData;
        this.currentRoom = synced;
        this.notify({ type: 'room_updated', data: synced });
      } else if (payload.type === 'start_game') {
        const gameData = payload.data as { target: number };
        if (this.currentRoom) {
          this.currentRoom.targetScore = gameData.target;
          this.currentRoom.status = 'playing';
          this.saveRoom(this.currentRoom);
        }
        this.notify({ type: 'host_started', data: gameData });
      } else if (payload.type === 'peer_action') {
        this.notify({ type: 'peer_action', data: payload.data });
      }
    }
  }

  public broadcast(payload: unknown) {
    try {
      this.channel?.postMessage(payload);
    } catch {
      // ignore
    }
  }

  public generatePassword(): string {
    return Math.floor(10000 + Math.random() * 90000).toString();
  }

  public createRoom(roomName: string): RoomData {
    const password = this.generatePassword();
    const room: RoomData = {
      roomName: roomName.trim() || '太鼓道場',
      password,
      hostId: this.myId,
      guestId: null,
      guestName: null,
      targetScore: null,
      status: 'waiting',
      lastActive: Date.now()
    };
    this.currentRoom = room;
    this.isHost = true;
    this.saveRoom(room);
    this.broadcast({ type: 'room_created', password, data: room });
    return room;
  }

  public joinRoom(password: string, guestName = '挑戦者'): { success: boolean; room?: RoomData; error?: string } {
    const cleanPw = password.trim();
    if (!/^\d{5}$/.test(cleanPw)) {
      return { success: false, error: 'パスワードは5桁の半角数字を入力してください' };
    }

    const saved = localStorage.getItem('taiko_room_' + cleanPw);
    if (!saved) {
      return { success: false, error: `パスワード「${cleanPw}」の部屋が見つかりませんでした。番号をご確認ください。` };
    }

    try {
      const room = JSON.parse(saved) as RoomData;
      room.guestId = this.myId;
      room.guestName = guestName;
      room.status = 'ready';
      room.lastActive = Date.now();

      this.currentRoom = room;
      this.isHost = false;
      this.saveRoom(room);

      this.broadcast({
        type: 'guest_join',
        password: cleanPw,
        data: { guestId: this.myId, guestName }
      });

      return { success: true, room };
    } catch {
      return { success: false, error: '部屋データの読み込みに失敗しました' };
    }
  }

  public getActiveRooms(): RoomData[] {
    const rooms: RoomData[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('taiko_room_')) {
          const raw = localStorage.getItem(key);
          if (raw) {
            const room = JSON.parse(raw) as RoomData;
            // 2時間以内のアクティブな部屋
            if (Date.now() - room.lastActive < 2 * 60 * 60 * 1000) {
              rooms.push(room);
            }
          }
        }
      }
    } catch {
      // ignore
    }
    return rooms.sort((a, b) => b.lastActive - a.lastActive);
  }

  public startGameAsHost(target: number): void {
    if (!this.currentRoom) return;
    this.currentRoom.targetScore = target;
    this.currentRoom.status = 'playing';
    this.saveRoom(this.currentRoom);

    this.broadcast({
      type: 'start_game',
      password: this.currentRoom.password,
      data: { target }
    });
  }

  public resetRoomToLobby(): void {
    if (!this.currentRoom) return;
    this.currentRoom.status = this.currentRoom.guestId ? 'ready' : 'waiting';
    this.currentRoom.targetScore = null;
    this.saveRoom(this.currentRoom);

    this.broadcast({
      type: 'room_sync',
      password: this.currentRoom.password,
      data: this.currentRoom
    });
  }

  public leaveRoom(): void {
    if (this.currentRoom) {
      if (this.isHost) {
        localStorage.removeItem('taiko_room_' + this.currentRoom.password);
      }
    }
    this.currentRoom = null;
    this.isHost = false;
  }

  private saveRoom(room: RoomData): void {
    try {
      localStorage.setItem('taiko_room_' + room.password, JSON.stringify(room));
    } catch {
      // storage quota or private mode
    }
  }
}

export const roomManager = new RoomManager();
