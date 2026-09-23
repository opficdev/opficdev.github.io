---
title: "Flutter 기본 상태관리와 Riverpod으로 같은 MVI 구조를 만들어보면 무엇이 달라질까?"
date: "2026-05-04T15:56:06.048Z"
excerpt: "동일한 커스텀 MVI 패턴으로 구성하되 Flutter 기본 상태관리와 Riverpod으로 만들었을 때 어떻게 달라지는지 비교 및 분석해보았다."
categories: flutter
tags: ["flutter","state management"]
source_url: "https://velog.io/@opficdev/Flutter-기본-상태관리와-Riverpod으로-같은-MVI-구조를-만들어보면-무엇이-달라질까"
header:
  teaser: "/assets/images/posts/flutter-riverpod-mvi/cover.png"
---

Flutter에서 상태관리를 이야기할 때는 보통 Provider, Riverpod, BLoC 같은 라이브러리 이름을 먼저 떠올린다.

그중 MVI와 닮은 단방향 흐름을 가진 주류 패턴을 고르라면 BLoC이 먼저 떠오른다.

```text
Event
-> Bloc
-> State
-> UI
```

이 흐름은 MVI의 기본 구조와 꽤 닮아 있다.

```text
Intent
-> Store
-> State
-> View
```

그렇다면 이런 질문이 생긴다.

> Flutter 기본 상태관리만으로도 MVI 같은 단방향 구조를 만들 수 있을까?
> Riverpod을 쓰면 아키텍처 자체가 달라지는 걸까?
> MVI라면 Riverpod보다 BLoC이 더 맞는 선택 아닐까?

결론부터 말하면 MVI만 놓고 보면 BLoC이 더 자연스럽다.
하지만 이 글의 목적은 'Flutter에서 MVI에 가장 잘 맞는 라이브러리 찾기'가 아니다.

이 글의 목적은 더 좁다.

> 같은 MVI 흐름을 Flutter 기본 상태관리와 Riverpod으로 만들었을 때
> 상태의 소유권, 주입, 구독, 생명주기 책임이 어디에 놓이는지 비교한다.

비교 대상은 다음 두 가지다.

- Flutter 기본 상태관리: `ChangeNotifier` + `InheritedNotifier`
- Riverpod: `NotifierProvider` + `Notifier`

예제 도메인은 스터디 세션 체크인 앱이다.

## 먼저 결과부터

같은 MVI 구조를 두 방식으로 만들면 결과는 이렇게 정리된다.

| 비교 항목 | Flutter 기본 상태관리 | Riverpod |
|---|---|---|
| MVI 구현 가능 여부 | 가능 | 가능 |
| State 변경 | Store 내부에서 `_state` 교체 | Notifier 내부에서 `state` 교체 |
| 변경 알림 | `notifyListeners()` 직접 호출 | `state = ...`로 전파 |
| 의존성 주입 | Scope와 생성자로 직접 구성 | Provider로 구성 |
| 구독 | `InheritedNotifier` 직접 연결 | `ref.watch` |
| 생명주기 | 위젯에서 직접 `dispose()` | ProviderContainer와 provider 설정에 따라 관리 |
| 테스트 확장성 | 의존성이 늘수록 직접 조립 | provider override로 교체 |
| MVI 흐름 강제력 | 직접 설계해야 함 | 직접 설계해야 함 |

여기서 중요한 점은 Riverpod이 MVI를 자동으로 만들어주지 않는다는 것이다.
Riverpod은 MVI 아키텍처 자체가 아니라 상태와 의존성을 운영하기 위한 기반에 가깝다.

정리하면 이렇다.

```text
Flutter 기본 상태관리
-> MVI 원리를 직접 이해하기 좋다.

Riverpod
-> 같은 MVI 구조를 앱 규모가 커져도 유지하기 좋다.

BLoC
-> Flutter에서 MVI와 닮은 단방향 흐름을 가진 주류 패턴에 가깝다.
```

## 비교 기준이 되는 단방향 상태 흐름

이번 글에서는 MVI의 핵심 아이디어인 단방향 상태 흐름을 기준으로 비교한다.

다만 아래 흐름이 표준 MVI라는 뜻은 아니다.
MVI는 구현체마다 Intent, Effect, Result를 나누는 방식이 다르고, 어떤 구현은 Effect나 Result를 별도 요소로 명시하지 않기도 한다.

