---
title: "URLSession 딥다이브: Swift 네트워크 요청은 어디서 실행되고 어디서 실패하는가"
date: "2026-06-24T05:09:54.265Z"
excerpt: "Swift의 URLRequest와 URLSession이 각각 어떤 책임을 갖는지 실험 코드로 확인하고 HTTP status validation, 진행 중인 중복 요청 방지, retry, auth 같은 네트워크 레이어 설계 기준을 정리한다"
categories: swift
tags: ["URLSession"]
source_url: "https://velog.io/@opficdev/URLSession-딥다이브-Swift-네트워크-요청은-어디서-실행되고-어디서-실패하는가"
---

Swift에서 네트워크 코드를 작성할 때 가장 먼저 만나는 타입은 보통 `URLRequest`와 `URLSession`이다. 겉으로 보면 둘 다 '요청을 보내는 코드' 근처에 있기 때문에 역할이 섞여 보인다. 하지만 실제로 네트워크 레이어를 설계하다 보면 둘은 전혀 다른 층에 있다.

`URLRequest`는 요청을 표현하는 타입이다. 어떤 URL로 보낼지, 어떤 HTTP method를 사용할지, 어떤 header와 body를 담을지, 요청 단위 timeout을 얼마로 둘지를 구성한다. 반면 `URLSession`은 그 요청을 실행하는 주체다. session은 configuration을 바탕으로 cache, cookie, credential, connection policy, delegate, background transfer 같은 실행 환경을 가진다.

처음에는 이 차이가 단순한 API 구분처럼 보인다. 하지만 status code validation, retry, auth 같은 문제를 만나면 이야기가 달라진다. 이 문제들은 `URLRequest`만 알아도 해결되지 않고 `URLSession`만 알아도 깔끔하게 정리되지 않는다. 요청을 만드는 단계, 실행하는 단계, 응답을 해석하는 단계, 실행 전후 정책을 적용하는 단계를 분리해서 봐야 한다.

이 글은 `URLSession`을 중심으로 Swift 네트워크 요청의 실행 모델을 실험해 본다. Swift API 설명에만 머물지 않고 HTTP 요청과 응답, 연결 재사용, 실패 처리 같은 실제 실행 흐름도 함께 정리한다.

## 이 글에서 다룰 흐름

처음 네트워크 코드를 작성할 때는 `URLSession.shared.data(for:)` 한 줄이면 충분해 보인다. 하지만 앱 안에서 요청이 많아지면 곧 비슷한 문제가 반복된다. 요청은 어디에서 만들고 어디에서 보내야 하는지, 404 응답은 왜 `catch`로 들어오지 않는지, 같은 요청이 동시에 여러 번 나가도 괜찮은지 같은 문제다.

이 글은 그런 질문을 API 사용법 순서가 아니라 요청의 흐름 순서로 따라간다. 먼저 `URLRequest`가 어떤 요청을 보낼지 표현하는 값이라는 점을 확인하고, 그 다음 `URLSession`이 그 요청을 실제 네트워크 작업으로 실행하는 방식을 본다. 이후 HTTP status code, 진행 중인 중복 요청 방지, retry, auth처럼 실제 앱에서 네트워크 레이어를 만들 때 부딪히는 정책들을 하나씩 분리해서 살펴본다.

목표는 특정 API를 외우는 것이 아니다. `URLRequest`와 `URLSession` 사이에서 어떤 책임을 어디에 둬야 하는지 판단할 수 있는 기준을 만드는 것이다.

## 실험 환경

실험은 가능한 한 작은 코드로 구성한다. 이 글에서는 별도 HTTP 서버를 직접 만들지 않고 `URLProtocol`을 사용해 request와 response 흐름을 관찰한다.

`URLProtocol`은 Foundation URL Loading System 안에서 request를 가로채 테스트 응답을 만들어 낼 수 있다. 실제 TCP 연결, DNS, TLS handshake, 서버의 HTTP cache 재검증까지 검증하는 도구는 아니지만 `URLSession`이 HTTP status code를 어떻게 다루는지, 같은 request를 여러 번 실행하면 몇 번 처리되는지, validation과 decoding 경계를 어디에 둘 수 있는지 정도를 확인하기에는 충분하다.

