---
title: "UICollectionView로 이해하는 FlashList와 React.memo"
date: "2026-11-01T00:00:00.000Z"
excerpt: "FlashList에서 썸네일 하나가 로드될 때 보이는 카드가 전부 다시 렌더되던 문제를 UICollectionView의 셀 재사용과 갱신 개념에 대응시켜 원인을 찾고 useCallback과 React.memo로 고친 과정 정리"
tags: ["iOS","React Native","FlashList"]
redirect_from: ["/ios/react-native/flashlist-memo-uicollectionview/"]
---

## 같은 화면을 UIKit과 React Native로 두 번 만들었습니다

지금 만들고 있는 앱의 홈 화면은 카드를 2열 그리드로 보여 줍니다. 처음에는 UIKit의 `UICollectionView`로 만들었고 지금은 React Native로 옮기면서 FlashList로 다시 만들고 있습니다.

React Native 쪽에서 썸네일을 불러오는 동안 카드가 필요 이상으로 다시 그려지는 문제를 고치다가 FlashList의 셀 재활용과 `React.memo` 동작을 소스까지 읽게 됐습니다. 처음 보는 개념 같았지만 하나씩 따져 보니 대부분 `UICollectionView`에서 이미 쓰던 개념이었습니다.

## 썸네일 하나가 로드되면 어디까지 다시 그려지나

| 상황 | UIKit | 수정 전 React Native | 수정 후 React Native |
| --- | --- | --- | --- |
| 썸네일 하나 로드 | 해당 셀만 `setThumbnail` | `renderItem` 12회, 카드 10장 | `renderItem` 12회, 카드 1장 |
| 메뉴 열기 | 셀 갱신 없음 | `renderItem` 12회, 카드 10장 | 렌더 없음 |
| 현재 시각 변경 | `reloadData()` | `renderItem` 12회, 카드 10장 | `renderItem` 12회, 카드 10장 |

수치는 화면을 jest와 `react-test-renderer`로 렌더해 센 값입니다. 목록은 셀 12개이고 `renderItem` 호출 12회가 목록 전체이며 그중 카드는 10장(이미지 5장, 텍스트 5장)입니다. FlashList는 `jestSetup`의 400×900 레이아웃으로 돌렸고 카드 컴포넌트는 렌더 횟수를 세는 빈 컴포넌트로 바꿨습니다. 각 행은 상태를 바꾸는 Action 하나를 보낸 뒤 늘어난 횟수이며 실제 기기에서 잰 값은 아닙니다. 수정 전은 수정 직전 커밋이고 수정 후는 수정이 들어간 뒤의 커밋입니다.

## 재사용 단위는 셀 객체가 아니라 key입니다

FlashList의 재활용 풀은 `@shopify/flash-list` 2.3.3의 `RenderStackManager`에 있습니다. 타입 문자열마다 key 집합을 하나씩 둡니다.

```ts
private recycleKeyPools: Map<string, Set<string>>;
```

화면 밖으로 나간 셀의 key가 타입별 풀에 들어가고 같은 타입의 새 셀이 필요해지면 그 key를 다시 씁니다. key가 같으면 React는 컴포넌트를 언마운트하지 않고 새 props로 다시 렌더합니다. UIKit이 셀 객체를 재사용해서 얻는 효과를 FlashList는 key를 재사용해서 얻습니다.

## renderItem은 cellForItemAt과 호출 시점이 다릅니다

UIKit에서 dequeue한 셀에 데이터를 넣는 곳은 `cellForItemAt`이고 FlashList에서는 `renderItem`입니다.

`cellForItemAt`은 셀이 화면에 새로 필요할 때와 `reloadData()`나 `reloadItems(at:)`로 갱신을 요청했을 때만 호출됩니다. 화면 상태가 바뀌었다고 해서 저절로 호출되지 않습니다.

`renderItem`은 각 셀을 감싼 `ViewHolder` 컴포넌트가 다시 렌더될 때 호출됩니다. `ViewHolder`는 직접 작성한 비교 함수와 함께 `React.memo`로 감싸져 있습니다. 실제 비교 함수는 `index`와 `layout`을 포함해 14개 prop을 비교하는데 아래에는 이 글과 관련된 세 줄만 남겼습니다.

