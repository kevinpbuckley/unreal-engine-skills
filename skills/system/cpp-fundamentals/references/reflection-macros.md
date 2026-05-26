# Reflection macros — full specifier reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the complete set of specifiers for
`UCLASS`, `UPROPERTY`, `UFUNCTION`, `USTRUCT`, `UENUM`, and `UINTERFACE`, including less-common
options that appear in real codebases. Grounded in UE 5.7
(`Engine/Source/Runtime/CoreUObject/Public/UObject/ObjectMacros.h`).

## How the macros work

`UCLASS(...)`, `UPROPERTY(...)`, `UFUNCTION(...)`, `USTRUCT(...)`, `UENUM(...)`, and
`UINTERFACE(...)` expand to empty stubs at C++ compile time (`ObjectMacros.h`:744-749). Their
actual content is parsed by UHT *before* the compiler runs. UHT generates a `ClassName.generated.h`
containing the real boilerplate (thunks, reflection tables, `GENERATED_BODY` expansion). The
`.generated.h` must be the last `#include` in the header; the compiler then sees the completed
class declaration.

`GENERATED_BODY()` (`ObjectMacros.h`:765) expands to a file-and-line-keyed macro that UHT
populates with:
- `StaticClass()` / `StaticStruct()` accessors.
- Constructor/destructor boilerplate.
- Serialization and property iteration hooks.
- Blueprint thunk (`execFuncName`) declarations for every `UFUNCTION`.

`GENERATED_UCLASS_BODY()` is the legacy form (pre-UE4.15) that required you to declare the
constructor separately; `GENERATED_BODY()` supersedes it for all new code.

## UCLASS specifiers (namespace UC, ObjectMacros.h:792)

### Essential
| Specifier | Effect |
|---|---|
| `Blueprintable` | Class can be subclassed in Blueprint. |
| `BlueprintType` | Class usable as a Blueprint variable type. |
| `Abstract` | Cannot be instantiated directly (used for base classes). |
| `Config=ConfigName` | Properties tagged `Config` read/write from `<ConfigName>.ini`. |
| `MinimalAPI` | Exports only reflection boilerplate; reduces link surface for internal classes. |

### Less common but important
| Specifier | Effect |
|---|---|
| `Within=OuterClassName` | Instances must have an outer of the specified class. |
| `DefaultToInstanced` | All instances treated as instanced (component semantics). |
| `Transient` | Class cannot be saved; instances are zeroed on load. |
| `perObjectConfig` | Each instance reads/writes its own `[ObjectName ClassName]` ini section. |
| `placeable` / `notplaceable` | Controls whether the class appears in the Place Actors panel. |
| `hidedropdown` | Hides the class from editor class-picker dropdowns. |
| `SparseClassDataType=FMyData` | Stores some properties once per class rather than per instance (memory optimization for large fleets). |
| `Experimental` / `EarlyAccessPreview` | Marks the class as unsupported/preview in the editor. |

### Meta specifiers for UCLASS
Applied as `UCLASS(meta=(Key="Value"))`:

| Key | Effect |
|---|---|
| `BlueprintSpawnableComponent` | Makes an ActorComponent spawnable from Blueprint's Add Component menu. |
| `ChildCanTick` / `ChildCannotTick` | Overrides Blueprint tick capability independent of C++ bCanEverTick. |
| `DisplayName="My Name"` | Custom display name in the editor. |
| `DeprecationMessage="..."` | Shown when the deprecated class is used. |

## UPROPERTY specifiers (namespace UP, ObjectMacros.h:1046)

### Edit and visibility
| Specifier | Effect |
|---|---|
| `EditAnywhere` | Editable on all instances and archetypes (CDO). |
| `EditDefaultsOnly` | Editable only on the CDO / Blueprint defaults. |
| `EditInstanceOnly` | Editable only on placed/spawned instances. |
| `VisibleAnywhere` | Visible (read-only) everywhere. |
| `VisibleDefaultsOnly` | Visible (read-only) on CDO only. |
| `VisibleInstanceOnly` | Visible (read-only) on instances only. |

