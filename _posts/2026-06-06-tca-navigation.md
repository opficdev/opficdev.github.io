---
title: "TCA Navigation: 화면 전환을 State로 관리하기"
date: "2026-06-06T02:17:49.932Z"
excerpt: "SwiftUI Navigation을 State로 관리하기 위한 @Presents, PresentationAction, .ifLet 에 대해 정리"
categories: architecture
tags: ["The Composable Architecture"]
source_url: "https://velog.io/@opficdev/TCA-Navigation-화면-전환을-State로-관리하기"
header:
  teaser: "/assets/images/posts/tca-cover.png"
---

## 범위

이번 정리에서 볼 흐름

```text
Button tap
-> Action
-> destination State 설정
-> NavigationStack
-> Detail 화면 표시
```

SwiftUI에서는 보통 `NavigationLink`를 View에 바로 둘 수 있다

TCA에서는 화면 전환도 State로 처리할 수 있다.

이번 예제는 카운터 화면에서 상세 화면으로 이동한다

상세 화면은 현재 카운트 값을 가지고 열린다

다만 TCA 문서에서 말하는 Navigation은 `NavigationStack`의 push만 말하지 않는다

drill-down, sheet, popover, cover, alert, dialog 같은 것을 모두 앱의 mode change로 보고 Navigation이라고 부른다

이번 글에서는 그중 optional destination State로 상세 화면을 여는 tree-based navigation을 본다

SwiftUI의 `NavigationStack` 안에서 화면을 열지만 TCA 기준의 stack-based navigation은 아니다

TCA에서 stack-based navigation은 `StackState`와 `StackAction`으로 경로를 collection state로 관리하는 경우를 말한다

이번 글에서 볼 것은 세 가지

```text
@Presents
PresentationAction
.ifLet
```

## 부모 Feature

카운터 화면이 상세 화면을 열 수 있도록 `destination` State를 추가한다

```swift
@Reducer
struct CounterNavigationFeature {
    @ObservableState
    struct State: Equatable {
        var count = 0
        @Presents var destination: Destination.State?
    }

    enum Action {
        case decrementButtonTapped
        case destination(PresentationAction<Destination.Action>)
        case detailButtonTapped
        case incrementButtonTapped
    }
}
```

`count`는 기존 카운터 값이다

`destination`은 현재 존재하는 내비게이션 State다

처음에는 들어간 mode가 없기 때문에 optional이다

```swift
@Presents var destination: Destination.State?
```

정리하면 이런 상태다

```text
destination == nil
-> 상세 화면 닫힘

destination != nil
-> 상세 화면 열림
```

## Destination

열 수 있는 화면은 `Destination`에 둔다

```swift
@Reducer
enum Destination {
    case detail(CounterDetailFeature)
}

extension CounterNavigationFeature.Destination.State: Equatable {}
```

지금은 상세 화면 하나만 있다

부모 State가 `Equatable`을 채택하고 있어서 `Destination.State`도 Equatable을 채택하게 둔다

나중에 화면이 늘어나면 여기에 case가 늘어난다

```text
detail
settings
edit
```

이런 식으로 들어갈 수 있는 mode 후보를 State 구조 안에 둔다

## 상세 Feature

상세 화면은 열린 시점의 카운트 값을 가진다

```swift
@Reducer
struct CounterDetailFeature {
    @ObservableState
    struct State: Equatable {
        let count: Int
    }

    enum Action {}
}
```

이번 상세 화면은 값을 보여주기만 한다

그래서 Action은 비어 있다

## 화면 열기

상세 보기 버튼을 누르면 Action을 보낸다

```swift
Button {
    store.send(.detailButtonTapped)
} label: {
    Label("상세 보기", systemImage: "arrow.right.circle")
}
```

Reducer는 이 Action을 받아 `destination`을 채운다

```swift
case .detailButtonTapped:
    state.destination = .detail(
        CounterDetailFeature.State(count: state.count)
    )
```

이 시점에 tree-based navigation State가 바뀐다

```text
destination
nil
-> .detail(CounterDetailFeature.State(count: state.count))
```

View가 직접 화면을 밀어 넣는 것이 아니다

View는 Action만 보낸다

어떤 mode로 들어갈지는 Reducer가 State로 결정한다

## PresentationAction

부모 Action에는 destination Action도 들어간다

```swift
case destination(PresentationAction<Destination.Action>)
```

상세 화면에서 발생한 Action은 부모 입장에서 destination Action으로 들어온다

```text
Detail Action
-> Destination.Action
-> PresentationAction
-> Parent Action
```