아래 코드는 실험에 사용할 `URLProtocol` 구현과 session 생성 함수다. `CountingURLProtocol`은 요청이 몇 번 처리됐는지 카운팅하고 실험마다 바꿔 넣은 `responseProvider`로 가짜 HTTP 응답을 돌려준다. `makeSession()`은 이 protocol을 사용하는 `URLSession`을 만든다.

```swift
import Foundation

final class CountingURLProtocol: URLProtocol {
	private static let lock = NSLock()
	private static var storedRequestCount = 0

	static var requestCount: Int {
		lock.withLock {
			storedRequestCount
		}
	}

	static var responseProvider: ((URLRequest) throws -> (HTTPURLResponse, Data))?

	static func reset() {
		lock.withLock {
			storedRequestCount = 0
		}
	}

	override class func canInit(with request: URLRequest) -> Bool {
		true
	}

	override class func canonicalRequest(for request: URLRequest) -> URLRequest {
		request
	}

	override func startLoading() {
		Self.lock.withLock {
			Self.storedRequestCount += 1
		}

		do {
			guard let provider = Self.responseProvider else {
				throw URLError(.badServerResponse)
			}

			let (response, data) = try provider(request)
			client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .allowed)
			client?.urlProtocol(self, didLoad: data)
			client?.urlProtocolDidFinishLoading(self)
		} catch {
			client?.urlProtocol(self, didFailWithError: error)
		}
	}

	override func stopLoading() {}
}

func makeSession() -> URLSession {
	let configuration = URLSessionConfiguration.ephemeral
	configuration.protocolClasses = [CountingURLProtocol.self]
	return URLSession(configuration: configuration)
}
```

## 1. URLRequest는 요청을 표현하는 값이다

`URLRequest`는 HTTP 요청을 표현하는 값이다. URL, method, header, body, timeout, cache policy 같은 정보가 들어간다. 다만 `URLRequest` 자체가 네트워크를 실행하지는 않는다. 같은 `URLRequest`를 여러 번 session에 넘기면 매번 새로운 실행이 시작된다.

이 구분은 중요하다. `요청을 만들었다`는 사실과 `요청을 실행했다`는 사실을 섞어 생각하면 네트워크 레이어에서 어디까지가 구성이고 어디부터가 실행인지 흐려지기 쉽다. `URLRequest`를 만들었다고 socket이 열리는 것이 아니다. DNS lookup이 발생하는 것도 아니고 TCP connection이 만들어지는 것도 아니며 TLS handshake가 시작되는 것도 아니다. 실제 네트워크 I/O는 `URLSessionTask`의 `resume()`이나 async API인 `data(for:)`가 호출되어 task가 실행될 때 시작된다.

```swift
var request = URLRequest(url: URL(string: "https://example.com/users")!)
request.httpMethod = "POST"
request.setValue("application/json", forHTTPHeaderField: "Content-Type")
request.httpBody = #"{"name":"opfic"}"#.data(using: .utf8)
request.timeoutInterval = 5
```

이 코드는 설명한대로 네트워크 요청을 보낸 것이 아니다. 요청을 설명하는 값을 만든 것이다.

`URLRequest`는 HTTP message를 구성하는 단계와 비슷하다. HTTP request line, header field, message body에 해당하는 정보를 담는다. 하지만 연결 설정, 흐름 제어, 혼잡 제어, 세그먼트 재전송 같은 일은 여기서 일어나지 않는다. 그 아래 작업은 `URLSession`과 OS 네트워크 스택이 담당한다.

### 실험: 같은 URLRequest를 여러 번 보내기

```swift
let session = makeSession()
let url = URL(string: "https://example.com/users")!
let request = URLRequest(url: url)

CountingURLProtocol.reset()
CountingURLProtocol.responseProvider = { request in
	let response = HTTPURLResponse(
		url: request.url!,
		statusCode: 200,
		httpVersion: nil,
		headerFields: ["Content-Type": "application/json"]
	)!
	return (response, Data(#"{"ok":true}"#.utf8))
}

_ = try await session.data(for: request)
_ = try await session.data(for: request)
_ = try await session.data(for: request)

print(CountingURLProtocol.requestCount)
```
<img width="300px" src="/assets/images/posts/urlsession-deep-dive/image-01.png">