Properties with no Edit/Visible specifier are hidden in the editor entirely (but can still be in BP
if `BlueprintReadWrite`/`BlueprintReadOnly` is set).

### Blueprint access
| Specifier | Effect |
|---|---|
| `BlueprintReadWrite` | Full get and set in Blueprint graphs. |
| `BlueprintReadOnly` | Get only in Blueprint. |
| `BlueprintGetter=FuncName` | Custom getter function (implies BlueprintReadOnly unless BlueprintReadWrite also set). |
| `BlueprintSetter=FuncName` | Custom setter function (implies BlueprintReadWrite). |
| `BlueprintAssignable` | For multicast delegates: can be bound in Blueprint. |
| `BlueprintCallable` | For multicast delegates: can be called (broadcast) from Blueprint. |

### Serialization and lifetime
| Specifier | Effect |
|---|---|
| `Transient` | Not saved to disk; zero-initialized on load. |
| `DuplicateTransient` | Reset to default whenever duplicated (copy/paste, PIE, binary dup). |
| `SaveGame` | Included in `USaveGame` serialization passes. |
| `Config` | Read/write from the class's config file (combine with `UCLASS(Config=...)`). |
| `GlobalConfig` | Reads from the base class config, not the subclass. |
| `SkipSerialization` | Not serialized to binary, but can still be exported to text. |
| `TextExportTransient` | Not exported to text (copy/paste). |

### Replication
| Specifier | Effect |
|---|---|
| `Replicated` | Replicated to clients. |
| `ReplicatedUsing=OnRep_FuncName` | Replicated with a repnotify callback. |
| `NotReplicated` | Skipped in replication (for struct members or service params). |

### Other useful specifiers
| Specifier | Effect |
|---|---|
| `Category="Group|Sub"` | Details panel hierarchy (required for all exposed properties). |
| `AdvancedDisplay` | Shown under the Advanced dropdown in Details. |
| `NoClear` | Hides the clear (null) button for object references. |
| `EditFixedSize` | Array size is immutable; only elements can be edited. |
| `Instanced` | Object reference is an instanced subobject; triggers deep duplication. |
| `AssetRegistrySearchable` | Value is indexed in the Asset Registry for filtering. |
| `FieldNotify` | Generates a field change notification for the `INotifyFieldValueChanged` system. |

### Common meta specifiers for UPROPERTY
Applied as `UPROPERTY(meta=(Key="Value"))`:

| Key | Context | Effect |
|---|---|---|
| `ClampMin` / `ClampMax` | Numeric | Hard-clamps value in serialization and editor. |
| `UIMin` / `UIMax` | Numeric | Soft range for the editor slider (value can exceed it). |
| `AllowPrivateAccess="true"` | Any | Exposes a `private` member to Blueprint. |
| `Units="cm"` / `"kg"` / `"s"` | Numeric | Display unit in editor (does not convert). |
| `InlineEditConditionToggle` | bool | Hides the bool, uses it as a visibility toggle for adjacent properties. |
| `EditCondition="BoolPropName"` | Any | Greys out the property when the named bool is false. |
| `MakeEditWidget` | FVector/FRotator | Shows a viewport widget for in-world editing. |

## UFUNCTION specifiers (namespace UF, ObjectMacros.h:945)

### Blueprint exposure
| Specifier | Effect |
|---|---|
| `BlueprintCallable` | Callable from Blueprint event graphs; has execution pins. |
| `BlueprintPure` | No side effects; pure node with no exec pins. |
| `BlueprintImplementableEvent` | No C++ body; fully implemented in Blueprint. |
| `BlueprintNativeEvent` | C++ provides `_Implementation`; Blueprint can override. |
| `BlueprintAuthorityOnly` | Blueprint can only call this on the server. |
| `BlueprintCosmetic` | Blueprint can only call this on clients (no dedicated server). |
| `BlueprintInternalUseOnly` | Not shown to Blueprint users (infrastructure use). |
| `CallInEditor` | Adds a Details panel button in the editor. |

