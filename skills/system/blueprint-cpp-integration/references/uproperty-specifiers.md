# UPROPERTY specifiers — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the edit/visibility axis, Blueprint access axis,
replication, delegates, and property meta tags with exact locations in the UE 5.7 source.
Grounded in `Engine/Source/Runtime/CoreUObject/Public/UObject/ObjectMacros.h` (namespace `UP`,
lines ~1080–1200) and the official
[UProperties](https://dev.epicgames.com/documentation/unreal-engine/unreal-engine-uproperties)
doc.

## The two axes: Edit/Visible and Blueprint access

These are **independent** dimensions — combine one from each axis as needed.

### Edit/Visible (editor panel access)

| Specifier | Edit? | Where |
|---|---|---|
| `EditAnywhere` | yes | archetypes (class defaults) and placed/spawned instances |
| `EditDefaultsOnly` | yes | class defaults (Blueprint defaults, CDO) only |
| `EditInstanceOnly` | yes | placed/spawned instances only, not class defaults |
| `VisibleAnywhere` | no (read-only display) | class defaults and instances |
| `VisibleDefaultsOnly` | no | class defaults only |
| `VisibleInstanceOnly` | no | instances only |

A property can have **either** an Edit or Visible specifier, not both. Omitting both hides the
property from the editor entirely (still accessible from Blueprint if BlueprintReadWrite is set).

### Blueprint access

| Specifier | Effect |
|---|---|
| `BlueprintReadWrite` | Generates both a Get and a Set node in BP |
| `BlueprintReadOnly` | Generates only a Get node in BP |
| `BlueprintGetter=FuncName` | Custom accessor; implies `BlueprintReadOnly` unless `BlueprintSetter` or `BlueprintReadWrite` is also present |
| `BlueprintSetter=FuncName` | Custom mutator; implies `BlueprintReadWrite` |

`BlueprintGetter`/`BlueprintSetter` let you intercept get/set in C++ (e.g. for change
notifications or validation) without exposing the raw field. The named functions must be
`UFUNCTION(BlueprintPure)` (getter) / `UFUNCTION(BlueprintCallable)` (setter).

## Delegate specifiers

| Specifier | Use on |
|---|---|
| `BlueprintAssignable` | `DYNAMIC_MULTICAST` delegates — lets BP bind event handlers |
| `BlueprintCallable` | `DYNAMIC_MULTICAST` delegates — lets BP broadcast the delegate |
| `BlueprintAuthorityOnly` | `DYNAMIC_MULTICAST` delegates — only BP events tagged `BlueprintAuthorityOnly` can bind |

`BlueprintAssignable` is the most common — it exposes `OnSomething.AddDynamic(...)` as an
Assign node in the Event Graph.

## Key meta tags (`meta=(...)`)

Metadata is editor-only — never write game logic that depends on it.

### Range and validation
- `ClampMin="N"` / `ClampMax="N"` — hard clamps on typed input (enforced in the UI and BP get
  node value).
- `UIMin="N"` / `UIMax="N"` — slider range (user can still type outside this range).
- `EditCondition="bFlagName"` — grey out the property unless a named bool property is true.
  Supports `!` for negation and simple C++ expressions.
- `InlineEditConditionToggle` — display the EditCondition bool inline as a checkbox, not as a
  separate row.

### Spawn exposure
- `ExposeOnSpawn="true"` — adds a pin to `SpawnActor` / `BeginDeferredActorSpawn` nodes for this
  property. Also works with deferred spawn via `SpawnActorDeferred`; set the value before calling
  `FinishSpawning`.

### Access control
- `AllowPrivateAccess="true"` — required when a `private:` member is tagged `BlueprintReadOnly`
  or `BlueprintReadWrite`; without it UHT refuses to compile.

### Display
- `DisplayName="Name"` — overrides the label shown in the Details panel and BP nodes.
- `Category="A|B"` — `|` separates nested categories in the Details panel.
- `AdvancedDisplay` — places the property in the "Advanced" collapsed section.
- `SimpleDisplay` — forces the property to the top-level visible section.
- `DisplayAfter="OtherProp"` — orders this property immediately after the named one in the panel,
  regardless of header declaration order.
- `DisplayPriority="N"` — tiebreaker within a `DisplayAfter` group (lower N = higher priority).
- `DisplayThumbnail="true"` — shows the asset thumbnail for object/asset properties.
- `HideAlphaChannel` — hides the alpha channel in color-picker widgets.
- `HideViewOptions` — removes the view options dropdown in class/asset pickers.

### Asset and class pickers
- `AllowedClasses="Class1,Class2"` — restricts FSoftObjectPath pickers to specific asset classes.
- `AllowAbstract="true/false"` — controls whether abstract classes appear in TSubclassOf pickers.
- `BlueprintBaseOnly` — only Blueprint classes appear in TSubclassOf/SoftClass pickers.
- `ExactClass="true"` — only the exact class, no subclasses, appears in the picker.

### Misc
- `MakeEditWidget` — adds a movable 3D widget in the viewport for Transform/Rotator properties.
- `AssetBundles="BundleName"` — used with soft references in Primary Data Assets (Asset Manager).
- `GetByRef` — the BP Get node returns a `const` reference instead of a copy (Sparse Class Data
  only).

## Source locations (UE 5.7)

All specifiers below are in `Runtime/CoreUObject/Public/UObject/ObjectMacros.h`:

- `UP` namespace (UPROPERTY enum), lines ~1080–1165:
  `BlueprintAssignable`:1104, `EditAnywhere`:1116, `EditInstanceOnly`:1119,
  `EditDefaultsOnly`:1122, `VisibleAnywhere`:1125, `VisibleInstanceOnly`:1128,
  `VisibleDefaultsOnly`:1131, `BlueprintReadOnly`:1134, `BlueprintGetter`:1137,
  `BlueprintReadWrite`:1140, `BlueprintSetter`:1143, `BlueprintCallable` (delegate):1155.

- Property meta tags (`EM::PropertyMetaData` enum, lines ~1290–1420):
  `AllowPrivateAccess`:1309, `ExposeOnSpawn`:1382, `ClampMin`/`ClampMax`,
  `UIMin`/`UIMax`, `EditCondition`, `DisplayName`, `DisplayAfter`, `DisplayPriority`,
  `AllowedClasses`, `AllowAbstract`, `BlueprintBaseOnly`, `MakeEditWidget`.

- CPF flags (property flags used at runtime), lines ~400–480:
  `CPF_BlueprintReadOnly`:423, `CPF_BlueprintCallable`:463, `CPF_ExposeOnSpawn`:467.
