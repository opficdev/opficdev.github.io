---
title: "TCA CasePathable: enum case를 key path처럼 다루기"
date: "2026-06-15T17:08:02.926Z"
excerpt: "Reducer가 자동 처리하지 않는 enum case를 연결할 수 있는 매크로인 CasePathable에 대해 정리"
categories: architecture
tags: ["The Composable Architecture"]
source_url: "https://velog.io/@opficdev/TCA-CasePathable-enum-case를-key-path처럼-다루기"
header:
  teaser: "/assets/images/posts/tca-cover.png"
---

## 범위

이번 정리에서 볼 흐름

```text
enum case
-> CaseKeyPath
-> \.caseName 문법
-> Reducer 조합
```

TCA에서는 Feature를 조합할 때 enum case를 자주 가리킨다

부모 Action 안에 자식 Action을 넣을 때가 있다

부모 State의 optional 값이나 enum case를 자식 Reducer로 좁혀 넘길 때도 있다

이번 글에서 볼 것은 세 가지

```text
@CasePathable
\.caseName
TestStore receive
```

## case path가 필요한 곳

TCA의 Action은 보통 enum이다

```swift
enum Action {
    case sheet(PresentationAction<Sheet>)
    case fetchSettings
}
```

Reducer를 조합할 때는 부모가 자식 Reducer로 넘길 State와 Action 위치를 명확히 지정해야 한다

```text
부모 State 중 어떤 값이 자식 State인가
부모 Action 중 어떤 case가 자식 Action을 담는가
```

대부분의 Feature State는 struct이고 그 안의 property는 key path로 가리킬 수 있다

```swift
\.sheet
```

하지만 Action은 enum case다

그래서 enum case를 가리키기 위한 도구가 필요하다

그 도구가 case path다

## CaseKeyPath 문법

현재 기준에서는 enum case를 key path 문법으로 표현할 수 있다

```swift
Reduce { state, action in
    // ...
}
.ifLet(\.child, action: \.child) {
    ChildFeature()
}
```

이때 `action: \.child`의 `\.child`는 struct property key path가 아니다

enum case를 가리키는 case key path다

이 문법을 가능하게 해주는 macro가 `@CasePathable`이다

## @Reducer가 자동으로 해주는 일

TCA Feature는 `@Reducer`를 붙인다

```swift
@Reducer
struct Feature {
    enum Action {
        case child(ChildFeature.Action)
    }
}
```

TCA 문서 기준으로 `@Reducer` macro는 Feature의 `Action` enum에 `@CasePathable`을 자동으로 적용한다

그래서 대부분의 Feature Action에는 직접 `@CasePathable`을 붙이지 않아도 된다

```text
@Reducer
-> Action enum에 @CasePathable 자동 적용
-> \.child 같은 case key path 문법 사용 가능
```

Feature의 `State`가 enum인 경우도 있다

이때는 `State`에도 `@CasePathable`과 `@dynamicMemberLookup`이 같이 적용된다

`@dynamicMemberLookup`은 dot-chaining으로 enum case 안의 값을 optional하게 꺼낼 수 있게 해준다

```swift
\.destination?.editForm
```

여기서 `destination`과 `editForm`은 struct property처럼 보이지만 실제로는 enum case다

`@CasePathable`이 enum case를 key path처럼 가리키게 해주고 `@dynamicMemberLookup`이 그 case path를 `.` 문법으로 이어서 쓸 수 있게 해준다

그래서 enum State를 navigation destination처럼 쓸 때 아래 같은 문법이 가능해진다

```swift
$store.scope(\.destination?.editForm, action: \.destination.editForm)
```

이번 글에서는 우선 `Action`과 별도 enum에 필요한 `@CasePathable` 흐름을 본다

## 직접 붙여야 하는 경우

`@Reducer`가 모든 enum에 `@CasePathable`을 붙여주는 것은 아니다

`@Reducer`가 자동으로 처리하는 것은 Feature의 `Action` enum이다

그리고 Feature의 `State`가 enum이라면 그 `State`도 자동 처리 대상이다

그 밖의 enum을 case key path 문법으로 쓰려면 직접 붙여야 한다

```text
Feature.Action
-> @Reducer가 @CasePathable 자동 적용

Feature.State가 enum인 경우
-> @Reducer가 @CasePathable과 @dynamicMemberLookup 자동 적용

그 밖의 enum
-> case key path가 필요하면 직접 @CasePathable 적용
```

기준은 enum인지 아닌지가 아니다

Reducer나 View나 TestStore에서 `\.detail`처럼 case를 가리켜야 하는지가 기준이다

## 예시

상세 Feature에는 sheet 상태가 enum으로 있다

```swift
@ObservableState
@CasePathable
enum SheetState: Equatable {
    case info
    case detail(DetailFeature.State)
}
```

이 enum은 sheet가 어떤 내용을 보여줄지 나타낸다

```text
info
-> 정보 sheet

detail
-> 다른 상세 Feature를 담는 sheet
```

