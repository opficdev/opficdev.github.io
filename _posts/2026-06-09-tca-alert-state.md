---
title: "TCA AlertState: Alert 표시를 State로 관리하기"
date: "2026-06-09T08:21:40.879Z"
excerpt: "범위\n\n이번 정리에서 볼 흐름\n\nSwiftUI에서는 보통 showAlert 같은 Bool 값을 둔다\n\n그리고 title, message, alert type을 따로 관리한다\n\nTCA에서는 Alert도 State로 둔다\n\n이번 세션에서는 Login 화면의 실패 Alert"
categories: architecture
tags: ["The Composable Architecture"]
source_url: "https://velog.io/@opficdev/TCA-AlertState-Alert-표시를-State로-관리하기"
header:
  teaser: "/assets/images/posts/tca-cover.png"
---

## 범위

이번 정리에서 볼 흐름

```text
Action
-> Reducer
-> AlertState 설정
-> View
-> Alert 표시
-> dismiss
-> AlertState nil
```

SwiftUI에서는 보통 `showAlert` 같은 Bool 값을 둔다

그리고 title, message, alert type을 따로 관리한다

TCA에서는 Alert도 State로 둔다

이번 세션에서는 Login 화면의 실패 Alert를 `AlertState`로 구성했다

이번 글에서 볼 것은 세 가지

```text
@Presents var alert
PresentationAction
.alert($store.scope(...))
```

## 기존 방식

기존 방식은 Alert 표시 여부와 Alert 내용을 분리해서 가진다

```swift
struct State: Equatable {
    var showAlert = false
    var alertTitle = ""
    var alertMessage = ""
}
```

이 구조에서는 Alert를 띄울 때 여러 값을 같이 맞춰야 한다

```text
showAlert = true
alertTitle = ...
alertMessage = ...
```

닫을 때도 같이 정리해야 한다

```text
showAlert = false
alertTitle = ""
alertMessage = ""
```

즉 Alert 하나를 표현하는 값이 여러 State로 흩어진다

그래서 dismiss 흐름이 생기면 정리 로직도 따로 필요하다

## AlertState 방식

AlertState를 쓰면 Alert 표시 여부와 내용을 하나의 State로 둔다

```swift
@ObservableState
struct State: Equatable {
    @Presents var alert: AlertState<Never>?
    var isLoading = false
}
```

`alert == nil`이면 Alert가 닫힌 상태다

`alert != nil`이면 Alert가 열린 상태다

정리하면 이렇게 볼 수 있다

```text
alert == nil
-> Alert 닫힘

alert != nil
-> Alert 열림
```

Alert 버튼에서 별도 Action을 보내지 않는다면 `AlertState<Never>`로 둘 수 있다

버튼에서 Action을 보내야 한다면 `Never` 대신 Action 타입을 둔다

## Alert도 Navigation인가

`@Presents`는 Navigation 글에서 먼저 봤다

그래서 `NavigationStack`으로 화면을 push할 때만 쓰는 값처럼 보일 수 있다

하지만 TCA 문서에서는 내비게이션을 더 넓게 본다

drill-down뿐만 아니라 sheet, popover, cover, alert, dialog도 앱의 mode change라서 모두 내비게이션에 포함된다

그리고 optional State로 이 mode의 존재 여부를 표현하는 방식을 tree-based navigation이라고 부른다

```text
Navigation destination
-> drill-down navigation

AlertState
-> alert navigation

ConfirmationDialogState
-> dialog navigation
```

그래서 `@Presents`는 Alert에도 사용할 수 있다

TCA 예제에서도 Alert와 ConfirmationDialog를 이렇게 둔다

```swift
@ObservableState
struct State: Equatable {
    @Presents var alert: AlertState<Action.Alert>?
    @Presents var confirmationDialog: ConfirmationDialogState<Action.ConfirmationDialog>?
}
```

정리하면 `@Presents`는 `NavigationStack` push 전용 문법이 아니다

optional navigation state를 TCA의 presentation 흐름으로 연결하기 위한 문법이다

AlertState도 optional State로 mode 존재 여부를 표현하므로 tree-based navigation 흐름에 들어간다

## Action

부모 Action에는 Alert 표시 흐름도 들어간다

```swift
enum Action {
    case alert(PresentationAction<Never>)
    case signInFailed(AlertType)
}
```

`signInFailed`는 로그인 실패 결과다

Reducer는 이 Action을 받아 Alert State를 만든다

```swift
case .signInFailed(let alertType):
    state.isLoading = false
    state.alert = alertState(for: alertType)
    return .none
```

View가 직접 Alert 값을 조립하지 않는다

실패라는 결과를 Reducer가 받고, Reducer가 Alert 표시 여부와 내용을 결정한다

## AlertState 만들기

AlertState는 title, message, button을 가진다

```swift
private func alertState(for alertType: AlertType) -> AlertState<Never> {
    AlertState {
        TextState(alertType.title)
    } actions: {
        ButtonState(role: .cancel) {
            TextState("확인")
        }
    } message: {
        TextState(alertType.message)
    }
}
```

이제 Alert에 필요한 값은 `alert` 하나에 모인다

```text
title
message
button
표시 여부
```

