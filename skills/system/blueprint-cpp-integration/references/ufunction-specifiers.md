# UFUNCTION specifiers — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers all Blueprint-relevant `UFUNCTION` specifiers and
function `meta=(...)` tags with their exact locations in the UE 5.7 source.
Grounded in `Engine/Source/Runtime/CoreUObject/Public/UObject/ObjectMacros.h` (namespace `UF`,
lines 943–1004) and the official
[UFunctions](https://dev.epicgames.com/documentation/unreal-engine/ufunctions-in-unreal-engine)
doc.

## The four Blueprint event specifiers

### BlueprintCallable (`ObjectMacros.h`:987)

Adds exec-in and exec-out pins to the node. Use for any function that:
- modifies state (side effects),
- returns a result **and** has side effects,
- needs to be sequenced in the graph (a node in a chain, not just a data source).

Non-`const` functions default to `BlueprintCallable` behavior when combined with `BlueprintPure=false`.

### BlueprintPure (`ObjectMacros.h`:984)

Removes exec pins. The node is a data source evaluated on demand. Rules:
- Use for stateless getters and math helpers that have no side effects.
- A `const` member function is automatically treated as pure; add `BlueprintPure=false` if you
  need exec pins on a `const` function.
- Blueprint re-evaluates a pure node for every wire connected to its output. Avoid pure functions
  for anything expensive (world queries, array scans). Cache the result in a local variable in BP
  if the node is called multiple times.
- Avoid returning arrays from pure functions — each read of the output pin copies the array.

### BlueprintImplementableEvent (`ObjectMacros.h`:950)

UHT generates a thunk that dispatches into Blueprint. C++ rules:
- **No C++ body** — providing one is a compile error.
- Call the base name from C++ (`OnHitReaction(...)`); if no BP override exists the call is a no-op
  (for void returns) or returns the zero-initialized default.
- Return values are supported, but void events are more common in practice.
- In Blueprint the function appears as an **Event** node (if void, no return) or a **function**
  node (if it has a return value or you add `meta=(ForceAsFunction)`).

### BlueprintNativeEvent (`ObjectMacros.h`:955)

Provides a C++ default plus an optional Blueprint override. Pattern:

```cpp
// Header:
UFUNCTION(BlueprintNativeEvent, Category="AI")
float ScoreThreat(const AActor* Threat) const;
float ScoreThreat_Implementation(const AActor* Threat) const;

// Cpp:
float UMyComponent::ScoreThreat_Implementation(const AActor* Threat) const
{
    return Threat ? Threat->GetDistanceTo(GetOwner()) : 0.f;
}
```

Calling rules:
- **From C++ production code**: always call `ScoreThreat(Threat)` — the engine routes to the BP
  override when present.
- **From a C++ override in a child class**: call `Super::ScoreThreat_Implementation(Threat)` to
  chain the default.
- **From Blueprint**: the event/function node calls the BP override; add a "Call Parent Function"
  node to chain the `_Implementation`.
- Never call `_Implementation` directly unless you explicitly want only the C++ path.

## Other function specifiers relevant to Blueprint

| Specifier | Effect |
|---|---|
| `CallInEditor` | Shows a button in the Details panel (editor only) |
| `BlueprintAuthorityOnly` | BP can only call on server/single-player |
| `BlueprintCosmetic` | Skipped on dedicated servers |
| `BlueprintInternalUseOnly` | Never shows in BP graphs; used for internal dispatch helpers |

## Function metadata specifiers (`meta=(...)`)

All metadata lives only in the editor build; never query it from gameplay code.

| Meta tag | Effect |
|---|---|
| `DisplayName="Label"` | Overrides the node label shown in the BP graph |
| `Category="A\|B"` | Nested category in the context menu (use `\|` as separator) |
| `Keywords="word1 word2"` | Extra search terms for the context menu |
| `ToolTip="..."` | Tooltip text (overrides code comment) |
| `CompactNodeTitle="X"` | Short label in compact-node display mode |
| `ExpandEnumAsExecs="ParamName"` | One exec pin per enum entry for the named parameter |
| `AdvancedDisplay="P1,P2"` | Collapse listed parameters behind an expand arrow |
| `AutoCreateRefTerm="P1"` | Auto-create a default for pass-by-ref pins left disconnected |
| `DefaultToSelf` | The object pin defaults to `self` (useful for static BP library funcs) |
| `HidePin="ParamName"` | Hides a pin (one per function); used to hide WorldContext pins |
| `HideSelfPin` | Hides the self pin on pure functions compatible with the owning class |
| `WorldContext="ParamName"` | Names the parameter that provides the world context |
| `CallableWithoutWorldContext` | Allows calling even if the class has no `GetWorld` |
| `BlueprintProtected` | Can only be called on `self` in BP; not on another instance |
| `DeterminesOutputType="Param"` | Return type dynamically matches the named TSubclassOf/TSoftObjectPtr param |
| `ForceAsFunction` | Turns a void `BlueprintImplementableEvent` from an event into a function |
| `UnsafeDuringActorConstruction` | Marks a function not safe to call in the construction script |
| `Latent` + `LatentInfo="Param"` | Marks the function as a latent (async) action |

## Source locations (UE 5.7)

All specifiers below are in `Runtime/CoreUObject/Public/UObject/ObjectMacros.h`:

- `UF` namespace (UFUNCTION enum), lines 943–1004:
  `BlueprintImplementableEvent`:950, `BlueprintNativeEvent`:955, `BlueprintPure`:984,
  `BlueprintCallable`:987, `BlueprintGetter`:990, `BlueprintSetter`:993,
  `BlueprintAuthorityOnly`:996, `BlueprintCosmetic`:999, `BlueprintInternalUseOnly`:1002,
  `CallInEditor`:1005.

- Function meta tags (`EM::FunctionMetaData` enum, lines ~1606–1735):
  `DisplayName`, `Keywords`, `ToolTip`, `CompactNodeTitle`, `ExpandEnumAsExecs`,
  `AdvancedDisplay`, `AutoCreateRefTerm`, `DefaultToSelf`, `HidePin`, `HideSelfPin`,
  `WorldContext`, `CallableWithoutWorldContext`, `BlueprintProtected`,
  `DeterminesOutputType`, `ForceAsFunction`, `UnsafeDuringActorConstruction`,
  `Latent`, `LatentInfo`.
