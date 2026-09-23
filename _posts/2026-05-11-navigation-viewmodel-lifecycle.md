---
title: "NavigationStack과 NavigationSplitView 사이에서 ViewModel은 어디서 만들어야 할까?"
date: "2026-05-10T16:27:10.860Z"
excerpt: "NavigationStack 기반 iOS 앱을 NavigationSplitView 구조로 확장하며 ViewModel 생성 위치와 생명주기 책임을 어떻게 분리할지 정리한 포스트"
categories: ios
tags: ["Life Cyle","navigation","swiftui"]
source_url: "https://velog.io/@opficdev/NavigationStack과-NavigationSplitView-사이에서-ViewModel은-어디서-만들어야-할까"
header:
  teaser: "/assets/images/posts/navigation-viewmodel-lifecycle/cover.png"
---

처음에는 iPhone 앱만 생각하고 화면을 구성했다.

iPhone만 대상으로 할 때는 대부분의 화면 흐름을 `NavigationStack`으로 처리해도 충분했다.  
사용자는 목록에서 항목을 선택하고 다음 화면으로 push되고 다시 뒤로 돌아온다.

```text
RootView
-> View1
-> View2
```

이 흐름은 직관적이다.

하지만 iPadOS와 macOS까지 함께 고려하기 시작하면 화면 구조를 하나의 stack으로만 생각하기 어렵다.

다만 여기서 중요한 기준은 OS가 아니다.  
iPad나 Mac에서도 창 크기, 분할 화면, 실행 환경에 따라 좁은 UI가 될 수 있다.

그래서 이 글에서는 플랫폼 이름이 아니라 layout 구조를 기준으로 나눈다.

```text
compact layout
-> NavigationStack 중심 구조

regular layout
-> NavigationSplitView 중심 구조
```

문제는 여기서 시작된다.

같은 route를 처리하더라도 `NavigationStack`과 `NavigationSplitView`는 화면을 배치하는 방식이 다르다.  
그리고 이 차이는 ViewModel을 어디서 만들고 얼마나 유지할지에 대한 고민으로 이어진다.

## NavigationStack은 화면을 쌓는다

compact layout에서는 `NavigationStack`이 자연스럽다.

구조를 단순화하면 다음과 같다.

```text
NavigationStack

[RootView]
   |
   v
[View1]
   |
   v
[View2]
```

Apple 공식 문서의 value-based navigation 예제로 표현하면 이런 형태다.

```swift
struct ColorDetail: View {
    var color: Color

    var body: some View {
        color.navigationTitle(color.description)
    }
}

NavigationStack {
    List {
        NavigationLink('Mint', value: Color.mint)
        NavigationLink('Pink', value: Color.pink)
        NavigationLink('Teal', value: Color.teal)
    }
    .navigationDestination(for: Color.self) { color in
        ColorDetail(color: color)
    }
    .navigationTitle('Colors')
}
```

이 예제는 `NavigationLink`가 destination View를 직접 들고 있는 것이 아니라 `Color` 값을 보낸다.  
그리고 `navigationDestination(for:)`가 해당 값에 대응하는 View를 만든다.

```text
NavigationLink(value:)
-> navigation path에 값 추가
-> navigationDestination(for:)에서 값에 맞는 View 생성
```

앱 코드에서는 이 값을 `Route.view1(id:)`, `Route.view2(id:)` 같은 route 값으로 확장해서 사용할 수 있다.

```swift
NavigationStack(path: navigationPath) {
    RootView()
        .navigationDestination(for: Route.self) { route in
            destinationView(route)
        }
}
```

route는 path에 순서대로 쌓인다.

```text
path = [
  Route.view1(id: view1ID),
  Route.view2(id: view2ID)
]
```

화면 의미는 다음과 같다.

```text
RootView
-> View1
-> View2
```

`View2`에서 뒤로 가면 `View1`로 돌아간다.  
즉 `NavigationStack`은 하위 화면을 이전 화면 위에 push하는 구조다.

## NavigationSplitView는 영역을 나눈다

regular layout에서는 같은 route를 꼭 stack으로 push할 필요가 없다.

넓은 화면에서는 기준 화면을 유지하고 선택된 하위 화면을 별도 영역에 보여줄 수 있다.

```text
NavigationSplitView

┌──────────┬────────────┬──────────────┐
│ Sidebar  │ Content    │ Detail       │
├──────────┼────────────┼──────────────┤
│ Section  │ RootView   │ View1/View2  │
└──────────┴────────────┴──────────────┘
```

조금 더 구조적으로 표현하면 다음과 같다.

