---
title: "TCA TestStore: Reducer의 State와 Action 검증하기"
date: "2026-06-06T03:11:42.450Z"
excerpt: "Reducer의 State 변화를 테스트할 수 있는 TestStore 정리"
categories: architecture
tags: ["The Composable Architecture"]
source_url: "https://velog.io/@opficdev/TCA-TestStore-Reducer의-State와-Action-검증하기"
header:
  teaser: "/assets/images/posts/tca-cover.png"
---

## 범위

이번 정리에서 볼 흐름

```text
TestStore
-> Action 전송
-> Reducer 실행
-> 변경된 State 검증
```

지금까지는 View에서 버튼을 눌러 흐름을 봤다

TestStore는 View 없이 Reducer를 직접 검증한다

이번 예제는 처음 카운터 Feature로 돌아간다

검증할 것은 단순하다

```text
incrementButtonTapped
-> count + 1

decrementButtonTapped
-> count - 1
```

## 대상 Feature

테스트할 Feature

```swift
@Reducer
struct CounterFeature {
    @ObservableState
    struct State: Equatable {
        var count = 0
    }

    enum Action {
        case decrementButtonTapped
        case incrementButtonTapped
    }

    var body: some ReducerOf<Self> {
        Reduce { state, action in
            switch action {
            case .decrementButtonTapped:
                state.count -= 1

            case .incrementButtonTapped:
                state.count += 1
            }

            return .none
        }
    }
}
```

View는 필요 없다

테스트 대상은 Reducer다

```text
initialState
Action
expected State
```

이 세 가지를 비교한다

## TestStore 만들기

```swift
let store = TestStore(initialState: CounterFeature.State()) {
    CounterFeature()
}
```

`TestStore`에 넣는 것

```text
initialState
-> 테스트 시작 State

CounterFeature()
-> Action을 처리할 Reducer
```

일반 Store와 비슷하지만 목적이 다르다

```text
StoreOf
-> View에서 Feature 사용

TestStore
-> 테스트에서 Reducer 검증
```

## Action 보내기

증가 버튼 Action을 테스트한다

```swift
await store.send(.incrementButtonTapped) {
    $0.count = 1
}
```

읽는 순서

```text
incrementButtonTapped Action을 보냄
Reducer가 State를 바꿈
바뀐 State는 count == 1이어야 함
```

`send` 뒤의 클로저는 예상 State다

```swift
{
    $0.count = 1
}
```

Reducer가 실제로 만든 State와 이 예상 State가 다르면 테스트가 실패한다

## 감소 테스트

감소도 같은 방식이다

```swift
await store.send(.decrementButtonTapped) {
    $0.count = -1
}
```

초기 State는 `count == 0`이다

감소 Action을 보내면 `count == -1`이 되어야 한다

```text
0
-> decrementButtonTapped
-> -1
```

## 초기 State 바꾸기

테스트 시작 State를 직접 정할 수도 있다

```swift
let store = TestStore(initialState: CounterFeature.State(count: -1)) {
    CounterFeature()
}

await store.send(.incrementButtonTapped) {
    $0.count = 0
}
```

이 테스트는 `-1`에서 시작한다

증가 Action을 보내면 `0`이 되어야 한다

```text
-1
-> incrementButtonTapped
-> 0
```

## Swift Testing 기반 테스트 코드

```swift
import ComposableArchitecture
import Testing
@testable import UITestProj

@MainActor
struct CounterFeatureTests {
    @Test
    func incrementButtonTapped() async {
        let store = TestStore(initialState: CounterFeature.State()) {
            CounterFeature()
        }

        await store.send(.incrementButtonTapped) {
            $0.count = 1
        }
    }

    @Test
    func decrementButtonTapped() async {
        let store = TestStore(initialState: CounterFeature.State()) {
            CounterFeature()
        }

        await store.send(.decrementButtonTapped) {
            $0.count = -1
        }
    }

    @Test
    func incrementAfterDecrement() async {
        let store = TestStore(initialState: CounterFeature.State(count: -1)) {
            CounterFeature()
        }

        await store.send(.incrementButtonTapped) {
            $0.count = 0
        }
    }
}
```

여기서 Swift Testing은 테스트를 감싸는 껍데기다

TestStore의 핵심은 그대로다

```text
Action을 보냄
State 변화를 클로저에서 검증함
```

## 왜 State가 Equatable이어야 하는가

TestStore는 실제 State와 예상 State를 비교한다

그래서 State가 비교 가능해야 한다

```swift
struct State: Equatable {
    var count = 0
}
```

`Equatable`이 없으면 TestStore가 State 변화가 맞는지 비교할 수 없다

공식 예제에서 State에 `Equatable`을 붙이는 이유가 여기서도 드러난다

## TestStore가 보는 것

TestStore는 View를 보지 않는다

다음만 본다

```text
Action을 보냈는가
Reducer가 State를 어떻게 바꿨는가
Effect가 추가 Action을 보냈는가
```

이번 카운터 예제는 Effect가 없다

그래서 `send`만 검증한다

Effect가 있는 경우에는 `receive`로 Effect가 되돌려 보낸 Action까지 검증한다

```swift
await store.receive(.response) {
    $0.message = "완료"
}
```

이번 글에서는 Effect 검증까지 깊게 보지 않는다

## 현재 기준

Reducer는 규칙이다

TestStore는 그 규칙을 실행해서 결과를 확인한다

카운터 예제 기준

```text
State
-> count

Action
-> incrementButtonTapped
-> decrementButtonTapped

검증
-> Action 이후 count가 예상대로 바뀌었는가
```

## 정리

현재 이해한 TestStore

```text
TestStore = View 없이 Reducer를 실행하는 테스트용 Store
send = Action을 보내고 State 변화를 검증
receive = Effect가 되돌려 보낸 Action을 검증
Equatable State = 실제 State와 예상 State를 비교하기 위한 조건
```

TCA에서 테스트는 View 이벤트를 흉내 내는 방식이 아니다

Reducer에 Action을 보내고 State 변화가 정확한지 확인하는 방식이다

## 참고

- [The Composable Architecture - Testing](https://swiftpackageindex.com/pointfreeco/swift-composable-architecture/1.25.5/documentation/composablearchitecture/testingtca)
- [The Composable Architecture - TestStore](https://swiftpackageindex.com/pointfreeco/swift-composable-architecture/1.25.5/documentation/composablearchitecture/teststore)
