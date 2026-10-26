---
title: "React Native 센서 값, 이벤트로 보낼까 큐에 모을까?"
date: "2026-10-25T00:00:00.000Z"
excerpt: "iOS 시뮬레이터에서 가속도계 값을 이벤트로 보내는 스트림, 거기에 JS 프레임 묶음을 더한 대조군, 네이티브 큐 세 방식으로 JS에 전달하며 콜백 횟수, 경계 통과 횟수, 지연, 유실을 반복 측정해 비교한 실험 보고서이다."
categories: architecture
tags: []
---
## 1. 실험 목적

네이티브에서 계속 만들어지는 센서 값을 React Native의 JS로 보내는 방식인 스트림과 큐를 같은 조건에서 반복 측정하여 어느 쪽이 어떤 조건에서 더 효율적인지 확인하는 것이 이 실험의 목적이다.

이 실험의 큐는 JS가 프레임마다 값을 꺼내 가도록 만들었다. 그래서 큐의 이점이 큐라는 구조에서 나오는지 아니면 프레임 단위로 처리하는 데서만 나오는지를 가려내기 위해 대조군인 프레임 묶음을 하나 더 두었다.

## 2. 실험 배경

### 2.1 용어와 원리

React Native 앱에서 JS 코드와 네이티브 코드는 대부분 서로 다른 스레드에서 실행된다. 공식 문서 [Threading Model](https://reactnative.dev/architecture/threading-model)은 UI 스레드를 화면의 뷰를 다룰 수 있는 유일한 스레드로 설명하고 JS 스레드를 React의 렌더 단계와 레이아웃이 실행되는 곳으로 설명한다. JS 스레드는 JS 콜백도 실행한다. JS는 작업 하나가 끝나야 다음 작업을 처리한다. 이 규칙은 [MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Execution_model#run-to-completion)에서 확인할 수 있다. 따라서 JS 스레드가 과부하가 걸리면 콜백과 화면 구성 계산이 그만큼 밀린다.

- 구독: JS가 ‘값이 오면 알려 달라’고 등록하는 것
- 콜백: 값이 왔을 때 JS에서 실행되는 함수
- TurboModule: React Native에서 JS가 네이티브 기능을 부르는 통로

- 프레임: 화면이 한 번 갱신되는 단위. `requestAnimationFrame`은 다음 프레임에 맞춰 함수를 실행한다
- 스트림: 값이 만들어질 때마다 이벤트를 하나씩 보낸다. 이벤트 하나마다 JS 스레드에서 콜백이 한 번 실행된다
- 큐: 네이티브가 값을 큐에 넣고 큐가 처음 채워질 때만 ‘읽을 값이 있다’는 신호를 보낸다. JS는 신호를 받으면 프레임마다 `drain`으로 최대 64개를 가져간다. 64는 실험자가 정한 값이다
- 프레임 묶음: 대조군이다. 스트림처럼 이벤트를 샘플마다 받지만 받은 값을 모아 두었다가 프레임마다 한 번에 처리하도록 실험자가 구현하였다. 큐의 이점이 큐 구조에서 나오는지 모아서 처리하는 데서 나오는지 가리려고 두었다
- 경계 통과: JS와 네이티브 사이를 한 번 넘는 일. 이 실험에서는 네이티브에서 JS로 보내는 이벤트 1회와 JS에서 네이티브로 부르는 동기 호출 1회를 각각 1회로 센다

공식 문서 [Emitting Events in Native Modules](https://reactnative.dev/docs/the-new-architecture/native-modules-custom-events)는 이벤트가 보내질 때마다 구독한 콜백이 실행된다고만 설명한다. 이벤트가 어떤 스레드의 어떤 작업으로 전달되는지와 메서드의 동기와 비동기 실행 방식, 리스너가 없을 때의 동작은 공식 문서에서 찾지 못했다. 그래서 다음 동작은 React Native 0.88.0의 iOS 소스를 읽고 정리하였다. 이 중 이벤트마다 콜백이 실행된다는 점과 구독 전 값이 사라진다는 점은 이 실험에서 측정으로도 확인하였다.

- 네이티브가 이벤트를 보내면 [`EventEmitter.h`](https://github.com/facebook/react-native/blob/v0.88.0/packages/react-native/ReactCommon/react/bridging/EventEmitter.h)의 `emit`이 리스너마다 [`Function.h`](https://github.com/facebook/react-native/blob/v0.88.0/packages/react-native/ReactCommon/react/bridging/Function.h)의 `invokeAsync`로 JS 스레드에서 실행할 콜백을 하나씩 예약한다
- [`RCTTurboModule.mm`](https://github.com/facebook/react-native/blob/v0.88.0/packages/react-native/ReactCommon/react/nativemodule/core/platform/ios/ReactCommon/RCTTurboModule.mm)에서 `void`나 `Promise`를 돌려주는 네이티브 메서드는 네이티브 쪽 큐에서 비동기로 실행되고 그 밖의 반환값이 있는 메서드는 JS 스레드가 끝날 때까지 기다린다
- 이벤트를 보내는 시점에 리스너가 하나도 없으면 `emit`이 돌 목록이 비어 있어서 값은 버려진다
- JS가 모듈을 처음 가져오기 전에는 [`serializeEventEmitter.js`](https://github.com/facebook/react-native/blob/v0.88.0/packages/react-native-codegen/src/generators/modules/GenerateModuleObjCpp/serializeEventEmitter.js)가 만든 이벤트 함수가 아무 일도 하지 않는다

이벤트 횟수를 프레임 단위로 줄이는 방식에는 React Native 안에도 선례가 있다. [ScrollView 문서](https://reactnative.dev/docs/scrollview)는 `onScroll`이 스크롤 중 프레임당 최대 한 번 호출된다고 설명하고 `scrollEventThrottle`로 호출 간격을 더 늘릴 수 있다고 설명한다. 다만 이것은 네이티브 쪽에서 횟수를 제한하는 방식이고 프레임 묶음과 큐의 효과를 보장하는 근거는 아니다.

<img class="theme-image--light" src="/assets/images/posts/rn-native-bidirectional-queue/rn-native-boundary-map-light.png" alt="네이티브의 CoreMotion 콜백이 emit으로 이벤트를 보내면 invokeAsync로 JS 스레드 작업이 되어 JS 코드가 실행되고 JS 코드가 부르는 sync 호출은 JS 스레드에서 메서드 본문을 실행하고 값을 반환하며 async 호출은 dispatch_async로 네이티브 methodQueue 스레드의 메서드 본문으로 가는 흐름">

<img class="theme-image--dark" src="/assets/images/posts/rn-native-bidirectional-queue/rn-native-boundary-map.png" alt="네이티브의 CoreMotion 콜백이 emit으로 이벤트를 보내면 invokeAsync로 JS 스레드 작업이 되어 JS 코드가 실행되고 JS 코드가 부르는 sync 호출은 JS 스레드에서 메서드 본문을 실행하고 값을 반환하며 async 호출은 dispatch_async로 네이티브 methodQueue 스레드의 메서드 본문으로 가는 흐름">

*그림 1. 호출 종류별로 실행되는 스레드*

### 2.2 효율의 기준

효율을 다음 지표로 정의하였다. 콜백 횟수, 경계 통과 횟수, 지연, 유실은 낮을수록 좋다. 콜백과 경계 통과가 적으면 JS 스레드의 부담이 작고 지연과 유실이 적으면 값이 제때 도착한 것이다.

- JS 콜백 횟수: 초당 JS가 실행하는 콜백 수
- 경계 통과 횟수: 초당 경계를 넘는 횟수
- 지연: 값이 만들어진 시각부터 JS 콜백이 실행되는 시각까지의 시간. 단위는 ms이다
- 유실과 버림: 도착하지 못했거나 버려진 값의 개수

## 3. 가설

1. 큐가 JS 콜백 횟수를 줄인다. 샘플이 많아져도 콜백은 프레임 수를 넘지 않고 스트림은 샘플 수와 같다.
2. 큐는 모든 샘플 속도에서 경계 통과를 줄인다.
3. JS가 한가하면 스트림의 지연이 가장 작다.
4. 콜백 1회의 일이 크면 큐의 지연이 스트림보다 작다.
5. 1번과 4번의 이득은 큐 구조에서 나오며 대조군은 같은 이득을 내지 못한다.
6. 구독하기 전에 만들어진 값은 스트림에서는 사라지고 큐에서는 남는다.
7. JS가 8초 멈췄다 풀리면 스트림은 값을 모두 전달하고 큐는 용량을 넘은 값을 버린다.

6번과 7번은 코드가 설계대로 동작하는지 확인하는 항목이다. 구조상 거의 확정된 결과를 숫자로 보여 주는 성격이어서 가설 검증과 구분하였다.

## 4. 실험 환경 및 도구


| 항목      | 내용                                                                             |
| ------- | ------------------------------------------------------------------------------ |
| 기기      | iPhone 18 Pro 시뮬레이터                                                            |
| OS      | iOS 27.0                                                                       |
| 앱       | React Native 0.88.0 템플릿 앱                                                      |
| 빌드      | Debug                                                                          |
| 언어      | Swift, Objective-C++, TypeScript                                               |
| 네이티브 샘플 | 가속도계가 없어 `DispatchSource` 타이머로 합성한 값. 실행 간격이 어긋나지 않도록 `.strict` 옵션을 사용         |
| 계측      | 네이티브 카운터는 생산, 이벤트, 신호, `drain` 횟수이고 `uptime`은 샘플 생성 시각과 같은 시계를 읽는다 |
| 결과 수집   | 앱이 결과를 로컬 HTTP 서버로 전송하여 파일에 기록                                                 |


변인은 다음과 같이 두었다.

- 독립변인: 전달 방식인 스트림, 프레임 묶음, 큐
- 실험 조건: 샘플 속도 초당 약 30, 63, 100, 125, 250, 1000개와 콜백 1회당 작업 시간 0, 4, 8, 12ms, 구독 시점, JS 정지 시간 8초
- 종속변인: 2.2의 지표
- 통제변인: 같은 앱과 기기, 같은 네이티브 샘플, 큐 용량 512, 한 번에 가져오는 양 64, 방식마다 3회 반복, 시행 사이 600ms 휴지. 방식의 측정 순서는 시행마다 돌려서 순서 효과를 줄였다

## 5. 실험 방법

### 5.1 프로그램 구성

스트림은 네이티브가 샘플을 만들 때마다 이벤트를 보내고 JS 콜백이 한 번씩 실행된다. 프레임 묶음은 같은 이벤트를 받되 콜백에서는 샘플 생성 시각만 모아 두고 `requestAnimationFrame`에서 한 번만 처리한다. 큐는 네이티브가 샘플을 큐에 넣고 큐가 처음 채워질 때만 신호를 보내며 JS가 프레임마다 `drain`으로 가져간다. 세 방식은 한 모듈에 들어 있고 `CMMotionManager`가 하나라서 한 번에 하나만 켠다. 시작과 정지는 순서가 중요해서 반환값이 있는 동기 메서드로 두었다. 전체 코드는 부록에 있다.

<img class="theme-image--light" src="/assets/images/posts/rn-native-bidirectional-queue/rn-native-stream-flow-light.png" alt="CoreMotion 콜백이 샘플마다 emitOnSample을 호출하고 JS 스레드 작업 대기를 거쳐 onSample 콜백이 샘플마다 한 번씩 실행되는 흐름">

<img class="theme-image--dark" src="/assets/images/posts/rn-native-bidirectional-queue/rn-native-stream-flow.png" alt="CoreMotion 콜백이 샘플마다 emitOnSample을 호출하고 JS 스레드 작업 대기를 거쳐 onSample 콜백이 샘플마다 한 번씩 실행되는 흐름">

*그림 2. 스트림 구조*

<img class="theme-image--light" src="/assets/images/posts/rn-native-bidirectional-queue/rn-native-queue-flow-light.png" alt="CoreMotion 콜백이 SampleQueue에 push하고 큐가 처음 채워질 때 emitOnReadable 신호를 보내면 JS가 requestAnimationFrame으로 drain을 예약해 큐에서 꺼내 onBatch 콜백으로 전달하며 setAlpha는 프레임 안에서 마지막 값만 남겨 네이티브를 한 번 호출하는 흐름">

<img class="theme-image--dark" src="/assets/images/posts/rn-native-bidirectional-queue/rn-native-queue-flow.png" alt="CoreMotion 콜백이 SampleQueue에 push하고 큐가 처음 채워질 때 emitOnReadable 신호를 보내면 JS가 requestAnimationFrame으로 drain을 예약해 큐에서 꺼내 onBatch 콜백으로 전달하며 setAlpha는 프레임 안에서 마지막 값만 남겨 네이티브를 한 번 호출하는 흐름">

*그림 3. 큐 구조*

### 5.2 절차

**실험 A. 샘플 속도에 따른 콜백과 경계 통과**

1. 구독한 뒤 네이티브를 켠다. 샘플 간격을 33, 16, 10, 8, 4, 1ms로 줄여 샘플 속도를 초당 약 30개에서 1000개까지 올려 가며 반복한다.
2. 3초 동안 JS 콜백 횟수와 받은 샘플 수를 센다.
3. 정지한 뒤 네이티브 카운터로 생산 수와 경계 통과 횟수를 읽는다.

**실험 B. 샘플 간격 10ms에서 JS가 바쁠 때의 지연**

1. 콜백마다 JS 스레드를 0, 4, 8, 12ms 동안 붙잡는다. 렌더링 같은 실제 작업을 흉내 낸 것이다. 일은 샘플이 아니라 콜백 1회마다 걸린다.
2. 4초 동안 콜백이 실행되는 시각의 `uptime`에서 샘플의 생성 시각을 빼서 지연을 구한다. 한 번에 여러 샘플이 온 경우에는 각각 계산한다.
3. 평균 지연, 최대 지연, 초당 받은 샘플 수를 기록한다.

**실험 C. 스트림과 큐의 구독 전 유실**

1. 네이티브를 먼저 켜고 500ms 뒤에 구독한 뒤 300ms 동안 받는다.
2. 샘플에는 1부터 올라가는 번호 `y`가 붙어 있으므로 처음 받은 샘플의 번호에서 1을 뺀 값을 유실로 센다. 프레임 묶음은 이벤트를 받는 방식이 스트림과 같아서 따로 재지 않았다.

**실험 D. JS 8초 정지**

1. 구독하고 네이티브를 켠 뒤 200ms 뒤에 JS 스레드를 8초 동안 붙잡는다.
2. 풀린 뒤 2.5초 동안 받는다. 생산 수, 받은 수, 버린 수를 기록한다.
3. 풀린 시점부터 지연이 50ms 아래로 내려온 첫 콜백까지의 시간을 회복 시간으로 한다.

## 6. 실험 결과

표 1과 표 2는 초당 횟수를 반올림한 정수로 적었다. 이 두 표의 3회 표본표준편차는 각각 최대 0.57과 1.14였다. 나머지 표의 값은 3회 평균 ± 표본표준편차이다. 표본표준편차는 반복 측정값이 평균에서 얼마나 흩어졌는지를 나타낸다.

**표 1. 실험 A: 샘플 속도별 초당 JS 콜백 횟수**


| 샘플 속도             | 스트림  | 프레임 묶음 | 큐   |
| ----------------- | ---- | ------ | --- |
| 초당 약 30개, 간격 33ms | 30   | 30     | 30  |
| 초당 약 63개, 간격 16ms | 63   | 60     | 60  |
| 초당 100개, 간격 10ms  | 100  | 60     | 60  |
| 초당 약 125개, 간격 8ms | 125  | 60     | 60  |
| 초당 250개, 간격 4ms   | 250  | 60     | 60  |
| 초당 1000개, 간격 1ms  | 1000 | 60     | 60  |


**표 2. 실험 A: 샘플 속도별 초당 경계 통과 횟수**


| 샘플 속도             | 스트림  | 프레임 묶음 | 큐   |
| ----------------- | ---- | ------ | --- |
| 초당 약 30개, 간격 33ms | 30   | 30     | 61  |
| 초당 약 63개, 간격 16ms | 63   | 63     | 119 |
| 초당 100개, 간격 10ms  | 100  | 100    | 120 |
| 초당 약 125개, 간격 8ms | 125  | 125    | 120 |
| 초당 250개, 간격 4ms   | 250  | 250    | 120 |
| 초당 1000개, 간격 1ms  | 1000 | 1000   | 120 |


**표 3. 실험 B: 콜백 1회당 작업 시간별 평균 지연이며 단위는 ms이다**


| 콜백 1회당 작업 | 스트림           | 프레임 묶음      | 큐           |
| --------- | ------------- | ----------- | ----------- |
| 0ms       | 0.41 ± 0.45   | 8.78 ± 0.53 | 9.45 ± 0.15 |
| 4ms       | 0.08 ± 0.04   | 9.44 ± 0.48 | 8.54 ± 1.53 |
| 8ms       | 0.03 ± 0.00   | 8.87 ± 0.45 | 8.18 ± 1.19 |
| 12ms      | 337.33 ± 3.53 | 8.95 ± 0.67 | 9.05 ± 0.20 |


**표 4. 실험 B: 콜백 1회당 작업 시간별 최대 지연이며 단위는 ms이고 3회 중 최솟값\~최댓값이다**


| 콜백 1회당 작업 | 스트림          | 프레임 묶음     | 큐          |
| --------- | ------------ | ---------- | ---------- |
| 0ms       | 0.4\~72.7    | 16.4\~17.0 | 16.5\~16.7 |
| 4ms       | 0.2\~11.5    | 16.6\~17.6 | 16.5\~16.9 |
| 8ms       | 0.1\~0.2     | 16.3\~17.7 | 16.0\~17.7 |
| 12ms      | 669.9\~685.6 | 15.9\~17.2 | 16.2\~16.7 |


콜백당 작업 12ms 조건에서 초당 받은 샘플 수는 스트림이 약 83개, 프레임 묶음과 큐가 약 100개였다. 스트림은 이 조건에서 4초가 끝난 시점에 처리하지 못한 이벤트가 3회 모두 68\~69개 남아 있었다. 이 개수는 생산 수에서 받은 수를 뺀 값이다. 프레임 묶음과 큐는 1\~2개였다.

**표 5. 실험 C: 구독 전 유실**


| 방식  | 시행별 구독 전 유실 개수 |
| --- | -------------- |
| 스트림 | 52, 51, 52     |
| 큐   | 0, 0, 0        |


**표 6. 실험 D: JS 8초 정지. 생산, 받은, 버린은 3회의 범위**


| 방식     | 생산         | 받은         | 버린       | 가장 오래 기다린 값(ms) | 회복(ms)      |
| ------ | ---------- | ---------- | -------- | --------------- | ----------- |
| 스트림    | 1071\~1073 | 1071\~1073 | 0\~0     | 7993.6 ± 3.2    | 7.0 ± 0.0   |
| 프레임 묶음 | 1072\~1072 | 1072\~1072 | 0\~0     | 8016.3 ± 0.1    | 4.7 ± 0.6   |
| 큐      | 1072\~1072 | 782\~784   | 288\~290 | 5116.2 ± 0.0    | 122.3 ± 9.2 |


<img class="align-center" src="/assets/images/posts/rn-native-bidirectional-queue/rn-native-simulator.png" alt="iPhone 18 Pro 시뮬레이터 화면에 스트림, 프레임 묶음, 큐 세 방식의 콜백 횟수, 경계 통과 횟수, 지연, 유실, JS 정지 결과의 평균이 표시된 측정 앱" width="320">

*그림 4. 앱이 화면에 표시한 측정 평균. 화면의 묶음 열은 본문의 프레임 묶음이다. 시뮬레이터에서 합성 샘플로 측정한 값이다.*

## 7. 고찰

### 7.1 가설 검증


| 가설                          | 결과                                                                                      | 판정                     |
| --------------------------- | --------------------------------------------------------------------------------------- | ---------------------- |
| 1. 큐가 콜백 횟수를 줄인다            | 큐는 샘플이 초당 63개 이상일 때 약 60회로 고정되고 스트림은 샘플 수와 같음. 초당 1000개에서 1000 대 60                     | 지지                     |
| 2. 큐가 모든 속도에서 경계 통과를 줄인다    | 초당 30개에서 스트림 30 대 큐 61. 초당 100개에서 100 대 120. 초당 125개에서 125 대 120. 초당 1000개에서 1000 대 120 | 반증. 125개/초 이상에서만 큐가 적음 |
| 3. JS가 한가하면 스트림의 지연이 작다     | 콜백당 작업 0, 4, 8ms에서 스트림 0.03\~0.41ms 대 큐 8.18\~9.45ms                                    | 지지                     |
| 4. 콜백 1회의 일이 크면 큐의 지연이 작다   | 12ms에서 스트림 337.33ms 대 큐 9.05ms. 8ms 이하에서는 스트림이 더 작음                                     | 조건부. 12ms에서만 지지        |
| 5. 이득이 큐 구조에서 나온다           | 12ms에서 프레임 묶음 8.95ms로 큐 9.05ms와 같고 콜백도 약 60회로 같음                                        | 반증                     |
| 6. 구독 전 값은 큐에서만 남는다         | 유실이 스트림 51\~52개 대 큐 0개                                                                  | 확인                     |
| 7. 정지 뒤 스트림은 모두 전달하고 큐는 버린다 | 스트림과 프레임 묶음은 전부 도착하고 큐는 288\~290개 버림                                                    | 확인                     |


### 7.2 해석

**콜백 횟수와 지연은 프레임 묶음에서 나왔다.** 큐도 프레임 묶음도 콜백이 초당 약 60회로 고정되었고 샘플이 초당 1000개가 되어도 변하지 않았다. 콜백마다 12ms를 쓰는 조건에서 스트림의 평균 지연은 337ms였고 최대 670\~686ms까지 커졌다. 프레임 묶음과 큐는 각각 8.95ms와 9.05ms로 같았다. 이 조건은 콜백 1회마다 일을 걸었다. 콜백이 초당 100번인 스트림은 1초에 1.2초 분량의 일을 받아 초당 약 83개만 처리했다. 60번인 프레임 묶음과 큐는 0.72초 분량이라 감당했다. 큐라는 구조가 아니라 콜백 수가 적다는 점이 이득의 원인이다. 일을 샘플마다 걸었다면 프레임 묶음과 큐도 이득이 줄었을 것이다. 이 조건은 측정하지 않았다.

지연이 337ms로 측정된 것도 4초만 쟀기 때문이다. 스트림은 이벤트가 계속 쌓이는 상태였고 평균이 최대의 절반이므로 시간이 지날수록 거의 같은 비율로 커진다고 볼 수 있다. 증가 속도는 초당 약 170ms이다.

**콜백이 가벼우면 콜백 수의 차이는 크지 않을 수 있다.** JS가 8초 멈췄다 풀렸을 때 스트림은 약 800개의 밀린 콜백을 7ms 만에 처리했다. 콜백 하나에 약 10µs가 든 셈이다. 12ms 조건에서는 초당 약 83개를 처리했으므로 콜백 1회의 오버헤드가 수십 µs 이내로 추정된다. 이 정도면 초당 1000번 불려도 JS 스레드의 몇 %만 쓴다. 콜백 수의 차이가 문제가 되는 때는 콜백 1회의 일이 클 때이다.

**경계 통과는 큐만의 효과였다.** 프레임 묶음은 이벤트를 샘플마다 받으므로 경계 통과가 스트림과 같았다. 큐는 프레임마다 신호 1번과 `drain` 1번을 쓰므로 샘플이 초당 60개를 넘으면 약 120회로 고정되었다. 초당 30개일 때는 큐가 61회로 스트림의 30회보다 두 배 많았다. 샘플이 초당 120개보다 적으면 스트림이 경계를 덜 넘고 많으면 큐가 덜 넘는다. 측정으로 확인한 교차점은 초당 100개와 125개 사이이다. 100개에서는 큐 120회 대 스트림 100회이고 125개에서는 큐 120회 대 스트림 125회이다. 1000개에서 큐는 스트림의 약 1/8이었다. 다만 경계를 한 번 넘는 비용이 얼마인지는 재지 않았다.

**지연은 JS가 한가할 때 스트림이 압도적으로 작았다.** 스트림은 평균 0.03\~0.41ms였고 프레임 묶음과 큐는 8\~9.5ms였다. 프레임 묶음과 큐는 값이 만들어진 뒤 다음 프레임이 올 때까지 기다리므로 평균 지연이 프레임 간격 약 16.7ms의 절반 안팎이다. 스트림의 최대 지연은 콜백당 작업이 0ms인 조건의 3회 중 1회에서 72.7ms까지 튀었다.

**구독 전 값은 큐에서만 남았다.** 500ms 동안 만들어진 값 중 스트림은 51\~52개를 잃었고 큐는 하나도 잃지 않았다. 큐는 512개까지 쌓아 두므로 초당 100개에서는 약 5초치까지 남는다. 이 결과는 스트림에 버퍼가 없다는 구조에서 정해진 것이어서 동작 확인에 가깝다.

**JS가 멈췄다 풀린 뒤에는 스트림이 더 빨리 회복했다.** 스트림과 프레임 묶음은 생산된 1071\~1073개를 모두 받았고 회복에 각각 약 7ms와 5ms가 걸렸다. 가장 오래 기다린 값은 약 8초였다. 큐는 용량을 넘은 288\~290개를 버렸고 남은 512개를 프레임마다 64개씩 8프레임에 걸쳐 오래된 값부터 내보내서 회복에 117\~133ms가 걸렸다. 가장 오래 기다린 값 5116ms는 512개 × 10ms에서 나온 값이다. 큐는 정지 뒤에 가장 오래된 값부터 전달하므로 최신 값이 가장 늦게 도착한다. 최근 값만 필요한 목적이라면 이 결과는 큐에 불리하다. 최신 값부터 꺼내는 방식은 이 실험에서 만들지 않았다.

### 7.3 오차 요인과 한계

- 실제 기기가 아니라 시뮬레이터에서 합성 샘플로 측정하였다. 실제 가속도계와 실제 기기의 화면 주사율은 확인하지 못했다. 시뮬레이터에서 `requestAnimationFrame`은 초당 약 60회로 관찰되었다. 120Hz 기기에서는 큐의 콜백과 경계 통과가 더 늘어나 교차점이 높아질 수 있다.
- 앱은 Debug 빌드이며 Release 빌드는 측정하지 않았다. 개발 모드의 JS 비용이 결과에 섞였을 수 있다.
- 콜백 횟수는 스트림의 `onSample`, 프레임 묶음의 프레임 처리 함수, 큐의 `drain` 콜백만 센 값이다. 프레임 묶음의 이벤트 핸들러와 큐의 신호 핸들러 호출은 세지 않았다.
- 지연은 콜백이 실행된 시각까지만 재었다. 값이 화면에 반영되는 프레임 시각까지는 재지 않았다.
- 콜백 1회당 작업 시간은 JS 스레드를 정해진 시간 동안 붙잡는 방식으로 흉내 낸 값이다. 실제 렌더링과 다르고 샘플마다 걸리는 일은 측정하지 않았다.
- 지연을 재기 위해 콜백마다 `uptime`을 동기로 호출하였다. 이 호출이 스트림에 더 큰 부담을 주었을 수 있다. 실험 A는 지연을 재지 않아 이 영향이 없다.
- 스트림과 큐는 전달 방식과 함께 값의 형식도 다르다. 스트림은 샘플마다 객체를 만들어 JS로 넘기고 큐는 숫자 묶음인 `ArrayBuffer`를 돌려준다. 이 차이가 결과에 준 영향은 분리하지 못했다.
- 대조군은 JS에서 프레임마다 처리하는 방식 하나뿐이다. 네이티브에서 값을 모아 이벤트 한 번에 여러 개를 보내는 방식은 측정하지 않았다.
- 큐의 용량 512와 `drain` 한 번의 최대 개수 64는 실험자가 정한 값이며 바꿔 가며 측정하지 않았다. 용량은 JS 정지 때 버려지는 개수에 영향을 주고 64는 회복 시간에 영향을 준다. 프레임마다 64개를 가져가면 초당 3840개까지 처리하므로 실험한 최대 속도인 초당 1000개보다 크다.
- 시행 순서를 교차했지만 모든 반복을 한 세션에서 연속으로 돌렸다. 표준편차가 작은 것은 같은 조건이 결정적으로 반복되었다는 뜻이고 서로 독립인 반복이라고 보기는 어렵다.
- 메모리와 CPU 사용량, Android는 측정하지 않았다. 스트림이 쌓아 두는 이벤트의 상한은 소스에서 찾지 못했고 이 실험에서는 약 1000개 규모까지만 버려진 값이 없었다.
- 첫 시도에서 콜백당 12ms 조건의 스트림이 7분 넘게 끝나지 않았다. 측정 종료를 4초 타이머로 걸었는데 JS가 쉬지 못해 타이머가 실행되지 못한 것으로 추정한다. 당시 기록은 남기지 않았고 원인도 확인하지 않았다. 콜백 안에서 직접 종료하도록 고쳐 다시 측정하였으며 위 결과는 고친 뒤의 값이다. 같은 이유로 실험 A에서 네이티브를 구독보다 먼저 켜던 순서도 구독을 먼저 하도록 고쳤다.

## 8. 결론

iOS 시뮬레이터와 합성 샘플 조건에서 얻은 결론은 다음과 같다.

- 콜백이 무거워서 JS가 밀리는 문제는 큐 없이도 풀 수 있었다. 이벤트는 그대로 받고 JS에서 프레임마다 한 번만 처리하는 프레임 묶음이 큐와 같은 약 9ms의 지연을 냈다.
- 큐가 프레임 묶음에 더해 주는 것은 세 가지였다. 경계 통과를 초당 약 120회로 고정하며 샘플이 초당 120개보다 많을 때 이득이 되었고 1000개에서는 약 1/8이었다. 구독 전에 만들어진 값을 보존하였다. 쌓이는 양에 상한을 두었다.
- 큐의 대가는 다음과 같다. 값이 프레임을 기다려서 지연이 약 9ms로 늘었다. 샘플이 초당 120개보다 적으면 경계를 오히려 더 넘었다. 정지 뒤에는 오래된 값부터 전달해서 회복이 117\~133ms 걸렸다. 동기 `drain`이 JS 스레드를 잠깐 붙잡는다.
- 샘플이 초당 120개 이하이고 값 하나하나가 필요하면 스트림이 낫다. 지연이 1ms 아래이고 구현이 가장 짧으며 이 조건에서 경계도 가장 적게 넘는다.

판단 기준은 다음과 같다. 값이 많지 않으면 스트림이 맞다. JS 쪽 부담이 문제이면 프레임 묶음이 맞다. 샘플이 초당 수백 개 이상이거나 구독 전 값 보존과 버퍼 상한이 필요하면 큐가 맞다. 이 기준은 시뮬레이터와 합성 샘플에서 얻은 것이므로 실제 기기와 실제 센서에서는 다시 확인해야 한다.

## 부록. 실험 코드

측정에 사용한 코드를 그대로 실었다. `setAlpha`와 `alpha` 필터는 JS에서 네이티브로의 호출을 재던 실험에 쓴 코드이며 이 글에서는 다루지 않는다.

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
type Opts = { intervalMs: number; durationMs: number; workMs?: number; lateMs?: number; blockMs?: number; lag?: boolean }

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
				tick()
			})
		}
	}
	const start = () => (method === 'queue' ? NativeAccelerometer.start(o.intervalMs) : NativeAccelerometer.startStream(o.intervalMs))

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

// JS → 네이티브: 같은 횟수를 직접 부를 때와 프레임 단위로 합칠 때
async function alphaTrial(spread: boolean) {
	const run = async (fn: (a: number) => void) => {
		const c0 = readStats().alphaCalls
		const t0 = performance.now()
		let jsMs = 0
		if (!spread) {
			for (let i = 0; i < 1000; i++) fn(1)
			jsMs = performance.now() - t0
		} else {
			await new Promise<void>((resolve) => {
				let k = 0
				const id = setInterval(() => {
					fn(1)
					if (++k === 200) {
						clearInterval(id)
						resolve()
					}
				}, 10)
			})
		}
		const loopSec = (performance.now() - t0) / 1000
		await sleep(600)
		return { calls: readStats().alphaCalls - c0, jsMs, loopSec }
	}
	const direct = await run((a) => NativeAccelerometer.setAlpha(a))
	const merged = await run(setAlpha)
	return { direct, merged }
}
```

</details>