이 글에서는 Flutter 기본 상태관리와 Riverpod을 같은 기준에서 비교하기 위해 Intent Reducer, Effect Handler, Result Reducer를 명시적으로 분리한 커스텀 흐름을 사용한다.

두 구현의 상태 흐름은 이 기준 안에서 동일하다.

![](/assets/images/posts/flutter-riverpod-mvi/image-01.png)

각 요소의 역할은 다음과 같다.

| 요소 | 역할 |
|---|---|
| View | State를 읽고 UI를 그린다 |
| Intent | 사용자의 의도 또는 화면 이벤트를 표현한다 |
| Intent Reducer | Intent를 받아 즉시 반영할 State와 Effect를 만든다 |
| Effect | 외부 작업을 표현한다 |
| Effect Handler | Repository 호출 같은 비동기 작업을 실행한다 |
| Result | Effect 실행 결과를 표현한다 |
| Result Reducer | Result를 State에 반영한다 |
| State | View 렌더링에 필요한 값을 담는다 |

핵심 규칙은 단순하다.

```text
이 예제의 View는 State를 직접 수정하지 않는다.
View는 Intent만 보낸다.
State 변경은 Store 또는 Notifier 내부에서만 일어난다.
```

이 예제에서는 View가 Intent를 Store 또는 Notifier에 전달하는 메서드 이름으로 `send`를 사용한다.
Redux/Flux 계열에서는 `dispatch`라는 이름도 흔하지만 여기서는 'Intent를 보낸다'는 의미를 더 직접적으로 드러내기 위해 `send`로 통일했다.

Basic MVI에서는 이렇게 Intent를 보낸다.

```dart
basicStudyStore.send(const BasicStudyReloadRequested());
```

Riverpod MVI에서는 이렇게 보낸다.

```dart
riverpodStudyNotifier.send(const RiverpodStudyReloadRequested());
```

View 입장에서는 둘 다 '상태를 바꿔라'가 아니라 '이 의도를 처리해라'에 가깝다.

## 예제 도메인

예제 앱은 스터디 멤버, 세션, 체크인 요약을 보여준다.

```dart
class StudyMember {
  const StudyMember({
    required this.id,
    required this.name,
    required this.role,
    required this.track,
    required this.level,
    required this.nextSessionAt,
    required this.needsHelp,
  });

  final String id;
  final String name;
  final String role;
  final String track;
  final String level;
  final DateTime nextSessionAt;
  final bool needsHelp;
}
```

화면에는 다음 액션이 있다.

- Reload
- Save check-in
- Fail load

Repository는 실제 API 대신 mock 데이터를 반환한다.
중요한 점은 Repository가 State를 직접 바꾸지 않는다는 것이다.

Repository는 데이터를 반환하고 Store 또는 Notifier가 그 결과를 Result로 감싸 State에 반영한다.

## 1. Flutter 기본 상태관리로 구현한 MVI

Flutter 기본 상태관리 방식에서는 Store를 직접 만든다.

```dart
abstract interface class BasicStudyStoreHandle {
  BasicStudyState get state;

  void send(BasicStudyIntent basicStudyIntent);
}

class BasicStudyStore extends ChangeNotifier implements BasicStudyStoreHandle {
  BasicStudyStore(MockStudyRepository mockStudyRepository)
    : _mockStudyRepository = mockStudyRepository;

  final MockStudyRepository _mockStudyRepository;

  var _state = BasicStudyState.initial();
  var _isDisposed = false;

  @override
  BasicStudyState get state => _state;
}
```

`BasicStudyStoreHandle`은 View에 노출되는 최소 인터페이스다.
View는 `state`를 읽고 `send`를 호출할 수 있지만, Store 내부 Repository나 `dispose()` 같은 운영 메서드에는 의존하지 않는다.

이 Store는 세 가지를 직접 책임진다.

```text
State 소유
Intent 처리
변경 알림
```

### State를 숨기고 send만 열어둔다

```dart
var _state = BasicStudyState.initial();

BasicStudyState get state => _state;
```

Dart에서 `_`로 시작하는 식별자는 library-private이다.
이 예제처럼 하나의 파일이 하나의 library로 동작하는 경우 다른 파일에서는 `_state`에 직접 접근할 수 없다.

외부에서는 getter로 State를 읽을 수만 있다.

