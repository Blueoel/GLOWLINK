# GlowLink 기술 설계서

## 1. 개요

GlowLink는 공연, 출범식, 팬 이벤트 등에서 참가자의 스마트폰 화면을 LED 응원봉처럼 활용하는 웹 기반 실시간 조명 제어 시스템이다.

참가자는 별도 앱 설치 없이 공개 HTTPS 링크에 접속해 입장 버튼을 누르고, 관리자는 태블릿 또는 노트북의 관리자 웹 화면에서 색상, 카운트다운, 조명 모드를 중앙 제어한다.

현재 배포 주소는 다음 구조를 사용한다.

- 참가자 화면: `https://glowlink-c0hi.onrender.com/`
- 관리자 화면: `https://glowlink-c0hi.onrender.com/admin.html`
- 배포 플랫폼: Render Web Service
- 저장소: `https://github.com/Blueoel/GLOWLINK`

## 2. 목표

- 참가자가 개인 스마트폰 인터넷 환경에서도 접속할 수 있어야 한다.
- QR 또는 링크로 접속한 참가자가 선착순으로 자동 입장되어야 한다.
- 관리자가 참가자 화면의 색상과 상태를 실시간으로 제어해야 한다.
- 카운트다운 종료 후 관리자가 별도 점등 버튼을 누르지 않아도 자동 점등되어야 한다.
- 관리자 화면에서 참가자 수, 현재 단계, 현재 모드, 실시간 색 현황을 확인할 수 있어야 한다.
- Render 기반 공개 HTTPS 배포가 가능해야 한다.

## 3. 비목표

현재 버전에서 다음 항목은 포함하지 않는다.

- 데이터베이스 저장
- 관리자 계정 로그인 시스템
- 행사별 이력 저장
- 여러 행사의 동시 운영
- 서버 재시작 후 참가자 상태 복원
- 좌석 도면 기반의 물리적 위치 매핑
- 네이티브 앱 또는 Bluetooth 제어

## 4. 시스템 구성

GlowLink는 단일 Node.js HTTP 서버와 정적 프론트엔드 파일로 구성된다.

```text
Browser Participants
  -> HTTPS
  -> Render Web Service
  -> Node.js server.js
  -> public/index.html, participant.js

Admin Tablet
  -> HTTPS
  -> Render Web Service
  -> Node.js server.js
  -> public/admin.html, admin.js
```

서버는 다음 역할을 동시에 수행한다.

- 참가자 화면 정적 파일 제공
- 관리자 화면 정적 파일 제공
- 참가자 입장/퇴장/하트비트 API 제공
- 관리자 명령 API 제공
- Server-Sent Events 기반 실시간 상태 브로드캐스트
- 카운트다운 종료 및 루프 효과 진행

## 5. 주요 파일

- `server.js`: HTTP 서버, API, SSE, 참가자 상태, 쇼 상태 관리
- `public/index.html`: 참가자 화면 HTML
- `public/participant.js`: 참가자 화면 동작, 입장, 타이머, 조명 표시
- `public/admin.html`: 관리자 화면 HTML
- `public/admin.js`: 관리자 화면 동작, 명령 전송, 미리보기, 실시간 현황 표시
- `public/styles.css`: 참가자/관리자 UI 스타일
- `render.yaml`: Render 배포 설정
- `package.json`: Node 실행 스크립트

## 6. 상태 모델

### 6.1 쇼 상태

서버는 메모리에 `showState`를 유지한다.

```js
{
  phase: "lobby" | "countdown" | "light" | "off",
  mode: "solid" | "mix" | "random",
  color: "#111827",
  brightness: 85,
  countdownTo: null,
  title: "지금은 준비중입니다",
  subtitle: "2026 출범식 LIGHT SHOW",
  startAt: timestamp,
  capacity: 300,
  commandId: number
}
```

### 6.2 참가자 상태

참가자는 서버 메모리의 `participants` Map에 저장된다.

```js
{
  id: string,
  slot: number,
  seat: "A01",
  connectedAt: timestamp,
  lastSeen: timestamp,
  color: "#ffffff",
  brightness: 100
}
```

