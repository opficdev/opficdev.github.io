---
title: "React Native 센서 값, 이벤트로 보낼까 큐에 모을까?"
date: "2026-10-25T00:00:00.000Z"
excerpt: "iOS 시뮬레이터와 Android 에뮬레이터에서 가속도계 값을 이벤트로 보내는 스트림과 대조군인 프레임 묶음과 네이티브 큐 세 방식으로 JS에 전달하며 콜백 횟수, 경계 통과 횟수, 지연, JS 타이머 지연, 유실을 반복 측정해 비교한 실험 보고서이다."
categories: architecture
tags: []
---
## 1. 실험 목적

네이티브에서 계속 만들어지는 센서 값을 React Native의 JS로 보내는 방식인 스트림과 큐를 iOS 시뮬레이터와 Android 에뮬레이터에서 같은 조건으로 반복 측정하여 어느 쪽이 어떤 조건에서 더 효율적인지 확인하는 것이 이 실험의 목적이다.

비교하는 방식은 스트림과 큐 두 가지이다. 이 실험의 큐는 JS가 프레임마다 값을 꺼내 가도록 만들었다. 그래서 큐의 이점이 큐라는 구조에서 나오는지 아니면 프레임 단위로 처리하는 데서만 나오는지를 가려내기 위해 대조군인 프레임 묶음을 하나 더 두었다.

## 2. 실험 배경

### 2.1 용어와 원리