```dart
BasicStudyState get state => _state;
```

State 변경의 입구는 `send()`다.

```dart
void send(BasicStudyIntent basicStudyIntent) {
  final basicStudyEffect = _reduceIntent(basicStudyIntent);

  if (basicStudyEffect == null) {
    return;
  }

  _handleEffect(basicStudyEffect);
}
```

View는 State를 직접 바꾸지 않고 Intent만 보낸다.

```text
'새로고침 해줘'
'체크인 저장해줘'
'에러 상황을 만들어줘'
```

실제로 어떤 State가 만들어질지는 Store 내부 reducer가 결정한다.

### Intent Reducer는 즉시 반응과 Effect를 분리한다

```dart
BasicStudyEffect? _reduceIntent(BasicStudyIntent basicStudyIntent) {
  return switch (basicStudyIntent) {
    BasicStudyEntered() || BasicStudyReloadRequested() => _prepareLoad(),
    BasicStudySampleCheckInSaved() => _prepareSave(),
    BasicStudyFailureRequested() => _prepareFailure(),
    BasicStudyNoticeConsumed() => _consumeNotice(),
  };
}
```

`_reduceIntent()`는 `BasicStudyEffect?`를 반환한다.
Effect가 없을 수도 있다는 뜻이다.

예를 들어 notice를 닫는 동작은 외부 작업이 필요 없다.

```dart
BasicStudyEffect? _consumeNotice() {
  _setState(_state.copyWith(clearNoticeMessage: true));

  return null;
}
```

반대로 새로고침은 Repository 호출이 필요하다.
그래서 먼저 loading State를 반영하고 Effect를 반환한다.

```dart
BasicStudyEffect _prepareLoad() {
  _setState(
    _state.copyWith(
      isLoading: true,
      clearErrorMessage: true,
      clearNoticeMessage: true,
    ),
  );

  return const BasicLoadOverviewEffect();
}
```

이 구조를 사용하면 즉시 UI에 반영할 상태와 시간이 걸리는 외부 작업을 분리할 수 있다.

```text
Intent Reducer
-> 사용자 입력에 대한 즉시 반응

Effect Handler
-> 비동기 외부 작업

Result Reducer
-> 외부 작업 결과 반영
```

### Effect Handler는 외부 작업을 실행한다

```dart
Future<void> _handleEffect(BasicStudyEffect basicStudyEffect) async {
  try {
    switch (basicStudyEffect) {
      case BasicLoadOverviewEffect():
        final studyOverview = await _mockStudyRepository.loadOverview();
        _reduceResult(BasicOverviewLoaded(studyOverview));

      case BasicSaveSampleCheckInEffect(:final checkInDraft):
        final studyOverview = await _mockStudyRepository.saveCheckIn(
          checkInDraft,
        );
        _reduceResult(BasicCheckInRecordSaved(studyOverview));

      case BasicFailNextLoadEffect():
        _mockStudyRepository.failNextLoad();
        final studyOverview = await _mockStudyRepository.loadOverview();
        _reduceResult(BasicOverviewLoaded(studyOverview));
    }
  } on Object catch (error) {
    final errorMessage = error.toString();

    if (basicStudyEffect is BasicSaveSampleCheckInEffect) {
      _reduceResult(BasicCheckInRecordSaveFailed(errorMessage));
      return;
    }

    _reduceResult(BasicOverviewLoadFailed(errorMessage));
  }
}
```

Repository 호출은 여기서만 일어난다.

```dart
await _mockStudyRepository.loadOverview();
```

성공하면 성공 Result를 만든다.
실패하면 실패 Result를 만든다.

```dart
_reduceResult(BasicOverviewLoaded(studyOverview));
```

### Result Reducer가 최종 State를 만든다

```dart
void _reduceResult(BasicStudyResult basicStudyResult) {
  switch (basicStudyResult) {
    case BasicOverviewLoaded(:final studyOverview):
      _setState(
        _state.copyWith(
          studyMembers: studyOverview.studyMembers,
          studySessions: studyOverview.studySessions,
          studySummary: studyOverview.studySummary,
          isLoading: false,
          clearErrorMessage: true,
          noticeMessage: 'Overview loaded through Result Reducer.',
        ),
      );

    case BasicOverviewLoadFailed(:final errorMessage):
      _setState(
        _state.copyWith(
          isLoading: false,
          errorMessage: errorMessage,
          clearNoticeMessage: true,
        ),
      );
  }
}
```

