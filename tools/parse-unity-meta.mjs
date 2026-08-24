// Unity .meta 파일에서 스프라이트 프레임 이름/rect 추출
import fs from 'node:fs';

const file = process.argv[2];
const text = fs.readFileSync(file, 'utf8');
const re =
  /name: (\w+)\s*\r?\n\s*rect:\s*\r?\n\s*serializedVersion: \d+\s*\r?\n\s*x: (\d+)\s*\r?\n\s*y: (\d+)\s*\r?\n\s*width: (\d+)\s*\r?\n\s*height: (\d+)/g;
const frames = [];
let m;
while ((m = re.exec(text)) !== null) {
  frames.push({ name: m[1], x: +m[2], y: +m[3], w: +m[4], h: +m[5] });
}
console.log(JSON.stringify(frames, null, 1));