```text
NavigationSplitView
├─ sidebar
│  └─ Section selection
├─ content
│  └─ RootView
└─ detail
   └─ selected route destination
      ├─ View1
      ├─ View2
      └─ View3
```

여기서는 화면이 순서대로 밀려 들어가기보다 detail 영역이 선택된 route에 맞게 교체된다.

```text
RootView는 content 영역에 유지
선택된 하위 화면은 detail 영역에서 변경
```

즉 `NavigationSplitView`는 하위 화면을 옆 영역에 배치하는 구조다.

Apple 공식 문서의 selection 연동 예제로 보면 구조가 더 분명하다.

```swift
let colors: [Color] = [.mint, .pink, .teal]
@State private var selection: Color?

var body: some View {
    NavigationSplitView {
        List(colors, id: \.self, selection: $selection) { color in
            NavigationLink(color.description, value: color)
        }
    } detail: {
        if let color = selection {
            ColorDetail(color: color)
        } else {
            Text('Pick a color')
        }
    }
}
```

이 예제에서 leading column의 선택 값은 detail column의 내용을 결정한다.

```text
List selection
-> detail column content
```

즉 `NavigationSplitView`에서는 route가 stack 위에 쌓인다기보다 선택 상태가 다음 column의 표시 내용을 결정하는 구조로 볼 수 있다.

## 같은 route가 다른 구조로 표현된다

사용자의 의도는 같을 수 있다.

```text
사용자 의도
-> View1 열기
```

하지만 layout에 따라 표현 방식은 달라진다.

```text
compact layout
-> NavigationStack path에 Route.view1 추가
```

```text
regular layout
-> NavigationSplitView detail에 Route.view1 표시
```

텍스트로 나란히 비교하면 차이가 더 분명하다.

```text
NavigationStack

Root
└─ path
   ├─ Route.view1
   └─ Route.view2

의미
Root -> View1 -> View2 순서로 push
```

```text
NavigationSplitView

Sidebar
└─ Section selection

Content
└─ RootView

Detail
└─ selected route
   ├─ Route.view1
   └─ Route.view2

의미
RootView는 유지되고 detail 영역만 선택 route로 교체
```

여기서 ViewModel 생성 위치가 애매해진다.

문제는 `NavigationStack`과 `NavigationSplitView`가 서로 다른 View를 보여준다는 것이 아니다.  
오히려 반대다.

두 구조 모두 같은 route에 대해 같은 destination View와 같은 ViewModel을 사용해야 한다.

```text
Route.view1
-> View1
-> View1ViewModel
```

하지만 destination이 놓이는 위치가 달라진다.

```text
compact layout
-> NavigationStack의 navigationDestination 안에서 View1 생성

regular layout
-> NavigationSplitView의 detail column 안에서 View1 생성
```

즉 같은 `View1ViewModel`이 필요하지만 View를 구성하는 지점은 layout별로 나뉜다.

이때 ViewModel 생성 코드를 각 layout 분기 안에 직접 두면 같은 destination에 대한 생성 로직이 두 navigation 구조에 흩어진다.

```text
compact branch
-> View1ViewModel 생성

regular branch
-> View1ViewModel 생성
```

그러면 다음 문제가 생긴다.

```text
같은 route에 대한 ViewModel 생성 정책을 두 곳에서 맞춰야 함
layout 구조가 바뀔 때 같은 ViewModel을 재사용할지 판단하기 어려움
View는 UI 구조를 결정하면서 객체 생성 정책까지 알게 됨
```

따라서 질문은 단순히 'ViewModel을 어디서 만들까?'가 아니다.

정확히는 다음 질문에 가깝다.

```text
NavigationStack과 NavigationSplitView가 같은 destination을 공유할 때
공통 ViewModel 생성 정책은 어디에 둘 것인가?
```

## route builder에서 ViewModel을 만들면 책임이 섞인다

가장 단순한 방식은 route builder에서 View와 ViewModel을 함께 만드는 것이다.

```swift
@ViewBuilder
private func destinationView(_ route: Route) -> some View {
    switch route {
    case .view1(let id):
        View1(
            viewModel: View1ViewModel(id: id)
        )

    case .view2(let id):
        View2(
            viewModel: View2ViewModel(id: id)
        )
    }
}
```

작은 화면에서는 이 방식도 충분히 단순하다.

하지만 root container가 여러 layout 구조를 동시에 담당하기 시작하면 책임이 늘어난다.

