# Strings & text — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers `FString`, `FName`, `FText`,
`TStringBuilder`, `FStringView`, and the conversion matrix. Grounded in UE 5.7
(`Runtime/Core/Public/`).

## FString

`FString` is the engine's mutable, heap-allocated wide string (`Containers/UnrealString.h`,
class defined in `UnrealString.h.inl`:54). It is the right choice when you need to build,
parse, or modify text at runtime that is not user-facing.

```cpp
// Building
FString Path = FString::Printf(TEXT("/Game/Maps/%s"), *MapName); // Printf:1423
FString Joined = FString::Format(TEXT("{A} beats {B}"),          // Format:1465
    { { TEXT("A"), FStringFormatArg(TeamA) },
      { TEXT("B"), FStringFormatArg(TeamB) } });

// Common predicates
bool bHas = Path.Contains(TEXT("Game"));
int32 Idx = Path.Find(TEXT("Maps")); // INDEX_NONE if absent
FString Sub = Path.Mid(6, 4);        // substring
Path.ToUpperInline();

// Numeric conversions
FString S  = FString::FromInt(42);
int32  I   = FCString::Atoi(*S);
float  F   = FCString::Atof(*S);
FString SF = FString::SanitizeFloat(3.14f);
```

`TStringBuilder<N>` (`Misc/StringBuilder.h`:78, alias defined in `Containers/StringFwd.h`:30)
is a stack-backed string builder that avoids allocations for short outputs and is strongly
preferred over repeated `FString` concatenation in hot paths.

```cpp
TStringBuilder<256> Builder;
Builder << TEXT("Actor: ") << *Actor->GetName();
Builder.Appendf(TEXT(" HP=%d"), Hp);
FString Result(Builder);  // or use Builder.ToString() for const TCHAR*
```

The old `TWriteToString<N>` is deprecated as of UE 5.3; use `TStringBuilder<N>`.

---

## FName

`FName` (`UObject/NameTypes.h`:616) is an interned, case-insensitive identifier. The engine
maintains a global name table; each `FName` stores an index and instance number rather than
character data. Comparison is O(1).

```cpp
FName Socket(TEXT("hand_r"));           // intern or look up
FName Same(TEXT("HAND_R"));             // same FName (case-insensitive)
bool Equal = (Socket == Same);          // true — O(1)
FString Str = Socket.ToString();        // back to FString (allocates)
FName FromStr(*SomeFString);            // FString → FName
```

**When to use `FName`:**
- Asset names, bone/socket names, tag identifiers, config keys, `UPROPERTY` name specifiers.
- Any identifier compared far more often than it is created.

**Never use `FName` for:**
- User-facing text (it can't localize and its casing can be surprising).
- Keys in a `TMap` where you need case-sensitive matching — `FName` comparison is always
  case-insensitive.

---

## FText

`FText` (`Internationalization/Text.h`:384) is the localization-aware display string. Any
text a player sees must go through `FText`. It supports plural forms, number/date formatting
per culture, and string tables.

```cpp
// Compile-time localized literal (preferred for static UI strings)
FText Title = NSLOCTEXT("UI", "MainMenu_Title", "Main Menu");

// Dynamic formatting — always use FText::Format, not FString
FText HpDisplay = FText::Format(                     // Format:647
    NSLOCTEXT("UI", "HpFmt", "HP: {0}/{1}"),
    FText::AsNumber(CurrentHp),
    FText::AsNumber(MaxHp));

// Culture-invariant text (for debug/API names, not for localization)
FText Debug = FText::FromString(SomeNonLocalizedString); // FromString:497

// Equality — do NOT use operator== for FText
bool Same = TextA.EqualTo(TextB);                    // EqualTo:571
```

**`NSLOCTEXT` vs `LOCTEXT`:**
- `NSLOCTEXT("Namespace", "Key", "Default")` — provides namespace inline; usable anywhere.
- `LOCTEXT("Key", "Default")` — requires `LOCTEXT_NAMESPACE` to be `#define`d at file scope
  and `#undef`'d at the end. More concise, but error-prone in headers.

### String tables

Prefer external string tables for large games. Reference a key with
`FText::FromStringTable(TableId, KEY)` (`Text.h`:483). This separates all translatable text
from code.

---

## Conversion matrix

| From | To | Method |
|---|---|---|
| `FName` | `FString` | `Name.ToString()` |
| `FName` | `FText` | `FText::FromName(Name)` — not truly localizable |
| `FString` | `FName` | `FName(*Str)` — lossy (case-insensitive; avoid for case-sensitive IDs) |
| `FString` | `FText` | `FText::FromString(Str)` — not localizable, debug only |
| `FText` | `FString` | `Text.ToString()` — may be lossy for some languages |
| `FText` | `FName` | No direct path — go via `FString` then `FName` |
| `int32`  | `FString` | `FString::FromInt(I)` |
| `float`  | `FString` | `FString::SanitizeFloat(F)` |
| `FString` | `int32` | `FCString::Atoi(*Str)` |
| `FString` | `float` | `FCString::Atof(*Str)` |

---

## FStringView

`FStringView` (`Containers/StringView.h`) is a non-owning view over a null-terminated (or
not) `TCHAR` buffer — essentially a `std::string_view`. Use it as an inexpensive function
parameter when you only need to read the content without owning or copying.

```cpp
bool DoesPathStart(FStringView Path, FStringView Prefix)
{
    return Path.StartsWith(Prefix);
}
DoesPathStart(TEXT("/Game/Maps"), TEXT("/Game"));
```

`FStringView` is compatible with `FString`, `TStringBuilder::ToView()`, and string literals
wrapped in `TEXT()`.

---

## Encoding rules

Always wrap `char` literals in `TEXT(...)` to produce `TCHAR`. Without it, the literal is an
ANSI `char*`; passing it to `FString`/`FName` APIs triggers a narrowing conversion that may
lose characters outside ASCII.

```cpp
FString Bad  = "hello";         // ANSI → implicit conversion, avoid
FString Good = TEXT("hello");   // TCHAR — always use this
```

Unreal's `TCHAR` is UTF-16 on Windows and UTF-32 on some other platforms. Do not assume
2 bytes per character in cross-platform code.

---

## Version notes

- `TWriteToString<N>` deprecated UE 5.3; use `TStringBuilder<N>`.
- Double-precision math in UE5 means `FString::SanitizeFloat` uses `double` by default.
  Check `FString::Printf(TEXT("%.3f"), (double)Val)` for controlled precision.