```ts
export const ViewHolder = React.memo(ViewHolderInternal, (prevProps, nextProps) => {
	return (
		prevProps.extraData === nextProps.extraData &&
		prevProps.item === nextProps.item &&
		prevProps.renderItem === nextProps.renderItem
	);
});
```

`React.memo`는 부모가 다시 렌더될 때 이전 props와 새 props를 비교해서 같으면 그 컴포넌트의 렌더를 건너뜁니다. 비교 함수를 넘기지 않으면 prop마다 `Object.is`로 비교하고 여기서처럼 직접 넘기면 그 함수의 결과를 따릅니다.

`ViewHolder` 안에서 `renderItem`을 호출하는 부분은 `useMemo`로 한 번 더 막혀 있습니다.

```ts
const children = useMemo(() => {
	return renderItem?.({ item, index, extraData, target }) ?? null;
}, [item, extraData, target, renderItem]);
```

따라서 이미 화면에 있는 셀의 `renderItem`이 다시 호출되는 경우는 세 가지입니다.

1. 그 셀의 `item` 참조가 바뀌었을 때
2. `renderItem` 함수 참조가 바뀌었을 때
3. `extraData` 참조가 바뀌었을 때

1번은 UIKit에서 해당 셀만 갱신하는 것에 가깝습니다. 2번과 3번은 보이는 셀 전부에 영향을 줍니다. 비교는 모두 `===`이므로 값이 같아도 새로 만든 객체나 함수는 바뀐 것으로 판단합니다.

## extraData={state}는 조건 없는 reloadData()였습니다

이 절부터 나오는 앱 코드는 실제 코드에서 역할만 남기고 이름을 바꿔 다시 작성한 것입니다. UIKit 쪽 홈 화면은 상태가 바뀔 때마다 `render(state:)`가 호출됩니다. 그렇다고 매번 `reloadData()`를 부르지는 않고 목록 구성이나 현재 시각이 바뀌었을 때만 부릅니다.

```swift
if state.items != renderedItems || state.now != renderedNow {
	renderedItems = state.items
	renderedNow = state.now
	collectionView.reloadData()
}
```

React Native로 처음 옮긴 코드에는 이 조건이 없었습니다. `renderItem`은 컴포넌트 본문에 선언한 일반 함수였고 FlashList에는 상태 전체를 `extraData`로 넘겼습니다.

```tsx
<FlashList
	data={items}
	renderItem={renderItem}
	extraData={state}
/>
```

일반 함수는 렌더될 때마다 새로 만들어집니다. 앞 절의 2번과 3번 조건이 상태가 바뀔 때마다 함께 성립했고 썸네일 요청이 시작되거나 메뉴가 열려도 보이는 셀이 전부 다시 렌더됐습니다. 상태가 바뀔 때마다 `reloadData()`를 부른 셈입니다.

## useCallback 의존성 배열이 reloadData() 조건을 대신합니다

`renderItem`을 `useCallback`으로 감싸고 카드가 실제로 읽는 값만 의존성에 넣었습니다. `useCallback`은 의존성 배열의 값이 이전 렌더와 같으면 이전에 만든 함수를 그대로 돌려줍니다. 아래 코드는 카드 분기만 남긴 것입니다.

```tsx
const { now, thumbnails, failedThumbnails } = state;
const renderItem = useCallback(
	({ item }: { item: ListItem }) => (
		<GridCard
			card={item.card}
			now={now}
			thumbnailUri={thumbnails[item.card.id] ?? null}
			isThumbnailFailed={!!failedThumbnails[item.card.id]}
			handlers={cardHandlers}
		/>
	),
	[cardHandlers, now, thumbnails, failedThumbnails],
);
```

`extraData`는 제거했습니다. 의존성 배열의 값이 하나라도 바뀔 때만 `renderItem`이 새 함수가 되므로 UIKit의 `if` 조건과 같은 판단을 합니다.

이렇게 할 수 있는 건 상태를 불변 방식으로 갱신하기 때문입니다. Action이 건드리지 않은 필드는 이전 객체 참조를 그대로 유지합니다. Redux Toolkit처럼 내부에서 Immer를 쓰는 도구도 같은 방식으로 동작합니다. 메뉴 상태만 바뀐 Action에서는 `state.thumbnails` 참조가 바뀌지 않으므로 `renderItem`도 같은 함수로 남습니다.