결과는 `3`이다. 같은 `URLRequest` 값을 재사용해도 session은 각각의 호출을 별도 실행으로 본다. 값이 같다는 것과 실행 결과가 공유된다는 것은 다른 문제다.

이 지점에서 '동일 GET 요청이면 알아서 하나만 보내면 되지 않나?'라는 의문이 생긴다. 하지만 그것은 HTTP cache나 진행 중인 중복 요청 방지의 영역이다. `URLRequest`가 같은 값을 가진다고 해서 Foundation이 앱의 의미를 추론해 결과를 공유해 주지는 않는다.

## 2. URLSession은 요청 실행 환경이다

`URLSession`은 request를 받아 실제 네트워크 작업을 만든다. session은 단순 함수가 아니라 실행 환경에 가깝다. configuration에는 session이 요청을 실행할 때 따를 기본 정책이 들어간다.

```swift
let configuration = URLSessionConfiguration.default
configuration.timeoutIntervalForRequest = 10
configuration.timeoutIntervalForResource = 60
configuration.requestCachePolicy = .useProtocolCachePolicy
configuration.waitsForConnectivity = true

let session = URLSession(configuration: configuration)
```

이 설정은 개별 `URLRequest` 하나에만 적용되는 값이 아니라 session이 실행하는 요청들의 기본 정책이다. 반대로 `URLRequest.timeoutInterval`이나 `URLRequest.cachePolicy`는 특정 요청에 붙는 값이다.

네트워크 계층 관점에서 보면 앱이 직접 다루는 것은 주로 응용 계층의 HTTP 요청이다. `URLSession`은 이 요청을 실행하면서 configuration에 담긴 timeout, cache policy, connectivity 같은 실행 정책을 적용한다. 실제 DNS 조회, TCP 연결 설정, TLS handshake, 연결 재사용 같은 하위 작업은 개발자가 직접 구현하지 않는다.

`URLSession`은 delegate를 통해 redirect, authentication challenge, task metrics, background transfer 같은 하위 이벤트를 전달할 수 있다. 다만 이 글의 실험은 `URLProtocol`로 request/response 흐름을 관찰하는 데 집중하므로 delegate 이벤트는 별도 실험으로 다루지 않는다.

### shared를 쓸지 직접 session을 만들지 결정하기

`URLSession.shared`는 가장 쉽게 사용할 수 있는 싱글톤 세션이다. 간단한 요청에는 편하지만 configuration을 세밀하게 제어하기 어렵다. 앱의 네트워크 정책을 명시적으로 가져가야 한다면 직접 `URLSessionConfiguration`을 만들고 세션을 생성하는 편이 낫다.

직접 세션을 만들 때는 목적에 맞는 configuration을 골라야 한다. `default` configuration은 disk cache, cookie, credential storage 같은 일반적인 동작을 사용한다. `ephemeral` configuration은 persistent storage를 남기지 않는 방향의 session을 만든다. `background` configuration은 앱이 백그라운드에 있는 동안에도 upload/download를 이어가기 위한 방식이다.

## 3. HTTP status code는 직접 검증해야 한다

`URLSession.data(for:)`는 `(Data, URLResponse)`를 반환한다. 처음에는 404나 500 같은 status code가 `try await`에서 throw될 것처럼 느껴질 수 있다. 하지만 서버가 HTTP response를 반환했다면 status code가 404든 500이든 response 자체는 받을 수 있다.

즉 404 응답은 네트워크 요청이 아무 응답도 받지 못한 상황이 아니다. 요청은 서버까지 갔고 서버는 HTTP response 안에 '요청한 resource가 없다'는 의미를 담아 반환했다. 앱에서 이 응답을 실패로 볼지는 별도의 validation 단계에서 정해야 한다.

반대로 DNS 실패, offline, TLS handshake 실패, connection reset, timeout, cancellation 같은 상황은 HTTP response 자체를 받지 못한 실패에 가깝다. 이때는 `URLError` 계열로 throw될 수 있다.

### 실험: 404는 throw되는가

