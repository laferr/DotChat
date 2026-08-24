// 26x30 도트 캐릭터 — 코드로 정의한 픽셀 아트 (M1 플레이스홀더, 추후 Aseprite 에셋으로 교체)
// 팔레트 문자 하나가 픽셀 하나. '.' 은 투명.

const DOT_PALETTE: Record<string, string> = {
  k: '#4a2837', // 외곽선
  h: '#d94f63', // 머리카락
  d: '#a23352', // 머리카락 어두운 부분
  H: '#f28b94', // 머리카락 하이라이트
  s: '#ffdcb8', // 피부
  S: '#e8a97e', // 피부 그림자 (목/다리)
  e: '#46233b', // 눈 어두운 부분
  E: '#c93a5e', // 눈동자
  w: '#fff6ec', // 눈 하이라이트
  b: '#ff9f9f', // 볼터치
  r: '#b93a54', // 원피스
  R: '#7c2742', // 원피스 어두운 부분 / 신발
  y: '#f6e7c8', // 옷깃 / 밑단 트임
};

const DOT_W = 26;
const DOT_H = 30;

// 머리 (20줄) — 둥근 단발 + 아호게, 큰 눈
const DOT_HEAD: string[] = [
  '............kk............',
  '...........kHhk...........',
  '........kkkkhhkkkk........',
  '......kkhhhhddhhhhkk......',
  '.....khhhhhhhhhhhhhhk.....',
  '....khhHHHHhhhhhhhhhhk....',
  '...khhHHHHhhhhhhhhhhhhk...',
  '..khhHHhhhhhhhhhhhhhhhhk..',
  '..khhhhhhhhhhhhhhhhhhhhk..',
  '..khhhdhhhdhhhhdhhhdhhhk..',
  '..khhhhhdhhhhhhhhdhhhhhk..',
  '..khhhhdssssssssssdhhhhk..',
  '..khhhdseeesssseeesdhhhk..',
  '..khhhdswEesssseEwsdhhhk..',
  '..khhhdsEEesssseEEsdhhhk..',
  '..khhhdbseesssseesbdhhhk..',
  '..khhhdssssseesssssdhhhk..',
  '....hhdksssssssssskdhh....',
  '....dd..kkkkkkkkkk..dd....',
  '...........kSSk...........',
];

// 몸통 — 서 있는 프레임 (10줄)
const DOT_BODY_STAND: string[] = [
  '.........kyyyyyyk.........',
  '........krrrrrrrrk........',
  '.......krrrrrrrrrrk.......',
  '.......kRrrrrrrrrRk.......',
  '.......kyyyyyyyyyyk.......',
  '.......kkkkkkkkkkkk.......',
  '..........SS..SS..........',
  '..........SS..SS..........',
  '..........RR..RR..........',
  '..........kk..kk..........',
];

// 몸통 — 다리 벌린 걷기 프레임 (10줄)
const DOT_BODY_WALK: string[] = [
  '.........kyyyyyyk.........',
  '........krrrrrrrrk........',
  '.......krrrrrrrrrrk.......',
  '.......kRrrrrrrrrRk.......',
  '.......kyyyyyyyyyyk.......',
  '.......kkkkkkkkkkkk.......',
  '.........SS....SS.........',
  '.........SS....SS.........',
  '.........RR....RR.........',
  '.........kk....kk.........',
];

function dotReplace(row: string, start: number, text: string): string {
  return row.slice(0, start) + text + row.slice(start + text.length);
}

// 눈 감은 머리 — 눈 영역(8~10열, 15~17열)을 감은 눈으로 치환
function dotClosedEyeHead(): string[] {
  const rows = DOT_HEAD.slice();
  for (const y of [12, 13, 15]) {
    rows[y] = dotReplace(rows[y], 8, 'sss');
    rows[y] = dotReplace(rows[y], 15, 'sss');
  }
  rows[14] = dotReplace(rows[14], 8, 'eee');
  rows[14] = dotReplace(rows[14], 15, 'eee');
  // 볼터치는 유지
  rows[15] = dotReplace(rows[15], 7, 'b');
  rows[15] = dotReplace(rows[15], 18, 'b');
  return rows;
}

