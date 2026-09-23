---
title: "Observable: 선언형 문법 뒤의 추적 구조를 파고들다"
date: "2026-06-19T07:57:57.975Z"
excerpt: "@Observable이 단순한 편의 문법이 아니라 매크로 확장을 통해 property access를 기록하고 SwiftUI의 View 갱신 범위를 확인하고 정리"
categories: swift
tags: ["observable"]
source_url: "https://velog.io/@opficdev/Observable-선언형-문법-뒤의-추적-구조를-파고들다"
---

## 1. SwiftUI는 `@Observable`을 어떻게 읽는가

WWDC23에서 Apple은 `body`가 실행될 때 SwiftUI가 `Observable` 타입에서 사용된 프로퍼티 접근을 추적한다고 설명한다. 또 `body` 실행 중 모델이 특정 프로퍼티에 접근했다는 사실을 SwiftUI가 알고 있으며 추적되지 않은 프로퍼티는 View invalidation에 포함되지 않을 수 있다고 설명한다.

```swift
import SwiftUI

@Observable
final class FoodTruckModel {
	var orders: [String] = []
	var donuts: [String] = ["Glazed", "Chocolate"]
}

struct DonutMenu: View {
	let model: FoodTruckModel

	var body: some View {
		List {
			ForEach(model.donuts, id: \.self) { donut in
				Text(donut)
			}

			Button("Add donut") {
				model.orders.append("New Donut")
				model.donuts.append("New Donut")
			}
		}
	}
}
```

이 예제에서 `body`는 `model.donuts`만 사용한다. WWDC 설명 기준으로 보면  donuts 배열의 변경은 추적 대상에 들어가고 추적 대상에 없는 `orders` 변경은 추적 대상에 들어가지 않는다고 가정할 수 있다.

### 확인 링크