대신 `extraData`라는 안전망이 사라졌습니다. 카드가 읽는 값을 의존성 배열에서 빠뜨리면 셀이 오래된 값을 보여 줍니다. UIKit에서 `reloadData()` 조건을 잘못 써서 화면이 갱신되지 않는 것과 같은 종류의 버그입니다. React에서는 ESLint의 `react-hooks/exhaustive-deps` 규칙이 `useCallback` 의존성 누락을 경고합니다.

## memo가 보이는 셀 중 바뀐 카드만 다시 렌더합니다

썸네일이 하나 로드되면 `state.thumbnails`가 새 객체가 되고 그 값에 의존하는 `renderItem`도 새 함수가 됩니다. 앞에서 본 조건 2번에 해당하므로 보이는 셀은 전부 `renderItem`을 다시 호출합니다. 이 호출은 막을 수 없습니다. 막을 수 있는 것은 그 안에서 만드는 카드의 렌더입니다.

UIKit에서는 이 문제가 없었습니다. `reloadData()`를 부르지 않고 보이는 셀을 돌면서 썸네일 키가 맞는 셀에만 이미지를 넣었기 때문입니다.

```swift
for cell in collectionView.visibleCells {
	guard let cell = cell as? ImageCell,
		  let key = cell.thumbnailKey,
		  let thumbnail = state.thumbnails[key] else { continue }
	cell.setThumbnail(thumbnail)
}
```

React에는 같은 방법이 없습니다. 셀은 객체가 아니라 props로 결정되는 렌더 결과라서 바깥에서 특정 셀을 찾아 값을 넣을 수 없습니다. 그 자리를 `React.memo`가 맡습니다. 카드를 `GridCard` 컴포넌트로 분리하고 `memo`로 감쌌습니다. 본문은 텍스트 카드와 이미지 카드를 나눠 그리는 내용이라 `CardView` 한 줄로 줄였습니다.

```tsx
type GridCardProps = {
	card: Card;
	now: number;
	thumbnailUri: string | null;
	isThumbnailFailed: boolean;
	handlers: CardHandlers;
};

const GridCard = memo(function GridCard(props: GridCardProps) {
	return <CardView {...props} />;
});
```

모든 셀이 `renderItem`을 다시 호출해도 각 셀이 만드는 `<GridCard>`의 props를 비교하면 썸네일이 로드된 카드 하나만 다릅니다. 나머지 카드는 본문을 실행하지 않습니다.

- `card`: 불변 갱신은 바뀌지 않은 카드 객체의 참조를 유지하므로 같습니다.
- `now`: 숫자이므로 같습니다.
- `thumbnailUri`, `isThumbnailFailed`: 문자열과 불리언이므로 썸네일이 로드된 카드 외에는 같습니다.
- `handlers`: 다음 절의 방법으로 참조를 고정했으므로 같습니다.

썸네일 정보를 객체로 묶지 않고 원시값 props로 넘긴 것이 중요합니다. 렌더마다 `{ thumbnailUri, isThumbnailFailed }` 같은 객체를 새로 만들어 넘기면 값이 같아도 `memo`의 비교를 통과하지 못합니다.

## 핸들러는 ref로 고정해 memo 비교를 통과시킵니다

카드 핸들러인 `select`, `showMenu`, `copy`는 현재 상태를 읽습니다. React 함수 컴포넌트에서 만든 함수는 그 렌더 시점의 상태 값을 캡처하므로 `useCallback`으로 감싸도 상태가 바뀔 때마다 새 함수가 됩니다. 이 함수를 `GridCard`에 그대로 넘기면 `handlers` prop이 매번 달라져 `memo`가 동작하지 않습니다.

UIKit에서는 이 문제가 없었습니다. 셀의 복사 버튼에 `cellForItemAt`에서 클로저를 넘기는데 이 클로저가 뷰 컨트롤러를 참조로 잡고 있어서 버튼을 누르는 시점의 상태로 `copy(_:)`를 실행했습니다.

```swift
cell.onCopy = { [weak self] in self?.copy(card) }
```

React에서도 같은 구조가 필요했습니다. ref에 최신 함수를 담아 두고 카드에는 ref를 거쳐 호출하는 고정된 함수를 넘겼습니다.

