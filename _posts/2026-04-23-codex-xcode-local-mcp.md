---
title: "Codex에 Xcode Local MCP를 연결해보자"
date: "2026-04-23T13:24:52.683Z"
excerpt: "에이전트를 쓰는 시대가 거의 당연시되는 시대에서 iOS 개발이라고 뒤쳐질 수 없으니 적극적으로 사용해보자"
categories: tools
tags: ["Xcode","codex"]
source_url: "https://velog.io/@opficdev/Codex에-Xcode-Local-MCP를-연결해보자"
---

## Xcode Local MCP의 출시

<img src="/assets/images/posts/codex-xcode-local-mcp/image-01.png">

Xcode 26.3이 출시되면서 기존의 Third Party MCP 였던 [Xcodebuildmcp](https://www.xcodebuildmcp.com) 가 하던 역할을 어느정도 대체하였다.

Xcodebuildmcp는 MCP라 CLI 기반이라 빌드 디바이스와 스킴을 따로 명령하거나 설정이 필요하다. 하지만 Xcode Local MCP는 Xcode에서 선택되어 있는 값으로 자동 선택되고 빌드시켜준다.
물론 그 외에도 각 서비스의 기능에 대해 차이가 있지만 그 이상 필자가 써본것은 없다. 기회가 된다면 추가 서치를 통해 적용을 해볼 생각이다.

<img src="/assets/images/posts/codex-xcode-local-mcp/image-02.png">

## 어떻게 연결하지?
필자가 Codex를 사용하고 있어 Codex를 예시로 설명이 진행될 예정

### Xcode 설정
우선 당연하게도 Xcode 버전은 26.3 이상이어야 한다

Settings (⌘ + ,) -> Components 탭에 Codex를 설치해준다. 필자는 이미 사용중이어서 설치가 되어 있는 상태다.

<img src="/assets/images/posts/codex-xcode-local-mcp/image-03.png">

다음은 Intelligence 탭에서 `Model Context Protocol`에 있는 토글을 허용해준다.
<img src="/assets/images/posts/codex-xcode-local-mcp/image-04.png">

그리고 Codex로 들어간 후 ChatGPT Account에 에 로그인을 해주면 Xcode 측에서는 설정이 끝난다.
<img src="/assets/images/posts/codex-xcode-local-mcp/image-05.png">

### Codex 설정
Codex는 앱과 Cli 방식으로 사용이 가능하다. 단 설정은 한쪽만 해주면 된다.

#### 1. Codex App
/Users/${계정명}/.codex/config.toml 파일을 찾아준다. 
```text
[mcp_servers.xcode]
command = "xcrun"
args = ["mcpbridge"]
```
해당 내용을 추가해주면 된다.

#### 2. Codex CLI
```text
codex mcp add xcode -- xcrun mcpbridge
```
해당 명령어를 터미널에 입력하면 된다.

### 완료 확인
연결이 성공적으로 된다면 Xcode에서는 해당 팝업을 띄운다.

<img src="/assets/images/posts/codex-xcode-local-mcp/image-06.png" width="30%">

**Allow**를 탭한 뒤 마음껏 개발을 시작하면 된다.

<img src="/assets/images/posts/codex-xcode-local-mcp/image-07.png" width="30%">

계속 사용하다보면 에이전트 세션이 Xcode에 이렇게 많이 연결이 되는데, 사용하는데 큰 문제는 없다. 거슬린다면 Xcode와 Codex를 둘다 종료하고 다시 연결하면 된다.

## 후기
필자는 Xcode 26.3 RC 버전부터 Xcode Local MCP를 연결해서 써보고 있다. 에이전트를 쓰지 않았을때보다 코드 작성은 확실히 훨씬 덜하고 있는건 팩트이다. 하지만 이렇게 에이전트만 연결한다고 Codex가 원하는 수준만큼 짜주는 것은 보장하지 않는다. 개발에서의 코드 작성은 사실상 일부분이기 때문에 내가 원하는 방향대로 따라가게 만들어주는 작업이 추가적으로 필요한데, 필자는 프롬프트 엔지니어링으로 처리하고 있다. 이 글을 작성하는 시점에서는 하네스라는 방법도 있는데, 아직 적극적으로 찾아보고 적용해보지는 않았다. 나중에 적용해보고 추가로 글을 올려볼 생각이다.
