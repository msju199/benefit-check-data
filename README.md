# benefit-check-data

미니앱 「내 혜택 자격 확인」(가칭)이 읽는 정적 데이터를 매일 만드는 저장소예요.

- 원본: 행정안전부_대한민국 공공서비스(혜택) 정보, https://www.data.go.kr/data/15113968/openapi.do
  - 이용허락범위 제한 없음
- 갱신: `.github/workflows/refresh.yml`이 매일 05:00 KST(20:00 UTC)에 돌아요. Actions 탭에서 수동으로도 돌릴 수 있어요(workflow_dispatch).
- 게시: 검증을 통과한 `out/` 폴더를 `data` 브랜치에 최신 한 벌만 올려요.
  - 앱의 데이터 주소: `https://raw.githubusercontent.com/msju199/benefit-check-data/data`
  - 예: `…/data/meta.json`
- 정부·공공기관의 공식 서비스가 아니에요.

## 필요한 비밀값

| 이름 | 상태 | 넣는 곳 |
|---|---|---|
| `GOV24_SERVICE_KEY` | **아직 없음** | Settings → Secrets and variables → Actions → New repository secret. data.go.kr 15113968 활용신청 후 받은 일반 인증키(Decoding)를 넣어요 |

키가 없으면 워크플로는 경고를 남기고 아무것도 올리지 않은 채 정상 종료해요. 키를 코드, 이슈, 로그에 쓰지 마세요. fetch.mjs는 오류 메시지에서도 키를 `***`로 가려요.

## 안전장치

다음 중 하나라도 걸리면 실패로 끝나고 data 브랜치를 바꾸지 않아요.

- 목록 행 수가 totalCount와 다름
- 고유 ID가 5,000개 미만
- 필수 필드가 없음
- 인증 오류
- 첫 다운로드(meta + 전국 + 시도)가 gzip 1MB 초과

정부 대출·융자·보증 사업은 데이터에서 빼요(`lib/loan.mjs`).

## 로컬 실행

```sh
npm test
GOV24_SERVICE_KEY=... node fetch.mjs --out ./out
node check-links.mjs --out ./out --write
```

규칙과 형식은 앱 저장소 쪽 `DATA-SPEC.md`(benefit-check)에 있어요.