```tsx
const handlers = useRef({ select, showMenu, copy });
useLayoutEffect(() => {
	handlers.current = { select, showMenu, copy };
});
const [cardHandlers] = useState<CardHandlers>(() => ({
	onSelect: (card) => handlers.current.select(card),
	onShowMenu: (card) => handlers.current.showMenu(card),
	onCopy: (card) => handlers.current.copy(card),
}));
```

`useRef`가 돌려주는 객체는 렌더가 바뀌어도 같은 객체이고 `current`를 바꿔도 렌더가 일어나지 않습니다. UIKit의 저장 프로퍼티와 비슷합니다. `cardHandlers`는 `useState` 초기화 함수로 한 번만 만들어지므로 참조가 바뀌지 않습니다. 호출될 때마다 `handlers.current`에서 마지막으로 커밋된 렌더의 함수를 꺼내 실행하므로 `[weak self]` 클로저가 뷰 컨트롤러를 거쳐 최신 상태에 접근하던 것과 같은 효과가 납니다.

## 선택하지 않은 다른 방법

- React 19.2에 추가된 `useEffectEvent`도 최신 값을 읽는 함수를 만듭니다. 다만 Effect 안에서만 호출하고 다른 컴포넌트에 넘기지 않도록 설계되어 있어서 자식 컴포넌트에 props로 넘기는 이 경우에는 맞지 않습니다.
- UIKit에도 iOS 15부터 같은 셀 객체를 유지한 채 다시 구성하는 `reconfigureItems(at:)`가 있습니다. 위 UIKit 코드는 보이는 셀을 직접 돌며 갱신했지만 `reconfigureItems(at:)`를 쓰면 바뀐 셀만 다시 구성하도록 요청할 수 있습니다.

## 비슷한 상황이라면

FlashList에서 카드가 필요 이상으로 다시 렌더된다면 아래 항목을 확인합니다.

1. `renderItem`이 컴포넌트 본문에 선언한 일반 함수인지 봅니다. 렌더마다 새 함수가 되므로 보이는 셀이 전부 다시 렌더됩니다. `useCallback`으로 감싸고 카드가 읽는 값만 의존성에 넣습니다.
2. `extraData`에 상태 전체를 넘기고 있는지 봅니다. 참조가 바뀔 때마다 보이는 셀이 전부 다시 렌더되므로 의존성 배열로 대신할 수 있다면 제거합니다.
3. 카드를 `memo` 컴포넌트로 분리하고 props를 원시값으로 넘깁니다. 렌더마다 새로 만든 객체는 값이 같아도 비교를 통과하지 못합니다.
4. 상태를 읽는 핸들러는 참조를 고정합니다. 그대로 넘기면 `memo`가 동작하지 않으므로 ref에 최신 함수를 담고 고정된 함수를 넘깁니다.

이 방법들은 상태를 불변 방식으로 갱신해 바뀌지 않은 필드의 참조를 유지한다는 전제가 있어야 동작합니다.

## 부록: UIKit과 FlashList 개념 대응

| UICollectionView | FlashList와 React | 비고 |
| --- | --- | --- |
| `register(_:forCellWithReuseIdentifier:)` | `getItemType` | 재사용 풀을 나누는 기준 |
| `dequeueReusableCell(withReuseIdentifier:for:)` | 재활용 풀에서 key 꺼내기 | FlashList 내부에서 자동으로 처리 |
| `collectionView(_:cellForItemAt:)` | `renderItem` | 호출 시점이 다름 |
| `prepareForReuse()` | 없음. 필요하면 `useRecyclingState` | props는 매번 새로 넘어가므로 초기화할 필요가 적음 |
| `reloadData()` | `extraData` 변경, `renderItem` 참조 변경 | 보이는 셀 전부 다시 렌더 |
| `visibleCells`를 돌며 셀 직접 갱신 | `React.memo`로 바뀐 카드만 렌더 | React에서는 셀을 직접 건드리지 못함 |
| `[weak self]` 클로저 | ref에 최신 함수를 담는 패턴 | 참조는 고정하고 호출 시점의 최신 함수를 실행 |
| `willDisplay`, `didEndDisplaying` | `onViewableItemsChanged` | 셀 단위 콜백과 보이는 목록 전체 콜백 |
| `UICollectionViewLayout` 서브클래스 | `masonry`, `overrideItemLayout` | 높이를 먼저 계산하는지 렌더 후 측정하는지가 다름 |