- [WWDC23 - Discover Observation in SwiftUI](https://developer.apple.com/videos/play/wwdc2023/10149/)
- [SE-0395 Observability](https://github.com/swiftlang/swift-evolution/blob/main/proposals/0395-observability.md)

---

## 2. Observation은 무엇을 추적하는 모델인가

`SE-0395`가 설명하는 `Observation`의 중심은 변경 사실 자체보다 접근 기록이다. `withObservationTracking`은 특정 scope 안에서 어떤 tracked property access가 일어났는지 수집한다. 이후 그 access 대상이 바뀌면 `onChange`를 호출한다. 이 순서가 먼저 잡혀야 `@Observable`도 읽힌다.

이 모델에서 중요한 것은 두 가지다. 하나는 추적이 객체 전체가 아니라 body에서 접근한 기준으로 형성된다는 점이다. 다른 하나는 추적이 선언 시점이 아니라 실행 시점에 만들어진다는 점이다. 어떤 프로퍼티가 실제 dependency가 되는지는 `body`나 `withObservationTracking` 클로저가 실행된 뒤에야 정해진다.


<table>
<tr>
<td align="center"><img src="/assets/images/posts/observable-tracking/image-01.png" alt="Observation 추적 예시의 첫 화면"></td>
<td align="center"><img src="/assets/images/posts/observable-tracking/image-02.png" alt="Observation 추적 예시의 실행 결과"></td>
</tr>
</table>

이 코드에서는 `model.name`에 대한 접근이 추적된다. 콘솔 결과는 버튼을 탭한 순서대로 기록한 것이다. `Start Tracking` 버튼을 탭하면 `withObservationTracking`의 apply closure가 즉시 실행된다. 그래서 먼저 `print(model.name)`가 실행되어 `opfic`가 출력된다. 이 시점에 추적 대상도 함께 만들어진다.

그 다음 `Change age`를 탭하면 `age changed: 28`만 출력된다. `age`는 첫번째 클로저 안에서 접근하지 않았기 때문에 이 변경은 `onChange`를 호출하지 않는다. 마지막으로 `Change name`을 탭하면 `tracked property changed`가 먼저 출력되고 그 다음 `name changed: jin`이 출력된다. 현재 예제에서는 `model.name = "jin"` 대입 경로의 `willSet` 단계에서 `onChange`가 호출될 수 있기 때문이다. 이 결과는 `withObservationTracking`이 객체 전체 변경을 보는 것이 아니라 apply closure 안에서 실제로 접근한 프로퍼티만 추적한다는 것을 보여 준다.

`ObservationTracking.swift`를 보면 이 동작은 `generateAccessList()`와 `_installTracking()`으로 구분된다. 먼저 access list를 만들고 그 다음 그 목록에 observer를 설치한다. 즉 추적의 실체는 어떠한 '관찰'이 아니라 access list 생성과 observer 설치다.

### 레퍼런스

- [SE-0395 Proposed solution](https://github.com/swiftlang/swift-evolution/blob/main/proposals/0395-observability.md)
- [ObservationTracking.swift](https://github.com/swiftlang/swift/blob/main/stdlib/public/Observation/Sources/Observation/ObservationTracking.swift)
- [Observation overview](https://developer.apple.com/documentation/observation)

---

## 3. `@Observable` 매크로는 타입을 어떻게 바꾸는가

타입 수준 구현은 `ObservableMacro.swift`에서 시작한다. 이 파일은 `ObservableMacro`를 `MemberMacro`와 `MemberAttributeMacro`와 `ExtensionMacro`로 확장한다. 각 role이 맡는 책임이 다르기 때문에 generated code도 여러 단계로 나뉜다.

첫 단계는 타입에 공통 member를 추가하는 것이다. `MemberMacro` expansion은 다음 멤버를 넣는다.

- `_$observationRegistrar` (`ObservableMacro.swift` L343)
- `access(keyPath:)` (`ObservableMacro.swift` L344)
- `withMutation(keyPath:_:)` (`ObservableMacro.swift` L345)
- `shouldNotifyObservers` 계열 helper (`ObservableMacro.swift` L346-L349)

둘째 단계는 각 저장 프로퍼티에 `@ObservationTracked`를 붙이는 것이다. 이 작업은 `MemberAttributeMacro`가 맡는다. 단 `@ObservationIgnored`가 붙은 프로퍼티와 `@ObservationTracked`가 붙은 프로퍼티는 건너뛴다. 

셋째 단계는 타입에 `Observable` conformance를 추가하는 것이다. 이 부분은 `ExtensionMacro`가 맡는다. 그래서 최종 결과는 단순한 annotation 추가가 아니라 타입 선언과 멤버 선언과 프로퍼티 선언이 동시에 재작성된 형태다.

```swift
@Observable
final class Model {
	var order: String?
	var allRecipesUnlocked = false
}
```

실제 해당 모델의 확장은 이 형태다.
<img class="theme-image--dark" src="/assets/images/posts/observable-tracking/image-03.png" alt="Observable comparison">
<img class="theme-image--light" src="/assets/images/posts/observable-tracking/image-04.png" alt="Observable comparison">
여기서 먼저 볼 것은 프로퍼티별 코드보다 타입에 공통으로 추가되는 멤버들이다. 실제 프로퍼티별 getter와 setter는 다음 섹션에서 이 helper들을 사용하는 형태로 이어진다.

### 레퍼런스

- [SE-0395 macro expansion example](https://github.com/swiftlang/swift-evolution/blob/main/proposals/0395-observability.md)
- [ObservableMacro.swift](https://github.com/swiftlang/swift/blob/main/lib/Macros/Sources/ObservationMacros/ObservableMacro.swift)

---

## 4. 읽기와 변경은 어떤 경로로 추적되는가

프로퍼티 수준 구현은 `ObservationTrackedMacro`가 맡는다. 이 매크로는 Swift macro의 `@attached(accessor)` 역할과 `@attached(peer)` 역할을 함께 구현한다. 즉 accessor를 만들 뿐 아니라 원래 저장 프로퍼티를 실제 값을 담는 내부 저장소로 옮긴다. 

```swift
@Observable
final class Counter {
	var count = 0
}
```

`ObservableMacro.swift`에서 이 프로퍼티에 해당하는 핵심 생성 코드는 아래 두 파트이다.

<img class="theme-image--dark" src="/assets/images/posts/observable-tracking/image-05.png" alt="Observable-creation">
<img class="theme-image--light" src="/assets/images/posts/observable-tracking/image-06.png" alt="Observable-creation">

```swift
// 500번째 줄
let storage = DeclSyntax(
  property.privatePrefixed(
    "_",
    addingAttribute: ObservableMacro.ignoredAttribute,
    removingAttribute: ObservableMacro.trackedAttribute,
    in: localContext
  )
)
```

이 결과를 보면 `@Observable`이 붙은 stored property는 그대로 유지되지 않는다고 정리할 수 있다. 대신 실제 값을 담는 저장소 하나와 바깥에서 접근하는 프로퍼티 코드가 나뉜다. 예를 들어 `count`가 있으면 실제 값은 `_count` 같은 이름으로 내려가고 바깥의 `count`에는 읽기와 쓰기용 코드가 붙는다.

즉 stored property 하나를 보면 실제로는 두 가지 결과가 생긴다.

- getter setter `_modify`가 붙은 바깥 프로퍼티
- 실제 값을 담는 내부 저장소

여기서 getter는 프로퍼티 접근을 기록한다. setter는 프로퍼티에 새 값을 넣고 그 변경을 Observation 쪽에 전달한다. `_modify`는 `append`처럼 값 내부를 직접 바꾸는 경우를 처리한다. 그래서 `@Observable`은 프로퍼티를 그대로 두는 것이 아니라 프로퍼티마다 읽기 경로와 쓰기 경로와 값 내부를 직접 바꾸는 경로를 따로 만든다고 보면 된다.

setter는 `withMutation`에 들어가기 전에 `shouldNotifyObservers`를 한 번 거친다. 이 helper는 타입에 따라 다르게 동작한다. `Equatable` 값은 `!=`로 비교하고, class는 identity 또는 equality 기준으로 비교한다. `Non-Equatable` 값은 비교할 수 없기 때문에 setter의 `shouldNotifyObservers` 단계에서는 항상 `true`로 처리된다. 반면 `_modify`는 같은 방식으로 비교하지 않는다.

### 레퍼런스

- [ObservableMacro.swift](https://github.com/swiftlang/swift/blob/main/lib/Macros/Sources/ObservationMacros/ObservableMacro.swift)
- [ObservationRegistrar.swift](https://github.com/swiftlang/swift/blob/main/stdlib/public/Observation/Sources/Observation/ObservationRegistrar.swift)

---

## 5. computed property와 collection에서는 추적이 어떻게 이어지는가

computed property는 두 종류로 나눠서 봐야 한다.

첫째는 저장 프로퍼티 조합으로 만들어진 computed property다. 이 경우는 자동 추적이 된다. `SE-0395`문서에서는 저장 프로퍼티를 바탕으로 값을 만드는 computed property는 자동 추적된다고 설명한다. 

```text
Computed properties that derive their values from stored properties are automatically tracked due to their reliance on tracked properties.
```

```swift
@Observable
final class FoodTruckModel {
	var orders: [String] = []

	var orderCount: Int {
		orders.count
	}
}
```

이 `orderCount`를 읽으면 `orders` access가 함께 일어난다. 그래서 `orders` 변경은 `orderCount`를 읽은 View의 갱신과 연결될 수 있다.

둘째는 값이 외부 저장소나 간접 저장소에 있는 computed property다. 이 경우는 자동 추적이 되지 않는다. `SE-0395`는 이때 getter와 setter 안에 `access(keyPath:)`와 `withMutation(keyPath:_:)`를 직접 써야 한다고 설명한다.

```text
Computed properties that source their value from remote storage or via indirection, however, must manually add tracking using the generated access(keyPath:) and withMutation(keyPath:) methods.
```

아래 `AtomicModel` 예시는 그 수동 연결이 실제로 어떤 모양인지 보여 준다. `score`는 computed property지만 실제 값은 `_scoreStorage`에 있고 getter와 setter가 직접 추적 경로를 연결한다.

```swift
@Observable
public class AtomicModel {
    @ObservationIgnored
    fileprivate let _scoreStorage = AtomicInt(initialValue: 0)

    public var score: Int {
        get {
            self.access(keyPath: \.score)
            return _scoreStorage.value
        }
        set {
            self.withMutation(keyPath: \.score) {
                _scoreStorage.value = newValue
            }
        }
    }
}
```

### 레퍼런스

- [WWDC23 - Discover Observation in SwiftUI](https://developer.apple.com/videos/play/wwdc2023/10149/)
- [SE-0395 - Computed properties](https://github.com/swiftlang/swift-evolution/blob/main/proposals/0395-observability.md)
- [SE-0395 - withObservationTracking](https://github.com/swiftlang/swift-evolution/blob/main/proposals/0395-observability.md)

---

## 6. `ObservableObject`와 비교하면 무엇이 달라지는가

`ObservableObject`와 `@Observable`의 차이는 annotation 개수보다 추적 단위에서 먼저 드러난다. `ObservableObject`는 `objectWillChange`를 중심에 두고 `@Published` 프로퍼티를 그 publisher에 연결한다. 따라서 같은 객체를 `@ObservedObject`로 받는 View는 객체 변경 알림 전체와 더 강하게 결합된다.

`SE-0395`가 문제로 보는 부분도 여기다. `@Published`를 반복해서 붙여야 한다는 문법 문제도 있지만 더 큰 문제는 변경 통지가 객체 단위로 넓게 퍼지기 쉽다는 점이다. proposal이 safety와 performance와 expressiveness 균형을 말하는 이유가 여기에 있다.

이 차이는 선언만 비교하면 약하게 보인다. 실제 차이는 View를 나눠서 `_printChanges()`로 확인할 때 더 분명하다. 아래 코드는 같은 구조를 `ObservableObject`와 `@Observable` 각각에 적용한 예시다.

<table>
<tr>
<td valign="top" width="50%">
<pre><code class="language-swift">import Combine
import SwiftUI

final class Model: ObservableObject {
    @Published var count = 0
    @Published var title = "Hello"
}

struct ContentView: View {
    @StateObject private var model = Model()

    var body: some View {
        let _ = Self._printChanges()

        VStack {
            Button("Count +1") {
                model.count += 1
            }

            CountView(model: model)
            TitleView(model: model)
        }
    }
}

private struct CountView: View {
    @ObservedObject var model: Model

    var body: some View {
        let _ = Self._printChanges()
        Text("count: \(model.count)")
    }
}

private struct TitleView: View {
    @ObservedObject var model: Model

    var body: some View {
        let _ = Self._printChanges()
        Text(model.title)
    }
}</code></pre>
</td>

<td valign="top" width="50%">
  <img src="/assets/images/posts/observable-tracking/image-07.gif">
</td>
</tr>
</table>

<table>
<tr>
<td valign="top" width="50%">
<pre><code class="language-swift">import SwiftUI

@Observable
final class Model {
    var count = 0
    var title = "Hello"
}

struct ContentView: View {
    @State private var model = Model()

    var body: some View {
        let _ = Self._printChanges()

        VStack {
            Button("Count +1") {
                model.count += 1
            }

            CountView(model: model)
            TitleView(model: model)
        }
    }
}

private struct CountView: View {
    let model: Model

    var body: some View {
        let _ = Self._printChanges()
        Text("count: \(model.count)")
    }
}

private struct TitleView: View {
    let model: Model

    var body: some View {
        let _ = Self._printChanges()
        Text(model.title)
    }
}</code></pre>
</td>

<td valign="top" width="50%">
  <img src="/assets/images/posts/observable-tracking/image-08.gif">
</td>
</tr>
</table>

위 예제의 실행 결과를 보면 `ObservableObject` 예시에서는 `ContentView: _model changed.`, `CountView: _model changed.`, `TitleView: _model changed.`가 출력된다. 같은 객체를 `@ObservedObject`로 받은 상위 View와 하위 View가 함께 다시 평가된 것이다.

반면 `@Observable` 예시에서는 `CountView: \Model.<computed ... (Int)> changed.`만 출력된다. 이 예시에서는 `count`에 접근한 `CountView`만 반응했고 `TitleView`는 같은 방식으로 다시 평가되지 않았다. 여기서 드러나는 차이가 `objectWillChange` 중심 모델과 property access tracking 중심 모델의 차이다.

### 레퍼런스

- [SE-0395 Motivation](https://github.com/swiftlang/swift-evolution/blob/main/proposals/0395-observability.md)
- [WWDC23 migration section](https://developer.apple.com/videos/play/wwdc2023/10149/)
- [Combine ObservableObject](https://developer.apple.com/documentation/combine/observableobject/)

---

## 7. 정리: 보이는 선언은 `@Observable`이지만 실제 동작을 결정하는 것은 Observation 추적 경로다

`@Observable`은 표면적으로는 model declaration 문법처럼 보인다. 하지만 앞에서 본 것처럼 이 매크로는 stored property를 그대로 두지 않고 타입에 공통 helper를 추가하고 프로퍼티마다 읽기와 쓰기 경로를 만든다. 그리고 SwiftUI는 그 generated accessor를 통해 `body` 안의 property access를 수집한다.

이 흐름을 줄이면 다음과 같다.

1. `@Observable`이 타입을 다시 쓴다.
2. stored property가 실제 값을 담는 내부 저장소와 바깥 프로퍼티 코드로 나뉜다.
3. getter와 setter와 `_modify`가 서로 다른 추적 경로를 만든다.
4. registrar가 그 경로를 runtime tracking으로 이어 준다.
5. computed property도 내부에서 tracked property에 접근하면 그 접근 경로를 통해 추적된다.
6. 외부 저장소나 간접 저장소를 쓰는 computed property는 `access(keyPath:)`와 `withMutation(keyPath:_:)`를 직접 연결해야 한다.
7. SwiftUI는 실행 중 접근한 property를 dependency로 삼는다.
8. 이 방식은 `objectWillChange` 중심의 객체 단위 알림보다 View가 실제로 접근한 property에 더 가깝게 반응한다.

따라서 `@Observable`을 읽을 때 중심은 annotation 자체보다 access path에 있다. 어떤 모델을 넘겼는가보다 View가 실제로 무엇에 접근했는가가 더 중요하다.