이번 예제에서는 상세 화면 Action이 없어서 직접 처리할 내용은 없다

```swift
case .destination:
    break
```

하지만 상세 화면에 버튼이나 비동기 작업이 생기면 이 흐름으로 부모까지 올라온다

## .ifLet

부모 Reducer는 `.ifLet`으로 destination Reducer를 연결한다

```swift
var body: some ReducerOf<Self> {
    Reduce { state, action in
        switch action {
        case .decrementButtonTapped:
            state.count -= 1

        case .destination:
            break

        case .detailButtonTapped:
            state.destination = .detail(
                CounterDetailFeature.State(count: state.count)
            )

        case .incrementButtonTapped:
            state.count += 1
        }

        return .none
    }
    .ifLet(\.$destination, action: \.destination)
}
```

`.ifLet`이 하는 일

```text
destination이 nil이면 자식 Reducer를 실행할 State가 없음
destination이 있으면 destination State와 destination Action을 자식 Reducer에 전달함
```

Scope와 비교하면 이렇게 볼 수 있다

```text
Scope
-> 항상 존재하는 자식 Feature 연결

.ifLet
-> optional로 존재하는 자식 Feature 연결
```

Tree-based navigation은 optional이나 enum State로 해당 mode에 들어갈 때만 자식 State가 생긴다

그래서 `Scope`보다 `.ifLet`이 자연스럽다

## View에서 navigationDestination

View는 Store를 bindable하게 가진다

```swift
struct CounterNavigationView: View {
    @Perception.Bindable var store: StoreOf<CounterNavigationFeature>
}
```

`destination`이 바뀌면 SwiftUI의 `navigationDestination`이 상세 화면을 연다

여기서는 `NavigationStack`을 쓰지만 TCA의 stack-based navigation은 아니다

`navigationDestination(item:)`에 optional destination State를 연결하기 때문이다

```swift
.navigationDestination(
    item: $store.scope(
        state: \.destination?.detail,
        action: \.destination.detail
    )
) { store in
    CounterDetailView(store: store)
}
```

여기서 `store.scope`는 부모 Store를 상세 화면 Store로 좁힌다

```text
StoreOf<CounterNavigationFeature>
-> StoreOf<CounterDetailFeature>
```

`$store.scope`는 Navigation 상태를 SwiftUI Binding으로 연결한다

그래서 뒤로 가기를 하면 `destination`도 다시 nil이 된다

```text
Back
-> destination nil
-> 상세 화면 닫힘
```

## 전체 흐름

상세 보기 버튼을 누른 흐름

```text
Button tap
-> store.send(.detailButtonTapped)
-> Reducer
-> state.destination = .detail(...)
-> navigationDestination
-> CounterDetailView 표시
```

뒤로 가기 흐름

```text
Back
-> destination nil
-> .ifLet 연결 해제
-> Detail 화면 사라짐
```

## 현재 기준

Navigation은 View에서 화면을 직접 여는 방식만 말하지 않는다

Reducer가 어떤 mode로 들어갈지 State로 정하고 View는 그 State를 보고 push, sheet, alert 같은 UI를 표시한다

카운터 예제 기준

```text
count
-> 현재 카운터 값

destination
-> 현재 들어가 있는 mode

detailButtonTapped
-> 상세 mode로 들어가라는 Action
```

## 정리

현재 이해한 Navigation

```text
@Presents = optional navigation State를 presentation 흐름으로 연결
PresentationAction = destination mode에서 올라오는 Action
.ifLet = optional destination State와 Action을 자식 Reducer에 전달하는 연결
navigationDestination = destination State를 보고 화면 표시
```

Navigation은 push 화면 전환만 말하지 않는다

현재 어떤 mode가 존재하는지를 State로 표현한다

Tree-based와 stack-based를 나누는 기준은 SwiftUI 컨테이너 이름이 아니라 State 모양이다

```text
@Presents var destination: Destination.State?
-> tree-based navigation

var path = StackState<Path.State>()
-> stack-based navigation
```

## 참고

- [The Composable Architecture - Navigation](https://swiftpackageindex.com/pointfreeco/swift-composable-architecture/1.25.5/documentation/composablearchitecture/navigation)
- [The Composable Architecture - What is navigation?](https://swiftpackageindex.com/pointfreeco/swift-composable-architecture/1.25.5/documentation/composablearchitecture/whatisnavigation)
- [The Composable Architecture - Tree-based navigation](https://swiftpackageindex.com/pointfreeco/swift-composable-architecture/1.25.5/documentation/composablearchitecture/treebasednavigation)