Alert 내용이 바뀌어도 View의 Alert 코드는 바뀌지 않는다

Reducer가 어떤 `AlertState`를 넣는지만 바뀐다

## View에서 Alert 연결하기

View는 Store를 bindable하게 가진다

```swift
struct LoginView: View {
    @Bindable var store: StoreOf<LoginFeature>
}
```

그리고 `.alert` modifier에서 Alert State를 연결한다

```swift
.alert($store.scope(state: \.alert, action: \.alert))
```

여기서 `scope`는 Alert에 필요한 State와 Action만 꺼낸다

```text
LoginFeature.State.alert
LoginFeature.Action.alert
```

Alert가 닫히면 TCA가 dismiss Action을 보낸다

```text
Alert dismiss
-> .alert(.dismiss)
-> alert State 정리
```

그래서 별도의 `showAlert = false` 처리를 View에 둘 필요가 줄어든다

## 반영 여부에 따른 장단점

| 구분 | 장점 | 단점 | 맞는 상황 |
| --- | --- | --- | --- |
| AlertState 반영 | Alert 표시 여부와 내용을 하나의 State로 관리할 수 있음 | `@Presents`, `PresentationAction`, `scope` 흐름을 알아야 함 | Alert가 Feature Action의 결과일 때 |
| AlertState 반영 | Navigation, Alert, Dialog를 같은 tree-based navigation 흐름으로 이해할 수 있음 | 처음에는 `@Presents`가 push 전용처럼 보여 헷갈릴 수 있음 | TCA presentation 흐름을 일관되게 가져가고 싶을 때 |
| AlertState 반영 | dismiss 흐름이 TCA presentation 흐름에 들어옴 | 단순 Alert 하나에는 코드가 더 커 보일 수 있음 | Alert 닫힘까지 테스트에서 검증하고 싶을 때 |
| AlertState 반영 | `showAlert`, `alertType`, title, message 동기화 문제가 줄어듦 | Alert 버튼에서 Action이 필요하면 Action 타입 설계가 필요함 | Alert 종류가 늘어나거나 실패 케이스가 여러 개일 때 |
| AlertState 미반영 | SwiftUI의 `alert(isPresented:)` 흐름이 익숙함 | Alert 관련 State가 여러 값으로 흩어질 수 있음 | 정말 View 안에서만 끝나는 단순 Alert일 때 |
| AlertState 미반영 | TCA presentation 문법을 몰라도 구현 가능함 | dismiss 시점의 cleanup 로직을 직접 맞춰야 함 | Feature로 올릴 필요가 없는 임시 UI일 때 |
| AlertState 미반영 | 작은 예제에서는 빠르게 작성할 수 있음 | 테스트에서 표시 여부와 내용을 따로 검증해야 함 | Alert 내용이 고정이고 상태 동기화 위험이 낮을 때 |

## 테스트 관점

AlertState를 쓰면 테스트도 Alert State를 직접 비교한다

```swift
await store.send(.signInFailed(.apple)) {
    $0.isLoading = false
    $0.alert = AlertState {
        TextState("로그인 실패")
    } actions: {
        ButtonState(role: .cancel) {
            TextState("확인")
        }
    } message: {
        TextState("다시 시도해주세요")
    }
}
```

닫힘도 Action으로 볼 수 있다

```swift
await store.send(.alert(.dismiss)) {
    $0.alert = nil
}
```

기존 방식에서는 여러 값을 같이 확인해야 한다

```text
showAlert == false
alertTitle == ""
alertMessage == ""
```

AlertState 방식에서는 핵심이 하나로 줄어든다

```text
alert == nil
```

## 현재 기준

AlertState를 반영하는 쪽이 맞는 경우

```text
Alert가 Feature Action의 결과다
Alert 내용이 State에 따라 바뀐다
dismiss도 테스트하고 싶다
showAlert와 alertType 동기화 코드가 생긴다
```

반대로 반영하지 않아도 되는 경우

```text
Alert가 View 내부에서만 끝난다
Alert 내용이 고정이다
테스트 대상이 아니다
TCA Feature로 올릴 필요가 없다
```

## 정리

현재 이해한 AlertState

```text
AlertState = Alert 표시 여부와 내용을 함께 가진 presentation State
@Presents var alert = optional Alert State
alert == nil = 닫힘
alert != nil = 열림
```

View는 Alert를 직접 조립하지 않는다

View는 Store의 Alert State를 연결한다

Reducer는 Action 결과에 따라 Alert State를 넣거나 비운다

```text
View
-> Action
-> Reducer
-> AlertState
-> View Alert
```

## 참고

- [The Composable Architecture - Tree-based navigation: API Unification](https://swiftpackageindex.com/pointfreeco/swift-composable-architecture/1.25.5/documentation/composablearchitecture/treebasednavigation#API-Unification)
- [The Composable Architecture - Tree-based navigation: Dismissal](https://swiftpackageindex.com/pointfreeco/swift-composable-architecture/1.25.5/documentation/composablearchitecture/treebasednavigation#Dismissal)
- [The Composable Architecture - PresentationAction](https://swiftpackageindex.com/pointfreeco/swift-composable-architecture/1.25.5/documentation/composablearchitecture/presentationaction)