```swift
let session = makeSession()
let request = URLRequest(url: URL(string: "https://example.com/missing")!)

CountingURLProtocol.responseProvider = { request in
	let response = HTTPURLResponse(
		url: request.url!,
		statusCode: 404,
		httpVersion: nil,
		headerFields: ["Content-Type": "application/json"]
	)!
	return (response, Data(#"{"message":"not found"}"#.utf8))
}

let (data, response) = try await session.data(for: request)
let httpResponse = response as! HTTPURLResponse

print(httpResponse.statusCode)
print(String(data: data, encoding: .utf8)!)
```

<img width="400px" src="/assets/images/posts/urlsession-deep-dive/image-02.png">

이 실험에서 `try await`는 throw되지 않고 status code `404`와 body를 받을 수 있다.

따라서 앱의 네트워크 레이어에는 보통 response validation 단계가 필요하다.

```swift
func validate(_ response: URLResponse, data: Data) throws {
	guard let httpResponse = response as? HTTPURLResponse else {
		throw URLError(.badServerResponse)
	}

	if !(200..<300).contains(httpResponse.statusCode) {
		throw HTTPStatusError(statusCode: httpResponse.statusCode, data: data)
	}
}

struct HTTPStatusError: Error {
	let statusCode: Int
	let data: Data
}
```

이 코드는 그 validation 단계를 가장 단순한 형태로 분리했다. HTTP response를 받는 것과 그 response를 앱에서 성공으로 처리하는 것은 같은 일이 아니므로 별도의 정책을 구성해서 처리해야 한다.

## 4. 같은 GET 요청을 동시에 보내면 자동으로 합쳐지는가

'같은 GET 요청 5개가 동시에 들어오면 실제 네트워크 요청은 1번만 나가야 하지 않을까?'

이 문제는 이미 완료된 응답을 재사용하는 문제와 다르다. 진행 중인 중복 요청 방지는 아직 끝나지 않은 동일 요청을 공유하는 문제다.

예를 들어 화면이 나타나면서 프로필 API를 호출하고 동시에 pull-to-refresh나 다른 child component도 같은 API를 호출한다고 하자. 첫 번째 요청이 아직 끝나지 않았다면 cache에는 아직 저장된 응답이 없다. 이때 같은 요청을 또 보내면 서버에는 중복 요청이 나간다.

`URLSession`은 connection reuse나 HTTP/2 multiplexing 같은 transport 최적화를 할 수 있다. 하지만 앱이 의미하는 '이 두 요청은 같은 logical data를 원한다'는 판단을 자동으로 해 주지는 않는다. 같은 URL이라도 Authorization header, Accept-Language, user context에 따라 다른 의미의 요청일 수 있기 때문이다.

### 실험: 같은 요청 5개 동시 실행

```swift
let session = makeSession()
let request = URLRequest(url: URL(string: "https://example.com/users/me")!)

CountingURLProtocol.reset()
CountingURLProtocol.responseProvider = { request in
	Thread.sleep(forTimeInterval: 0.2)

	let response = HTTPURLResponse(
		url: request.url!,
		statusCode: 200,
		httpVersion: nil,
		headerFields: ["Content-Type": "application/json"]
	)!
	return (response, Data(#"{"id":1}"#.utf8))
}

try await withThrowingTaskGroup(of: Data.self) { group in
	for _ in 0..<5 {
		group.addTask {
			let (data, _) = try await session.data(for: request)
			return data
		}
	}

	for try await _ in group {}
}

print(CountingURLProtocol.requestCount)
```

<img width="300px" src="/assets/images/posts/urlsession-deep-dive/image-03.png">

이 실험 결과는 같은 request value를 동시에 넘겨도 `URLSession` 호출 자체가 자동으로 하나로 합쳐지지 않는다는 점을 보여준다.

해결하려면 이미 실행 중인 요청을 key로 보관하고, 같은 key의 요청이 들어오면 새 task를 만들지 않고 기존 task의 결과를 기다리게 하면 된다.