`SheetState`는 `@Reducer`가 자동 처리하는 Feature의 최상위 `State` enum이 아니다

그리고 아래에서 `\.detail` case key path로 쓰인다

그래서 직접 `@CasePathable`을 붙인다

## Sheet Action

sheet 내부에서 일어나는 Action도 별도 enum으로 둔다

```swift
enum Action {
    case sheet(PresentationAction<Sheet>)

    @CasePathable
    enum Sheet {
        case tapCloseButton
        case detail(DetailFeature.Action)
    }
}
```

여기서 `Action` 자체는 `@Reducer`가 처리한다

하지만 nested enum인 `Sheet`는 직접 `@CasePathable`을 붙인다

이 enum도 아래에서 `\.detail` case key path로 쓰이기 때문이다

## .ifLet에서 사용

sheet를 열 수 있는 부모 State는 optional로 둔다

```swift
@ObservableState
struct State {
    @Presents var sheet: SheetState?
}
```

sheet에서 올라오는 Action은 `PresentationAction`으로 받는다

```swift
enum Action {
    case sheet(PresentationAction<Sheet>)
}
```

부모 Reducer는 sheet State와 sheet Action을 `.ifLet`으로 연결한다

```swift
var body: some ReducerOf<Self> {
    Reduce { state, action in
        // ...
    }
    .ifLet(\.$sheet, action: \.sheet) {
        DetailSheetReducer()
    }
}
```

여기서 두 key path는 의미가 다르다

```text
\.$sheet
-> @Presents로 감싼 optional sheet State

\.sheet
-> Action.sheet case
```

`action: \.sheet`가 가능한 이유는 `Action`이 case path를 만들 수 있기 때문이다

Feature의 `Action`은 `@Reducer`가 `@CasePathable`로 만들어준다

## .ifCaseLet에서 사용

sheet 안에는 다시 상세 Feature가 들어갈 수 있다

```swift
private struct DetailSheetReducer: Reducer {
    typealias State = DetailFeature.SheetState
    typealias Action = DetailFeature.Action.Sheet

    var body: some ReducerOf<Self> {
        EmptyReducer()
        .ifCaseLet(\.detail, action: \.detail) {
            DetailFeature()
        }
    }
}
```

여기서 `\.detail`은 두 곳에 쓰인다

```text
state: \.detail
-> SheetState.detail case

action: \.detail
-> Action.Sheet.detail case
```

`.ifCaseLet`은 현재 enum State가 특정 case일 때만 자식 Reducer를 실행한다

그리고 해당 case 안의 State와 Action을 자식 Reducer에 전달한다

이 흐름이 가능하려면 `SheetState`와 `Action.Sheet`가 모두 case key path를 만들 수 있어야 한다

그래서 둘 다 `@CasePathable`이 필요하다

## View에서의 연결

View에서도 같은 원리로 sheet를 Store scope로 연결한다

```swift
.sheet(item: $store.scope(state: \.sheet, action: \.sheet)) { sheetStore in
    sheetContent(sheetStore)
}
```

앞의 `\.sheet`는 State의 property key path다

뒤의 `\.sheet`는 Action의 case key path다

둘 다 같은 `\.` 문법이라 헷갈릴 수 있지만 가리키는 대상이 다르다

## TestStore에서의 사용

TCA 문서에서는 `TestStore`의 `receive`에서도 case key path 문법을 사용한다

```swift
await store.receive(\.timerTick) {
    $0.count = 1
}
```

Effect가 Action을 되돌려 보냈을 때 어떤 Action case가 들어왔는지 `\.timerTick`으로 검증한다

nested Action도 원리는 같다

```swift
await store.receive(\.child)
```

이때도 `child` case를 case key path로 가리킨다

더 깊게 중첩된 Action도 case key path로 이어서 표현할 수 있다

```swift
await store.receive(\.child.presented.response.success)
```

이 문법도 중간에 있는 enum들이 `@CasePathable`이어야 가능하다

## 정리

`@CasePathable`은 CasePaths 라이브러리가 enum case를 `\.caseName` 문법으로 다룰 수 있게 해주는 macro다

Reducer 조합 API는 이 문법으로 State와 Action의 연결 지점을 표현한다

중요한 기준은 enum의 종류가 아니라 그 enum case를 `\.detail`처럼 가리켜야 하는지다

`@Reducer`가 자동 처리하지 않는 enum을 case key path로 넘겨야 한다면 직접 `@CasePathable`을 붙인다

## 참고

- [The Composable Architecture - Reducer: @CasePathable and @dynamicMemberLookup enums](https://swiftpackageindex.com/pointfreeco/swift-composable-architecture/1.25.5/documentation/composablearchitecture/reducer#CasePathable-and-dynamicMemberLookup-enums)
- [The Composable Architecture - Testing: Testing effects](https://swiftpackageindex.com/pointfreeco/swift-composable-architecture/1.25.5/documentation/composablearchitecture/testingtca#Testing-effects)