```text
RootContainerView
-> compact layout 판단
-> regular layout 판단
-> NavigationStack 구성
-> NavigationSplitView 구성
-> route 해석
-> destination View 조합
-> ViewModel 생성
-> ViewModel 재사용 정책 판단
```

앞의 책임은 UI 구성에 가깝다.

```text
어떤 layout에서
어떤 navigation container를 사용하고
어떤 route에 어떤 View를 보여줄 것인가
```

반면 뒤의 책임은 객체 생성과 생명주기에 가깝다.

```text
이 ViewModel을 새로 만들 것인가
기존 ViewModel을 재사용할 것인가
언제 교체할 것인가
```

이 두 책임이 같은 View 안에 섞이기 시작하면 View가 커진다기보다 역할의 경계가 흐려진다.

## 생성 위치의 선택지

이 지점에서 핵심은 특정 패턴 이름이 아니다.  
핵심은 ViewModel 생성 위치다.

선택지는 크게 세 가지다.

| 선택지 | 설명 | 한계 |
|---|---|---|
| destination View 내부에서 생성 | View가 자신의 ViewModel 생성 | 외부 route/layout 전환과 생명주기 조율이 어려움 |
| root container에서 생성 | route builder가 ViewModel 생성 | UI 구성과 객체 생성 책임이 섞임 |
| 별도 factory 객체에서 생성 | ViewModel 생성 정책을 분리 | factory 객체가 생성 정책을 가져야 함 |

세 번째 방식을 선택하면 역할을 다음처럼 나눌 수 있다.

```text
RootContainerView
-> layout과 route 조합 담당

ViewModelFactory
-> 하위 화면 ViewModel 생성 담당
```

구조를 나누면 다음과 같다.

```text
RootContainerView
├─ compact layout 판단
├─ regular layout 판단
├─ NavigationStack 구성
├─ NavigationSplitView 구성
└─ route에 맞는 View 조합

ViewModelFactory
├─ View1ViewModel 생성
└─ View2ViewModel 생성
```

이 별도 factory 객체는 프로젝트에 따라 Factory, Router, Coordinator 같은 이름을 가질 수 있다.  
중요한 것은 이름이 아니라 화면 구조를 결정하는 객체와 ViewModel 생성 정책을 가진 객체를 분리하는 것이다.

또한 이 객체가 반드시 모든 화면 흐름을 제어할 필요는 없다.

이번 경우에는 root container에 있던 ViewModel 생성 책임을 분리하는 정도면 충분했다.

## 별도 factory는 생성 정책을 명시하는 위치다

별도 factory 객체는 다음처럼 구성할 수 있다.

```swift
@MainActor
@Observable
final class ViewModelFactory {
    // ViewModel 생성 시 필요한 의존성을 resolve하기 위해 보관한다.
    private let container: DIContainer

    @ObservationIgnored
    private var view1ViewModel: View1ViewModel?

    @ObservationIgnored
    private var view2ViewModel: View2ViewModel?

    init(container: DIContainer) {
        self.container = container
    }
}
```

root container는 여전히 화면 구조를 결정한다.

```swift
if isCompactLayout {
    NavigationStack(path: navigationPath) {
        rootContentView
            .navigationDestination(for: Route.self) { route in
                destinationView(route)
            }
    }
} else {
    NavigationSplitView {
        sidebarView
    } content: {
        rootContentView
    } detail: {
        detailView
    }
}
```

destination을 만들 때 ViewModel은 별도 factory 객체에게 요청한다.

```swift
@ViewBuilder
private func destinationView(_ route: Route) -> some View {
    switch route {
    case .view1(let id):
        View1(
            viewModel: viewModelFactory.view1ViewModel(id: id)
        )

    case .view2(let id):
        View2(
            viewModel: viewModelFactory.view2ViewModel(id: id)
        )
    }
}
```

이렇게 하면 root container의 관심사는 다음으로 좁아진다.

```text
어떤 route에 어떤 View를 보여줄 것인가
```

factory 객체의 관심사는 다음으로 분리된다.

```text
그 View에 필요한 ViewModel을 어떻게 만들고 재사용할 것인가
```

## 단순 이동만으로는 부족하다

생성 코드를 별도 factory 객체로 옮기기만 하면 충분하지 않다.

factory 객체가 매번 새 ViewModel을 만든다면 route builder에 있던 코드가 위치만 바뀐 것과 크게 다르지 않다.

따라서 factory 객체는 최소한의 생성 정책을 가져야 한다.

예를 들어 현재 표시하려는 View1의 id가 기존 ViewModel의 id와 같으면 기존 인스턴스를 반환할 수 있다.

