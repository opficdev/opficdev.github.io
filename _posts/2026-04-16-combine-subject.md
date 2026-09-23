---
title: "Subject"
date: "2026-04-15T15:00:52.088Z"
excerpt: "Combine의 Subject에 대해 간단하게 알아보자"
categories: swift
tags: ["Combine","swift"]
source_url: "https://velog.io/@opficdev/CombineSubject"
---

### 1. 왜 Subject가 필요한가
Combine의 Publisher은 외부에서 값을 직접 주입할 수 없다.
즉 데이터 흐름은 항상 내부에서 생성되어 **외부로 방출되는 구조**다.

<img width="50%" src="/assets/images/posts/combine-subject/image-01.png">
- Just 같은 Publisher은 외부에서 값을 수정할 수가 없다.

하지만 앱에서는 다음과 같은 흐름이 필요한 경우가 많다
- 사용자 액션을 트리거로 이벤트를 발생시키고 싶을 때
- 외부 시스템 (Notification, Delegate 등)에서 값을 전달받을 때
- 특정 시점에 수동으로 값을 방출하고 싶을 때

이처럼 외부에서 값을 푸시할 수 있는 형태가 필요하고, 그 역할을 하는 것이 **Subject**이다. 코드의 PassthroughSubject가 뭔지는 하단에서 설명하겠다.

### 2. Subject란 무엇인가
Subject는 다음 2가지 역할을 **동시**에 수행한다.
- Publisher -> 이벤트 발행자
- Subscriber -> 이벤트 구독자

즉 값을 받아 다시 방출하는 중간 지점이다.

<img width="50%" src="/assets/images/posts/combine-subject/image-02.png">

### 3. Subject의 종류
Subject는 다음 2가지가 존재한다
- CurrentValueSubject -> 상태 보관
- PassthroughSubject -> 이벤트 보관

### 4. CurrentValueSubject
특징
- 항상 최신값을 저장한다
- 생성 시 초기값 지정이 필요하다
- 새로운 subscriber은 현재 값을 즉시 전달받는다

사용 예시
- ViewModel의 상태
- UI 상태 바인딩
- 현재 최신값이 항상 필요한 경우

즉 `상태(State)`를 표현할 때 주로 사용한다

**예시 코드**

<img width="50%" src="/assets/images/posts/combine-subject/image-03.png">

### 5. PassthroughSubject
특징
- 값을 저장하지 않는다
- 구독 이후에 발생한 값만 전달한다
- 과거 값은 알 수가 없다

사용 예시
- 버튼 클릭 이벤트
- 네트워크 요청 트리거
- 단순 이벤트 전달

즉 `순간적인 이벤트`를 전달할 때 주로 사용한다

**예시 코드**

<img width="50%" src="/assets/images/posts/combine-subject/image-04.png">

### 6. completion과 Life Cycle
Subject도 Publisher이기 때문에 completion을 가진다

<img width="50%" src="/assets/images/posts/combine-subject/image-05.png">

.send(completion: .finished)를 통해 스트림을 종료시키며 더 이상 값이 전달되지 않는다.
