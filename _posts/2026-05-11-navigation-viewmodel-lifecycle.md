---
title: "NavigationStack과 NavigationSplitView 사이에서 ViewModel은 어디서 만들어야 할까?"
date: "2026-05-10T16:27:10.860Z"
excerpt: "NavigationStack 기반 iOS 앱을 NavigationSplitView 구조로 확장하며 ViewModel 생성 위치와 생명주기 책임을 어떻게 분리할지 정리"
tags: ["iOS","SwiftUI","Navigation","Life Cycle"]
redirect_from: ["/ios/navigation-viewmodel-lifecycle/"]
source_url: "https://velog.io/@opficdev/NavigationStack과-NavigationSplitView-사이에서-ViewModel은-어디서-만들어야-할까"
header:
  teaser: "/assets/images/posts/navigation-viewmodel-lifecycle/cover.png"
---

## 같은 화면을 두 가지 구조로 그리게 됐습니다

지금 만들고 있는 앱은 처음에 iPhone만 생각하고 만들었습니다. 홈에서 카테고리를 고르면 리스트 화면이 push되고 리스트에서 항목을 고르면 상세 화면이 그 위에 push되는 `NavigationStack` 구조였습니다.

iPad와 Mac까지 지원하면서 넓은 화면에서는 `NavigationSplitView`로 사이드바, 홈, 상세 화면을 나란히 보여 주도록 바꿨습니다. 분기 기준은 기기 종류가 아니라 `horizontalSizeClass`입니다. iPad에서도 화면을 나눠 쓰면 창이 좁아져 compact가 되기 때문입니다.

이렇게 바꾸고 나서 리스트와 상세 화면의 ViewModel을 어디서 만들고 언제까지 유지할지 다시 정해야 했습니다. 이 글에 나오는 앱 코드는 실제 코드에서 역할만 남기고 이름을 바꿔 다시 작성한 것입니다.

## 두 layout이 route 배열 하나를 나눠 읽습니다

화면 이동은 route 배열 하나로 관리합니다. compact layout은 배열 전체를 쓰고 regular layout은 첫 route를 detail의 루트로 읽고 나머지는 detail 안의 path로 읽습니다.

```swift
@Observable
final class Router<Route: Hashable> {
    var path: [Route] = []

    var root: Route? { path.first }

    var detailPath: [Route] {
        get { Array(path.dropFirst()) }
        set { path = root.map { [$0] + newValue } ?? newValue }
    }
}
```

regular layout에서는 detail column 안에 `NavigationStack`을 하나 더 둡니다.

```swift
if isCompactLayout {
    NavigationStack(path: $router.path) {
        HomeView()
            .navigationDestination(for: Route.self, destination: destination)
    }
} else {
    NavigationSplitView {
        Sidebar()
    } content: {
        HomeView()
    } detail: {
        NavigationStack(path: $router.detailPath) {
            Group {
                if let root = router.root {
                    destination(root)
                }
            }
            .navigationDestination(for: Route.self, destination: destination)
        }
    }
}
```

홈에서 카테고리를 고르면 compact layout에서는 배열에 push하고 regular layout에서는 배열을 그 route 하나로 바꿉니다. 리스트에서 항목을 고르는 동작은 두 layout 모두 push입니다.

| `path` | compact layout | regular layout |
| --- | --- | --- |
| `[.list(a)]` | 홈 위에 리스트 | 리스트가 detail 루트 |
| `[.list(a), .detail(x)]` | 홈 위에 리스트와 상세가 차례로 쌓임 | 리스트가 detail 루트가 되고 상세는 그 위에 쌓임 |

router는 layout 바깥에 있어서 layout이 바뀌어도 `path`는 그대로 남습니다. 바뀌는 것은 route를 그리는 위치입니다. 같은 `.detail(x)`라도 compact layout에서는 `navigationDestination` 안에서 View가 되고 regular layout에서는 detail column 안에서 View가 됩니다.

## layout이 바뀔 때마다 ViewModel이 새로 만들어졌습니다

처음에는 `destination(_:)`이 호출될 때마다 ViewModel을 새로 만들었습니다.

```swift
@ViewBuilder
func destination(_ route: Route) -> some View {
    switch route {
    case .list(let category):
        ListView(viewModel: ListViewModel(category: category))
            .id(category)
    case .detail(let id):
        DetailView(viewModel: DetailViewModel(id: id))
            .id(id)
    }
}
```

리스트와 상세 화면은 전달받은 ViewModel을 `@State`로 보관합니다.

```swift
struct DetailView: View {
    @State var viewModel: DetailViewModel
    // ...
}
```

`@State`는 View의 identity가 유지되는 동안 처음 받은 값을 계속 씁니다. 그래서 상위 View의 body가 다시 평가되어 `destination(_:)`이 불리면 ViewModel은 새로 만들어지지만 화면은 기존 ViewModel을 그대로 쓰고 새 인스턴스는 쓰이지 않습니다. Apple 문서도 `@State`를 memberwise initializer로 설정하면 SwiftUI의 저장소 관리와 충돌할 수 있다고 안내합니다.

반면 `horizontalSizeClass`가 바뀌면 상세 화면이 다른 위치에서 새 identity로 만들어집니다. 이때 `@State`는 새로 받은 인스턴스로 초기화되고 그 인스턴스는 초기 상태에서 시작합니다. 같은 항목을 보고 있었더라도 이전 ViewModel이 들고 있던 상태는 이어지지 않습니다.

## 같은 조건이면 같은 인스턴스를 돌려줍니다