```swift
func view1ViewModel(id: View1ID) -> View1ViewModel {
    if let view1ViewModel,
       view1ViewModel.id == id {
        return view1ViewModel
    }

    let view1ViewModel = View1ViewModel(
        id: id,
        dependency: container.resolve(View1Dependency.self)
    )
    self.view1ViewModel = view1ViewModel
    return view1ViewModel
}
```

View2도 같은 방식으로 처리할 수 있다.

```swift
func view2ViewModel(id: View2ID) -> View2ViewModel {
    if let view2ViewModel,
       view2ViewModel.id == id {
        return view2ViewModel
    }

    let view2ViewModel = View2ViewModel(
        id: id,
        dependency: container.resolve(View2Dependency.self)
    )
    self.view2ViewModel = view2ViewModel
    return view2ViewModel
}
```

이 정책은 장기 캐시가 아니다.

```text
방문한 모든 View1ViewModel을 저장하지 않는다.
방문한 모든 View2ViewModel을 저장하지 않는다.
현재 route와 같은 조건이면 재사용한다.
조건이 달라지면 새 인스턴스로 교체한다.
```

목적은 명확하다.

```text
layout 구조가 바뀌어 같은 route가 다시 View로 조합되더라도
같은 식별자라면 기존 ViewModel 인스턴스를 유지한다.
```

## dictionary 보관이 항상 더 안전한 것은 아니다

처음에는 id 기반 dictionary 보관도 생각할 수 있다.

```swift
private var view1ViewModels = [View1ID: View1ViewModel]()
private var view2ViewModels = [View2ID: View2ViewModel]()
```

이 방식은 여러 화면의 상태를 동시에 보존해야 할 때 유효하다.

예를 들어 `NavigationStack` 안에 같은 타입의 detail 화면이 여러 개 쌓이고 각 detail의 입력 상태나 편집 상태를 모두 보존해야 한다면 dictionary 보관이 더 적절할 수 있다.

하지만 모든 상황에서 dictionary가 더 나은 것은 아니다.

`NavigationSplitView`에서는 content와 detail이 함께 유지될 수 있고 사용자가 여러 항목을 탐색하면 dictionary에는 이전 ViewModel이 계속 쌓일 수 있다.

```text
View1ID.a
View1ID.b
View1ID.c
View1ID.d
...
```

방문한 모든 화면의 상태를 보존해야 하는 요구가 없다면 이는 불필요한 데이터 보관이 될 수 있다.

따라서 먼저 정책을 정해야 한다.

```text
stack 전체의 상태를 보존할 것인가
현재 선택된 하위 화면만 유지할 것인가
```

이번 구조에서는 후자에 가까웠다.

그래서 dictionary 기반 장기 보관보다 현재 route 기준의 단일 인스턴스 보관이 더 적절했다.

## ViewModel은 생성 기준을 알고 있어야 한다

단일 인스턴스 보관을 하려면 재사용 기준이 필요하다.

이 기준을 factory 객체가 별도 값으로 들 수도 있다.

```swift
private var view1ID: View1ID?
private var view2ID: View2ID?
```

하지만 이 값은 ViewModel의 생성 기준이다.

ViewModel이 특정 id로 만들어진다면 그 id는 ViewModel이 직접 알고 있는 편이 자연스럽다.

```swift
final class View1ViewModel {
    let id: View1ID
}
```

```swift
final class View2ViewModel {
    let id: View2ID
}
```

그러면 factory 객체는 별도 key 상태를 관리하지 않아도 된다.

```swift
if let view1ViewModel,
   view1ViewModel.id == id {
    return view1ViewModel
}
```

ViewModel이 어떤 입력으로 만들어졌는지 스스로 알고 있고 factory 객체는 그 값을 보고 재사용 여부만 판단한다.  
즉 재사용 판단에 필요한 식별자는 factory 객체가 별도로 중복 관리하기보다 ViewModel이 자신의 생성 기준으로 갖고 있는 값을 활용하는 편이 단순하다.

## 보관된 ViewModel은 관찰 대상에서 제외한다

factory 객체가 `@Observable`이라면 ViewModel 보관 프로퍼티도 관찰 대상이어야 할까?

```swift
@ObservationIgnored
private var view1ViewModel: View1ViewModel?

@ObservationIgnored
private var view2ViewModel: View2ViewModel?
```

여기서는 관찰 대상에서 제외하는 편이 자연스럽다.

이 값들은 UI에 직접 표시되는 상태가 아니다.  
같은 조건이면 같은 ViewModel 인스턴스를 반환하기 위한 내부 보관 값이다.

