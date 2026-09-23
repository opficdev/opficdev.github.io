---
title: "Publisher"
date: "2026-04-17T01:03:20.001Z"
excerpt: "Combine의 Publisher에 대해 간단히 알아보자"
categories: swift
tags: ["Combine","swift"]
source_url: "https://velog.io/@opficdev/Publisher"
---

## 1. Publisher란 무엇인가
공식 문서에서는 Publisher란 다음과 같이 정의한다.

<img src="/assets/images/posts/combine-publisher/image-01.png">

- a type that can deliver a sequence of values over time

즉 시간에 따라 값을 방출하는 타입이다.

더 자세히 설명하자면 
- 값(Value)을 비동기적으로 생성
- 여러 값을 스트림 형태로 전달
- 마지막에 완료(completion) 혹은 실패(failure) 발생

이러한 성질로 인해 다음과 같은 형태로 많이 사용된다.
- 스트림 기반 데이터 흐름
- 이벤트 처리 모델
- Reactive Programming


## 2. 이벤트
공식 문서에서는 Publisher을 통해 다음과 같은 3가지 이벤트를 전달할 수 있다고 설명한다.
<img src="/assets/images/posts/combine-publisher/image-02.png">

### 1. receive(subscription:)
- Publisher가 Subscriber에게 `이제 연결되었으니 제어해` 라고 알려주는 단계
- Subscription 객체를 전달하여 제어 (**Subscription**: Publisher과 Subscriber 사이의 `연결 객체`)
- **구독 시작 + 제어권 전달**

### 2. receive(_:)
- Publisher가 값을 **하나씩** Subscriber에게 전달하는 단계
- 여러번 호출이 가능하다 (0 ~ n번)
- return 값으로 **Subscribers.Demand**를 반환하므로 이를 통해 값을 추가 요청이 가능하다
- **실제 데이터 전달**

### 3. receive(completion:)
- Publisher가 `이제 종료됨`을 알림
- 딱 **1번**만 호출됨
- 호출 이후에는 값이 오지 않고 스트림이 완전이 종료된다
- **스트림 종료**

## 3. 구조
... 추가 검색해야할듯

## 4. 가장 간단한 Publisher 사용 예제
<img width="50%" src="/assets/images/posts/combine-publisher/image-03.png">

-  단일 값 방출 후 즉시 종료되는 결과를 볼 수 있다
- **sink** 가 Subscriber 역할을 하고 있다.

## 5. Subscriber과의 연결
앞선 예제에서 `sink`를 통해 쉽게 값을 받았지만, 사실은 더 큰 의미가 있다.
Publisher은 값을 만들어 낼 수 있는 타입이지만 그 자체만으로는 데이터 전달이 시작되지 않는다. 공식 문서에서도 Publisher과 Subscriber를 연결할 때 내부적으로 publisher.subscribe(subscriber)를 호출하고, Publisher은 Subscriber가 연결되기 전까지 데이터를 보낼 수 없다고 설명한다.

<img src="/assets/images/posts/combine-publisher/image-04.png">

즉 Combine의 데이터 흐름은 다음과 같이 설명이 가능하다
> Publisher = 값을 방출할 수 있는 쪽
> Subscriber = 값을 받겠다고 선언하는 쪽
> Subscription = 둘 사이를 연결하고 흐름을 제어하는 객체

기억해야 할 점은 Publisher은 단순히 `값 저장소`가 아닌 Subscriber과 연결되었을 때 동작하는 스트림의 출발점이라는 것이다. 이 구조 덕분에 Combine은 일반적인 `함수 호출 -> 즉시 값 반환` 형태와 다르게 구독이 발생해야 실행되는 지연 구조(`Lazy`) 성격을 가진다. 

### 왜 Subscriber가 있어야 하는가?
일반적인 함수 코드는 다음과 같이 즉시 값이 방출된다.
```swift
func add(_ lhs: Int, _ rhs: Int) -> Int {
	return lhs + rhs
}

print(add(1, 2))
// 3
```
하지만 Publisher은 만들어 둔다고 해서 값이 자동으로 방출되지 않는다.
```swift
import Combine

let publisher = [1, 2, 3].publisher
```
이 코드는 `값을 방출할 수 있는 Publisher를 만든 것` 뿐이다. 값 방출에 대해 컨트롤하는 Subscriber가 없기 때문에 `데이터 방출` 이라는 이벤트가 전혀 발생하지 않는다. Subscriber가 붙어야 Publisher가 만든 값을 누구에게, 어떤 속도로, 어떤 생명 주기로 결정할 수 있다. 

### Subscriber가 붙으면 무슨 일이 일어날까?
1. Subscriber가 Publisher을 구독한다.
2. Publisher는 Subscriber에게 Subscription을 전달한다.
3. Subscriber는 Subscription을 통해 몇 개의 값을 받을지 요청한다.
4. Publisher는 그 요청에 맞춰 값을 방출한다.
5. 마지막으로 완료 이벤트를 보낸다.

즉 Combine에서의 연결은 리스너 등록이 아닌, `데이터 흐름 자체의 시작`이다.

## 6. Operator을 통한 변환
Publisher는 연산자(Operator)를 통해 변환이 가능하다.

```swift
// 공식 문서에서 가져온 코드
let cancellable = [1, 2, 3, 4, 5].publisher
    .filter {
        $0 % 2 == 0
    }
    .sink {
        print ("Even number: \($0)")
    }
// Prints:
// Even number: 2
// Even number: 4
```
