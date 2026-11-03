# WalkPlay Web EQ SDK

`walk-play-web-eq-sdk.umd.js`는 사용자의 최신 GitHub main에서 확인한 제조사 원본입니다. 파일을 수정하지 않고 포함했습니다.

- 크기: 94,147바이트
- SHA-256: `9a096081ab1f48e295ddb0f8dcca45bfa629082cacacf550d1af848559d4e579`
- 전역: `window.WalkPlayWebEqSDK`
- 사용 경로: `CB` (CB1300D로 변경하지 않음)
- Report ID: 75
- EQ: 36바이트 × 10
- RAM: `[1,10,4,0,0,255,255]`
- Flash: `[1,1,0]` (**3바이트**)

`DeviceService.js`는 호출 예제이며 이 본체와 다릅니다. 앱은 원본 SDK가 생성한 바이트를 확인해 순차 전송합니다. 합성 SDK는 배포 앱에서 쓰지 않습니다.

`tests/vendor-sdk.test.js`에서 원본 해시·API·패킷·계수·모의 HID 적용을 검증합니다. 실제 DAC와 전원 차단 후 보존은 [출시 전 검증](../docs/출시검증.md)으로 확인합니다.