성공하면 데이터를 State에 넣는다.
실패하면 에러 메시지를 State에 넣는다.

View는 최종 State만 보고 다시 그려진다.

### Basic 방식의 핵심은 `_setState`

```dart
void _setState(BasicStudyState basicStudyState) {
  if (_isDisposed) {
    return;
  }

  _state = basicStudyState;
  notifyListeners();
}
```

여기서 기본 상태관리 방식의 성격이 드러난다.

```text
_state를 직접 교체한다.
notifyListeners()를 직접 호출한다.
dispose 이후 업데이트도 직접 방어한다.
```

이 방식은 상태관리 원리가 잘 보인다는 장점이 있다.
반대로 Store가 많아질수록 생성, 주입, 구독, dispose 코드를 직접 반복해야 한다.

### Store 주입은 `InheritedNotifier`로 직접 구성한다

```dart
class BasicStudyScope extends StatefulWidget {
  const BasicStudyScope({super.key, required this.child});

  final Widget child;

  static BasicStudyStoreHandle of(BuildContext context) {
    final basicStudyInherited = context
        .dependOnInheritedWidgetOfExactType<_BasicStudyInherited>();

    assert(basicStudyInherited != null, 'BasicStudyScope was not found.');

    return basicStudyInherited!.notifier!;
  }

  @override
  State<BasicStudyScope> createState() => _BasicStudyScopeState();
}
```

Scope 내부에서는 Store를 생성하고 dispose한다.

```dart
class _BasicStudyScopeState extends State<BasicStudyScope> {
  late final basicStudyStore = BasicStudyStore(MockStudyRepository());

  @override
  void initState() {
    super.initState();
    Future.microtask(() => basicStudyStore.send(const BasicStudyEntered()));
  }

  @override
  void dispose() {
    basicStudyStore.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return _BasicStudyInherited(
      basicStudyStore: basicStudyStore,
      child: widget.child,
    );
  }
}
```

이 코드가 하는 일은 명확하다.

```text
Store 생성
-> 초기 Intent send
-> 하위 위젯에 Store 제공
-> Scope가 사라질 때 dispose
```

하지만 이 구조를 Store마다 직접 만들어야 한다.
작은 앱에서는 괜찮지만 Store가 늘어나면 보일러플레이트와 생명주기 관리가 부담이 된다.

## 2. Riverpod으로 구현한 MVI

Riverpod에서도 MVI 흐름은 동일하다.

```text
View
-> Intent
-> Intent Reducer
-> Effect
-> Effect Handler
-> Repository
-> Effect Handler
-> Result
-> Result Reducer
-> State
```

다만 Store 운영을 직접 구현하는 대신 Provider 시스템을 사용한다.

### Repository도 Provider로 등록한다

```dart
final _riverpodMockStudyRepositoryProvider = Provider<MockStudyRepository>(
  (ref) => MockStudyRepository(),
);
```

Basic MVI에서는 Store를 만들 때 Repository를 직접 넘겼다.

```dart
BasicStudyStore(MockStudyRepository())
```

Riverpod에서는 Repository 자체를 Provider로 등록한다.
다만 이 예제에서는 View가 Repository Provider를 직접 읽어 MVI 흐름을 우회하지 않도록 private으로 둔다.

실제 앱에서는 Repository Provider를 별도 DI 파일에 public으로 두고, feature View에서는 Notifier만 읽도록 import 경계를 나누는 방식도 가능하다.
핵심은 View가 Repository를 직접 호출하지 않고 `send`를 통해서만 상태 흐름에 참여하게 만드는 것이다.

```text
MockStudyRepository
-> LocalStudyRepository
-> RemoteStudyRepository
-> CachedStudyRepository
```

의존성 변경이 Store 생성 코드가 아니라 Provider override 전략으로 이동한다.

### Store 역할은 Notifier가 맡는다

```dart
final provider = NotifierProvider<RiverpodStudyNotifier, RiverpodStudyState>(
  RiverpodStudyNotifier.new,
);
```

`RiverpodStudyNotifier`는 Basic MVI의 Store와 비슷한 역할을 한다.

```dart
class RiverpodStudyNotifier extends Notifier<RiverpodStudyState> {
  @override
  RiverpodStudyState build() {
    return RiverpodStudyState.initial();
  }
}
```