View가 관찰해야 하는 것은 factory 객체 내부의 보관 슬롯이 아니라 실제 화면에 전달된 ViewModel의 State다.

```text
View1
-> View1ViewModel.state 관찰

RootContainerView
-> factory 객체의 내부 보관 슬롯을 렌더링 상태로 사용하지 않음
```

만약 내부 보관 슬롯까지 Observation 대상이 되면 ViewModel을 저장하는 행위 자체가 불필요한 View invalidation으로 이어질 수 있다.

따라서 factory 객체가 ViewModel을 소유하더라도 그 보관 프로퍼티는 UI 상태가 아니라 내부 구현 세부사항으로 취급하는 편이 맞다.

## 생성 위치를 정할 때 같이 봐야 할 기준

이 글의 핵심은 ViewModel 생성 위치를 View의 크기만으로 판단할 수 없다는 점이다.

View가 커져도 단순히 subview로 분리하면 충분한 경우가 있다.  
반대로 View 크기는 크지 않아도 navigation 구조에 따라 ViewModel 생성 위치가 애매해질 수 있다.

ViewModel 생성 위치를 정할 때 봐야 할 기준은 조금 다르다.

```text
View가 layout 구조를 결정하는가?
View가 route를 해석하는가?
View가 ViewModel 생성까지 담당하는가?
View가 ViewModel 재사용 정책까지 알고 있는가?
```

이 질문에 모두 같은 View가 답하고 있다면 책임 경계가 흐려졌을 가능성이 있다.

특히 `NavigationStack`과 `NavigationSplitView`를 함께 지원하면 같은 route가 서로 다른 화면 구조로 표현된다.

```text
compact layout
-> route가 stack path에 쌓임

regular layout
-> route가 split detail 영역을 교체함
```

이때 ViewModel 생성 위치를 root container에 계속 두면 UI 구조와 객체 생명주기가 강하게 결합된다.

이 결합을 끊는 방법은 하나가 아니다.

```text
ViewModel을 destination View 내부에서 생성
-> View가 자신의 생명주기를 강하게 소유

ViewModel을 root container에서 생성
-> route builder가 생성 정책까지 소유

ViewModel을 별도 factory 객체에서 생성
-> 화면 구조와 생성 정책 분리
```

이번 글에서는 세 번째 방식을 기준으로 설명한다.

```text
RootContainerView
-> layout과 route 기반 View 조합

ViewModelFactory
-> route에 필요한 ViewModel 생성과 재사용 정책
```

## 정리

이번 작업을 통해 정리한 기준은 다음과 같다.

```text
View가 커졌다
-> 무조건 별도 생성 객체가 필요한 것은 아님

NavigationStack과 NavigationSplitView를 함께 지원한다
-> 같은 route가 다른 화면 구조로 표현될 수 있음

route builder가 ViewModel 생성까지 담당한다
-> UI 구성과 객체 생명주기 책임이 섞일 수 있음

방문한 모든 화면 상태를 보존해야 한다
-> ID 기반 dictionary 보관 검토

현재 선택된 하위 화면만 유지하면 된다
-> 단일 ViewModel 보관으로 충분할 수 있음
```

중요한 것은 특정 패턴 이름이 아니다.

핵심은 다음 질문이다.

```text
같은 route가 NavigationStack과 NavigationSplitView에서 함께 쓰일 때
공통 ViewModel 생성 정책을 어디에 둘 것인가?
```

따라서 결론은 다음과 같다.

```text
NavigationStack과 NavigationSplitView 사이에서
ViewModel 생성 위치는 단순 구현 세부사항이 아니다.

같은 route를 서로 다른 navigation 구조에서 공유한다면
ViewModel 생성 위치와 재사용 정책도 함께 설계해야 한다.

그 설계의 한 선택지가 별도 factory 객체일 수 있다.
```

## 참고 문서

- [NavigationStack | Apple Developer Documentation](https://developer.apple.com/documentation/swiftui/navigationstack)
- [NavigationSplitView | Apple Developer Documentation](https://developer.apple.com/documentation/swiftui/navigationsplitview)
- [NavigationLink | Apple Developer Documentation](https://developer.apple.com/documentation/swiftui/navigationlink)

## 실제 구현 참고 PR

- [#438 MainView에 Coordinator를 구성한다](https://github.com/opficdev/SwiftUI_DevLog/pull/438)
- [#446 MainView의 destination ViewModel 생성 및 생명주기를 개선한다](https://github.com/opficdev/SwiftUI_DevLog/pull/446)