참가자 코드는 현재 `A01`, `A02`, `A03`처럼 A 번호 체계만 사용한다.

## 7. 참가자 입장 및 배정 정책

참가자가 입장 버튼을 누르면 브라우저는 로컬 저장소에 저장된 `clientId`를 사용해 `/api/join`을 호출한다.

서버는 현재 접속자들이 사용 중이지 않은 가장 작은 번호를 찾아 배정한다.

예:

```text
A01, A02, A03 접속
A02 퇴장
새 참가자 입장
-> A02 재배정
```

참가자가 브라우저를 닫으면 `pagehide` 이벤트에서 `/api/leave`를 호출한다. 이 신호가 실패하더라도 서버는 `lastSeen` 기준 15초 이상 갱신되지 않은 참가자를 자동 제거한다.

## 8. 단계와 모드

### 8.1 단계

- `lobby`: 대기 상태
- `countdown`: 카운트다운 상태
- `light`: 점등 상태
- `off`: 종료/OFF 상태

### 8.2 모드

- `solid`: 전체 참가자 동일 색상 점등
- `mix`: 팔레트 기반으로 참가자별 색상이 섞이며 천천히 변화
- `random`: 팔레트 기반으로 참가자별 색상이 무작위로 변화

`mix`와 `random` 모드에서는 밝기를 100%로 고정한다.

## 9. 실시간 통신

실시간 업데이트는 Server-Sent Events를 사용한다.

- Endpoint: `/events`
- Event types: `snapshot`, `command`

서버는 다음 시점에 참가자와 관리자 화면으로 상태를 전송한다.

- 참가자 입장
- 참가자 퇴장
- 참가자 하트비트
- 관리자 명령 실행
- 카운트다운 자동 종료
- 혼합/랜덤 루프 색상 변경
- 주기적 상태 브로드캐스트

SSE를 선택한 이유:

- 브라우저 기본 지원
- 서버에서 클라이언트로 단방향 상태 전송에 적합
- WebSocket보다 구현과 배포가 단순함
- 현재 요구사항은 참가자별 실시간 입력보다 중앙 제어 브로드캐스트가 핵심임

## 10. API 설계

### `GET /healthz`

Render 헬스체크용 엔드포인트.

응답:

```json
{ "ok": true }
```

### `GET /api/state`

현재 쇼 상태와 참가자 목록을 반환한다.

### `POST /api/join`

참가자 입장.

요청:

```json
{ "clientId": "uuid" }
```

### `POST /api/heartbeat`

참가자 연결 유지.

요청:

```json
{ "clientId": "uuid" }
```

### `POST /api/leave`

참가자 퇴장.

요청:

```json
{ "clientId": "uuid" }
```

### `POST /api/command`

관리자 명령 실행.

Render 환경변수 `ADMIN_PIN`이 설정되어 있으면 요청 헤더 `x-admin-pin`이 일치해야 한다.

예:

```json
{
  "phase": "light",
  "mode": "solid",
  "color": "#ff3b30",
  "brightness": 100
}
```

### `POST /api/reset`

참가자 목록 초기화. 행사 설정은 유지한다.

Render 환경변수 `ADMIN_PIN`이 설정되어 있으면 요청 헤더 `x-admin-pin`이 일치해야 한다.

### `GET /events`

SSE 연결을 생성한다.

## 11. 참가자 화면 설계

참가자 화면은 스마트폰 접속을 전제로 한다.

주요 상태:

- 입장 전: 제목, 서브타이틀, 입장 버튼 표시
- 대기: 행사 시작까지 남은 시간 표시
- 카운트다운: 중앙 숫자만 표시
- 점등: 전체 화면을 지정 색상으로 표시
- OFF: 어두운 화면 표시

주요 기능:

- `localStorage`에 참가자 `clientId` 저장
- 입장 상태 저장
- 서버 시간 기준 보정 타이머
- 긴 메인 타이틀 자동 줄바꿈
- Wake Lock API 지원 브라우저에서 화면 유지
- `pagehide` 시 퇴장 신호 전송