Basic MVI에서는 Store가 `_state` 필드를 직접 들고 있었다.

```dart
var _state = BasicStudyState.initial();
```

Riverpod에서는 Notifier의 `state`를 사용한다.

```dart
state = state.copyWith(
  isLoading: true,
  clearErrorMessage: true,
  clearNoticeMessage: true,
);
```

차이는 여기서 명확해진다.

```dart
// Basic MVI
_state = basicStudyState;
notifyListeners();

// Riverpod MVI
state = state.copyWith(...);
```

Riverpod에서는 `notifyListeners()`를 직접 호출하지 않는다.
`state`를 새 값으로 교체하면 Riverpod이 필요한 구독자에게 변경을 전파한다.

### Intent Reducer 구조는 거의 같다

```dart
RiverpodStudyEffect? _reduceIntent(RiverpodStudyIntent riverpodStudyIntent) {
  return switch (riverpodStudyIntent) {
    RiverpodStudyEntered() || RiverpodStudyReloadRequested() => _prepareLoad(),
    RiverpodStudySampleCheckInSaved() => _prepareSave(),
    RiverpodStudyFailureRequested() => _prepareFailure(),
    RiverpodStudyNoticeConsumed() => _consumeNotice(),
  };
}
```

Basic MVI와 구조가 거의 같다.

즉 Riverpod을 쓴다고 MVI가 사라지는 것이 아니다.
Intent, Effect, Result, Reducer는 그대로 유지된다.

차이는 상태 변경과 운영 책임의 위치다.

```dart
// Basic MVI
_setState(
  _state.copyWith(
    isLoading: true,
    clearErrorMessage: true,
    clearNoticeMessage: true,
  ),
);

// Riverpod MVI
state = state.copyWith(
  isLoading: true,
  clearErrorMessage: true,
  clearNoticeMessage: true,
);
```

### Effect Handler에서 의존성은 `ref`로 읽는다

```dart
Future<void> _handleEffect(RiverpodStudyEffect riverpodStudyEffect) async {
  final mockStudyRepository = ref.read(_riverpodMockStudyRepositoryProvider);

  try {
    switch (riverpodStudyEffect) {
      case RiverpodLoadOverviewEffect():
        final studyOverview = await mockStudyRepository.loadOverview();
        _reduceResult(RiverpodOverviewLoaded(studyOverview));
    }
  } on Object catch (error) {
    final errorMessage = error.toString();
    _reduceResult(RiverpodOverviewLoadFailed(errorMessage));
  }
}
```

Basic MVI에서는 Repository가 생성자로 들어왔다.

```dart
BasicStudyStore(MockStudyRepository mockStudyRepository)
  : _mockStudyRepository = mockStudyRepository;
```

Riverpod에서는 `ref.read()`로 Provider를 읽는다.

```dart
ref.read(_riverpodMockStudyRepositoryProvider);
```

의존성이 많아질수록 이 차이가 커진다.

```text
AuthRepository
StudyRepository
AnalyticsService
LocalCache
FeatureFlag
```

기본 상태관리에서는 이것들을 어디서 생성하고 어떻게 전달할지 직접 설계해야 한다.
Riverpod에서는 각 의존성을 Provider로 등록하고 필요한 곳에서 읽으면 된다.

### View에서는 `watch`와 `read`를 구분한다

Riverpod View는 다음처럼 State 구독과 Intent send를 나눈다.

```dart
final riverpodStudyState = ref.watch(riverpodStudyProvider);
final riverpodStudyNotifier = ref.read(riverpodStudyProvider.notifier);
```

역할은 다르다.

```text
ref.watch
-> provider를 구독한다.
-> 값이 바뀌면 Widget이 rebuild 된다.

ref.read
-> 현재 값을 한 번 읽는다.
-> 보통 이벤트 핸들러에서 Intent를 보낼 때 사용한다.
```

화면 렌더링에는 `watch`를 쓴다.

```dart
final riverpodStudyState = ref.watch(riverpodStudyProvider);
```

버튼 이벤트에는 `read`를 쓴다.

```dart
onSaveCheckIn: () {
  riverpodStudyNotifier.send(const RiverpodStudySampleCheckInSaved());
}
```

View는 State를 구독하고 이벤트가 발생하면 Intent를 보낸다.
이 점은 Basic MVI와 같다.