### reuse identifier 대신 `getItemType`으로 풀을 나눕니다

UIKit에서는 셀 클래스를 reuse identifier로 등록합니다. 그리드에는 텍스트 카드 셀과 이미지 카드 셀이 있습니다.

```swift
collectionView.register(TextCell.self, forCellWithReuseIdentifier: TextCell.reuseIdentifier)
collectionView.register(ImageCell.self, forCellWithReuseIdentifier: ImageCell.reuseIdentifier)
```

`cellForItemAt`에서는 같은 identifier로 셀을 꺼냅니다. 화면 밖으로 나간 셀은 identifier별 재사용 큐에 들어갔다가 다음 dequeue에서 다시 쓰입니다.

```swift
let cell = collectionView.dequeueReusableCell(
	withReuseIdentifier: ImageCell.reuseIdentifier,
	for: indexPath
) as! ImageCell
```

FlashList에는 등록과 dequeue 호출이 없습니다. 데이터마다 타입 문자열을 돌려주는 `getItemType`을 넘기면 FlashList가 타입별 재활용 풀을 관리합니다.

```tsx
getItemType={(item) => (item.image === null ? 'text' : 'image')}
```

`'text'`와 `'image'`는 UIKit의 텍스트 셀과 이미지 셀 identifier에 해당합니다.

### prepareForReuse가 하던 일은 props가 대신합니다

UIKit 셀은 재사용되기 전에 `prepareForReuse()`에서 이전 데이터의 흔적을 지웁니다. 이미지 셀은 이전 썸네일 키와 복사 버튼 클로저와 썸네일 이미지를 초기화합니다.

```swift
override func prepareForReuse() {
	super.prepareForReuse()
	thumbnailKey = nil
	onCopy = nil
	setThumbnail(nil)
}
```

FlashList에는 이 메서드에 해당하는 것이 없습니다. 셀에 들어가는 값을 `renderItem`이 매번 props로 새로 넘기기 때문입니다. 썸네일 URI와 핸들러와 표시 값이 모두 props라면 재활용된 셀도 새 데이터의 props로 다시 렌더되므로 따로 지울 것이 없습니다.

남는 것은 컴포넌트 안의 로컬 상태입니다. key가 유지되므로 셀 안에서 `useState`로 들고 있던 값은 이전 데이터의 값 그대로 다음 데이터로 넘어갑니다. UIKit 셀의 저장 프로퍼티를 `prepareForReuse()`에서 지우지 않은 것과 같은 상황입니다. FlashList v2는 이 경우를 위해 데이터가 바뀔 때 값을 초기화하는 `useRecyclingState`를 제공합니다. 이 글의 카드 컴포넌트는 로컬 상태가 없어서 쓰지 않았습니다.

### willDisplay와 didEndDisplaying은 onViewableItemsChanged 하나로 받습니다

UIKit에서는 셀이 화면에 들어오고 나가는 시점을 `willDisplay`와 `didEndDisplaying`이 셀 단위로 알려 줍니다. FlashList에는 셀 단위 콜백이 없고 `onViewableItemsChanged`가 지금 보이는 데이터 목록 전체를 알려 줍니다. 들어오고 나간 데이터를 알려면 이전 목록과 직접 비교해야 합니다.

### UICollectionViewLayout은 높이를 먼저 계산하고 masonry는 렌더 후 측정합니다

UIKit에서 2열 그리드는 `UICollectionViewLayout`을 상속한 레이아웃 클래스가 직접 배치합니다. `prepare()`에서 델리게이트에게 각 셀의 높이를 묻고 더 짧은 열에 셀을 쌓습니다.

FlashList에서는 `masonry`와 `numColumns={2}`로 같은 배치를 얻습니다.

```tsx
masonry
numColumns={2}
```

차이는 높이를 아는 시점입니다. UIKit 레이아웃은 셀을 그리기 전에 델리게이트로 높이를 계산하므로 `prepare()`가 끝나면 콘텐츠 높이가 정해집니다. FlashList 쪽은 높이를 넘기지 않아서 셀을 렌더한 뒤 측정한 높이로 배치합니다. 그래서 셀이 새로 측정될 때마다 콘텐츠 높이가 바뀝니다.