ViewModel 생성을 coordinator로 옮기고 생성 조건이 같으면 보관해 둔 인스턴스를 돌려주게 했습니다. 처음에는 id별 dictionary에 보관했지만 regular layout에서는 홈이 계속 떠 있어서 여러 항목을 오갈수록 dictionary가 커집니다. 지금 보고 있는 화면의 상태만 이어지면 충분했기 때문에 타입마다 인스턴스 하나만 보관하도록 바꿨습니다.

```swift
@Observable
final class Coordinator {
    @ObservationIgnored
    private var detailViewModel: DetailViewModel?

    func detailViewModel(id: String, isEditable: Bool = true) -> DetailViewModel {
        if let detailViewModel,
           detailViewModel.id == id,
           detailViewModel.isEditable == isEditable {
            return detailViewModel
        }
        let detailViewModel = DetailViewModel(id: id, isEditable: isEditable)
        self.detailViewModel = detailViewModel
        return detailViewModel
    }
}
```

`destination(_:)`은 이제 coordinator에 ViewModel을 요청합니다.

```swift
case .detail(let id):
    DetailView(viewModel: coordinator.detailViewModel(id: id))
        .id(id)
```

리스트 ViewModel도 category를 조건으로 같은 방식으로 재사용합니다. 재사용 조건은 coordinator가 따로 key를 두지 않고 ViewModel이 가진 생성 입력으로 비교합니다. 생성 입력은 생성할 때 정해지고 바뀌지 않는 값이라 ViewModel의 화면 상태(`state`)에 넣지 않고 상수로 두었습니다. 같은 항목이라도 편집할 수 없는 화면에서 열면 다른 ViewModel이어야 하므로 `isEditable`도 함께 비교합니다.

보관 프로퍼티에는 `@ObservationIgnored`를 붙였습니다. `detailViewModel(id:isEditable:)`은 상위 View의 body를 평가하는 도중에 불립니다. 보관 프로퍼티가 관찰 대상이면 body 안에서 슬롯을 읽고 새 인스턴스를 넣는 것만으로 상위 View가 다시 그려질 수 있습니다.

## .id가 있어야 새 ViewModel이 들어갑니다

ViewModel을 `@State`로 보관하는 한 `destination(_:)`의 `.id(id)`는 빠지면 안 됩니다. regular layout에서 다른 카테고리를 고르면 detail 루트의 route만 `.list(a)`에서 `.list(b)`로 바뀌고 View는 같은 자리에 남습니다. `.id`가 없으면 identity가 유지되어 route는 b인데 화면은 a의 ViewModel을 계속 씁니다. route의 id로 identity를 바꿔 줘야 coordinator가 새로 만든 인스턴스가 `@State`에 들어갑니다.

## 인스턴스 하나만 보관해서 남는 제약

코드 리뷰에서 인스턴스 하나만 보관하면 같은 타입의 화면이 stack에 여러 개 있을 때 마지막 요청만 슬롯에 남아 이전 화면의 ViewModel이 다시 만들어질 수 있다는 의견을 받았습니다. ViewModel 생성자에 `print`를 넣고 화면을 회전해 보니 로그는 처음 한 번만 찍혔습니다. 회전만으로는 ViewModel이 다시 만들어지지 않았으므로 dictionary로 되돌리지 않았습니다. 다만 같은 타입의 화면이 동시에 둘 이상 떠 있는 경우는 리뷰 의견이 맞았습니다.

실제로 슬롯 하나를 여러 탭이 함께 쓰면 문제가 생깁니다. compact layout의 `TabView`에서 두 탭에 서로 다른 상세 화면을 열어 두면 탭을 바꾸기만 해도 상위 View의 body가 다시 평가되면서 슬롯이 두 항목의 ViewModel을 번갈아 새로 만듭니다. 화면에 떠 있는 상세 화면은 `@State`가 기존 인스턴스를 쥐고 있어서 바로 드러나지 않지만 이 상태에서 layout이 바뀌면 두 상세 화면 모두 새 인스턴스를 받아 이전 상태가 이어지지 않습니다. 방문한 화면의 상태를 모두 보존해야 한다면 id 기반 dictionary가 맞습니다.

## 비슷한 상황이라면

compact와 regular layout을 함께 지원하면서 layout을 바꿀 때 하위 화면의 상태가 사라진다면 아래 항목을 확인합니다.

1. route 배열이 layout 바깥에 있는지 봅니다. 두 layout이 같은 배열을 읽어야 전환 뒤에도 같은 화면이 다시 그려집니다.
2. destination View가 ViewModel을 `@State`로 받는다면 View를 만드는 쪽에서 매번 새 ViewModel을 만들고 있지 않은지 봅니다. layout 전환처럼 identity가 바뀌는 순간 그 새 인스턴스가 `@State`에 들어갑니다.
3. 같은 조건이면 같은 인스턴스를 돌려주게 하고 조건은 ViewModel이 가진 생성 입력으로 비교합니다.
4. 같은 자리에서 route만 바뀌는 화면에는 생성 입력과 같은 값으로 `.id`를 붙입니다.
5. 같은 타입의 화면 여러 개가 각자 상태를 보존해야 한다면 인스턴스 하나 대신 id 기반 dictionary로 보관합니다.

## 참고 문서

- [NavigationStack \| Apple Developer Documentation](https://developer.apple.com/documentation/swiftui/navigationstack)
- [NavigationSplitView \| Apple Developer Documentation](https://developer.apple.com/documentation/swiftui/navigationsplitview)
- [State \| Apple Developer Documentation](https://developer.apple.com/documentation/swiftui/state)