## 그럼 BLoC이 더 나은가?

MVI 흐름만 보면 BLoC이 더 자연스럽다.
BLoC은 기본적으로 Event를 받고 State를 내보내는 구조이기 때문이다.

```text
Event
-> Bloc
-> State
```

MVI의 용어로 바꾸면 다음처럼 볼 수 있다.

```text
Intent
-> Store
-> State
```

따라서 Flutter에서 MVI와 닮은 단방향 흐름의 주류 선택지를 찾는다면 BLoC을 먼저 검토하는 것이 자연스럽다.

하지만 이 글에서 비교하려는 지점은 'MVI에 가장 잘 맞는 라이브러리'가 아니다.
이 글의 비교 지점은 다음이다.

```text
Flutter 기본 상태관리로 MVI를 직접 만들면 어떤 책임을 직접 갖는가?
Riverpod으로 같은 MVI를 만들면 어떤 책임이 Provider 시스템으로 이동하는가?
```

BLoC은 단방향 흐름을 라이브러리 구조가 더 강하게 유도한다.
Riverpod은 단방향 흐름을 강제하기보다 상태 소유권과 의존성 그래프를 운영하기 쉽게 해준다.

그래서 선택 기준은 이렇게 나눌 수 있다.

```text
MVI에 가까운 이벤트 기반 구조를 라이브러리 차원에서 강하게 가져가고 싶다
-> BLoC

Provider graph, dependency override, scope 관리, 조합성을 중요하게 본다
-> Riverpod

상태관리 원리와 MVI 구성 요소를 직접 이해하고 싶다
-> ChangeNotifier + InheritedNotifier
```

## 같은 MVI인데 무엇이 달라졌나?

두 구현은 겉으로 보면 비슷하다.

```text
State
Intent
Effect
Result
Reducer
```

하지만 운영 책임은 다르다.

### 1. State 소유권

Basic MVI에서는 Store가 State 필드를 직접 가진다.

```dart
var _state = BasicStudyState.initial();
```

Riverpod MVI에서는 Notifier가 `state`를 노출한다.
그리고 Riverpod 관점에서 provider state는 ProviderContainer에 저장된다.

```dart
state = state.copyWith(...);
```

정리하면 다음과 같다.

```text
Basic MVI
-> Store가 State 보관과 변경 알림을 직접 책임진다.

Riverpod MVI
-> Notifier는 State 변경 로직을 갖고 ProviderContainer가 provider state를 관리한다.
```

### 2. DI

Basic MVI는 Scope와 생성자를 직접 조립한다.

```dart
late final basicStudyStore = BasicStudyStore(MockStudyRepository());
```

Riverpod은 Provider 선언이 의존성 그래프의 단위가 된다.

```dart
final _riverpodMockStudyRepositoryProvider = Provider<MockStudyRepository>(
  (ref) => MockStudyRepository(),
);
```

테스트에서는 provider override로 의존성을 교체할 수 있다.

```dart
ProviderScope(
  overrides: [
    studyRepositoryProvider.overrideWithValue(fakeRepository),
  ],
  child: App(),
)
```

### 3. 구독

Basic MVI에서는 `InheritedNotifier`를 직접 만든다.

```dart
class _BasicStudyInherited extends InheritedNotifier<BasicStudyStore>
```

View에서는 Scope를 통해 Store를 가져온다.

```dart
final basicStudyStore = BasicStudyScope.of(context);
final basicStudyState = basicStudyStore.state;
```

Riverpod에서는 `ref.watch`가 구독을 담당한다.

```dart
final riverpodStudyState = ref.watch(riverpodStudyProvider);
```

### 4. 생명주기

Basic MVI에서는 위젯 생명주기 안에서 Store를 직접 dispose한다.

```dart
@override
void dispose() {
  basicStudyStore.dispose();
  super.dispose();
}
```

비동기 작업이 늦게 끝날 수도 있으므로 dispose 이후 State 변경도 직접 막는다.

```dart
if (_isDisposed) {
  return;
}
```

Riverpod에서는 provider state가 ProviderContainer 안에 저장된다.
그리고 provider의 생명주기는 provider 설정과 ProviderScope 범위에 따라 달라진다.
다만 여기서 주의할 점이 있다.