```swift
struct RequestKey: Hashable {
	let method: String
	let url: URL?
	let authorization: String?
	let acceptLanguage: String?

	init(request: URLRequest) {
		method = request.httpMethod ?? "GET"
		url = request.url
		authorization = request.value(forHTTPHeaderField: "Authorization")
		acceptLanguage = request.value(forHTTPHeaderField: "Accept-Language")
	}
}

actor PendingRequestTaskStore {
	private var tasks: [RequestKey: Task<(Data, URLResponse), Error>] = [:]

	func data(
		for request: URLRequest,
		session: URLSession
	) async throws -> (Data, URLResponse) {
		let key = RequestKey(request: request)

		if let task = tasks[key] {
			return try await task.value
		}

		let task = Task {
			try await session.data(for: request)
		}
		tasks[key] = task

		do {
			let result = try await task.value
			tasks[key] = nil
			return result
		} catch {
			tasks[key] = nil
			throw error
		}
	}
}
```

<img width="300px" src="/assets/images/posts/urlsession-deep-dive/image-04.png">

같은 5개 요청을 `store.data(for:session:)`로 보내면 실제 실행은 1번만 일어난다. 여기서 중요한 코드는 `URLSession` 호출이 아니라 `tasks[key]`를 먼저 확인하는 부분이다. 이미 진행 중인 task가 있으면 그 task의 `value`를 함께 기다리고, 없을 때만 새 task를 만든다.

다만 key에 무엇을 넣을지는 앱이 정해야 한다. Authorization이나 Accept-Language처럼 response에 영향을 주는 값이 빠지면 다른 요청을 같은 요청으로 잘못 묶을 수 있다.

## 5. retry는 단순 반복이 아니다

네트워크 요청이 실패하면 retry를 붙이고 싶어진다. 하지만 retry는 위험한 기능이다. retry는 성공률을 높일 수 있지만 서버 장애 상황에서는 부하를 증폭시킬 수 있다. 또한 서버의 데이터를 바꾸는 요청을 여러 번 재시도하면 중복 처리 문제가 생길 수 있다.

retry를 설계할 때는 최소한 다음을 구분해야 한다.

- 다시 시도해 볼 만한 일시적인 네트워크 실패인가?
- HTTP status code 중 재시도 가능한 응답인가?
- 데이터를 받아오는 요청인가, 서버의 데이터를 바꾸는 요청인가?
- request body를 다시 보낼 수 있는가?
- retry 간격에 backoff와 jitter가 있는가?
- cancellation이 들어오면 retry loop가 멈추는가?

retry를 판단할 때는 먼저 이 요청이 데이터를 읽는 요청인지, 서버의 데이터를 바꾸는 요청인지 봐야 한다. 데이터를 읽는 요청은 같은 요청을 다시 보내도 서버 데이터가 바뀌지 않기 때문에 상대적으로 재시도하기 쉽다. 반면 서버의 데이터를 바꾸는 요청은 조심해야 한다. 예를 들어 `POST /orders`가 timeout 되었더라도 서버에서는 이미 주문이 만들어졌을 수 있다. 이때 클라이언트가 같은 요청을 다시 보내면 주문이 두 번 만들어질 수 있다.

cancellation처럼 다시 시도하면 안 되는 실패는 retry 대상에서 제외해야 한다. 반면 timeout이나 일시적인 연결 끊김처럼 다시 시도해 볼 만한 실패는 retry 대상이 될 수 있다. HTTP status code 기반 retry는 `URLSession.data(for:)`가 아니라 response validation 이후에 별도로 판단해야 한다.

## 6. 인증은 header만 붙이는 문제가 아니다

인증이 필요한 요청에서는 `Authorization` header를 붙인다.

```swift
var request = URLRequest(url: URL(string: "https://example.com/me")!)
request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
```

간단한 예제에서는 이 정도로 충분하다. 하지만 앱 전체에서 인증 요청이 많아지면 header를 붙이는 코드만으로는 부족한 상황이 생길 수 있다.

- token이 만료되면 어디에서 refresh할 것인가?
- 여러 요청이 동시에 401을 받으면 refresh도 여러 번 나갈 것인가? // 401: 인증 실패
- refresh 중인 동안 기존 요청은 기다릴 것인가 실패할 것인가?
- refresh 실패 시 pending request를 어떻게 정리할 것인가?
- Authorization header를 logging에서 숨기고 있는가?

이 섹션에서 중요한 점은 인증을 `request.setValue` 한 줄로만 보면 안 된다는 것이다. token은 request 생성 시점에는 유효했지만 실제 요청이 처리되는 시점에는 만료되어 있을 수 있고, 여러 요청이 동시에 같은 인증 상태를 공유할 수도 있다.

