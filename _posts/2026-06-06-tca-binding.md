---
title: "TCA Binding: 바인딩 변경을 Action으로 다루기"
date: "2026-06-05T15:10:04.813Z"
excerpt: "SwiftUI의 Binding과 직접 연결할 수 있는 @Bindable과 BindableAction을 정리"
categories: architecture
tags: ["The Composable Architecture"]
source_url: "https://velog.io/@opficdev/TCA-Binding-바인딩-변경을-Action으로-다루기"
header:
  teaser: "/assets/images/posts/tca-cover.png"
---

## 범위

이번 정리에서 볼 흐름

```text
View 입력
-> Binding setter
-> binding Action
-> StoreOf
-> BindingReducer
-> State 변경
-> View 다시 그림
```

버튼 탭은 `store.send`로 Action을 보냈다

여기서 Binding은 SwiftUI의 `Binding`을 말한다

SwiftUI의 `Binding` 자체는 값을 읽고 쓰는 통로다

TCA에서는 Store에서 만든 Binding을 binding Action 흐름으로 연결할 수 있다

이번 예제는 기존 카운터 흐름을 유지한다

추가하는 값은 하나

```text
step = 증가하거나 감소할 단위
```

이번 예제에서 볼 것은 세 가지

```text
@Bindable var store 또는 @State var store
BindableAction
BindingReducer
```

iOS 16 이하에서 사용할 경우 `@Bindable` 대신 `@Perception.Bindable`을 사용한다

이때 `@Bindable`은 우리가 아는 SwiftUI의 `@Bindable` 이 맞다

```text
iOS 17 이상
-> @Bindable

iOS 16 이하
-> @Perception.Bindable
```

## 예제 코드

카운터에 `step`을 추가한다

`step`은 Stepper로 바꿀 수 있다

```swift
@Reducer
struct CounterBindingFeature {
    @ObservableState
    struct State: Equatable {
        var count = 0
        var step = 1
    }

    enum Action: BindableAction {
        case binding(BindingAction<State>)
        case decrementButtonTapped
        case incrementButtonTapped
    }

    var body: some ReducerOf<Self> {
        BindingReducer()

        Reduce { state, action in
            switch action {
            case .binding:
                break

            case .decrementButtonTapped:
                state.count -= state.step

            case .incrementButtonTapped:
                state.count += state.step
            }

            return .none
        }
    }
}
```

기존 카운터와 달라진 점

```text
State에 step 추가
Action이 BindableAction 채택
binding Action 추가
BindingReducer 추가
```

## State

```swift
@ObservableState
struct State: Equatable {
    var count = 0
    var step = 1
}
```

`count`는 결과 값이다

`step`은 사용자가 바꾸는 입력 값이다

버튼을 누르면 `step`만큼 값이 바뀐다

```swift
state.count += state.step
```

## BindableAction

Store에서 만든 Binding 변경을 `binding` Action으로 받으려면 Action이 `BindableAction`을 채택한다

SwiftUI의 `Binding` 자체를 쓴다고 항상 필요한 것은 아니다

```swift
enum Action: BindableAction {
    case binding(BindingAction<State>)
    case decrementButtonTapped
    case incrementButtonTapped
}
```

`binding` Action은 View의 Binding 변경을 Reducer로 전달하기 위한 Action이다

Stepper가 `step`을 바꾸면 이 Action 흐름을 탄다

```text
Stepper
-> binding Action
-> BindingReducer
-> state.step 변경
```

## BindingReducer

```swift
BindingReducer()
```

`BindingReducer`는 `binding` Action을 받아 State 값을 실제로 바꾼다

그래서 `.binding` case에서는 별도 처리를 하지 않는다

```swift
case .binding:
    break
```

현재 기준에서 `.binding`은 사용자가 `step`을 바꿨다는 흐름만 통과시킨다

실제 `step` 변경은 `BindingReducer`가 처리한다

## View에서 Binding 만들기

이 예제의 View는 전달받은 StoreOf에서 Binding을 만들기 위해 `@Bindable`을 사용한다

```swift
struct CounterBindingView: View {
    @Bindable var store: StoreOf<CounterBindingFeature>
}
```

View가 Store를 직접 만들고 소유한다면 `@State`로도 Binding을 만들 수 있다

```swift
@State var store = Store(initialState: CounterBindingFeature.State()) {
    CounterBindingFeature()
}
```

`@Bindable`은 Store를 소유하기 위한 도구라기보다 전달받은 Store에서 `$store.step` 같은 Binding을 만들기 위한 도구다

```swift
Stepper(value: $store.step, in: 1...10) {
    Text("증가 단위 \(store.step)")
}
```

여기서 `$store.step`이 Binding이다

겉으로 보면 Stepper가 `state.step`을 직접 바꾸는 것처럼 보인다

하지만 실제로는 그렇지 않다

```text
View가 만든 Binding의 setter가 Action을 보낸다
Binding 변경은 binding Action으로 들어간다
BindingReducer가 State를 바꾼다
```

개념적으로는 거의 이런 모양이다

```swift
Stepper(
    value: Binding(
        get: { store.step },
        set: { store.send(.binding(.set(\.$step, $0))) }
    ),
    in: 1...10
) {
    Text("증가 단위 \(store.step)")
}
```

실제 예제는 이 긴 코드를 축약해서 `$store.step`으로 쓴 것이다

즉 `send`를 안 쓰는 것이 아니라 Binding 안에 `send`가 숨어 있다고 보면 된다

그래서 View가 State를 직접 바꾸는 구조가 아니다

```text
View
-> Binding setter
-> store.send(.binding(...))
-> BindingReducer
-> State 변경
```

## 버튼 Action과 Binding

증가 버튼은 기존처럼 Action을 보낸다

```swift
Button {
    store.send(.incrementButtonTapped)
} label: {
    Image(systemName: "plus")
}
```

Reducer는 현재 `step`을 읽어서 `count`를 바꾼다

```swift
state.count += state.step
```

흐름은 이렇게 나눠진다

```text
Stepper 조작
-> binding Action
-> state.step 변경

plus 버튼 탭
-> state.count += state.step
```

Binding은 버튼 Action을 대체하는 개념이 아니다

사용자가 직접 값을 바꾸는 UI를 State와 연결하는 흐름이다

## 정리

현재 이해한 Binding

```text
@Bindable var store = 전달받은 Store에서 $store.step 같은 Binding을 만들기 위한 wrapper
@State var store = View가 Store를 직접 소유하면서 Binding을 만들기 위한 wrapper
BindableAction = Binding Action을 받을 수 있는 Action
BindingReducer = Binding Action으로 State를 변경하는 Reducer
```

카운터 예제 기준

```text
Stepper
-> $store.step
-> store.send(.binding(...))
-> binding Action
-> BindingReducer
-> state.step 변경
```

## 참고

- [The Composable Architecture - Bindings](https://swiftpackageindex.com/pointfreeco/swift-composable-architecture/1.25.5/documentation/composablearchitecture/bindings)
- [The Composable Architecture - Store](https://swiftpackageindex.com/pointfreeco/swift-composable-architecture/1.25.5/documentation/composablearchitecture/store)