React Native 앱에서 JS 코드와 네이티브 코드는 대부분 서로 다른 스레드에서 실행된다. 공식 문서 [Threading Model](https://reactnative.dev/architecture/threading-model)은 UI 스레드를 화면의 뷰를 다룰 수 있는 유일한 스레드로 설명하고 JS 스레드를 React의 렌더 단계와 레이아웃이 실행되는 곳으로 설명한다. JS 스레드는 JS 콜백도 실행한다. JS는 작업 하나가 끝나야 다음 작업을 처리한다. 이 규칙은 [MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Execution_model#run-to-completion)에서 확인할 수 있다. 따라서 JS 스레드에 과부하가 걸리면 콜백과 화면 구성 계산이 그만큼 밀린다.

- 구독: JS가 ‘값이 오면 알려 달라’고 등록하는 것
- 콜백: 값이 왔을 때 JS에서 실행되는 함수
- JS 타이머: `setTimeout`으로 예약한 함수. JS 스레드가 다른 일로 바쁘면 예정보다 늦게 실행된다
- TurboModule: React Native에서 JS가 네이티브 기능을 부르는 통로

- 프레임: 화면이 한 번 갱신되는 단위. `requestAnimationFrame`은 다음 프레임에 맞춰 함수를 실행한다
- 스트림: 값이 만들어질 때마다 이벤트를 하나씩 보낸다. 이벤트 하나마다 JS 스레드에서 콜백이 한 번 실행된다
- 큐: 네이티브가 값을 큐에 넣고 큐가 처음 채워질 때만 ‘읽을 값이 있다’는 신호를 보낸다. JS는 신호를 받으면 프레임마다 `drain`으로 최대 64개를 가져간다. 64는 실험자가 정한 값이다
- 프레임 묶음: 대조군이다. 스트림처럼 이벤트를 샘플마다 받지만 받은 값을 모아 두었다가 프레임마다 한 번에 처리하도록 실험자가 구현하였다. 큐의 이점이 큐 구조에서 나오는지 모아서 처리하는 데서 나오는지 가리려고 두었다
- 경계 통과: JS와 네이티브 사이를 한 번 넘는 일. 이 실험에서는 네이티브에서 JS로 보내는 이벤트 1회와 JS에서 네이티브로 부르는 `drain` 호출 1회를 각각 1회로 센다

공식 문서 [Emitting Events in Native Modules](https://reactnative.dev/docs/the-new-architecture/native-modules-custom-events)는 이벤트가 보내질 때마다 구독한 콜백이 실행된다고만 설명한다. 이벤트가 어떤 스레드의 어떤 작업으로 전달되는지와 메서드의 동기와 비동기 실행 방식, 리스너가 없을 때의 동작은 공식 문서에서 찾지 못했다. 그래서 다음 동작은 React Native 0.88.0의 iOS 소스를 읽고 정리하였다. 이 중 이벤트마다 콜백이 실행된다는 점과 구독 전 값이 사라진다는 점은 이 실험에서 측정으로도 확인하였다. Android의 전달 경로는 소스를 읽지 않았다.

- 네이티브가 이벤트를 보내면 [`EventEmitter.h`](https://github.com/facebook/react-native/blob/v0.88.0/packages/react-native/ReactCommon/react/bridging/EventEmitter.h)의 `emit`이 리스너마다 [`Function.h`](https://github.com/facebook/react-native/blob/v0.88.0/packages/react-native/ReactCommon/react/bridging/Function.h)의 `invokeAsync`로 JS 스레드에서 실행할 콜백을 하나씩 예약한다
- [`RCTTurboModule.mm`](https://github.com/facebook/react-native/blob/v0.88.0/packages/react-native/ReactCommon/react/nativemodule/core/platform/ios/ReactCommon/RCTTurboModule.mm)에서 `void`나 `Promise`를 돌려주는 네이티브 메서드는 네이티브 쪽 큐에서 비동기로 실행되고 그 밖의 반환값이 있는 메서드는 호출한 JS 스레드에서 바로 실행되어 끝날 때까지 JS 스레드가 기다린다
- 이벤트를 보내는 시점에 리스너가 하나도 없으면 `emit`이 돌 목록이 비어 있어서 값은 버려진다
- JS가 모듈을 처음 가져오기 전에는 [`serializeEventEmitter.js`](https://github.com/facebook/react-native/blob/v0.88.0/packages/react-native-codegen/src/generators/modules/GenerateModuleObjCpp/serializeEventEmitter.js)가 만든 이벤트 함수가 아무 일도 하지 않는다

이벤트 횟수를 프레임 단위로 줄이는 방식에는 React Native 안에도 선례가 있다. [ScrollView 문서](https://reactnative.dev/docs/scrollview)는 `onScroll`이 스크롤 중 프레임당 최대 한 번 호출된다고 설명하고 `scrollEventThrottle`로 호출 간격을 더 늘릴 수 있다고 설명한다. 다만 이것은 네이티브 쪽에서 횟수를 제한하는 방식이고 프레임 묶음과 큐의 효과를 보장하는 근거는 아니다.

<img class="theme-image--light" src="/assets/images/posts/rn-native-bidirectional-queue/rn-native-boundary-map-light.png" alt="네이티브의 CoreMotion 콜백이 emit으로 이벤트를 보내면 invokeAsync로 JS 스레드 작업이 되어 JS 코드가 실행되고 JS 코드가 부르는 sync 호출은 JS 스레드에서 메서드 본문을 실행하고 값을 반환하며 async 호출은 dispatch_async로 네이티브 methodQueue 스레드의 메서드 본문으로 가는 흐름">

<img class="theme-image--dark" src="/assets/images/posts/rn-native-bidirectional-queue/rn-native-boundary-map.png" alt="네이티브의 CoreMotion 콜백이 emit으로 이벤트를 보내면 invokeAsync로 JS 스레드 작업이 되어 JS 코드가 실행되고 JS 코드가 부르는 sync 호출은 JS 스레드에서 메서드 본문을 실행하고 값을 반환하며 async 호출은 dispatch_async로 네이티브 methodQueue 스레드의 메서드 본문으로 가는 흐름">

*그림 1. iOS 소스 기준으로 호출 종류별로 실행되는 스레드. 비동기 호출 경로는 이 글의 측정에서 쓰지 않는다.*

### 2.2 효율의 기준

효율을 다음 지표로 정의하였다. 콜백 횟수, 경계 통과 횟수, 지연, JS 타이머 지연, 유실은 낮을수록 좋다. 콜백과 경계 통과가 적으면 JS 스레드의 부담이 작고 JS 타이머 지연이 작으면 다른 JS 작업이 제때 실행되며 지연과 유실이 적으면 값이 제때 도착한 것이다.

- JS 콜백 횟수: 초당 JS가 실행하는 처리 콜백 수. 스트림은 `onSample`, 프레임 묶음은 프레임 처리 함수, 큐는 `drain`으로 받은 값을 처리하는 콜백을 센다. 프레임 묶음의 이벤트 핸들러와 큐의 신호 핸들러는 세지 않는다
- 경계 통과 횟수: 초당 경계를 넘는 횟수
- 지연: 값이 만들어진 시각부터 JS 콜백이 실행되는 시각까지의 시간. 단위는 ms이다
- JS 타이머 지연: 10ms 간격으로 다시 예약하는 타이머가 예정보다 늦게 실행된 시간의 최댓값. 단위는 ms이다
- 유실과 버림: 도착하지 못했거나 버려진 값의 개수

## 3. 가설

1. 큐가 JS 콜백 횟수를 줄인다. 샘플이 많아져도 콜백은 프레임 수를 넘지 않고 스트림은 샘플 수와 같다.
2. 큐는 모든 샘플 속도에서 경계 통과를 줄인다.
3. 콜백 1회의 일이 8ms 이하이면 스트림의 지연이 가장 작다.
4. 콜백 1회의 일이 스트림의 처리 능력을 넘을 만큼 크면 큐의 지연이 스트림보다 작다.
5. 1번과 4번과 6번의 이득은 큐 구조에서 나오며 대조군은 같은 이득을 내지 못한다.
6. 콜백 1회의 일이 스트림의 처리 능력을 넘을 만큼 크면 스트림은 JS 타이머를 크게 늦추고 큐는 수십 ms 이내로만 늦춘다.
7. 일이 샘플마다 걸려 처리 능력을 넘으면 큐도 처리량을 늘리지 못하고 스트림과의 평균 지연 비율이 실험 B보다 작아진다.

5.2의 실험 D와 E는 코드가 설계대로 동작하는지 확인하는 실험이다. 구독 전 값 보존과 정지 때의 버림은 구조상 결과가 거의 정해져 있어서 가설에 넣지 않았다.

## 4. 실험 환경 및 도구


| 항목 | 내용 |
| --- | --- |
| iOS 기기 | iPhone 18 Pro 시뮬레이터, iOS 27.0 |
| Android 기기 | Pixel 8 에뮬레이터, Android 16(API 36) Google APIs arm64-v8a, 화면 주사율 60Hz |
| 앱 | React Native 0.88.0 템플릿 앱 |
| 빌드 | 두 플랫폼 모두 Debug |
| 언어 | Swift, Objective-C++, Kotlin, TypeScript |
| 네이티브 샘플 | iOS 시뮬레이터에는 가속도계가 없고 Android는 같은 조건을 위해 센서 대신 합성한 값. iOS는 `DispatchSource` 타이머에 `.strict` 옵션을 쓰고 Android는 전용 스레드에서 `LockSupport.parkNanos`로 간격을 맞춤 |
| 계측 | 네이티브 카운터는 생산, 이벤트, 신호, `drain` 횟수이고 `uptime`은 샘플 생성 시각과 같은 시계를 읽는다. 시계는 iOS가 `systemUptime`, Android가 `elapsedRealtimeNanos`이다. JS 타이머는 `setTimeout`을 10ms로 다시 예약하며 실행 시각을 `performance.now()`로 읽는다 |
| 결과 수집 | 앱이 결과를 로컬 HTTP 서버로 전송하여 파일에 기록. Android는 `adb reverse`로 같은 서버에 연결 |


변인은 다음과 같이 두었다.

- 독립변인: 전달 방식인 스트림, 프레임 묶음, 큐와 플랫폼인 iOS, Android
- 실험 조건: 샘플 속도 초당 약 30, 63, 100, 125, 250, 1000개와 콜백 1회당 작업 시간 0, 4, 8, 12, 20ms, 샘플 1개당 작업 시간 4, 8, 12ms, 구독 시점, JS 정지 시간 8초
- 종속변인: 2.2의 지표
- 통제변인: 같은 JS 코드와 측정 앱, 플랫폼마다 같은 기기, 같은 네이티브 샘플, 큐 용량 512, 한 번에 가져오는 양 64, 방식마다 3회 반복, 시행 사이 600ms 휴지. 방식의 측정 순서는 시행마다 돌려서 순서 효과를 줄였다

## 5. 실험 방법

### 5.1 프로그램 구성

스트림은 네이티브가 샘플을 만들 때마다 이벤트를 보내고 JS 콜백이 한 번씩 실행된다. 프레임 묶음은 같은 이벤트를 받되 콜백에서는 샘플 생성 시각만 모아 두고 `requestAnimationFrame`에서 한 번만 처리한다. 큐는 네이티브가 샘플을 큐에 넣고 큐가 처음 채워질 때만 신호를 보내며 JS가 프레임마다 `drain`으로 가져간다. 세 방식은 한 모듈에 들어 있고 샘플 생성기가 하나라서 한 번에 하나만 켠다. 시작과 정지는 순서가 중요해서 반환값이 있는 동기 메서드로 두었다. 전체 코드는 부록에 있다. Android는 같은 구조를 Kotlin으로 옮겼다. 큐와 `drain`, 이벤트 방출은 코드젠이 만든 TurboModule 스펙으로 연결하며 `drain`은 `ArrayBuffer`를 돌려준다. JS 코드와 측정 앱은 두 플랫폼에서 같다.

<img class="theme-image--light" src="/assets/images/posts/rn-native-bidirectional-queue/rn-native-stream-flow-light.png" alt="CoreMotion 콜백이 샘플마다 emitOnSample을 호출하고 JS 스레드 작업 대기를 거쳐 onSample 콜백이 샘플마다 한 번씩 실행되는 흐름">

<img class="theme-image--dark" src="/assets/images/posts/rn-native-bidirectional-queue/rn-native-stream-flow.png" alt="CoreMotion 콜백이 샘플마다 emitOnSample을 호출하고 JS 스레드 작업 대기를 거쳐 onSample 콜백이 샘플마다 한 번씩 실행되는 흐름">

*그림 2. 스트림 구조. 샘플을 만드는 부분은 실제 기기에서는 CoreMotion 콜백이고 이 실험에서는 합성 샘플이다.*

<img class="theme-image--light" src="/assets/images/posts/rn-native-bidirectional-queue/rn-native-queue-flow-light.png" alt="CoreMotion 콜백이 SampleQueue에 push하고 큐가 처음 채워질 때 emitOnReadable 신호를 보내면 JS가 requestAnimationFrame으로 drain을 예약해 큐에서 꺼내 onBatch 콜백으로 전달하는 흐름">

<img class="theme-image--dark" src="/assets/images/posts/rn-native-bidirectional-queue/rn-native-queue-flow.png" alt="CoreMotion 콜백이 SampleQueue에 push하고 큐가 처음 채워질 때 emitOnReadable 신호를 보내면 JS가 requestAnimationFrame으로 drain을 예약해 큐에서 꺼내 onBatch 콜백으로 전달하는 흐름">

*그림 3. 큐 구조. 샘플을 만드는 부분은 실제 기기에서는 CoreMotion 콜백이고 이 실험에서는 합성 샘플이다.*

비교하는 것은 스트림과 큐이고 같은 샘플이 두 방식에서 어떻게 전달되는지 시간 순서로 그리면 다음과 같다. 스트림은 샘플마다 경계를 넘고 콜백이 실행된다. 큐는 비어 있던 큐가 채워질 때 신호가 한 번 넘어가고 프레임마다 `drain` 한 번에 샘플을 모아 가져가서 콜백이 한 번 실행된다. 큐의 점선 부분은 프레임 동안 쌓인 값을 프레임 끝에 한 번에 처리하는 동작이다. 대조군인 프레임 묶음이 하는 일이 이것이고 큐의 나머지인 신호와 `drain`은 대조군에 없다.

<img class="theme-image--light" src="/assets/images/posts/rn-native-bidirectional-queue/rn-native-queue-timeline-light.png" alt="샘플이 4ms 간격으로 12개 도착하고 프레임이 세 번 지나는 동안 스트림은 경계 통과와 콜백이 각각 12회이고 큐는 신호 3회와 drain 3회로 경계 통과 6회와 콜백 3회이고 큐의 프레임마다 모아 한 번 처리하는 부분이 점선으로 표시된 흐름">

<img class="theme-image--dark" src="/assets/images/posts/rn-native-bidirectional-queue/rn-native-queue-timeline.png" alt="샘플이 4ms 간격으로 12개 도착하고 프레임이 세 번 지나는 동안 스트림은 경계 통과와 콜백이 각각 12회이고 큐는 신호 3회와 drain 3회로 경계 통과 6회와 콜백 3회이고 큐의 프레임마다 모아 한 번 처리하는 부분이 점선으로 표시된 흐름">

*그림 4. 샘플이 4ms 간격으로 도착하고 프레임이 16.7ms 간격일 때 스트림과 큐의 동작. 점선은 대조군인 프레임 묶음과 같은 동작이다. 측정값이 아니라 동작을 보여 주는 개념도이다.*

### 5.2 절차

모든 실험은 두 플랫폼에서 같은 절차로 따로 돌렸다.

**실험 A. 샘플 속도에 따른 콜백과 경계 통과**

1. 구독한 뒤 네이티브를 켠다. 샘플 간격을 33, 16, 10, 8, 4, 1ms로 줄여 샘플 속도를 초당 약 30개에서 1000개까지 올려 가며 반복한다.
2. 3초 동안 JS 콜백 횟수와 받은 샘플 수를 센다.
3. 정지한 뒤 네이티브 카운터로 생산 수와 경계 통과 횟수를 읽는다.

**실험 B. 샘플 간격 10ms에서 JS가 바쁠 때의 지연**

1. 콜백마다 JS 스레드를 0, 4, 8, 12, 20ms 동안 붙잡는다. 렌더링 같은 실제 작업을 흉내 낸 것이다. 일은 샘플이 아니라 콜백 1회마다 걸린다.
2. 4초 동안 콜백이 실행되는 시각의 `uptime`에서 샘플의 생성 시각을 빼서 지연을 구한다. 한 번에 여러 샘플이 온 경우에는 각각 계산한다.
3. 같은 시간 동안 10ms 간격으로 다시 예약하는 타이머를 돌리고 예정보다 늦게 실행된 시간의 최댓값과 실행 횟수를 기록한다. 측정이 끝났는데도 실행되지 못한 타이머는 그때까지 밀린 시간을 지연에 넣는다.
4. 평균 지연, 최대 지연, 초당 받은 샘플 수를 기록한다.

**실험 C. 샘플 간격 10ms에서 일이 샘플마다 걸릴 때**

1. 샘플 1개마다 JS 스레드를 4, 8, 12ms 동안 붙잡는다. 스트림은 콜백마다 샘플 1개이고 프레임 묶음과 큐는 한 번에 받은 개수만큼 붙잡는다. 12ms는 샘플 간격 10ms보다 길어서 세 방식 모두 처리 능력을 넘는다.
2. 실험 B와 같은 지표를 재고 측정이 끝난 시점에 받지 못한 샘플 수도 기록한다. 이 개수는 생산 수에서 받은 수와 버린 수를 뺀 값이다.

**실험 D. 스트림과 큐의 구독 전 유실**

1. 네이티브를 먼저 켜고 500ms 뒤에 구독한 뒤 300ms 동안 받는다.
2. 샘플에는 1부터 올라가는 번호 `y`가 붙어 있으므로 처음 받은 샘플의 번호에서 1을 뺀 값을 유실로 센다. 프레임 묶음은 이벤트를 받는 방식이 스트림과 같아서 따로 재지 않았다.

**실험 E. JS 8초 정지**

1. 구독하고 네이티브를 켠 뒤 200ms 뒤에 JS 스레드를 8초 동안 붙잡는다.
2. 풀린 뒤 2.5초 동안 받는다. 생산 수, 받은 수, 버린 수와 가장 오래 기다린 값을 기록한다.
3. 풀린 시점부터 지연이 50ms 아래로 내려온 첫 콜백까지의 시간을 회복 시간으로 한다.

## 6. 실험 결과

iOS의 표 1과 표 2는 초당 횟수를 반올림한 정수로 적었다. 이 두 표의 3회 표본표준편차는 각각 최대 1.39와 2.66이었다. 나머지 표의 값은 별도 표시가 없으면 3회 평균 ± 표본표준편차이다. 표본표준편차는 반복 측정값이 평균에서 얼마나 흩어졌는지를 나타낸다.

### 6.1 iOS 시뮬레이터

**표 1. 실험 A: 샘플 속도별 초당 처리 콜백 횟수**

| 샘플 속도 | 스트림 | 프레임 묶음 | 큐 |
| --- | --- | --- | --- |
| 초당 약 30개, 간격 33ms | 30 | 30 | 30 |
| 초당 약 63개, 간격 16ms | 63 | 60 | 59 |
| 초당 100개, 간격 10ms | 100 | 60 | 60 |
| 초당 약 125개, 간격 8ms | 125 | 60 | 60 |
| 초당 250개, 간격 4ms | 250 | 60 | 60 |
| 초당 1000개, 간격 1ms | 1000 | 60 | 60 |


**표 2. 실험 A: 샘플 속도별 초당 경계 통과 횟수**

| 샘플 속도 | 스트림 | 프레임 묶음 | 큐 |
| --- | --- | --- | --- |
| 초당 약 30개, 간격 33ms | 30 | 30 | 61 |
| 초당 약 63개, 간격 16ms | 63 | 63 | 117 |
| 초당 100개, 간격 10ms | 100 | 100 | 120 |
| 초당 약 125개, 간격 8ms | 125 | 125 | 120 |
| 초당 250개, 간격 4ms | 250 | 250 | 120 |
| 초당 1000개, 간격 1ms | 1000 | 1000 | 120 |


**표 3. 실험 B: 콜백 1회당 작업 시간별 평균 지연이며 단위는 ms이다**

| 콜백 1회당 작업 | 스트림 | 프레임 묶음 | 큐 |
| --- | --- | --- | --- |
| 0ms | 0.85 ± 1.08 | 9.36 ± 0.19 | 8.63 ± 1.37 |
| 4ms | 0.08 ± 0.02 | 9.04 ± 0.60 | 9.31 ± 0.17 |
| 8ms | 0.03 ± 0.01 | 9.06 ± 0.25 | 9.35 ± 0.19 |
| 12ms | 337.41 ± 1.88 | 8.58 ± 1.52 | 9.43 ± 0.17 |
| 20ms | 1001.02 ± 1.43 | 10.09 ± 0.05 | 10.21 ± 0.42 |


**표 4. 실험 B: 콜백 1회당 작업 시간별 최대 지연이며 단위는 ms이고 3회 중 최솟값\~최댓값이다**

| 콜백 1회당 작업 | 스트림 | 프레임 묶음 | 큐 |
| --- | --- | --- | --- |
| 0ms | 0.5\~104.6 | 16.3\~16.6 | 16.4\~17.3 |
| 4ms | 0.3\~0.4 | 16.1\~17.2 | 16.4\~16.6 |
| 8ms | 0.2\~1.0 | 16.1\~16.8 | 16.3\~16.6 |
| 12ms | 670.6\~682.2 | 16.3\~16.7 | 16.3\~16.8 |
| 20ms | 1999.6\~2003.0 | 20.2\~21.5 | 20.1\~21.8 |


콜백당 작업 12ms 조건에서 초당 받은 샘플 수는 스트림이 약 83개, 프레임 묶음과 큐가 약 100개였다. 20ms 조건에서는 스트림이 약 50개, 프레임 묶음과 큐가 약 100개였다. 스트림은 측정이 끝난 시점에 받지 못한 샘플이 12ms에서 3회 모두 68\~69개, 20ms에서 201\~202개였다. 프레임 묶음과 큐는 두 조건 모두 1\~2개였다.

**표 5. 실험 B: 콜백 1회당 작업 시간별 JS 타이머 결과**

| 콜백 1회당 작업 | 스트림 | 프레임 묶음 | 큐 |
| --- | --- | --- | --- |
| 0ms | 8\~106 · 236회 | 8\~8 · 239회 | 8\~8 · 240회 |
| 4ms | 9\~10 · 240회 | 10\~11 · 239회 | 10\~11 · 239회 |
| 8ms | 10\~10 · 240회 | 16\~16 · 160회 | 16\~16 · 160회 |
| 12ms | 3991\~3994 · 0회 | 18\~19 · 239회 | 18\~19 · 239회 |
| 20ms | 4000\~4004 · 0회 | 26\~27 · 197회 | 26\~27 · 197회 |

각 칸은 최대 타이머 지연의 3회 중 최솟값\~최댓값과 4초 동안의 평균 실행 횟수이며 지연의 단위는 ms이다. 스트림의 12ms와 20ms 조건은 4초 동안 타이머가 한 번도 실행되지 못해서 지연이 측정 시간과 같다. 실제 지연은 이보다 길 수 있다.

**표 6. 실험 C: 샘플 1개당 작업 시간별 결과**

| 샘플 1개당 작업 | 지표 | 스트림 | 프레임 묶음 | 큐 |
| --- | --- | --- | --- | --- |
| 4ms | 평균 지연(ms) | 0.1 ± 0.0 | 8.5 ± 0.9 | 7.9 ± 1.4 |
| 4ms | 최대 타이머 지연(ms) | 9\~15 | 16\~16 | 16\~17 |
| 8ms | 평균 지연(ms) | 0.0 ± 0.0 | 8.6 ± 1.2 | 9.2 ± 0.3 |
| 8ms | 최대 타이머 지연(ms) | 10\~10 | 24\~25 | 24\~24 |
| 12ms | 평균 지연(ms) | 340.6 ± 3.5 | 174.6 ± 0.4 | 178.2 ± 7.8 |
| 12ms | 최대 타이머 지연(ms) | 3995\~4000 | 734\~734 | 734\~760 |
| 12ms | 초당 받은 샘플 | 83 | 83 | 83 |
| 12ms | 끝난 시점에 못 받은 샘플 | 68\~69 | 75\~75 | 74\~79 |

평균 지연은 3회 평균 ± 표본표준편차이고 단위는 ms이다. 타이머 지연과 못 받은 샘플은 3회 중 최솟값\~최댓값이다. 12ms 조건에서 프레임 묶음과 큐는 측정이 끝난 시각이 각각 평균 4.34초와 4.43초로 4초보다 늦었다. 마지막 콜백이 길게 실행되었기 때문이다. 초당 값은 실제 경과 시간으로 나누었다.

**표 7. 실험 D: 구독 전 유실**

| 방식 | 시행별 구독 전 유실 개수 |
| --- | --- |
| 스트림 | 52, 52, 52 |
| 큐 | 0, 0, 0 |


**표 8. 실험 E: JS 8초 정지. 생산, 받은, 버린은 3회의 범위**

| 방식 | 생산 | 받은 | 버린 | 가장 오래 기다린 값(ms) | 회복(ms) |
| --- | --- | --- | --- | --- | --- |
| 스트림 | 1072\~1072 | 1072\~1072 | 0\~0 | 7996.1 ± 1.0 | 6.7 ± 0.6 |
| 프레임 묶음 | 1072\~1072 | 1072\~1072 | 0\~0 | 8016.8 ± 0.2 | 5.0 ± 0.0 |
| 큐 | 1072\~1072 | 782\~782 | 290\~290 | 5116.1 ± 0.3 | 116.3 ± 0.6 |


<img class="align-center" src="/assets/images/posts/rn-native-bidirectional-queue/rn-native-ios-results.png" alt="iPhone 18 Pro 시뮬레이터 화면에 스트림, 프레임 묶음, 큐 세 방식의 콜백 횟수, 경계 통과 횟수, 지연, 타이머 지연, 유실, JS 정지 결과의 평균이 표시된 측정 앱" width="320">

*그림 5. 앱이 화면에 표시한 측정 평균. 시뮬레이터에서 합성 샘플로 측정한 값이다.*

### 6.2 Android 에뮬레이터

Android는 iOS와 같은 절차와 같은 JS 코드로 측정하였다. 표 9와 표 10은 초당 횟수를 반올림한 정수이고 3회 표본표준편차는 각각 최대 2.06과 2.26이었다. 나머지 표의 값은 6장 첫 문단과 같은 방식이다.

**표 9. 실험 A: Android의 샘플 속도별 초당 처리 콜백 횟수**

| 샘플 속도 | 스트림 | 프레임 묶음 | 큐 |
| --- | --- | --- | --- |
| 초당 약 30개, 간격 33ms | 30 | 30 | 29 |
| 초당 약 63개, 간격 16ms | 62 | 50 | 49 |
| 초당 100개, 간격 10ms | 100 | 59 | 59 |
| 초당 약 125개, 간격 8ms | 125 | 60 | 60 |
| 초당 250개, 간격 4ms | 250 | 60 | 60 |
| 초당 1000개, 간격 1ms | 999 | 60 | 60 |

**표 10. 실험 A: Android의 샘플 속도별 초당 경계 통과 횟수**

| 샘플 속도 | 스트림 | 프레임 묶음 | 큐 |
| --- | --- | --- | --- |
| 초당 약 30개, 간격 33ms | 30 | 30 | 59 |
| 초당 약 63개, 간격 16ms | 62 | 62 | 98 |
| 초당 100개, 간격 10ms | 100 | 100 | 117 |
| 초당 약 125개, 간격 8ms | 125 | 125 | 120 |
| 초당 250개, 간격 4ms | 250 | 250 | 120 |
| 초당 1000개, 간격 1ms | 999 | 999 | 120 |

**표 11. 실험 B: Android의 콜백 1회당 작업 시간별 평균 지연이며 단위는 ms이다**

| 콜백 1회당 작업 | 스트림 | 프레임 묶음 | 큐 |
| --- | --- | --- | --- |
| 0ms | 0.86 ± 0.18 | 8.76 ± 0.33 | 8.16 ± 0.45 |
| 4ms | 0.49 ± 0.04 | 8.07 ± 0.06 | 8.08 ± 0.47 |
| 8ms | 0.29 ± 0.13 | 7.52 ± 0.21 | 7.50 ± 0.59 |
| 12ms | 334.50 ± 0.11 | 8.75 ± 0.57 | 9.81 ± 0.05 |
| 20ms | 1009.99 ± 22.09 | 15.85 ± 1.30 | 15.23 ± 0.13 |

콜백당 작업 12ms 조건에서 초당 받은 샘플 수는 스트림이 약 83개, 프레임 묶음과 큐가 약 100개였다. 20ms 조건에서는 스트림이 약 50개, 프레임 묶음과 큐가 약 100개였다. 측정이 끝난 시점에 받지 못한 샘플은 스트림이 12ms에서 68개, 20ms에서 201\~203개였고 프레임 묶음과 큐는 두 조건 모두 0\~2개였다.

**표 12. 실험 B: Android의 콜백 1회당 작업 시간별 JS 타이머 결과**

| 콜백 1회당 작업 | 스트림 | 프레임 묶음 | 큐 |
| --- | --- | --- | --- |
| 0ms | 23\~36 · 234회 | 20\~22 · 231회 | 19\~24 · 232회 |
| 4ms | 21\~24 · 207회 | 22\~23 · 168회 | 22\~23 · 166회 |
| 8ms | 22\~30 · 157회 | 18\~28 · 160회 | 18\~23 · 160회 |
| 12ms | 592\~687 · 17회 | 25\~27 · 210회 | 25\~28 · 197회 |
| 20ms | 1652\~1914 · 6회 | 32\~132 · 119회 | 29\~38 · 119회 |

각 칸은 최대 타이머 지연의 3회 중 최솟값\~최댓값과 4초 동안의 평균 실행 횟수이며 지연의 단위는 ms이다.

**표 13. 실험 C: Android의 샘플 1개당 작업 시간별 결과**

| 샘플 1개당 작업 | 지표 | 스트림 | 프레임 묶음 | 큐 |
| --- | --- | --- | --- | --- |
| 4ms | 평균 지연(ms) | 0.7 ± 0.3 | 7.9 ± 0.0 | 7.5 ± 0.1 |
| 4ms | 최대 타이머 지연(ms) | 23\~58 | 18\~21 | 18\~23 |
| 8ms | 평균 지연(ms) | 0.2 ± 0.0 | 24.0 ± 2.0 | 22.5 ± 2.1 |
| 8ms | 최대 타이머 지연(ms) | 22\~29 | 49\~64 | 49\~54 |
| 12ms | 평균 지연(ms) | 344.0 ± 12.4 | 237.3 ± 11.2 | 235.8 ± 17.0 |
| 12ms | 최대 타이머 지연(ms) | 651\~727 | 903\~991 | 772\~780 |
| 12ms | 초당 받은 샘플 | 82 | 80 | 80 |
| 12ms | 끝난 시점에 못 받은 샘플 | 68\~74 | 90\~98 | 84\~93 |

평균 지연은 3회 평균 ± 표본표준편차이고 단위는 ms이다. 타이머 지연과 못 받은 샘플은 3회 중 최솟값\~최댓값이다. 12ms 조건에서 프레임 묶음과 큐는 측정이 끝난 시각이 각각 평균 4.75초와 4.38초로 4초보다 늦었다. 초당 값은 실제 경과 시간으로 나누었다.

실험 D의 구독 전 유실은 iOS와 같이 스트림이 3회 모두 52개, 큐가 0개였다.

**표 14. 실험 E: Android의 JS 8초 정지. 생산, 받은, 버린은 3회의 범위**

| 방식 | 생산 | 받은 | 버린 | 가장 오래 기다린 값(ms) | 회복(ms) |
| --- | --- | --- | --- | --- | --- |
| 스트림 | 1072\~1073 | 1072\~1073 | 0\~0 | 7994.3 ± 3.8 | 4.0 ± 0.0 |
| 프레임 묶음 | 1072\~1074 | 1072\~1072 | 0\~0 | 8015.2 ± 0.5 | 16.0 ± 1.7 |
| 큐 | 1073\~1074 | 782\~782 | 290\~290 | 5114.9 ± 3.3 | 132.3 ± 2.3 |

<img class="align-center" src="/assets/images/posts/rn-native-bidirectional-queue/rn-native-android-results.png" alt="Android 에뮬레이터 화면에 스트림, 프레임 묶음, 큐 세 방식의 콜백 횟수, 경계 통과 횟수, 지연, 타이머 지연, 유실, JS 정지 결과의 평균이 표시된 측정 앱" width="320">

*그림 6. Android 에뮬레이터에서 앱이 화면에 표시한 측정 평균. 화면의 simulator 문구는 앱에 고정된 표시이며 합성 샘플로 측정한 값이다.*

## 7. 고찰

### 7.1 가설 검증


- **가설 1. 큐가 콜백 횟수를 줄인다**
	- iOS: 지지. 큐는 샘플이 초당 63개 이상일 때 콜백이 약 60회로 고정되고 스트림은 샘플 수와 같았다. 초당 1000개에서 1000 대 60이었다.
	- Android: 지지. 큐는 초당 100개 이상에서 약 59\~60회로 고정되었고 63개에서는 49회였다. 초당 1000개에서 999 대 60이었다.
- **가설 2. 큐가 모든 속도에서 경계 통과를 줄인다**
	- iOS: 반증. 초당 30개에서 스트림 30 대 큐 61, 100개에서 100 대 120, 125개에서 125 대 120, 1000개에서 1000 대 120이었다. 초당 125개 이상에서만 큐가 적었다.
	- Android: 반증. 초당 30개에서 30 대 59, 100개에서 100 대 117, 125개에서 125 대 120, 1000개에서 999 대 120이었다. 초당 125개 이상에서만 큐가 적었다.
- **가설 3. 콜백 1회의 일이 8ms 이하이면 스트림의 지연이 작다**
	- iOS: 지지. 콜백당 작업 0, 4, 8ms에서 스트림 0.03\~0.85ms 대 큐 8.63\~9.35ms였다.
	- Android: 지지. 스트림 0.29\~0.86ms 대 큐 7.50\~8.16ms였다.
- **가설 4. 콜백 1회의 일이 처리 능력을 넘을 만큼 크면 큐의 지연이 작다**
	- iOS: 조건부. 12ms에서 스트림 337.41ms 대 큐 9.43ms, 20ms에서 1001.02ms 대 10.21ms였다. 8ms 이하에서는 스트림이 더 작아서 12ms 이상에서만 지지된다.
	- Android: 조건부. 12ms에서 334.50ms 대 9.81ms, 20ms에서 1009.99ms 대 15.23ms였다. 8ms 이하에서는 스트림이 더 작아서 12ms 이상에서만 지지된다.
- **가설 5. 이득이 큐 구조에서 나온다**
	- iOS: 반증. 12ms와 20ms에서 프레임 묶음 8.58ms와 10.09ms가 큐 9.43ms와 10.21ms와 같았다. 콜백은 12ms에서 약 60회, 20ms에서 약 49회로 같았고 최대 타이머 지연도 18\~19ms와 26\~27ms로 같았다.
	- Android: 반증. 프레임 묶음 8.75ms와 15.85ms가 큐 9.81ms와 15.23ms와 비슷했다. 12ms에서 최대 타이머 지연은 프레임 묶음 25\~27ms와 큐 25\~28ms였다. 20ms에서는 프레임 묶음이 32\~132ms로 큐 29\~38ms보다 넓었다.
- **가설 6. 스트림은 타이머를 크게 늦추고 큐는 수십 ms 이내로만 늦춘다**
	- iOS: 조건부. 12ms와 20ms에서 스트림은 4초 동안 타이머가 0회 실행되었다. 큐는 12ms에서 최대 지연 18\~19ms로 약 239회, 20ms에서 26\~27ms로 약 197회 실행되었다. 8ms에서는 스트림 10ms 대 큐 16ms여서 12ms 이상에서만 지지된다.
	- Android: 조건부. 12ms에서 스트림은 최대 지연 592\~687ms로 17회, 큐는 25\~28ms로 197회 실행되었다. 20ms에서는 스트림 1652\~1914ms로 6회, 큐 29\~38ms로 119회였다. 12ms 이상에서만 지지된다.
- **가설 7. 일이 샘플마다 걸려 처리 능력을 넘으면 큐도 처리량을 늘리지 못하고 지연 비율이 줄어든다**
	- iOS: 지지. 샘플당 12ms에서 세 방식 모두 초당 83개를 받았다. 평균 지연은 스트림 340.6ms 대 큐 178.2ms로 약 2배였고 콜백당 12ms의 337.41ms 대 9.43ms는 약 36배였다.
	- Android: 지지. 샘플당 12ms에서 초당 82개, 80개, 80개를 받았다. 평균 지연은 344.0ms 대 235.8ms로 약 1.5배였고 콜백당 12ms의 334.50ms 대 9.81ms는 약 34배였다.


### 7.2 해석

별도 표시가 없는 내용은 iOS 시뮬레이터 결과이고 Android는 따로 표시하였다. 세부 수치는 7.1과 6장의 표에 있다.

- **콜백 횟수와 지연의 이득은 프레임 단위 처리에서 나왔다**
	- 큐와 프레임 묶음은 콜백이 초당 약 60회로 고정되었고 지연도 같았다. 큐라는 구조가 아니라 무거운 일이 프레임마다 한 번만 실행된 점이 이득의 원인으로 보인다.
	- 콜백당 12ms에서 스트림은 콜백이 초당 100번 불려 1초에 1.2초 분량의 일을 받아 초당 약 83개만 처리했다. 프레임 묶음과 큐는 60번이라 0.72초 분량이어서 감당했다.
	- 스트림의 평균 지연 337ms는 4초 동안만 잰 값이다. 이벤트가 계속 쌓이는 상태여서 시간이 지날수록 초당 약 170ms씩 커진다고 볼 수 있다.
	- 콜백이 가벼우면 차이가 작다. 8초 정지 뒤 스트림은 밀린 콜백 약 800개를 7ms 만에 처리해 콜백 하나에 약 10µs가 들었다. 이 정도면 초당 1000번 불려도 JS 스레드의 몇 %만 쓴다.
- **스트림이 과부하일 때 타이머가 막혔다**
	- iOS: 콜백당 12ms와 20ms에서 스트림은 4초 동안 타이머가 한 번도 실행되지 못했다. 프레임 묶음과 큐는 일이 프레임마다 한 번만 실행되어 JS 스레드에 쉬는 시간이 남았고 그 사이에 타이머가 실행된 것으로 보인다. 타이머와 콜백이 실행되는 순서는 확인하지 않았다. 7.3의 첫 시도에서 종료용 타이머가 실행되지 못한 것도 같은 현상으로 보인다.
	- Android: 스트림도 완전히 막히지는 않아서 12ms에서 17회, 20ms에서 6회 실행되었다. 다만 최대 지연이 592\~1914ms로 프레임 묶음과 큐의 25\~132ms보다 훨씬 컸다. 덜 막힌 이유는 확인하지 않았다.
	- 일이 8ms 이하로 가벼울 때는 반대였다. 스트림의 타이머 지연은 약 8\~10ms였고 프레임 묶음과 큐는 iOS 8ms에서 16ms였다. iOS에서는 타이머가 4초 동안 약 240회, 초당 약 60회만 실행되어 프레임마다 한 번씩 실행되는 것으로 보인다.
- **일이 샘플마다 걸리면 큐의 이득이 줄었다**
	- 샘플당 12ms는 일이 샘플 간격보다 길어서 세 방식 모두 처리 능력이 같았다. 처리량과 측정이 끝난 시점에 받지 못한 샘플 수도 비슷했다. 프레임 묶음과 큐는 처리 능력을 늘리지 못하고 지연과 타이머만 덜 막는다.
	- iOS: 평균 지연은 스트림의 약 절반이었다. 타이머는 스트림이 한 번도 실행되지 못했고 프레임 묶음과 큐는 18회 실행되었지만 최대 734\~760ms 늦었다.
	- Android: 평균 지연은 스트림의 약 2/3로 이득이 더 작았다. 타이머는 프레임 묶음과 큐의 최대 지연이 903\~991ms와 772\~780ms로 스트림의 651\~727ms보다 길었다.
	- 일이 샘플 간격의 80%만큼 걸리는 샘플당 8ms에서는 두 플랫폼 모두 스트림의 지연과 타이머가 가장 작았다. Android에서는 프레임 묶음과 큐의 평균 지연이 22\~24ms, 최대 타이머 지연이 49\~64ms로 차이가 더 컸다. 원인은 확인하지 않았다.
- **경계 통과는 큐만의 효과였다**
	- 프레임 묶음은 이벤트를 샘플마다 받으므로 경계 통과가 스트림과 같았다. 큐는 프레임마다 신호 1번과 `drain` 1번을 쓰므로 샘플이 초당 60개를 넘으면 약 120회로 고정되었다.
	- 교차점은 두 플랫폼 모두 초당 100개와 125개 사이였다. 초당 30개에서는 큐가 두 배 많았고 1000개에서는 스트림의 약 1/8이었다. 경계를 한 번 넘는 비용은 재지 않았다.
- **지연은 JS가 한가할 때 스트림이 가장 작았다**
	- 프레임 묶음과 큐는 값이 만들어진 뒤 다음 프레임이 올 때까지 기다려서 평균 지연이 프레임 간격 약 16.7ms의 절반 안팎이다.
	- iOS에서 스트림의 최대 지연이 콜백당 작업 0ms 조건의 3회 중 1회에서 104.6ms로 튀었고 같은 시행의 타이머 지연도 106ms였다. 원인은 확인하지 않았다.
- **구독 전 값은 큐에서만 남았다**
	- 스트림은 3회 모두 52개를 잃었고 큐는 하나도 잃지 않았다. 두 플랫폼이 같았다.
	- 스트림에 버퍼가 없다는 구조에서 정해진 결과여서 동작 확인에 가깝다. 큐는 512개까지 쌓아 두므로 초당 100개에서는 약 5초치까지 남는다.
- **JS 정지 뒤에는 스트림이 더 빨리 회복했다**
	- 스트림과 프레임 묶음은 생산된 값을 모두 받았고 큐는 가장 오래된 290개를 버렸다. 큐는 남은 512개를 프레임마다 64개씩 8프레임에 걸쳐 오래된 값부터 내보내서 회복에 iOS 116\~117ms, Android 131\~135ms가 걸렸다. 가장 오래 기다린 값 5116ms는 512개 × 10ms에서 나온 값이다.
	- 큐는 최신 값이 가장 늦게 도착한다. 최근 값만 필요한 목적이라면 큐에 불리하다. 최신 값부터 꺼내는 방식은 만들지 않았다.
	- 프레임 묶음의 회복은 iOS 5.0ms, Android 16.0ms이고 스트림은 6.7ms와 4.0ms였다. 플랫폼 차이의 원인은 확인하지 않았다.

### 7.3 오차 요인과 한계

- **측정 환경**
	- 실제 기기가 아니라 iOS 시뮬레이터와 Android 에뮬레이터에서 합성 샘플로 쟀다. 두 환경 모두 `requestAnimationFrame`이 초당 약 60회여서 120Hz 기기에서는 큐의 콜백과 경계 통과가 늘어 교차점이 높아질 수 있다.
	- Debug 빌드만 쟀다. 개발 모드의 JS 비용이 섞였을 수 있다.
- **측정 방식**
	- 콜백 횟수는 처리 콜백만 센 값이다. 프레임 묶음의 이벤트 핸들러와 큐의 신호 핸들러는 세지 않았다.
	- 지연은 콜백이 실행된 시각까지만 쟀고 화면에 반영되는 시각은 재지 않았다. 콜백마다 `uptime`을 동기로 호출해서 스트림에 부담을 더 주었을 수 있다. 실험 A는 지연을 재지 않아 이 영향이 없다.
	- JS 타이머 지연은 4초 안의 최댓값이라 이상치에 민감하다. 스트림이 막힌 조건에서는 값이 측정 시간과 같아 실제 지연은 더 길 수 있다. 타이머를 함께 돌린 영향은 비교하지 않았고 Android 20ms에서 프레임 묶음이 1회 132ms까지 늘어난 원인도 확인하지 않았다.
	- 콜백당 작업과 샘플당 작업은 JS 스레드를 붙잡아 흉내 낸 값이어서 실제 렌더링과 다르다. `drain`이 JS 스레드를 붙잡는 시간, 메모리, CPU 사용량은 재지 않았다.
- **비교의 한계**
	- 스트림과 큐는 값의 형식도 다르다. 스트림은 샘플마다 객체를 넘기고 큐는 `ArrayBuffer`를 돌려준다. 이 영향은 분리하지 못했다.
	- 대조군은 JS에서 프레임마다 처리하는 방식 하나뿐이다. 네이티브에서 모아 이벤트 한 번에 여러 개를 보내는 방식은 재지 않았다.
	- 플랫폼별 네이티브 구현을 Swift와 Kotlin으로 따로 써서 플랫폼 차이가 런타임에서 오는지 구현에서 오는지 가르지 못했다. Android 에뮬레이터는 호스트 Mac의 자원에도 영향을 받는다.
	- 큐 용량 512와 `drain` 최대 개수 64는 실험자가 정했고 바꿔 가며 재지 않았다. 용량은 정지 때 버려지는 개수에, 64는 회복 시간에 영향을 준다. 64개씩이면 초당 3840개까지 처리해 실험한 최대 속도 1000개보다 크다.
	- 스트림이 쌓아 두는 이벤트의 상한은 소스에서 찾지 못했고 약 800개가 쌓인 경우에도 버려진 값이 없었다.
- **통계와 과정**
	- 모든 반복을 한 세션에서 연속으로 돌렸다. 표준편차가 작은 것은 같은 조건이 거의 같게 반복되었다는 뜻일 수 있고 독립인 반복이라고 보기는 어렵다.
	- iOS의 첫 시도에서 콜백당 12ms의 스트림이 7분 넘게 끝나지 않았다. 종료용 4초 타이머가 실행되지 못한 것으로 추정하며 이후 타이머 지연 측정에서 같은 현상이 보였으나 당시 상황은 재현하지 않았다. 종료를 콜백 안에서 직접 하도록 고치고 실험 A의 구독 순서도 바로잡은 뒤의 값이 위 결과이다.

## 8. 결론

iOS 시뮬레이터와 Android 에뮬레이터의 합성 샘플 조건에서 얻은 결론이다.

- 콜백마다 무거운 일이 걸려 JS가 밀리는 문제는 큐 없이 프레임 묶음으로 풀렸다. 지연이 큐와 같았고 스트림이 막은 타이머도 풀렸다.
- 큐만의 이점은 세 가지이다. 경계 통과를 초당 약 120회로 고정하고 구독 전 값을 보존하며 쌓이는 양에 상한을 둔다.
- 큐의 대가는 두 가지이다. 프레임을 기다려 지연이 약 9ms 늘고 정지 뒤 회복이 느리다.
- 일이 샘플마다 걸려 처리 능력을 넘으면 프레임 묶음과 큐도 처리량을 늘리지 못했다.
- Android에서는 일이 샘플 간격의 80%만큼 걸리면 스트림이 지연과 타이머 모두 더 나았다.

선택 기준은 다음과 같다.

- 샘플이 적고 콜백이 가벼우면 스트림
- 콜백마다 무거운 일이 걸려 JS가 밀리면 프레임 묶음
- 경계 통과 비용이 문제가 될 만큼 샘플이 초당 수백 개 이상이거나 구독 전 값 보존과 버퍼 상한이 필요하면 큐

실제 기기는 측정하지 않았으므로 이 결론과 기준은 두 환경에 한정되며 실제 기기와 실제 센서에서는 다시 확인해야 한다.

## 부록. 실험 코드

<details markdown="1">
<summary>A. 큐 코드</summary>

```swift
import Foundation

struct Sample {
	let t: Double
	let x: Double
	let y: Double
	let z: Double

	static let zero = Sample(t: 0, x: 0, y: 0, z: 0)
}

final class SampleQueue {
	private let lock = NSLock()
	private let capacity: Int
	private var storage: [Sample]
	private var head = 0
	private var count = 0
	private var dropped = 0
	private var signaled = false

	init(capacity: Int) {
		self.capacity = capacity
		storage = Array(repeating: .zero, count: capacity)
	}

	func clear() {
		lock.lock()
		defer { lock.unlock() }
		head = 0
		count = 0
		dropped = 0
		signaled = false
	}

	// 신호를 보내야 하면 true를 반환한다
	func push(_ sample: Sample) -> Bool {
		lock.lock()
		defer { lock.unlock() }
		if count == capacity {
			head = (head + 1) % capacity
			count -= 1
			dropped += 1
		}
		storage[(head + count) % capacity] = sample
		count += 1
		if signaled { return false }
		signaled = true
		return true
	}

	func drain(max: Int) -> (samples: [Sample], dropped: Int) {
		lock.lock()
		defer { lock.unlock() }
		let n = min(max, count)
		var samples = [Sample]()
		samples.reserveCapacity(n)
		for i in 0..<n {
			samples.append(storage[(head + i) % capacity])
		}
		head = (head + n) % capacity
		count -= n
		let lost = dropped
		dropped = 0
		if count == 0 { signaled = false }
		return (samples, lost)
	}
}
```

</details>

<details markdown="1">
<summary>B. 모듈 본체 코드</summary>

```swift
import CoreMotion

@objc(AccelerometerBridge)
public final class AccelerometerBridge: NSObject {
	@objc public var onReadable: (() -> Void)?
	@objc public var onSample: (([String: Double]) -> Void)?

	private struct Counters {
		var produced = 0
		var emitted = 0
		var signals = 0
		var drains = 0
		var alphaCalls = 0
	}

	private let motion = CMMotionManager()
	private let updates = OperationQueue()
	private let queue = SampleQueue(capacity: 512)
	private let lock = NSLock()
	private var alpha = 1.0
	private var last: Sample?
	private var counters = Counters()

	public override init() {
		updates.maxConcurrentOperationCount = 1
		super.init()
	}

	// 큐 방식: 큐에 넣고 처음 채워질 때만 신호를 보낸다
	@objc public func start(intervalMs: Double) {
		queue.clear()
		startUpdates(intervalMs: intervalMs) { [weak self] sample in
			guard let self else { return }
			if queue.push(sample) {
				bump { $0.signals += 1 }
				onReadable?()
			}
		}
	}

	// 스트림 방식: 샘플마다 바로 보낸다
	@objc public func startStream(intervalMs: Double) {
		startUpdates(intervalMs: intervalMs) { [weak self] sample in
			guard let self else { return }
			bump { $0.emitted += 1 }
			onSample?(["t": sample.t, "x": sample.x, "y": sample.y, "z": sample.z])
		}
	}

	@objc public func stop() {
		motion.stopAccelerometerUpdates()
		lock.lock()
		last = nil
		lock.unlock()
	}

	@objc public func setAlpha(_ value: Double) {
		lock.lock()
		alpha = value
		counters.alphaCalls += 1
		lock.unlock()
	}

	// [dropped, t, x, y, z, t, x, y, z, ...] 순서의 Float64 배열을 반환한다
	@objc public func drain(max: Int) -> NSMutableData {
		bump { $0.drains += 1 }
		let result = queue.drain(max: max)
		var values = [Double]()
		values.reserveCapacity(1 + result.samples.count * 4)
		values.append(Double(result.dropped))
		for sample in result.samples {
			values.append(contentsOf: [sample.t, sample.x, sample.y, sample.z])
		}
		return values.withUnsafeBufferPointer {
			NSMutableData(bytes: $0.baseAddress, length: $0.count * MemoryLayout<Double>.stride)
		}
	}

	// 실험용 계측: [생산, 스트림 emit, 큐 신호, drain 호출, setAlpha 실행] 횟수
	@objc public func stats() -> NSMutableData {
		lock.lock()
		defer { lock.unlock() }
		let values = [counters.produced, counters.emitted, counters.signals, counters.drains, counters.alphaCalls].map(Double.init)
		return values.withUnsafeBufferPointer {
			NSMutableData(bytes: $0.baseAddress, length: $0.count * MemoryLayout<Double>.stride)
		}
	}

	// 실험용 계측: 샘플의 t와 같은 시계(부팅 후 경과 시간, 초)
	@objc public func uptime() -> Double {
		ProcessInfo.processInfo.systemUptime
	}

	private func bump(_ change: (inout Counters) -> Void) {
		lock.lock()
		change(&counters)
		lock.unlock()
	}

	private func startUpdates(intervalMs: Double, deliver: @escaping (Sample) -> Void) {
		guard motion.isAccelerometerAvailable else { return }
		motion.accelerometerUpdateInterval = intervalMs / 1000
		motion.startAccelerometerUpdates(to: updates) { [weak self] data, _ in
			guard let self, let data else { return }
			let raw = Sample(t: data.timestamp, x: data.acceleration.x, y: data.acceleration.y, z: data.acceleration.z)
			bump { $0.produced += 1 }
			deliver(filtered(raw))
		}
	}

	private func filtered(_ raw: Sample) -> Sample {
		lock.lock()
		defer { lock.unlock() }
		guard let previous = last else {
			last = raw
			return raw
		}
		let next = Sample(
			t: raw.t,
			x: previous.x + alpha * (raw.x - previous.x),
			y: previous.y + alpha * (raw.y - previous.y),
			z: previous.z + alpha * (raw.z - previous.z)
		)
		last = next
		return next
	}
}
```

시뮬레이터에는 가속도계가 없어서 테스트 앱의 위 파일에만 아래 합성 네이티브 샘플 타이머를 더했다. `startUpdates`의 `guard motion.isAccelerometerAvailable else { ... }` 분기에서 `startSynthetic(intervalMs:deliver:)`를 부르며 `stop()`에서는 `timer?.cancel()`을 호출한다.

```swift
	private var timer: DispatchSourceTimer?
	private var counter = 0

	// 테스트 전용: 가속도계가 없는 시뮬레이터에서 합성 샘플을 같은 경로로 넣는다
	private func startSynthetic(intervalMs: Double, deliver: @escaping (Sample) -> Void) {
		timer?.cancel()
		counter = 0
		let source = DispatchSource.makeTimerSource(flags: .strict, queue: DispatchQueue(label: "synthetic", qos: .userInteractive))
		source.schedule(deadline: .now(), repeating: .nanoseconds(Int(intervalMs * 1_000_000)), leeway: .nanoseconds(0))
		source.setEventHandler { [weak self] in
			guard let self else { return }
			counter += 1
			let raw = Sample(t: ProcessInfo.processInfo.systemUptime, x: counter % 2 == 0 ? 1 : -1, y: Double(counter), z: 0)
			bump { $0.produced += 1 }
			deliver(filtered(raw))
		}
		timer = source
		source.resume()
	}
```

</details>

<details markdown="1">
<summary>C. TurboModule 연결 코드</summary>

```json
{
	"codegenConfig": {
		"name": "AccelerometerSpec",
		"type": "modules",
		"jsSrcsDir": "src",
		"ios": {
			"modulesProvider": {
				"NativeAccelerometer": "RCTNativeAccelerometer"
			}
		}
	}
}
```

```objc
// RCTNativeAccelerometer.h
#import <Foundation/Foundation.h>
#import <AccelerometerSpec/AccelerometerSpec.h>

@interface RCTNativeAccelerometer : NativeAccelerometerSpecBase <NativeAccelerometerSpec>
@end

// RCTNativeAccelerometer.mm
#import "RCTNativeAccelerometer.h"
#import <React-RCTAppDelegate/RCTDefaultReactNativeFactoryDelegate.h>
#import "AccelTest-Swift.h"

@implementation RCTNativeAccelerometer {
	AccelerometerBridge *_bridge;
}

- (instancetype)init
{
	if (self = [super init]) {
		_bridge = [AccelerometerBridge new];
		__weak RCTNativeAccelerometer *weakSelf = self;
		_bridge.onReadable = ^{
			[weakSelf emitOnReadable];
		};
		_bridge.onSample = ^(NSDictionary<NSString *, NSNumber *> *sample) {
			[weakSelf emitOnSample:sample];
		};
	}
	return self;
}

- (NSNumber *)start:(double)intervalMs { [_bridge startWithIntervalMs:intervalMs]; return @YES; }
- (NSNumber *)startStream:(double)intervalMs { [_bridge startStreamWithIntervalMs:intervalMs]; return @YES; }
- (NSNumber *)stop { [_bridge stop]; return @YES; }
- (void)setAlpha:(double)alpha { [_bridge setAlpha:alpha]; }
- (NSMutableData *)drain:(double)max { return [_bridge drainWithMax:(NSInteger)max]; }
- (NSMutableData *)stats { return [_bridge stats]; }
- (NSNumber *)uptime { return @([_bridge uptime]); }

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params
{
	return std::make_shared<facebook::react::NativeAccelerometerSpecJSI>(params);
}

+ (NSString *)moduleName { return @"NativeAccelerometer"; }

@end
```

```ts
// NativeAccelerometer.ts
import type { TurboModule, CodegenTypes } from 'react-native'
import { TurboModuleRegistry } from 'react-native'

export type Sample = { t: number; x: number; y: number; z: number }

export interface Spec extends TurboModule {
	// 시작과 정지는 순서가 중요해서 반환값이 있는 동기 메서드로 둔다
	start(intervalMs: number): boolean // 큐 방식
	startStream(intervalMs: number): boolean // 스트림 방식
	stop(): boolean
	setAlpha(alpha: number): void
	drain(max: number): ArrayBuffer
	stats(): ArrayBuffer // 실험용 계측
	uptime(): number // 실험용 계측
	readonly onReadable: CodegenTypes.EventEmitter<void>
	readonly onSample: CodegenTypes.EventEmitter<Sample>
}

export default TurboModuleRegistry.getEnforcing<Spec>('NativeAccelerometer')
```

</details>

<details markdown="1">
<summary>D. JS 구독 함수 코드</summary>

```ts
// accelerometer.ts
import NativeAccelerometer, { type Sample } from './NativeAccelerometer'

export const STRIDE = 4
const MAX_PER_DRAIN = 64

export type Batch = { dropped: number; samples: Float64Array }

// 스트림: 샘플마다 콜백이 한 번 불린다
export function attachStream(onSample: (sample: Sample) => void) {
	const subscription = NativeAccelerometer.onSample(onSample)
	return () => subscription.remove()
}

// 큐: 신호가 오면 프레임마다 최대 64개를 가져와 콜백을 한 번 부른다
export function attachQueue(onBatch: (batch: Batch) => void) {
	let frame: number | null = null

	const schedule = () => {
		if (frame === null) frame = requestAnimationFrame(drain)
	}

	const drain = () => {
		frame = null
		const view = new Float64Array(NativeAccelerometer.drain(MAX_PER_DRAIN))
		const count = (view.length - 1) / STRIDE
		if (count > 0) onBatch({ dropped: view[0], samples: view.subarray(1) })
		if (count === MAX_PER_DRAIN) schedule()
	}

	const subscription = NativeAccelerometer.onReadable(schedule)
	schedule() // 이미 쌓여 있는 값을 바로 가져온다

	return () => {
		subscription.remove()
		if (frame !== null) cancelAnimationFrame(frame)
	}
}

// 프레임 안에서 여러 번 불려도 마지막 값만 네이티브로 보낸다
let pendingAlpha: number | null = null

export function setAlpha(alpha: number) {
	if (pendingAlpha === null) requestAnimationFrame(flushAlpha)
	pendingAlpha = alpha
}

function flushAlpha() {
	const alpha = pendingAlpha
	pendingAlpha = null
	if (alpha !== null) NativeAccelerometer.setAlpha(alpha)
}
```

</details>

<details markdown="1">
<summary>E. 측정 코드</summary>

```tsx
// App.tsx 측정 부분
// stream: 샘플마다 콜백, coalesced: 이벤트는 샘플마다 받되 JS에서 프레임마다 한 번만 처리(대조군), queue: 큐와 drain
type Method = 'stream' | 'coalesced' | 'queue'
const ARMS: Method[] = ['stream', 'coalesced', 'queue']
type Opts = {
	intervalMs: number
	durationMs: number
	workMs?: number // 콜백 1회마다 거는 일
	sampleMs?: number // 샘플 1개마다 거는 일
	lateMs?: number
	blockMs?: number
	lag?: boolean
	timer?: boolean
}
const TIMER_MS = 10

// 한 번의 시행: 구독하고 네이티브를 켜서 durationMs 동안 센 뒤 정지한다 (늦은 구독은 반대 순서)
async function trial(method: Method, o: Opts) {
	const s0 = readStats()
	const t0 = Date.now()
	let active = true
	let callbacks = 0
	let received = 0
	let dropped = 0
	let lagSum = 0
	let lagMax = 0
	let lagN = 0
	let firstY = -1
	let unblockAt = 0
	let recoverMs = -1
	let tBegin = Date.now()
	let finished = false
	let timerExpected = 0
	let timerId: ReturnType<typeof setTimeout> | undefined
	const timerLate: number[] = []
	let resolveDone = () => {}
	const donePromise = new Promise<void>((resolve) => {
		resolveDone = resolve
	})
	// JS가 쉬지 못하면 타이머가 실행되지 못해서 종료를 콜백 안에서 판단한다
	const tick = () => {
		if (!finished && Date.now() - (unblockAt || tBegin) >= o.durationMs) {
			finished = true
			resolveDone()
		}
	}
	// 10ms 간격으로 다시 예약하는 타이머가 예정보다 늦게 실행된 시간을 모은다
	const beat = () => {
		const now = performance.now()
		timerLate.push(Math.max(0, now - timerExpected))
		timerExpected = now + TIMER_MS
		timerId = setTimeout(beat, TIMER_MS)
	}
	const lagOf = (t: number, now: number) => (now - t) * 1000
	const noteLag = (lag: number) => {
		lagSum += lag
		lagN += 1
		if (lag > lagMax) lagMax = lag
		if (unblockAt && recoverMs < 0 && lag < 50) recoverMs = Date.now() - unblockAt
	}

	let detach = () => {}
	const attach = () => {
		tBegin = Date.now()
		if (method === 'stream') {
			detach = attachStream((s) => {
				if (!active) return
				callbacks += 1
				received += 1
				if (firstY < 0) firstY = s.y
				if (o.lag) noteLag(lagOf(s.t, NativeAccelerometer.uptime()))
				if (o.workMs) busyWait(o.workMs)
				if (o.sampleMs) busyWait(o.sampleMs)
				tick()
			})
		} else if (method === 'coalesced') {
			const pending: number[] = []
			let frame: number | null = null
			const flush = () => {
				frame = null
				if (!active || pending.length === 0) return
				const n = pending.length
				callbacks += 1
				received += n
				if (o.lag) {
					const now = NativeAccelerometer.uptime()
					for (let i = 0; i < n; i++) noteLag(lagOf(pending[i], now))
				}
				pending.length = 0
				if (o.workMs) busyWait(o.workMs)
				if (o.sampleMs) busyWait(o.sampleMs * n)
				tick()
			}
			const off = attachStream((s) => {
				if (!active) return
				if (firstY < 0) firstY = s.y
				pending.push(s.t)
				if (frame === null) frame = requestAnimationFrame(flush)
			})
			detach = () => {
				off()
				if (frame !== null) cancelAnimationFrame(frame)
			}
		} else {
			detach = attachQueue((b) => {
				if (!active) return
				const n = b.samples.length / STRIDE
				callbacks += 1
				received += n
				dropped += b.dropped
				if (firstY < 0) firstY = b.samples[2]
				if (o.lag) {
					const now = NativeAccelerometer.uptime()
					for (let i = 0; i < n; i++) noteLag(lagOf(b.samples[i * STRIDE], now))
				}
				if (o.workMs) busyWait(o.workMs)
				if (o.sampleMs) busyWait(o.sampleMs * n)
				tick()
			})
		}
	}
	const start = () => (method === 'queue' ? NativeAccelerometer.start(o.intervalMs) : NativeAccelerometer.startStream(o.intervalMs))

	if (o.timer) {
		timerExpected = performance.now() + TIMER_MS
		timerId = setTimeout(beat, TIMER_MS)
	}
	if (o.lateMs) {
		start()
		await sleep(o.lateMs)
		attach()
	} else {
		attach()
		start()
	}

	if (o.blockMs) {
		await sleep(200)
		busyWait(o.blockMs)
		unblockAt = Date.now()
	}
	await Promise.race([sleep(o.durationMs), donePromise])

	active = false
	detach()
	NativeAccelerometer.stop()
	if (timerId !== undefined) clearTimeout(timerId)
	// 끝났는데도 실행되지 못한 타이머가 밀린 시간도 지연에 넣는다
	if (o.timer) timerLate.push(Math.max(0, performance.now() - timerExpected))
	const s1 = readStats()
	const sec = (Date.now() - t0) / 1000
	const produced = s1.produced - s0.produced
	const crossings = method === 'queue' ? s1.signals - s0.signals + (s1.drains - s0.drains) : s1.emitted - s0.emitted
	return {
		sec,
		produced,
		received,
		dropped,
		lost: produced - received - dropped,
		cbPerSec: callbacks / sec,
		crossPerSec: crossings / sec,
		recvPerSec: received / sec,
		lagMean: lagN ? lagSum / lagN : 0,
		lagMax,
		firstY,
		recoverMs,
		timerMax: timerLate.length ? Math.max(...timerLate) : 0,
		timerRuns: timerLate.length - 1,
	}
}

type Trial = Awaited<ReturnType<typeof trial>>

// 방식 순서를 시행마다 돌려 가며(교차) 측정한다
async function repeat(tag: string, arms: Method[], o: Opts) {
	const out: Record<string, Trial[]> = Object.fromEntries(arms.map((a) => [a, []]))
	for (let i = 0; i < N; i++) {
		for (let k = 0; k < arms.length; k++) {
			const m = arms[(i + k) % arms.length]
			const t = await trial(m, o)
			post({ tag, m, i, ...Object.fromEntries(Object.entries(t).map(([key, v]) => [key, Math.round(v * 100) / 100])) })
			out[m].push(t)
			await sleep(600)
		}
	}
	return out
}
```

</details>


<details markdown="1">
<summary>F. Android 구현 코드</summary>

```json
{
	"codegenConfig": {
		"android": {
			"javaPackageName": "com.acceltest"
		}
	}
}
```

기존 `codegenConfig`에 위 `android` 항목을 더했고 `MainApplication.kt`의 패키지 목록에 `add(AccelerometerPackage())`를 추가하였다.

```kotlin
// SampleQueue.kt
package com.acceltest

class Sample(val t: Double, val x: Double, val y: Double, val z: Double)

class DrainResult(val samples: List<Sample>, val dropped: Int)

class SampleQueue(private val capacity: Int) {
  private val lock = Any()
  private val storage = arrayOfNulls<Sample>(capacity)
  private var head = 0
  private var count = 0
  private var dropped = 0
  private var signaled = false

  fun clear() = synchronized(lock) {
    head = 0
    count = 0
    dropped = 0
    signaled = false
  }

  // 신호를 보내야 하면 true를 반환한다
  fun push(sample: Sample): Boolean = synchronized(lock) {
    if (count == capacity) {
      head = (head + 1) % capacity
      count -= 1
      dropped += 1
    }
    storage[(head + count) % capacity] = sample
    count += 1
    if (signaled) return false
    signaled = true
    true
  }

  fun drain(max: Int): DrainResult = synchronized(lock) {
    val n = minOf(max, count)
    val samples = ArrayList<Sample>(n)
    for (i in 0 until n) {
      samples.add(storage[(head + i) % capacity]!!)
    }
    head = (head + n) % capacity
    count -= n
    val lost = dropped
    dropped = 0
    if (count == 0) signaled = false
    DrainResult(samples, lost)
  }
}
```

```kotlin
// AccelerometerModule.kt
package com.acceltest

import android.os.SystemClock
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ArrayBuffer
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.annotations.ReactModule
import java.nio.ByteOrder
import java.util.concurrent.locks.LockSupport

@ReactModule(name = AccelerometerModule.NAME)
class AccelerometerModule(reactContext: ReactApplicationContext) : NativeAccelerometerSpec(reactContext) {
  private val queue = SampleQueue(512)
  private val lock = Any()
  private var alpha = 1.0
  private var last: Sample? = null
  private var produced = 0
  private var emitted = 0
  private var signals = 0
  private var drains = 0
  private var alphaCalls = 0
  @Volatile private var running = false
  private var thread: Thread? = null

  override fun getName() = NAME

  // 큐 방식: 큐에 넣고 처음 채워질 때만 신호를 보낸다
  override fun start(intervalMs: Double): Boolean {
    queue.clear()
    startSynthetic(intervalMs) { sample ->
      if (queue.push(sample)) {
        synchronized(lock) { signals += 1 }
        emitOnReadable()
      }
    }
    return true
  }

  // 스트림 방식: 샘플마다 바로 보낸다
  override fun startStream(intervalMs: Double): Boolean {
    startSynthetic(intervalMs) { sample ->
      synchronized(lock) { emitted += 1 }
      val map = Arguments.createMap()
      map.putDouble("t", sample.t)
      map.putDouble("x", sample.x)
      map.putDouble("y", sample.y)
      map.putDouble("z", sample.z)
      emitOnSample(map)
    }
    return true
  }

  // 테스트 전용: 에뮬레이터의 센서 대신 합성 샘플을 같은 경로로 넣는다
  private fun startSynthetic(intervalMs: Double, deliver: (Sample) -> Unit) {
    stopThread()
    running = true
    val intervalNs = (intervalMs * 1_000_000).toLong()
    val worker = Thread {
      var counter = 0
      var next = System.nanoTime()
      while (running) {
        counter += 1
        val raw = Sample(now(), if (counter % 2 == 0) 1.0 else -1.0, counter.toDouble(), 0.0)
        synchronized(lock) { produced += 1 }
        deliver(filtered(raw))
        next += intervalNs
        val wait = next - System.nanoTime()
        if (wait > 0) LockSupport.parkNanos(wait)
      }
    }
    worker.priority = Thread.MAX_PRIORITY
    thread = worker
    worker.start()
  }

  private fun stopThread() {
    running = false
    thread?.join()
    thread = null
  }

  override fun stop(): Boolean {
    stopThread()
    synchronized(lock) { last = null }
    return true
  }

  override fun setAlpha(alpha: Double) {
    synchronized(lock) {
      this.alpha = alpha
      alphaCalls += 1
    }
  }

  // [dropped, t, x, y, z, t, x, y, z, ...] 순서의 Float64 배열을 반환한다
  override fun drain(max: Double): ArrayBuffer {
    synchronized(lock) { drains += 1 }
    val result = queue.drain(max.toInt())
    val buffer = ArrayBuffer((1 + result.samples.size * 4) * 8)
    val bytes = buffer.bytes.duplicate().order(ByteOrder.LITTLE_ENDIAN)
    bytes.putDouble(result.dropped.toDouble())
    for (sample in result.samples) {
      bytes.putDouble(sample.t)
      bytes.putDouble(sample.x)
      bytes.putDouble(sample.y)
      bytes.putDouble(sample.z)
    }
    return buffer
  }

  // 실험용 계측: [생산, 스트림 emit, 큐 신호, drain 호출, setAlpha 실행] 횟수
  override fun stats(): ArrayBuffer {
    val buffer = ArrayBuffer(5 * 8)
    val bytes = buffer.bytes.duplicate().order(ByteOrder.LITTLE_ENDIAN)
    synchronized(lock) {
      bytes.putDouble(produced.toDouble())
      bytes.putDouble(emitted.toDouble())
      bytes.putDouble(signals.toDouble())
      bytes.putDouble(drains.toDouble())
      bytes.putDouble(alphaCalls.toDouble())
    }
    return buffer
  }

  // 실험용 계측: 샘플의 t와 같은 시계(부팅 후 경과 시간, 초)
  override fun uptime() = now()

  private fun now() = SystemClock.elapsedRealtimeNanos() / 1e9

  private fun filtered(raw: Sample): Sample = synchronized(lock) {
    val previous = last
    if (previous == null) {
      last = raw
      return raw
    }
    val next = Sample(
      raw.t,
      previous.x + alpha * (raw.x - previous.x),
      previous.y + alpha * (raw.y - previous.y),
      previous.z + alpha * (raw.z - previous.z),
    )
    last = next
    next
  }

  companion object {
    const val NAME = "NativeAccelerometer"
  }
}
```

```kotlin
// AccelerometerPackage.kt
package com.acceltest

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class AccelerometerPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == AccelerometerModule.NAME) AccelerometerModule(reactContext) else null

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(
      AccelerometerModule.NAME to ReactModuleInfo(
        AccelerometerModule.NAME,
        AccelerometerModule.NAME,
        false,
        false,
        false,
        true,
      ),
    )
  }
}
```

</details>
