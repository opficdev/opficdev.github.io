---
title: "TCA 기본: State, Action, Reducer 흐름 이해하기"
date: "2026-06-04T08:19:09.146Z"
excerpt: "Store의 기본적인 '상태 관리' 를 정리"
categories: architecture
tags: ["The Composable Architecture"]
source_url: "https://velog.io/@opficdev/TCA1-State-Action-Reducer-흐름-이해하기"
header:
  teaser: "/assets/images/posts/tca-cover.png"
---

## 범위

이번 정리에서 볼 흐름

```text
View -> Action -> Reducer -> State -> View
```

첫 번째 글에서는 버튼을 누르면 숫자가 바뀌는 매우 카운터 예제를 구현했다

## 예제 코드

```swift
import ComposableArchitecture
import SwiftUI

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

이 예제에서 볼 것.

- `State`: 화면을 그리는 데 필요한 값
- `Action`: 사용자의 입력이나 이벤트
- `Reducer`: Action을 기준으로 State를 변경하는 로직

## State

```swift
@ObservableState
struct State: Equatable {
    var count = 0
}
```

`State`는 현재 Feature가 가지고 있는 상태

카운터 예제에서 필요한 상태는 `count` 하나뿐이라서 `State`도 단순하게 유지한다

`@ObservableState`: Store의 State 변화를 View에서 관찰하기 위한 표시

`Equatable`은 화면 동작 자체에는 필수가 아니지만 상태 비교와 테스트 확장을 생각하면 붙여두는 편이 나은것 같다. (공식 문서 예제에서도 `Equatable`을 붙인 예제를 확인할 수 있었다)

## Action

```swift
enum Action {
    case decrementButtonTapped
    case incrementButtonTapped
}
```

`Action`은 상태 변경의 원인이 되는 이벤트

카운터 예제에서는 버튼 탭만 Action으로 둔다

```swift
store.send(.incrementButtonTapped)
```

View는 `count`를 직접 증가시키지 않는다. View는 Action을 보낸다

## Reducer

```swift
Reduce { state, action in
    switch action {
    case .decrementButtonTapped:
        state.count -= 1

    case .incrementButtonTapped:
        state.count += 1
    }
    return .none
}
```

Reducer는 Action을 받아서 State를 어떻게 바꿀지 결정한다

`incrementButtonTapped`가 들어오면 `count`를 1 증가시킨다

`decrementButtonTapped`가 들어오면 `count`를 1 감소시킨다

여기서 상태 변경 책임은 View가 아니라 Reducer에 있다

`return .none`은 추가로 실행할 Effect가 없다는 의미

## View

```swift
struct CounterView: View {
    let store: StoreOf<CounterFeature>

    var body: some View {
        VStack(spacing: 24) {
            Text("\(store.count)")

            Button {
                store.send(.incrementButtonTapped)
            } label: {
                Image(systemName: "plus")
            }
        }
    }
}
```

View의 역할

- Store에서 State 읽기
- 사용자 입력을 Action으로 보내기

`store.count`는 현재 State의 `count`를 읽는 코드

`store.send(.incrementButtonTapped)`는 Store에 Action을 보내는 코드

## 흐름

```text
Button tap
-> store.send(.incrementButtonTapped)
-> Reducer 실행
-> state.count += 1
-> Store의 State 변경
-> View 다시 그림
```

현재 이해한 TCA의 가장 작은 흐름.

- View는 State를 읽는다
- View는 Action을 보낸다
- Reducer는 Action을 받아 State를 변경한다
- State가 바뀌면 View가 다시 그려진다

## 정리

```text
State = 현재 값
Action = 상태 변경의 계기
Reducer = Action에 따른 State 변경 규칙
```

## 참고

- [The Composable Architecture - Getting started](https://github.com/pointfreeco/swift-composable-architecture/blob/1.25.5/Sources/ComposableArchitecture/Documentation.docc/Articles/GettingStarted.md)
- [The Composable Architecture - Reducer](https://github.com/pointfreeco/swift-composable-architecture/blob/1.25.5/Sources/ComposableArchitecture/Documentation.docc/Extensions/Reducer.md)
- [The Composable Architecture - Store](https://github.com/pointfreeco/swift-composable-architecture/blob/1.25.5/Sources/ComposableArchitecture/Documentation.docc/Extensions/Store.md)