### Replication (RPCs)
| Specifier | Effect |
|---|---|
| `Server` | Executed on the server when called on a client. Provide `_Implementation`. |
| `Client` | Executed on the owning client when called on the server. |
| `NetMulticast` | Executed on server and all clients. |
| `Reliable` | Guaranteed delivery (use sparingly — has cost). |
| `Unreliable` | Best-effort; lost calls are not retransmitted. |
| `WithValidation` | Provide `_Validate` function; returning false kicks the caller. |

### Other
| Specifier | Effect |
|---|---|
| `Exec` | Registers as a console command (call from player controller chain). |
| `SealedEvent` | Cannot be overridden in subclasses (events only). |
| `FieldNotify` | Emits a field change notification. |
| `CustomThunk` | Suppresses auto-generated thunk; you provide `execFuncName`. |

### Common meta specifiers for UFUNCTION
| Key | Effect |
|---|---|
| `DisplayName="..."` | Custom label in Blueprint context menus. |
| `Keywords="foo bar"` | Extra search terms in Blueprint palette. |
| `CompactNodeTitle="..."` | Short title shown on collapsed Blueprint node. |
| `ReturnDisplayName="..."` | Custom label for the return value pin. |
| `DefaultToSelf` | A parameter defaults to `self` in Blueprint. |
| `HidePin="ParamName"` | Hides a parameter pin (it must have a default). |

## USTRUCT specifiers (namespace US, ObjectMacros.h:1176)

| Specifier | Effect |
|---|---|
| `BlueprintType` | Usable as a Blueprint variable/return type. |
| `Atomic` | Serialized as a single unit; partial serialization is not allowed. |
| `NoExport` | Header parsed for metadata only; no generated code emitted. |

`USTRUCT` structs are **not** garbage-collected. A `UPROPERTY` inside a struct enables
serialization and editor exposure but does not constitute GC ownership. Struct lifetimes follow
their containing UObject or stack frame.

## UENUM

```cpp
UENUM(BlueprintType)
enum class EMyState : uint8
{
    Idle    UMETA(DisplayName="Idle"),
    Active  UMETA(DisplayName="Active"),
    Dead    UMETA(DisplayName="Dead"),
};
```

- Must be `uint8`-backed for `BlueprintType`.
- `UMETA(DisplayName="...")` sets the label in Blueprint dropdowns.
- `UMETA(Hidden)` hides an entry from Blueprint while keeping it in C++.
- `UMETA(ToolTip="...")` adds a tooltip.

## UINTERFACE

Interfaces always come in pairs. The `U*` half is a thin UObject shell (needed for reflection); the
`I*` half is the actual C++ interface with the function declarations.

```cpp
// Declare in header; both must be in the same file
UINTERFACE(MinimalAPI, Blueprintable)
class UInteractable : public UInterface { GENERATED_BODY() };

class IInteractable
{
    GENERATED_BODY()
public:
    // BlueprintNativeEvent: C++ can provide a default; Blueprint can override
    UFUNCTION(BlueprintNativeEvent, Category="Interaction")
    void Interact(AActor* Instigator);

    // BlueprintImplementableEvent: no C++ body at all
    UFUNCTION(BlueprintImplementableEvent, Category="Interaction")
    void OnInteractFailed();
};
```

To implement in a C++ class:
```cpp
class AMyDoor : public AActor, public IInteractable
{
    GENERATED_BODY()
public:
    virtual void Interact_Implementation(AActor* Instigator) override;
};
```

To check / call:
```cpp
if (AActor* Actor = SomeRef.Get())
{
    if (Actor->Implements<UInteractable>())
    {
        IInteractable::Execute_Interact(Actor, this);   // BP-safe dispatch
    }
}
```

`UInterface` and `IInterface` are both defined in
`Engine/Source/Runtime/CoreUObject/Public/UObject/Interface.h`:18.

## Version notes

- The macro stubs and specifier namespaces (`UC`, `UP`, `UF`, `US`) are stable across UE4 / UE5.
- `SparseClassDataType` was introduced in UE 4.27.
- `FieldNotify` and the `INotifyFieldValueChanged` system were introduced in UE 5.0.
- Line numbers in `ObjectMacros.h` drift across patch releases; use the namespace names to locate
  sections reliably.