`autoDispose`가 아닌 provider는 단순히 화면에서 구독이 사라졌다는 이유만으로 바로 정리되지 않는다.
화면 단위로 정리하고 싶다면 `NotifierProvider.autoDispose`나 별도의 `ProviderScope` 전략을 써야 한다.

```dart
final studyProvider = NotifierProvider.autoDispose<StudyNotifier, StudyState>(
  StudyNotifier.new,
);
```

또한 timer, stream, cancel token 같은 리소스가 있다면 `ref.onDispose`로 정리해야 한다.

```dart
@override
StudyState build() {
  final timer = Timer.periodic(const Duration(seconds: 1), (_) {
    // ...
  });

  ref.onDispose(timer.cancel);

  return StudyState.initial();
}
```

즉 Riverpod이 생명주기 관리의 중심을 제공하지만 모든 비동기 정리 코드를 자동으로 대신 작성해주는 것은 아니다.

## 실제로 줄어든 책임

이 비교의 핵심은 코드 길이가 아니다.
책임의 이동이다.

Basic MVI Store가 직접 책임지는 것:

```text
State 보관
State 변경
변경 알림
구독 연결
Scope 생성
Repository 생성
초기 Intent 호출
dispose
dispose 이후 업데이트 방어
```

Riverpod MVI Notifier가 주로 책임지는 것:

```text
Intent 처리
Effect 실행
Result 반영
State 변경
필요한 리소스 정리 등록
```

Riverpod 쪽으로 이동하는 것:

```text
Provider 생성
의존성 주입
구독
상태 변경 전파
provider state 저장
provider 범위 관리
```

따라서 Riverpod은 MVI를 대체하는 것이 아니다.
MVI를 운영하기 위한 기반을 제공한다.

```text
Basic MVI
-> Store 운영까지 직접 구현하는 MVI

Riverpod MVI
-> Store 운영의 많은 부분을 Riverpod에 위임하는 MVI
```

## Basic MVI가 좋은 경우

Flutter 기본 상태관리는 별로인 방식이 아니다.
오히려 학습용으로는 좋다.

Basic MVI를 직접 만들면 다음 질문을 피할 수 없다.

```text
State는 누가 소유하는가?
View는 어떻게 구독하는가?
State 변경은 어떻게 전파되는가?
Store는 어디서 생성하는가?
Store는 언제 dispose되는가?
Repository는 어떻게 주입하는가?
```

상태관리의 원리를 직접 만져보게 된다.

다음 조건에서는 `ChangeNotifier` + `InheritedNotifier`도 충분하다.

```text
화면 수가 적다.
전역 상태가 거의 없다.
의존성이 단순하다.
테스트보다 구조 이해가 목적이다.
```

## Riverpod이 유리한 경우

앱이 커질수록 Store 운영 문제가 커진다.

예를 들어 Store가 다음처럼 늘어난다고 해보자.

```text
StudyListStore
StudyDetailStore
SessionListStore
CheckInStore
SettingsStore
AuthStore
NotificationStore
```

기본 상태관리만 쓰면 이런 질문을 매번 직접 해결해야 한다.

```text
각 Store는 어디서 만들까?
어떤 Store는 앱 전체에서 공유해야 할까?
어떤 Store는 화면 단위로 dispose해야 할까?
Repository는 어디서 생성할까?
테스트에서는 Mock을 어떻게 넣을까?
비동기 작업 중 화면이 사라지면 어떻게 할까?
```

Riverpod은 이 문제를 Provider 그래프와 Scope로 다룬다.

```text
Provider로 의존성 선언
ref.watch로 구독
ref.read로 이벤트 처리
ProviderScope로 범위 지정
ProviderContainer와 provider 설정으로 state 관리
```

그래서 중간 규모 이상의 앱에서는 Riverpod의 장점이 더 크게 보인다.

## 한눈에 보는 흐름 비교

![](/assets/images/posts/flutter-riverpod-mvi/image-02.png)

MVI 흐름은 거의 같다.
다른 것은 마지막 책임자다.

```text
Basic MVI
-> 내가 notifyListeners와 InheritedNotifier를 관리한다.

Riverpod MVI
-> Riverpod이 상태 전파와 구독을 관리한다.
```

## 주의할 점

이 비교를 읽을 때 다음 세 가지는 구분해야 한다.

### Dart의 `_`는 library-private이다

`_state`는 class-private이 아니라 library-private이다.
이 예제처럼 파일 하나가 library 하나로 동작하면 파일 밖에서 접근할 수 없지만 Dart의 private 기준은 class가 아니라 library다.

