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

캐릭터 파츠 스프라이트(Hippo "Fantasy Heroes" / PixelFantasy 유니티 에셋)는 재배포 금지 라이선스라 저장소에 포함되어 있지 않습니다. 에셋을 구한 뒤 임포트 스크립트를 실행하세요:

```bash
node tools/import-pixelheroes.mjs "D:/assetsPuller/Assets/PixelFantasy/PixelHeroes"
```

`assets/pixelheroes/<레이어>/<이름>.png` + `manifest.json`이 생성됩니다 (총 ~436개 시트, 576×928 / 64×64 셀).

- 파츠 레이어: 종족세트(Body+Head+Eyes+Arms, Ears), Hair, Armor(+Bracers 자동), Helmet, Weapon, Shield, Mask, Back, Cape, Horns
- 합성 규칙(유니티 CharacterBuilder 포팅)은 `packages/client/src/renderer/composer.ts` 참고
- 첫 로그인: 랜덤 종족 세트 + 랜덤 머리카락 + TravelerTunic
- 선물상자(기본 3분): 종족은 세트로, 나머지는 개별 파츠로 드랍
- 파츠별 HSV 색상 변경 지원 (외모 변경 패널의 색조/채도/명도 슬라이더)

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
  "pinnedMsg": "작업 중이라 자리 비움",
  "pinnedOn": true,
  "serverUrl": "https://내-서버-주소"
}
```

`serverUrl`을 넣으면 패키징된 앱이 해당 서버로 접속합니다 (env `DOTCHAT_SERVER`가 있으면 그쪽이 우선).

### 고정메시지

채팅창 ☰ 메뉴 → 📌 고정메시지에서 캐릭터 닉네임 위에 상시 표시할 한 줄(최대 40자)을 설정합니다.
꼬리 없는 말풍선으로 그려지고, 표시 여부는 체크박스로 켜고 끕니다. 채팅을 보내면 그 말풍선이 뜨는 동안
잠시 숨었다가 사라지면 다시 나타납니다. 다른 접속자에게도 동기화됩니다 (`pinned` / `player-pinned` 이벤트).
프로토콜 검증: `node tools/verify-pinned.mjs` (기본 `localhost:4020`, `DOTCHAT_SERVER`로 대상 변경).

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
