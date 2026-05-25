# Native Gameplay Tags — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the four native-tag macros, the
`FNativeGameplayTag` lifetime, module registration timing, multi-module sharing, and
file-private tags. Grounded in UE 5.7
(`Engine/Source/Runtime/GameplayTags/Public/NativeGameplayTags.h`).

## The four macros

| Macro | Where | Purpose |
|---|---|---|
| `UE_DECLARE_GAMEPLAY_TAG_EXTERN(Name)` | `.h` | Declares `extern FNativeGameplayTag Name;` for cross-TU access |
| `UE_DEFINE_GAMEPLAY_TAG(Name, "a.b.c")` | `.cpp` | Defines the tag with an empty developer comment |
| `UE_DEFINE_GAMEPLAY_TAG_COMMENT(Name, "a.b.c", "comment")` | `.cpp` | Same but with a tooltip shown in the editor |
| `UE_DEFINE_GAMEPLAY_TAG_STATIC(Name, "a.b.c")` | `.cpp` | `static` — file-private, no header declaration |

A `static_assert` inside each `DEFINE` macro rejects use in `.h` files at compile time
(`NativeGameplayTags.h`:36, :41, :46). This is intentional: duplicate definitions across
translation units would cause ODR violations or double-registration.

## FNativeGameplayTag

`FNativeGameplayTag` is a non-copyable RAII wrapper (`FNoncopyable`) declared at
`NativeGameplayTags.h`:58. Its constructor takes `PluginName`, `ModuleName`, `TagName`
(as `FName`), `TagDevComment` (`FString`), and a private token
`ENativeGameplayTagToken::PRIVATE_USE_MACRO_INSTEAD` — the token prevents construction
outside the macros.

On construction it calls `UGameplayTagsManager::AddNativeGameplayTag(this)` (the private
overload at `GameplayTagsManager.h`:400) to register the tag pointer.  
On destruction it calls `RemoveNativeGameplayTag(this)`, so if a plugin module is
unloaded the tag is safely removed from the dictionary.

The `operator FGameplayTag() const` implicit conversion (`:67`) makes `FNativeGameplayTag`
usable everywhere an `FGameplayTag` is expected without calling `.GetTag()`.

## Registration timing

Native tags register at **static initialization time** — before `main()` runs and before
any `UObject` exists. The tag dictionary lock (`DoneAddingNativeTags`, `GameplayTagsManager.h`:405)
is called during engine startup after all module constructors have run. After that point,
adding new native tags is unsafe.

Consequence: you **cannot** define a native tag inside a function body or inside a
`UObject` constructor — the macro must be at file scope in a `.cpp` file.

If your code runs during module startup and needs to react after all native tags are
loaded, register a delegate:

```cpp
// Safe call-or-register pattern (fires immediately if tags are already done):
UGameplayTagsManager::Get().CallOrRegister_OnDoneAddingNativeTagsDelegate(
    FSimpleMulticastDelegate::FDelegate::CreateLambda([]
    {
        // All native tags are now registered; safe to cache FGameplayTag values.
    })
);
```

`CallOrRegister_OnDoneAddingNativeTagsDelegate` is at `GameplayTagsManager.h`:415.

## Sharing tags across modules

The canonical pattern for a module that owns tags shared with other modules:

```cpp
// MyModule/Public/MyModuleTags.h
#pragma once
#include "NativeGameplayTags.h"

// Declare each tag as extern — no definition here.
UE_DECLARE_GAMEPLAY_TAG_EXTERN(TAG_Ability_Dash)
UE_DECLARE_GAMEPLAY_TAG_EXTERN(TAG_State_Airborne)
```

```cpp
// MyModule/Private/MyModuleTags.cpp
#include "MyModuleTags.h"

UE_DEFINE_GAMEPLAY_TAG_COMMENT(TAG_Ability_Dash,    "Ability.Dash",    "Dash movement ability")
UE_DEFINE_GAMEPLAY_TAG_COMMENT(TAG_State_Airborne,  "State.Airborne",  "Actor is not on ground")
```

Other modules include `MyModuleTags.h` and list `MyModule` in their `PublicDependencyModuleNames`
(or `PrivateDependencyModuleNames`). The linker resolves the extern symbols.

## File-private tags

`UE_DEFINE_GAMEPLAY_TAG_STATIC` declares the `FNativeGameplayTag` as `static`, making it
internal to the translation unit (`:46`). Use it for implementation-detail tags that no
other file needs:

```cpp
// CombatSystem.cpp
UE_DEFINE_GAMEPLAY_TAG_STATIC(TAG_Internal_ComboWindow, "Internal.Combat.ComboWindow")

void UCombatSystem::OnAttackLanded()
{
    if (OwnerTags.HasTag(TAG_Internal_ComboWindow))
    { /* ... */ }
}
```

No `DECLARE` is needed or possible — the tag cannot be referenced from another `.cpp`.

## Accessing the underlying FGameplayTag

```cpp
FNativeGameplayTag MyNativeTag = ...;          // you rarely hold one directly

// Three equivalent ways to get the FGameplayTag:
FGameplayTag A = MyNativeTag;                  // implicit operator FGameplayTag()
FGameplayTag B = MyNativeTag.GetTag();         // explicit getter
FGameplayTag C = (FGameplayTag)MyNativeTag;    // explicit cast
```

When used in `HasTag`, `AddTag`, `MatchesTag`, etc., the implicit conversion fires
automatically, so you can pass `TAG_State_Stunned` (a `FNativeGameplayTag`) directly.

## Version notes

All four macros and `FNativeGameplayTag` are stable across UE5. The `static_assert`
blocking header-file definitions has been present since the macros were introduced.
`UE_INCLUDE_NATIVE_GAMEPLAYTAG_METADATA` (`NativeGameplayTags.h`:49) controls whether
plugin/module name metadata is stored; it is enabled in Editor non-Shipping builds and
disabled in Shipping to reduce memory.