### State 내부 컬렉션도 수정 불가능하게 노출한다

`_state` 자체를 외부에서 교체하지 못하게 막는 것과 `state.studyMembers` 같은 컬렉션 내부 변경을 막는 것은 다르다.

이 예제에서는 State 생성 시 리스트를 `List.unmodifiable(...)`로 감싸 View가 `send`를 거치지 않고 컬렉션을 수정하는 경로를 막는다.

```dart
BasicStudyState({
  required List<StudyMember> studyMembers,
  required List<StudySession> studySessions,
  ...
}) : studyMembers = List.unmodifiable(studyMembers),
     studySessions = List.unmodifiable(studySessions);
```

다만 타입은 여전히 `List`라서 `clear()`나 `add()` 같은 메서드가 코드상으로는 보인다.
차이는 실행 시점에 수정하려고 하면 `UnsupportedError`가 발생한다는 것이다.

컴파일 단계에서 수정 메서드까지 숨기고 싶다면 View에 `Iterable`이나 별도의 읽기 전용 모델을 노출하는 방식도 고려할 수 있다.

### Riverpod도 비동기 정리는 설계가 필요하다

Riverpod이 provider state와 구독을 관리해주지만 네트워크 요청 취소나 stream/timer 정리는 직접 설계해야 한다.
이때 `ref.onDispose`와 `autoDispose`가 핵심 도구가 된다.

또 하나 주의할 점은 동시에 여러 Intent가 들어오는 경우다.
이 예제의 `send()`는 `_handleEffect()`를 기다리지 않는다.
그래서 실전 앱에서 reload 요청이 여러 번 겹치면 늦게 끝난 요청이 나중에 State를 덮을 수 있다.

실전에서는 request id를 두거나, 이전 요청을 취소하거나, `AsyncValue` 같은 비동기 상태 표현을 사용하는 식으로 경쟁 상태를 별도로 다뤄야 한다.


## 결론

Flutter에서 MVI와 닮은 단방향 흐름을 가진 주류 패턴은 BLoC에 가깝다.
하지만 BLoC만이 MVI를 만들 수 있는 것은 아니다.

Flutter 기본 상태관리만으로도 MVI는 충분히 만들 수 있다.
다만 기본 상태관리 방식에서는 다음을 직접 책임져야 한다.

```text
Store 생성
Store 주입
State 구독
변경 알림
dispose
의존성 전달
```

Riverpod을 쓰면 이 책임 중 상당수가 Provider 시스템으로 이동한다.

그래서 코드의 본질은 더 MVI에 집중된다.

```text
Intent를 어떻게 해석할 것인가?
어떤 Effect가 필요한가?
Effect 결과를 어떤 Result로 표현할 것인가?
Result를 State에 어떻게 반영할 것인가?
```

즉 이 글의 결론은 'Riverpod이 BLoC보다 MVI에 더 적합하다'가 아니다.

결론은 이것이다.

```text
MVI와 닮은 단방향 흐름의 Flutter 주류 패턴을 찾는다면
-> BLoC

MVI의 상태 소유권, 주입, 구독, 생명주기 책임이 어떻게 이동하는지 보고 싶다면
-> Flutter 기본 상태관리와 Riverpod 비교
```

Basic MVI를 직접 만들어본 뒤 Riverpod으로 넘어가면 Riverpod이 해결하는 문제가 훨씬 선명하게 보인다.

그때 Riverpod은 '마법 같은 패키지'가 아니라 상태 소유권, 주입, 구독, 생명주기를 체계적으로 맡아주는 도구로 보이기 시작한다.

## 참고 문서

- [Flutter `ChangeNotifier`](https://api.flutter.dev/flutter/foundation/ChangeNotifier-class.html)
- [Flutter `InheritedNotifier`](https://api.flutter.dev/flutter/widgets/InheritedNotifier-class.html)
- [Riverpod `NotifierProvider`](https://docs-v2.riverpod.dev/docs/providers/notifier_provider)
- [Riverpod ProviderContainer/ProviderScope](https://riverpod.dev/docs/concepts2/containers)
- [Riverpod Automatic disposal](https://riverpod.dev/docs/concepts2/auto_dispose)
- [Dart Libraries and imports](https://dart.dev/language/libraries)