참가자 화면에는 조명 중 모드 텍스트를 표시하지 않고 색상만 보여준다.

## 12. 관리자 화면 설계

관리자 화면은 태블릿 사용을 전제로 한다.

현재 레이아웃 순서:

1. 실시간 색 현황
2. 현재 단계 / 현재 모드 / 참가 현황
3. 색상 선택 / 시나리오 컨트롤 / 참가자 화면 미리보기
4. 행사 설정

주요 기능:

- 참가자 실시간 색 현황 표시
- 가로 50개 기준의 참가자 그리드 표시
- 색상 선택
- 밝기 조절
- 단계 제어: 대기, 카운트다운, 종료/OFF
- 모드 제어: 전체 점등, 혼합 루프, 랜덤 루프
- A01 기준 참가자 화면 미리보기
- 메인 타이틀, 서브타이틀, 시작 시간, 카운트다운 초, 인원수 설정
- 참가자 초기화
- 관리자 PIN 입력 및 로컬 저장

## 13. 배포 설계

배포는 Render Web Service를 사용한다.

### Render 설정

- Runtime: Node
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/healthz`
- Auto Deploy: On Commit
- Environment Variable:
  - `ADMIN_PIN`: 관리자 명령 보호용 PIN

### 서버 실행

`package.json`:

```json
{
  "scripts": {
    "start": "node server.js"
  }
}
```

서버는 Render의 `PORT` 환경변수를 사용하며, 공개 배포를 위해 기본 host는 `0.0.0.0`이다.

## 14. 보안 설계

현재 보안은 관리자 명령 보호에 초점을 둔다.

- 참가자 링크는 공개 접근 가능
- 관리자 화면도 URL 접근은 가능
- 실제 명령 실행은 `ADMIN_PIN`으로 보호
- 관리자 브라우저는 입력한 PIN을 `localStorage`에 저장하고 `x-admin-pin` 헤더로 전송

주의:

- `ADMIN_PIN`은 행사 관계자 외 공유하지 않는다.
- 관리자 링크는 참가자에게 공유하지 않는다.
- 현재 방식은 간단한 운영 보호 수준이며, 계정 기반 인증은 아니다.

## 15. 운영 한계

현재 구현은 메모리 기반이다.

따라서 다음 상황에서는 상태가 초기화될 수 있다.

- Render 재배포
- Render 인스턴스 재시작
- 서버 크래시
- 무료/저가 플랜의 슬립 또는 재시작

이 경우 참가자 목록과 현재 조명 상태는 초기화된다. 실제 행사 운영에서는 Render 유료 플랜을 사용하고, 행사 직전 재배포를 피하는 것이 좋다.

## 16. 확장 방향

향후 확장 가능한 기능:

- 데이터베이스 기반 행사 상태 저장
- 관리자 로그인 또는 OAuth 인증
- 행사별 고유 URL
- 좌석/구역 기반 색상 매핑
- 참가자 그룹 제어
- QR 코드 생성 페이지
- 운영 로그 및 명령 이력
- 리허설 모드
- 다중 관리자 권한
- WebSocket 기반 양방향 통신
- 참가자 접속 품질 모니터링

## 17. 테스트 체크리스트

배포 전 확인 항목:

- 참가자 링크 접속 가능
- 입장 버튼 클릭 시 코드 배정
- 퇴장 후 앞 빈 코드 재사용
- 관리자 링크 접속 가능
- 관리자 PIN 없이 명령 차단
- 관리자 PIN 입력 후 명령 실행
- 카운트다운 종료 후 자동 점등
- 전체 점등 색상 변경
- 혼합 루프 색상 변화
- 랜덤 루프 색상 변화
- 혼합/랜덤 밝기 100% 유지
- 실시간 색 현황 50열 표시
- 태블릿 관리자 레이아웃 버튼 넘침 없음
- 스마트폰 참가자 화면 제목/카운트다운/점등 표시 정상