## 7. 정리

`URLRequest`는 요청의 값이다. 같은 값을 여러 번 보내면 여러 번 실행된다. 값이 같다고 결과 공유가 자동으로 생기지는 않는다.

`URLSession`은 실행 환경이다. session configuration은 cache, cookie, credential, connectivity 같은 정책을 담는다. `URLSession.shared`는 편하지만 앱 전체 네트워크 정책을 명시하기에는 부족할 수 있다.

HTTP 실패와 transport 실패는 다르다. 404나 500은 HTTP response를 받은 것이므로 transport 관점에서는 성공일 수 있다. 앱에서 실패로 볼지는 response validation 단계에서 정해야 한다.

진행 중인 중복 요청 방지는 `URLSession`이 자동으로 처리해 주는 기능이 아니다. 같은 URL이어도 앱 관점에서 같은 데이터 요청인지 판단하는 기준은 앱이 정해야 한다.

retry는 단순 반복이 아니다. 일시적인 네트워크 실패인지, 데이터를 읽는 요청인지 서버의 데이터를 바꾸는 요청인지, retry 간격을 어떻게 둘지 함께 고려해야 한다.

auth, retry 같은 공통 처리는 request 생성 코드에 흩뿌리기보다 실행 전후 정책으로 분리하는 편이 낫다.

## 마무리

Swift에서 네트워크 요청을 보낸다는 것은 단순히 `try await URLSession.shared.data(for: request)` 한 줄을 호출하는 일이 아니다. 그 한 줄 아래에는 HTTP message 구성, session configuration, DNS, TCP, TLS, connection reuse, response validation, retry 같은 여러 층이 있다.

`URLRequest`는 요청을 설명한다. `URLSession`은 요청을 실행한다. 하지만 좋은 네트워크 레이어는 이 둘만으로 끝나지 않는다. 요청을 만들고 실행하고 응답을 검증하고 실패를 해석하고 필요할 때 재시도하는 책임이 분리되어야 한다.

결국 중요한 질문은 'URLRequest를 써야 하나 URLSession을 써야 하나'가 아니다. 더 정확한 질문은 이것이다.

'이 코드는 요청을 만드는 책임인가 요청을 실행하는 책임인가 실행 결과를 해석하는 책임인가?'

이 질문에 답할 수 있으면 Swift 네트워크 코드는 훨씬 단단해진다.

## 실험 코드

아래 코드는 이 글의 실험을 실행하기 위한 전체 코드다.

<details>
<summary>main.swift</summary>

```swift
import Foundation

let suite = URLSessionExperimentSuite()

await suite.runAll()
```

</details>

<details>
<summary>CountingURLProtocol.swift</summary>

```swift
import Foundation

final class CountingURLProtocol: URLProtocol {
	private static let lock = NSLock()
	private static var storedRequestCount = 0
	private static var storedResponseProvider: ((URLRequest) throws -> (HTTPURLResponse, Data))?

	static var requestCount: Int {
		lock.withLock {
			storedRequestCount
		}
	}

	static var responseProvider: ((URLRequest) throws -> (HTTPURLResponse, Data))? {
		get {
			lock.withLock {
				storedResponseProvider
			}
		}
		set {
			lock.withLock {
				storedResponseProvider = newValue
			}
		}
	}

	static func reset() {
		lock.withLock {
			storedRequestCount = 0
			storedResponseProvider = nil
		}
	}

	override class func canInit(with request: URLRequest) -> Bool {
		true
	}

	override class func canonicalRequest(for request: URLRequest) -> URLRequest {
		request
	}

	override func startLoading() {
		let provider = Self.lock.withLock {
			Self.storedRequestCount += 1
			return Self.storedResponseProvider
		}

		do {
			guard let provider else {
				throw URLError(.badServerResponse)
			}

			let (response, data) = try provider(request)
			client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .allowed)
			client?.urlProtocol(self, didLoad: data)
			client?.urlProtocolDidFinishLoading(self)
		} catch {
			client?.urlProtocol(self, didFailWithError: error)
		}
	}

	override func stopLoading() {}
}
```

</details>

<details>
<summary>NetworkExperimentSupport.swift</summary>

