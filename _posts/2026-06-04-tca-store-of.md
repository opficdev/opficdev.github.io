---
title: "TCA StoreOf: View와 Feature 연결하기"
date: "2026-06-04T12:47:37.735Z"
excerpt: "View와 Reducer을 연결하는 Store에 대해 정리"
categories: architecture
tags: ["The Composable Architecture"]
source_url: "https://velog.io/@opficdev/TCA-Store-View와-Feature-연결하기"
header:
  teaser: "/assets/images/posts/tca-cover.png"
---

## 범위

이번 정리에서 볼 흐름

```text
View
-> StoreOf
-> Action
-> Reducer
-> State
-> StoreOf
-> View
```

`Reducer`는 `Action`을 받아 `State`를 바꾸는 규칙이다

`StoreOf`는 그 `Reducer`를 실제 View에서 사용할 수 있게 잡아주는 타입이다

```swift
public typealias StoreOf<R: Reducer> = Store<R.State, R.Action>
```

`Store`는 실제 저장소 객체이고 `StoreOf<CounterFeature>`는 `CounterFeature`에 맞춘 Store 타입 별칭으로 보면 된다

이번 글에서 볼 것은 세 가지

```text
View가 StoreOf를 가진다
View는 StoreOf에서 State를 읽는다
View는 StoreOf에 Action을 보낸다
```

이번 예제는 기존 카운터 Feature를 그대로 사용한다

## Feature 코드

카운터 Feature

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

여기까지는 Feature 쪽 코드

아직 View와 연결되지 않았다

`State`, `Action`, `Reducer`는 Feature 안에 있지만 View가 이 값을 쓰려면 StoreOf가 필요하다

## StoreOf

View는 Feature를 직접 들고 있지 않는다

View는 StoreOf를 가진다

```swift
struct CounterView: View {
    let store: StoreOf<CounterFeature>
}
```

`StoreOf<CounterFeature>`는 이 Feature에 맞춰진 Store 타입이라는 뜻으로 보면 된다

풀어서 생각하면 이 정도

```text
CounterFeature.State를 가지고 있고
CounterFeature.Action을 받을 수 있는 StoreOf
```

ViewModel을 쓰던 코드와 비교하면 위치가 보인다

```swift
@State var viewModel: CounterViewModel
```

TCA에서는 View가 ViewModel 대신 StoreOf를 가진다

```swift
let store: StoreOf<CounterFeature>
```

여기서 프로퍼티 이름은 `store`지만 타입은 `StoreOf<CounterFeature>`다

실제로 View에서 계속 쓰는 것은 이 `store` 프로퍼티다

## State 읽기

View는 StoreOf를 통해 State를 읽는다

```swift
Text("\(store.count)")
```

`count`는 `CounterFeature.State` 안에 있는 값이다

```swift
struct State: Equatable {
    var count = 0
}
```

View 입장에서는 `store.count`처럼 바로 읽는다

State가 바뀌면 StoreOf를 통해 View가 다시 그려진다

## Action 보내기

View는 상태를 직접 바꾸지 않는다

버튼을 누르면 StoreOf에 Action을 보낸다

```swift
Button {
    store.send(.incrementButtonTapped)
} label: {
    Image(systemName: "plus")
}
```

흐름은 이렇게 이어진다

```text
Button tap
-> store.send(.incrementButtonTapped)
-> Reducer
-> state.count += 1
-> StoreOf가 가진 State 변경
-> View 다시 그림
```

감소 버튼도 같은 구조다

```swift
Button {
    store.send(.decrementButtonTapped)
} label: {
    Image(systemName: "minus")
}
```

View는 `count`를 직접 증가시키거나 감소시키지 않는다

View는 Action만 보낸다

## Store 생성

StoreOf 프로퍼티에 넘길 Store는 Feature의 초기 State와 Reducer로 만든다

```swift
CounterView(
    store: Store(initialState: CounterFeature.State()) {
        CounterFeature()
    }
)
```

여기서 필요한 것

```text
initialState: 화면이 처음 가질 State
CounterFeature(): Action을 처리할 Reducer
```

View는 만들어진 Store를 `StoreOf<CounterFeature>`로 받아서 State를 읽고 Action을 보낸다

StoreOf가 없으면 View는 Feature의 State와 Action에 접근할 수 없다

## 현재 기준

`Feature` 안쪽

```text
State
Action
Reducer
Effect
Dependency
```

`View` 연결

```text
StoreOf
store.send
State 값 읽기
```

StoreOf는 Reducer의 내부 규칙이라기보다 만들어진 Feature를 View에서 실제로 사용하게 해주는 연결부다

## 정리

StoreOf

```text
Store = Feature의 State를 보관하고 Action을 Reducer로 보내는 실제 객체
StoreOf<Feature> = 특정 Feature에 맞춰진 Store 타입
```

View의 역할은 단순하게

```text
State 읽기
Action 보내기
```

ViewModel을 TCA로 바꿀 때 가장 먼저 바뀌는 모양

```text
ViewModel을 들던 View
-> StoreOf<Feature>를 드는 View
```

카운터 예제 기준으로는 이렇게 정리한다

```text
CounterView
-> StoreOf<CounterFeature>
-> store.count 읽기
-> store.send(.incrementButtonTapped)
```

## 참고

- [The Composable Architecture - Store](https://swiftpackageindex.com/pointfreeco/swift-composable-architecture/1.25.5/documentation/composablearchitecture/store)
