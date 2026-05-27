# Structured logging (UE_LOGFMT) — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers `UE_LOGFMT` field styles, the
`UE_LOG_CONTEXT` thread-local scope, `FLogRecord`, and custom `SerializeForLog`
overloads. Grounded in UE 5.7
(`Engine/Source/Runtime/Core/Public/Logging/StructuredLog.h`). Introduced in UE 5.2.

## Why structured logging

`UE_LOG` produces a flat formatted string. `UE_LOGFMT` produces a **structured record**
with named fields that tools (telemetry pipelines, log analyzers, Insights) can parse
without regex. The human-readable string is derived from the fields; the fields themselves
are stored as compact binary (`FCbObject`).

## Include

```cpp
#include "Logging/StructuredLog.h"
```

The category still needs its own header via the usual `DECLARE_LOG_CATEGORY_EXTERN` /
`DEFINE_LOG_CATEGORY` pair.

## Positional fields

Values map left-to-right to the `{FieldName}` placeholders in the format string. The count
of values must match the count of placeholders.

```cpp
// Format: "Loaded '{Name}' in {Ms} ms"
// Fields: Package->GetName() → Name, ElapsedMs → Ms
UE_LOGFMT(LogAssets, Log, "Loaded '{Name}' in {Ms} ms",
    Package->GetName(), ElapsedMs);
```

`FString` values do not need `*` — `UE_LOGFMT` serializes via `SerializeForLog`, not
`printf`. The field value is stored typed, not pre-formatted.

## Named fields

Order is irrelevant; extra fields are permitted and are stored in the record even if the
format string does not reference them. Named style uses `("FieldName", Value)` syntax,
expanded by `UE_PRIVATE_LOGFMT_FIELD`.

```cpp
UE_LOGFMT(LogAssets, Warning, "Load of '{Name}' failed with {Code}",
    ("Name", Package->GetName()),
    ("Code", ErrorCode),
    ("Flags", static_cast<uint32>(LoadFlags)));   // extra field stored, not shown in message
```

Field name rules: must match `[A-Za-z0-9_]+`; must be unique within the call; ANSI string
literals only.

## Exceeding 16 fields — UE_LOGFMT_EX

`UE_LOGFMT` supports up to 16 fields via count-dispatch macros. For more, use
`UE_LOGFMT_EX` with explicit `UE_LOGFMT_FIELD` / `UE_LOGFMT_VALUE` wrappers:

```cpp
// Positional with UE_LOGFMT_EX
UE_LOGFMT_EX(LogMyModule, Log, "Event '{Name}' at {X} {Y}",
    UE_LOGFMT_VALUE(EventName),
    UE_LOGFMT_VALUE(X),
    UE_LOGFMT_VALUE(Y));

// Named with UE_LOGFMT_EX
UE_LOGFMT_EX(LogMyModule, Log, "Event '{Name}' at {X} {Y}",
    UE_LOGFMT_FIELD("Name", EventName),
    UE_LOGFMT_FIELD("X", X),
    UE_LOGFMT_FIELD("Y", Y));
```

## Thread-local log context — UE_LOG_CONTEXT

`UE_LOG_CONTEXT` registers a named value on the calling thread for the lifetime of the
enclosing scope. Every `UE_LOGFMT` call on that thread during the scope automatically
inherits the context as an extra field.

```cpp
void LoadPackage(const FString& PackageName)
{
    UE_LOG_CONTEXT("Package", *PackageName);   // active for the duration of this function
    // All UE_LOGFMT calls on this thread now carry a "Package" field automatically.
    UE_LOGFMT(LogAssets, Log, "Starting load");
    UE_LOGFMT(LogAssets, Warning, "Missing redirect for {Target}", RedirectTarget);
}   // context removed here
```

Context names overridden by a newer context with the same name. A field of the same name in
the log call takes precedence over the context. Context names are collected into a
`$Context` array field on the `FLogRecord`.

Multiple contexts can be stacked; they are unregistered in LIFO order by `FLogContext`
destructor (`StructuredLog.h`:509).

## FLogRecord

`UE_LOGFMT` constructs an `FLogRecord` (`StructuredLog.h`:183) which is dispatched to
output devices. Fields of interest for custom output devices or log output device subclasses:

```cpp
// Key accessors on FLogRecord:
const FName&            GetCategory()   // log category name
ELogVerbosity::Type     GetVerbosity()  // verbosity level
const TCHAR*            GetFormat()     // format string (e.g. "Loading '{Name}'")
const FCbObject&        GetFields()     // compact-binary field object
const ANSICHAR*         GetFile()       // source file (__FILE__)
int32                   GetLine()       // source line (__LINE__)
```

`FLogRecord::FormatMessageTo(FWideStringBuilderBase&)` produces the human-readable string
by substituting field values into the format template.

## Custom SerializeForLog

To make your own type loggable as a `UE_LOGFMT` field, overload `SerializeForLog`:

```cpp
// Make FMyStruct loggable as a structured field
inline void SerializeForLog(FCbWriter& Writer, const FMyStruct& Value)
{
    Writer.BeginObject();
    Writer << "Name" << Value.Name;
    Writer << "Count" << Value.Count;
    // Add a $text field to control the human-readable representation:
    Writer << "$text" << FString::Printf(TEXT("%s (%d)"), *Value.Name, Value.Count);
    Writer.EndObject();
}
```

The `$text` field in an object overrides the default JSON serialization for the
human-readable message. Without it, the object is rendered as JSON. Declared in
`StructuredLog.h`:289.

## Conditional structured log — UE_CLOGFMT

Like `UE_CLOG` but structured:

```cpp
UE_CLOGFMT(bShouldLog, LogMyModule, Log, "Skipped '{Name}'", AssetName);
```

## Localized structured log — UE_LOGFMT_LOC

For log messages that need localization (e.g. user-facing notifications surfaced via log):

```cpp
// Requires LOCTEXT_NAMESPACE to be set in the .cpp
UE_LOGFMT_LOC(LogUI, Display, "LoadFailed", "Failed to load '{Name}'",
    ("Name", AssetName));
```

The key identifies the localized FText entry. Declared in `StructuredLog.h`:87.