```swift
import Foundation

func makeSession() -> URLSession {
	let configuration = URLSessionConfiguration.ephemeral
	configuration.protocolClasses = [CountingURLProtocol.self]
	return URLSession(configuration: configuration)
}

func makeJSONResponse(
	url: URL,
	statusCode: Int,
	headerFields: [String: String] = [:]
) -> HTTPURLResponse {
	var headers = headerFields
	headers["Content-Type"] = "application/json"

	return HTTPURLResponse(
		url: url,
		statusCode: statusCode,
		httpVersion: "HTTP/1.1",
		headerFields: headers
	)!
}

func validate(_ response: URLResponse, data: Data) throws {
	guard let httpResponse = response as? HTTPURLResponse else {
		throw URLError(.badServerResponse)
	}

	if !(200..<300).contains(httpResponse.statusCode) {
		throw HTTPStatusError(statusCode: httpResponse.statusCode, data: data)
	}
}

func sendWithRetry(
	request: URLRequest,
	session: URLSession,
	maxAttempts: Int
) async throws -> (Data, URLResponse) {
	var attempt = 0
	var lastError: Error?

	while attempt < maxAttempts {
		if Task.isCancelled {
			throw CancellationError()
		}

		attempt += 1

		do {
			return try await session.data(for: request)
		} catch {
			lastError = error

			if attempt < maxAttempts {
				try await Task.sleep(for: .milliseconds(200 * attempt))
			}
		}
	}

	throw lastError ?? URLError(.unknown)
}
```

</details>

<details>
<summary>HTTPStatusError.swift</summary>

```swift
import Foundation

struct HTTPStatusError: Error {
	let statusCode: Int
	let data: Data
}
```

</details>

<details>
<summary>PendingRequestTaskStore.swift</summary>

```swift
import Foundation

struct RequestKey: Hashable {
	let method: String
	let url: URL?
	let authorization: String?
	let acceptLanguage: String?

	init(request: URLRequest) {
		method = request.httpMethod ?? "GET"
		url = request.url
		authorization = request.value(forHTTPHeaderField: "Authorization")
		acceptLanguage = request.value(forHTTPHeaderField: "Accept-Language")
	}
}

actor PendingRequestTaskStore {
	private var tasks: [RequestKey: Task<(Data, URLResponse), Error>] = [:]

	func data(
		for request: URLRequest,
		session: URLSession
	) async throws -> (Data, URLResponse) {
		let key = RequestKey(request: request)

		if let task = tasks[key] {
			return try await task.value
		}

		let task = Task {
			try await session.data(for: request)
		}
		tasks[key] = task

		do {
			let result = try await task.value
			tasks[key] = nil
			return result
		} catch {
			tasks[key] = nil
			throw error
		}
	}
}
```

</details>

<details>
<summary>URLSessionExperimentSuite.swift</summary>

