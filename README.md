# DotChat

데스크톱 작업표시줄 위를 걸어다니는 도트 캐릭터 온라인 채팅 게임.

## 구조

- `packages/client` — Electron 오버레이 클라이언트 (M1)
- `packages/server` — Node + Socket.IO 서버 (M2 예정)
- `packages/shared` — 클라이언트/서버 공유 타입

## 실행

```bash
npm install
npm run dev
```

### 캐릭터 에셋 준비 (필수)

캐릭터 스프라이트(SuperRetroWorld 에셋 팩)는 재배포 금지 라이선스라 저장소에 포함되어 있지 않습니다.
[gif-superretroworld.itch.io](https://gif-superretroworld.itch.io/)에서 캐릭터 팩을 받은 뒤, 프로젝트 루트에 아래 구조로 배치하세요:

```
sprite_split/
└── character_1/
    └── character_1_frame16x20.png   (3x4 시트: 1행 정면, 2행 왼쪽, 3행 오른쪽)
```

시트가 없으면 앱은 내장 폴백 도트 캐릭터로 실행됩니다.

종료는 트레이 아이콘 우클릭 → 종료.

## 실행 스크립트

```bash
npm run server   # 게임 서버 (포트 4020)
npm run start    # 클라이언트 앱
npm run bot      # 테스트 봇 (두 번째 유저 시뮬레이션)
```

- 선물상자 주기: 기본 5분. 테스트 시 `DOTCHAT_GIFT_SEC` env로 조절 (예: 20)
- 인벤토리 저장 위치: `%APPDATA%\DotChat\inventory.json` (삭제하면 초기화)
- 프로필(닉네임#고유번호): `%APPDATA%\DotChat\profile.json` (삭제하면 첫 실행 설정 창 다시 표시)
- 접속할 서버 주소: `DOTCHAT_SERVER` env (기본 `http://localhost:4020`)

## 로드맵

- [x] M1 — 오프라인 오버레이: 작업표시줄 위를 걸어다니는 캐릭터, 클릭 통과
- [x] M2 — 온라인화: 서버 접속, 채팅 + 말풍선 (5~10초, 길이 비례)
- [x] M3 — 콘텐츠: 선물상자(5분, 클라이언트 로컬 스폰), 치장품 인벤토리, 외모 변경
- [x] M3.5 — 채팅 이미지 전송: 클라 리사이즈(1024px WebP) → 서버 저장 → URL+썸네일 브로드캐스트, 말풍선 썸네일, 분당 2개 제한, 3일 보존 (`packages/server/uploads/`)
- [x] M4 — 옵션(투명도 10~100%), electron-builder 인스톨러, 자동 업데이트 준비, 서버 배포 준비

## 설정

채팅창 ⚙️ 옵션에서 오버레이 콘텐츠 투명도를 조절할 수 있습니다 (10~100%, 즉시 적용·저장).
설정 파일: `%APPDATA%\DotChat\settings.json`

```json
{
  "opacity": 1,
  "serverUrl": "https://내-서버-주소"
}
```

`serverUrl`을 넣으면 패키징된 앱이 해당 서버로 접속합니다 (env `DOTCHAT_SERVER`가 있으면 그쪽이 우선).

## 인스톨러 빌드

```bash
npm run dist
```

결과물: `packages/client/release/DotChat Setup <버전>.exe` (NSIS 원클릭 인스톨러).
코드 서명이 없으므로 Windows SmartScreen 경고가 뜰 수 있습니다("추가 정보" → "실행").
스프라이트 시트는 인스톨러 리소스에 동봉됩니다.

## 자동 업데이트

`electron-updater`가 연결되어 있고, 패키징 앱에서 publish 설정이 있을 때만 동작합니다. 활성화하려면:

1. GitHub 저장소 생성 후 `packages/client/package.json`의 `build`에 추가:
   ```json
   "publish": [{ "provider": "github", "owner": "<계정>", "repo": "<저장소>" }]
   ```
2. `npx electron-builder --win nsis --publish always`로 릴리스 업로드 (GH_TOKEN 필요)
3. 이후 앱 실행 시 새 릴리스를 자동 감지·설치합니다.

## 서버 배포

루트의 `Dockerfile`이 서버 전용 이미지입니다 (클라이언트/Electron 미포함).

**Railway 기준:**
1. GitHub에 푸시 → Railway "New Project" → 저장소 연결 (Dockerfile 자동 인식)
2. Volume 추가, 마운트 경로 `/data/uploads` (이미지 3일 보존 저장소)
3. 배포 후 발급된 도메인을 클라이언트 `serverUrl`(또는 `DOTCHAT_SERVER`)에 설정

`PORT`는 Railway가 주입하는 값을 그대로 사용하고, 이미지 저장 경로는 `UPLOAD_DIR` env로 바꿀 수 있습니다.
정식 오픈 시에는 서울 리전 VPS(Vultr 등)에 같은 Dockerfile로 이전하면 됩니다.
