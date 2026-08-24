# DotChat 게임 서버 (packages/server) 배포용 이미지
FROM node:22-alpine

WORKDIR /app

# 워크스페이스 메타만 먼저 복사해 의존성 레이어 캐시
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/

# 서버 실행에 필요한 워크스페이스만 설치 (electron 다운로드 방지)
RUN npm ci --workspace @dotchat/shared --workspace @dotchat/server

COPY packages/shared packages/shared
COPY packages/server packages/server

RUN npm run build -w @dotchat/shared && npm run build -w @dotchat/server

ENV PORT=4020
ENV UPLOAD_DIR=/data/uploads

EXPOSE 4020

CMD ["node", "packages/server/dist/index.js"]