function dotValidate(rows: string[], name: string): void {
  rows.forEach((row, i) => {
    if (row.length !== DOT_W) {
      throw new Error(`sprite ${name} row ${i}: length ${row.length} != ${DOT_W}`);
    }
    for (const ch of row) {
      if (ch !== '.' && !(ch in DOT_PALETTE)) {
        throw new Error(`sprite ${name} row ${i}: unknown char '${ch}'`);
      }
    }
  });
}

function dotGridToCanvas(rows: string[]): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = DOT_W;
  canvas.height = rows.length;
  const ctx = canvas.getContext('2d')!;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = DOT_PALETTE[row[x]];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  });
  return canvas;
}

interface DotFrames {
  /** 서 있는 자세 (눈 뜸) */
  idle: HTMLCanvasElement;
  /** 다리 벌린 걷기 프레임 */
  walk: HTMLCanvasElement;
  /** 서 있는 자세 (눈 감음) */
  blink: HTMLCanvasElement;
  width: number;
  height: number;
}

// 캐릭터 애니메이션 프레임 세트 (시트 기반 / 폴백 공용)
interface CharFrames {
  /** 정면 서있기 — 시트 (1행, 가운데) */
  idle: HTMLCanvasElement;
  /** 왼쪽 이동 프레임 — 시트 2행 */
  left: HTMLCanvasElement[];
  /** 오른쪽 이동 프레임 — 시트 3행 */
  right: HTMLCanvasElement[];
  /** 걷기 재생 순서 (left/right 배열 인덱스) */
  cycle: number[];
  width: number;
  height: number;
}

function cropCell(
  img: HTMLImageElement,
  cw: number,
  ch: number,
  col: number,
  row: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, col * cw, row * ch, cw, ch, 0, 0, cw, ch);
  return canvas;
}

// 3x4 RPG 시트: 1행 정면, 2행 왼쪽, 3행 오른쪽, 4행 뒷모습
function buildSheetFrames(img: HTMLImageElement): CharFrames {
  const cw = Math.floor(img.width / 3);
  const ch = Math.floor(img.height / 4);
  return {
    idle: cropCell(img, cw, ch, 1, 0),
    left: [0, 1, 2].map((col) => cropCell(img, cw, ch, col, 1)),
    right: [0, 1, 2].map((col) => cropCell(img, cw, ch, col, 2)),
    cycle: [0, 1, 2, 1], // 가운데(1)가 중립 포즈인 핑퐁 재생
    width: cw,
    height: ch,
  };
}

// 시트가 없을 때 코드로 찍은 도트 인형으로 폴백
function buildFallbackFrames(): CharFrames {
  const dot = buildDotFrames();
  return {
    idle: dot.idle,
    left: [dot.walk, dot.idle],
    right: [dot.walk, dot.idle],
    cycle: [0, 1],
    width: dot.width,
    height: dot.height,
  };
}

function buildDotFrames(): DotFrames {
  const closedHead = dotClosedEyeHead();
  dotValidate(DOT_HEAD, 'head');
  dotValidate(closedHead, 'head-closed');
  dotValidate(DOT_BODY_STAND, 'body-stand');
  dotValidate(DOT_BODY_WALK, 'body-walk');

  const idleRows = DOT_HEAD.concat(DOT_BODY_STAND);
  const walkRows = DOT_HEAD.concat(DOT_BODY_WALK);
  const blinkRows = closedHead.concat(DOT_BODY_STAND);
  if (idleRows.length !== DOT_H) {
    throw new Error(`sprite total height ${idleRows.length} != ${DOT_H}`);
  }

  return {
    idle: dotGridToCanvas(idleRows),
    walk: dotGridToCanvas(walkRows),
    blink: dotGridToCanvas(blinkRows),
    width: DOT_W,
    height: DOT_H,
  };
}
