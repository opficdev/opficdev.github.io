---
title: "TCA Reducer: 상태 변경과 Effect 반환"
date: "2026-06-04T08:57:15.638Z"
excerpt: "Reducer에서 Effect를 반환하고 그에 따른 추가적 상태변화에 대해 정리"
categories: architecture
tags: ["The Composable Architecture"]
source_url: "https://velog.io/@opficdev/TCA2-상태-변경과-Effect-반환-구조"
header:
  teaser: "/assets/images/posts/tca-cover.png"
---

## 범위

이번 정리에서 볼 흐름.

```text
Action
-> Reducer
-> State 변경
-> Effect 반환
-> Effect가 다시 Action 전송
-> Reducer
-> State 변경
```

1편에서는 `Reducer`가 `State`만 바꾸고 `.none`을 반환했다.

2편에서는 `Reducer`가 `State`를 바꾼 뒤 `Effect`를 반환하는 경우를 본다.

## 예제 코드

```swift
@Reducer
struct CounterEffectFeature {
    @ObservableState
    struct State: Equatable {
        var count = 0
        var isLoading = false
        var message = "Reducer가 State를 바꾸고 Effect를 반환하는 예제"
    }

    enum Action {
        case incrementButtonTapped
        case delayedIncrementButtonTapped
        case delayedIncrementFinished
    }

    var body: some ReducerOf<Self> {
        Reduce { state, action in
            switch action {
            case .incrementButtonTapped:
                state.count += 1
                state.message = "State만 즉시 변경"

            case .delayedIncrementButtonTapped:
                state.isLoading = true
                state.message = "Effect 실행 중"

                return .run { send in
                    try await Task.sleep(for: .seconds(1))
                    await send(.delayedIncrementFinished)
                }

            case .delayedIncrementFinished:
                state.count += 1
                state.isLoading = false
                state.message = "Effect가 Action을 다시 보낸 뒤 State 변경"
            }

            return .none
        }
    }
}
```

## State만 변경하는 Action

```swift
case .incrementButtonTapped:
    state.count += 1
    state.message = "State만 즉시 변경"
```

이 case는 외부 작업이 없다.

상태만 바꾸고 switch 밖의 `return .none`으로 내려간다.

```swift
return .none
```

`Effect`가 없는 Action.

## Effect를 반환하는 Action

```swift
case .delayedIncrementButtonTapped:
    state.isLoading = true
    state.message = "Effect 실행 중"

    return .run { send in
        try await Task.sleep(for: .seconds(1))
        await send(.delayedIncrementFinished)
    }
```

이 case는 두 가지를 같이 한다.

- 바로 State 변경
- Effect 반환

`isLoading`과 `message`는 Action을 받은 즉시 바뀐다.

그 다음 `.run` Effect를 반환한다.

```swift
return .run { send in
    try await Task.sleep(for: .seconds(1))
    await send(.delayedIncrementFinished)
}
```

`.run` 내부는 비동기 작업을 실행하는 공간.

작업이 끝나면 `send`로 다음 Action을 보낸다.

## Effect가 다시 보낸 Action

```swift
case .delayedIncrementFinished:
    state.count += 1
    state.isLoading = false
    state.message = "Effect가 Action을 다시 보낸 뒤 State 변경"
```

Effect 안에서 보낸 `.delayedIncrementFinished`도 결국 Action이다.

Action이기 때문에 다시 Reducer로 들어온다.

Reducer는 이 Action을 받아서 다시 State를 변경한다.

## 흐름

```text
delayedIncrementButtonTapped
-> isLoading = true
-> return .run
-> Task.sleep
-> send(.delayedIncrementFinished)
-> count += 1
-> isLoading = false
```

현재 기준.

```text
Reducer는 State를 바꿀 수 있다.
Reducer는 Effect를 반환할 수 있다.
Effect는 작업이 끝난 뒤 Action을 다시 보낼 수 있다.
State 변경은 다시 Reducer에서 일어난다.
```

## `.none`과 `.run`

`return .none`

- 추가 작업 없음
- State 변경만 하고 종료

`return .run`

- 비동기 작업 실행
- 작업 결과를 Action으로 다시 전달

Reducer 안에서 직접 오래 걸리는 작업을 끝까지 처리하지 않는다.

Reducer는 Effect를 반환하고 Effect가 다시 Action을 보내는 구조로 이어진다.

## 정리

1편 기준.

```text
Action -> Reducer -> State
```

2편 기준.

```text
Action -> Reducer -> State
                 -> Effect -> Action -> Reducer -> State
```

Effect가 들어와도 State 변경의 위치는 Reducer다.

Effect는 State를 직접 바꾸는 도구가 아니라 다음 Action을 만들어 다시 Reducer로 보내는 도구로 정리한다.

## 참고

- [The Composable Architecture - Reducer](https://swiftpackageindex.com/pointfreeco/swift-composable-architecture/1.25.5/documentation/composablearchitecture/reducer)
- [The Composable Architecture - Effect](https://swiftpackageindex.com/pointfreeco/swift-composable-architecture/1.25.5/documentation/composablearchitecture/effect)
