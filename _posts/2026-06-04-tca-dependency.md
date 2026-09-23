---
title: "TCA Dependency: 외부 작업을 Reducer에서 분리하기"
date: "2026-06-04T11:07:59.268Z"
excerpt: "Dependency의 역활에 대해 정리"
categories: architecture
tags: ["The Composable Architecture"]
source_url: "https://velog.io/@opficdev/TCA-Dependency-외부-작업을-Reducer에서-분리하기"
header:
  teaser: "/assets/images/posts/tca-cover.png"
---

## 범위

이번 정리에서 볼 흐름.

```text
Action
-> Reducer
-> Effect
-> Dependency
-> Action
-> Reducer
-> State
```

`Dependency`는 외부 작업의 구현을 Reducer에서 분리하기 위해 사용한다.

여기서 말하는 외부 작업.

- 시간 지연
- API 요청
- DB 접근
- 파일 저장
- 현재 날짜 읽기
- UUID 생성

이번 예제에서는 가장 작은 단위로 시간 지연만 본다.

```text
버튼 탭
-> 1초 대기
-> count 증가
```

## Dependency 없이 작성한 코드

먼저 `Task.sleep`을 직접 호출하는 형태.

```swift
@Reducer
struct CounterFeature {
    @ObservableState
    struct State: Equatable {
        var count = 0
        var isLoading = false
    }

    enum Action {
        case delayedIncrementButtonTapped
        case delayedIncrementFinished
    }

    var body: some ReducerOf<Self> {
        Reduce { state, action in
            switch action {
            case .delayedIncrementButtonTapped:
                state.isLoading = true

                return .run { send in
                    try await Task.sleep(for: .seconds(1))
                    await send(.delayedIncrementFinished)
                }

            case .delayedIncrementFinished:
                state.count += 1
                state.isLoading = false
            }

            return .none
        }
    }
}
```

동작은 문제 없다.

```text
delayedIncrementButtonTapped
-> isLoading = true
-> Task.sleep
-> delayedIncrementFinished
-> count += 1
```

하지만 Reducer 안의 Effect가 구체적인 시간 지연 구현을 직접 알고 있다.

```swift
try await Task.sleep(for: .seconds(1))
```

카운터에서는 큰 문제가 아니지만 이 자리가 API 요청이나 파일 저장으로 바뀌면 Reducer가 외부 구현을 계속 끌고 가게 된다.

## Dependency를 사용한 코드

`Task.sleep`을 직접 호출하지 않고 `DelayClient`라는 Dependency를 만들어 사용한다.

```swift
struct DelayClient {
    var wait: @Sendable () async throws -> Void
}

extension DelayClient: DependencyKey {
    static let liveValue = Self(
        wait: {
            try await Task.sleep(for: .seconds(1))
        }
    )
}

extension DependencyValues {
    var delayClient: DelayClient {
        get { self[DelayClient.self] }
        set { self[DelayClient.self] = newValue }
    }
}
```

`DelayClient`는 시간 지연 작업을 가진다.

`liveValue`에는 실제 앱에서 사용할 구현을 넣는다.

`DependencyValues`에 `delayClient`를 추가하면 Reducer에서 `@Dependency`로 꺼내 쓸 수 있다.

```swift
@Reducer
struct CounterDependencyFeature {
    @ObservableState
    struct State: Equatable {
        var count = 0
        var isLoading = false
    }

    enum Action {
        case delayedIncrementButtonTapped
        case delayedIncrementFinished
    }

    @Dependency(\.delayClient) var delayClient

    var body: some ReducerOf<Self> {
        Reduce { state, action in
            switch action {
            case .delayedIncrementButtonTapped:
                state.isLoading = true

                return .run { [delayClient] send in
                    try await delayClient.wait()
                    await send(.delayedIncrementFinished)
                }

            case .delayedIncrementFinished:
                state.count += 1
                state.isLoading = false
            }

            return .none
        }
    }
}
```

핵심은 이 부분.

```swift
@Dependency(\.delayClient) var delayClient
```

Effect 안에서는 직접 `Task.sleep`을 호출하지 않는다.

```swift
try await delayClient.wait()
```

Reducer가 `Task.sleep`이라는 구체 구현을 직접 들고 있지 않게 된다.

## 역할 분리

현재 예제에서 각 역할.

```text
Action: 지연 증가 버튼을 눌렀다는 이벤트
Reducer: isLoading을 바꾸고 Effect를 반환
Effect: 비동기 작업을 실행
Dependency: 시간 지연 구현을 제공
```

Reducer가 모든 일을 직접 처리하는 구조가 아니다.

```text
Reducer는 상태 변경과 작업 지시를 담당한다.
Effect는 작업을 실행한다.
Dependency는 외부 구현을 제공한다.
```

이 기준으로 보면 `Dependency`는 Reducer를 더 작게 만드는 도구라기보다 Reducer가 알아야 하는 것을 줄이는 도구에 가깝다.

## 왜 분리하는가

예제만 보면 `Task.sleep`을 직접 쓰는 코드가 더 짧다.

```swift
try await Task.sleep(for: .seconds(1))
```

그래도 Dependency를 쓰는 이유는 외부 작업이 바뀌었을 때 더 명확해진다.

예를 들어 사용자 정보를 가져오는 작업이라면 Reducer가 네트워크 구현을 알 필요가 없다.

```swift
@Dependency(\.userClient) var userClient
```

Reducer는 필요한 작업만 호출한다.

```swift
let user = try await userClient.fetch()
```

`userClient`가 실제로 URLSession을 쓰는지 테스트용 값을 반환하는지 실패를 만들어내는지는 Reducer의 관심사가 아니다.

Reducer 입장에서 중요한 것은 작업 결과가 다시 Action으로 들어온다는 점이다.

```text
Effect
-> userClient.fetch()
-> send(.userResponse(user))
-> Reducer
-> State 변경
```

## 테스트 관점

Dependency를 분리하면 테스트에서 외부 작업을 바꿔 끼울 수 있다.

시간 지연 예제에서는 실제 1초를 기다리지 않게 만들 수 있다.

```swift
let store = TestStore(initialState: CounterDependencyFeature.State()) {
    CounterDependencyFeature()
} withDependencies: {
    $0.delayClient.wait = {}
}
```

현재는 `TestStore`를 자세히 보지 않는다.

여기서는 Dependency의 기준만 잡는다.

```text
실제 환경에서는 실제 Dependency 사용
테스트 환경에서는 테스트용 Dependency 사용
```

Reducer의 흐름은 그대로 두고 외부 구현만 바꿀 수 있다.

## 정리

Dependency를 쓰는 이유.

```text
Reducer가 외부 구현을 직접 알지 않게 하기
```

현재 기준.

```text
State = 화면에 필요한 값
Action = 상태 변경이나 작업 시작의 계기
Reducer = 상태 변경 규칙과 Effect 반환 위치
Effect = 비동기 작업 실행 위치
Dependency = 외부 구현을 주입받는 위치
```

`Effect.run`은 비동기 작업을 실행하는 위치다.

`Dependency`는 그 작업에 필요한 외부 구현을 Reducer 밖에서 가져오는 방식이다.

## 참고

- [The Composable Architecture - Dependency management](https://swiftpackageindex.com/pointfreeco/swift-composable-architecture/1.25.5/documentation/composablearchitecture/dependencymanagement)
- [The Composable Architecture - Effect](https://swiftpackageindex.com/pointfreeco/swift-composable-architecture/1.25.5/documentation/composablearchitecture/effect)