```swift
import Foundation

struct URLSessionExperimentSuite {
	func runAll() async {
		await run("같은 URLRequest를 여러 번 보내기") {
			try await runRepeatedRequestExperiment()
		}

		await run("404 응답은 URLSession.data(for:)에서 throw되지 않음") {
			try await runHTTPStatusExperiment()
		}

		await run("HTTP status validation은 별도 policy") {
			try await runValidationExperiment()
		}

		await run("같은 GET 요청 5개 동시 실행") {
			try await runConcurrentRequestExperiment()
		}

		await run("진행 중인 같은 GET 요청 공유") {
			try await runCoalescedRequestExperiment()
		}

		await run("transport error retry") {
			try await runRetryExperiment()
		}
	}

	private func run(
		_ title: String,
		operation: () async throws -> Void
	) async {
		print("\n== \(title) ==")

		do {
			try await operation()
		} catch {
			print("failed:", error)
		}
	}

	private func runRepeatedRequestExperiment() async throws {
		let session = makeSession()
		let url = URL(string: "https://example.com/users")!
		let request = URLRequest(url: url)

		CountingURLProtocol.reset()
		CountingURLProtocol.responseProvider = { request in
			let response = makeJSONResponse(url: request.url!, statusCode: 200)
			return (response, Data(#"{"ok":true}"#.utf8))
		}

		_ = try await session.data(for: request)
		_ = try await session.data(for: request)
		_ = try await session.data(for: request)

		print("expected request count: 3")
		print("actual request count:", CountingURLProtocol.requestCount)
	}

	private func runHTTPStatusExperiment() async throws {
		let session = makeSession()
		let request = URLRequest(url: URL(string: "https://example.com/missing")!)

		CountingURLProtocol.reset()
		CountingURLProtocol.responseProvider = { request in
			let response = makeJSONResponse(url: request.url!, statusCode: 404)
			return (response, Data(#"{"message":"not found"}"#.utf8))
		}

		let (data, response) = try await session.data(for: request)
		let httpResponse = response as! HTTPURLResponse

		print("status code:", httpResponse.statusCode)
		print("body:", String(data: data, encoding: .utf8)!)
	}

	private func runValidationExperiment() async throws {
		let session = makeSession()
		let request = URLRequest(url: URL(string: "https://example.com/missing")!)

		CountingURLProtocol.reset()
		CountingURLProtocol.responseProvider = { request in
			let response = makeJSONResponse(url: request.url!, statusCode: 404)
			return (response, Data(#"{"message":"not found"}"#.utf8))
		}

		let (data, response) = try await session.data(for: request)

		do {
			try validate(response, data: data)
			print("validation result: success")
		} catch let error as HTTPStatusError {
			print("validation result: failed")
			print("status code:", error.statusCode)
			print("body:", String(data: error.data, encoding: .utf8)!)
		}
	}

	private func runConcurrentRequestExperiment() async throws {
		let session = makeSession()
		let request = URLRequest(url: URL(string: "https://example.com/users/me")!)

		CountingURLProtocol.reset()
		CountingURLProtocol.responseProvider = { request in
			Thread.sleep(forTimeInterval: 0.2)

			let response = makeJSONResponse(url: request.url!, statusCode: 200)
			return (response, Data(#"{"id":1}"#.utf8))
		}

		try await withThrowingTaskGroup(of: Data.self) { group in
			for _ in 0..<5 {
				group.addTask {
					let (data, _) = try await session.data(for: request)
					return data
				}
			}

			for try await _ in group {}
		}

		print("expected request count: 5")
		print("actual request count:", CountingURLProtocol.requestCount)
	}

	private func runCoalescedRequestExperiment() async throws {
		let session = makeSession()
		let store = PendingRequestTaskStore()
		let request = URLRequest(url: URL(string: "https://example.com/users/me")!)

		CountingURLProtocol.reset()
		CountingURLProtocol.responseProvider = { request in
			Thread.sleep(forTimeInterval: 0.2)

			let response = makeJSONResponse(url: request.url!, statusCode: 200)
			return (response, Data(#"{"id":1}"#.utf8))
		}

		try await withThrowingTaskGroup(of: Data.self) { group in
			for _ in 0..<5 {
				group.addTask {
					let (data, _) = try await store.data(
						for: request,
						session: session
					)
					return data
				}
			}

			for try await _ in group {}
		}

		print("expected request count: 1")
		print("actual request count:", CountingURLProtocol.requestCount)
	}

	private func runRetryExperiment() async throws {
		let session = makeSession()
		let request = URLRequest(url: URL(string: "https://example.com/retry")!)

		CountingURLProtocol.reset()
		CountingURLProtocol.responseProvider = { request in
			if CountingURLProtocol.requestCount < 3 {
				throw URLError(.timedOut)
			}

			let response = makeJSONResponse(url: request.url!, statusCode: 200)
			return (response, Data(#"{"retried":true}"#.utf8))
		}

		let (data, response) = try await sendWithRetry(
			request: request,
			session: session,
			maxAttempts: 3
		)
		let httpResponse = response as! HTTPURLResponse

		print("final status code:", httpResponse.statusCode)
		print("body:", String(data: data, encoding: .utf8)!)
		print("attempt count:", CountingURLProtocol.requestCount)
	}
}
```

</details>

## 참고 링크

- [URLSession \| Apple Developer Documentation](https://developer.apple.com/documentation/foundation/urlsession)
- [URLRequest \| Apple Developer Documentation](https://developer.apple.com/documentation/foundation/urlrequest)
- [URLSessionConfiguration \| Apple Developer Documentation](https://developer.apple.com/documentation/foundation/urlsessionconfiguration)
- [RFC 9110: HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110)

