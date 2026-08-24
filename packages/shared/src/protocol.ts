// 클라이언트-서버 공유 프로토콜

export const DEFAULT_PORT = 4020;
export const MAX_CHAT_LEN = 200;
export const MAX_NICKNAME_LEN = 16;

// 이미지 전송 정책
export const IMAGE_MAX_BYTES = 1_500_000; // 리사이즈 후 업로드 허용 최대치
export const IMAGE_PER_MINUTE = 2;
export const IMAGE_RETENTION_DAYS = 3;

export interface PlayerState {
  id: string;
  nickname: string;
  /** 4자리 고유번호 — 닉네임#태그 조합이 사용자 구분 키 */
  tag: string;
  /** sprite_split 폴더의 캐릭터 이름 (예: character_7) */
  character: string;
  /** 화면 가로 위치 (0~1 정규화 — 해상도가 달라도 상대 위치 유지) */
  x: number;
  dir: -1 | 1;
  walking: boolean;
}

export interface MovePayload {
  x: number;
  dir: -1 | 1;
  walking: boolean;
}

export interface ChatImage {
  /** 서버 상대 경로 (/i/xxx.webp) — 클라이언트 메인 프로세스가 절대 URL로 변환 */
  url: string;
  /** 말풍선/채팅 목록용 소형 썸네일 (data URL, 브로드캐스트에 포함) */
  thumb: string;
  /** 원본(리사이즈 후) 크기 — 말풍선 비율 계산용 */
  w: number;
  h: number;
}

export interface ChatMessage {
  id: string;
  nickname: string;
  tag: string;
  text: string;
  ts: number;
  image?: ChatImage;
}

export interface ClientToServerEvents {
  hello: (data: { nickname: string; tag: string; character: string }) => void;
  move: (data: MovePayload) => void;
  chat: (text: string) => void;
  /** 치장(캐릭터) 교체 알림 — 획득 판정은 클라이언트 로컬 */
  appearance: (character: string) => void;
  /** 이미지 업로드 (리사이즈된 바이너리 + 썸네일). 서버가 저장 후 chat으로 브로드캐스트 */
  image: (
    payload: { data: ArrayBuffer; mime: string; thumb: string; w: number; h: number },
    ack: (res: { ok: boolean; error?: string }) => void,
  ) => void;
}

export interface ServerToClientEvents {
  welcome: (data: { selfId: string; players: PlayerState[] }) => void;
  'player-joined': (player: PlayerState) => void;
  'player-moved': (data: { id: string } & MovePayload) => void;
  'player-left': (id: string) => void;
  'player-appearance': (data: { id: string; character: string }) => void;
  chat: (msg: ChatMessage) => void;
}

/** 말풍선 표시 시간(ms): 기본 5초 + 글자당 0.05초, 최대 10초 */
export function bubbleDurationMs(text: string): number {
  return Math.min(10, 5 + text.length * 0.05) * 1000;
}
