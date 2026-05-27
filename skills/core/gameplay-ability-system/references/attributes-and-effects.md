# Attributes and Gameplay Effects

> Deep-dive reference for `UAttributeSet`, `FGameplayAttributeData`, and `UGameplayEffect`.
> Grounded in UE 5.7 source at `Engine/Plugins/Runtime/GameplayAbilities/Source/GameplayAbilities/Public/`.
> Return to [../SKILL.md](../SKILL.md) for the entry-level overview.

## FGameplayAttributeData

`FGameplayAttributeData` (`AttributeSet.h:21`) stores two floats:

- **BaseValue** — the permanent value, modified by Instant and permanent GEs.
- **CurrentValue** — `BaseValue` plus any active modifiers (HasDuration/Infinite GEs). Read-only
  from outside; changes when modifiers are added or removed.

Use `GetCurrentValue()` / `GetBaseValue()` accessors. `SetCurrentValue` and `SetBaseValue` bypass
the aggregation system and should only be called during initialization (`InitFromMetaDataTable`).

## ATTRIBUTE_ACCESSORS macro

Defined by convention in `AttributeSet.h:420` as a composite of four internal macros:

```cpp
#define ATTRIBUTE_ACCESSORS(ClassName, PropertyName)         \
    GAMEPLAYATTRIBUTE_PROPERTY_GETTER(ClassName, PropertyName) \
    GAMEPLAYATTRIBUTE_VALUE_GETTER(PropertyName)              \
    GAMEPLAYATTRIBUTE_VALUE_SETTER(PropertyName)              \
    GAMEPLAYATTRIBUTE_VALUE_INITTER(PropertyName)
```

Generated API for `ATTRIBUTE_ACCESSORS(UMySet, Health)`:

| Generated | Signature | Purpose |
|---|---|---|
| `GetHealthAttribute()` | `static FGameplayAttribute` | Identifies the attribute for GE modifiers |
| `GetHealth()` | `float` | Returns `Health.GetCurrentValue()` |
| `SetHealth(float)` | `void` | Routes through ASC `SetNumericAttributeBase`; safe to call at runtime |
| `InitHealth(float)` | `void` | Sets both Base and Current; initialization only |

`ATTRIBUTE_ACCESSORS_BASIC` is an alias defined at `AttributeSet.h:466` for projects that have not
copied the macro. Use either consistently.

## Attribute set callbacks

Override these on `UAttributeSet` to control attribute modification behavior:

### PreAttributeChange (`AttributeSet.h:221`)
Called before any modification to `CurrentValue`. Use **only** for clamping; do not trigger game
logic here (this fires from many paths, not just GE execution):

```cpp
void UMyAttributeSet::PreAttributeChange(const FGameplayAttribute& Attr, float& NewValue)
{
    if (Attr == GetHealthAttribute())
    {
        NewValue = FMath::Clamp(NewValue, 0.f, GetMaxHealth());
    }
}
```

### PreAttributeBaseChange (`AttributeSet.h:232`)
Same purpose but for `BaseValue` changes. Override both for complete clamping coverage.

### PostGameplayEffectExecute (`AttributeSet.h:207`)
Called after an Instant GE modifies `BaseValue`. Use this to react to confirmed changes: trigger
death, notify UI, or apply overflow into another attribute (meta-attribute pattern).

```cpp
void UMyAttributeSet::PostGameplayEffectExecute(const FGameplayEffectModCallbackData& Data)
{
    if (Data.EvaluatedData.Attribute == GetHealthAttribute())
    {
        SetHealth(FMath::Clamp(GetHealth(), 0.f, GetMaxHealth()));
        if (GetHealth() <= 0.f)
        {
            // Notify owning actor to handle death
        }
    }
}
```

### Meta-attribute (damage) pattern

A common pattern for damage in GAS: declare an intermediate `Damage` attribute that has no
permanent meaning. A damage GE modifies `Damage`; `PostGameplayEffectExecute` reads `Damage`,
subtracts from `Health`, then resets `Damage` to 0. This allows pre-resist math and ensures all
damage flows through one observable path:

```cpp
UPROPERTY() FGameplayAttributeData Damage;
ATTRIBUTE_ACCESSORS(UMyAttributeSet, Damage)

void UMyAttributeSet::PostGameplayEffectExecute(const FGameplayEffectModCallbackData& Data)
{
    if (Data.EvaluatedData.Attribute == GetDamageAttribute())
    {
        float LocalDamage = GetDamage();
        InitDamage(0.f);  // reset
        SetHealth(FMath::Max(GetHealth() - LocalDamage, 0.f));
    }
}
```

## Replication for attribute sets

Add `GetLifetimeReplicatedProps` to the attribute set:

```cpp
void UMyAttributeSet::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const
{
    Super::GetLifetimeReplicatedProps(OutLifetimeProps);
    DOREPLIFETIME_CONDITION_NOTIFY(UMyAttributeSet, Health, COND_None, REPNOTIFY_Always);
    DOREPLIFETIME_CONDITION_NOTIFY(UMyAttributeSet, MaxHealth, COND_None, REPNOTIFY_Always);
}

void UMyAttributeSet::OnRep_Health(const FGameplayAttributeData& OldHealth)
{
    GAMEPLAYATTRIBUTE_REPNOTIFY(UMyAttributeSet, Health, OldHealth);
}
```

`GAMEPLAYATTRIBUTE_REPNOTIFY` tells the prediction system about the replicated change so local
predictions can be reconciled correctly.

## UGameplayEffect structure

`UGameplayEffect` (`GameplayEffect.h`) is a `UObject` asset — immutable at runtime. Its fields
and behavior are increasingly expressed via `UGameplayEffectComponent` subclasses (since 5.3):

### Duration policy (`EGameplayEffectDurationType`, `GameplayEffect.h:663`)

| Value | Behavior |
|---|---|
| `Instant` | Applied once, modifies BaseValue, never enters the Active GE container |
| `HasDuration` | Lasts `Duration` seconds, modifies CurrentValue via aggregator |
| `Infinite` | Active indefinitely until explicitly removed |

### Modifiers

Each modifier specifies: target `FGameplayAttribute`, operation (`Add`/`Multiply`/`Divide`/
`Override`), and magnitude (scalable float, attribute-based, custom calculation, or SetByCaller).

### GE Components (5.3+)

Component-based GEs replace the old monolithic approach. Common built-in components:

| Component | Effect |
|---|---|
| `UTargetTagsGameplayEffectComponent` | Grants/removes tags on the target ASC while active |
| `UTargetTagRequirementsGameplayEffectComponent` | GE only applies/continues if target has/lacks tags |
| `UAdditionalEffectsGameplayEffectComponent` | Conditionally applies additional GEs on execute |
| `UImmunityGameplayEffectComponent` | Blocks other GE specs matching a query |
| `URemoveOtherGameplayEffectComponent` | Removes active GEs by query on application |
| `UChanceToApplyGameplayEffectComponent` | Probability gate |
| `UBlockAbilityTagsGameplayEffectComponent` | Blocks ability activation by tag while active |

### Execution calculations

For complex attribute changes beyond simple modifiers, subclass
`UGameplayEffectExecutionCalculation` and override `Execute_Implementation`. Captures multiple
source/target attributes, applies custom math, and outputs attribute modifiers:

```cpp
UCLASS()
class UExecCalc_Damage : public UGameplayEffectExecutionCalculation
{
    GENERATED_BODY()
public:
    UExecCalc_Damage();
    virtual void Execute_Implementation(
        const FGameplayEffectCustomExecutionParameters& ExecutionParams,
        FGameplayEffectCustomExecutionOutput& OutExecutionOutput) const override;
};
```

Defined in `GameplayEffectExecutionCalculation.h` (in the plugin Public folder).

### Applying GEs

```cpp
// Simple immediate apply (self)
FGameplayEffectContextHandle Ctx = ASC->MakeEffectContext();
FGameplayEffectSpecHandle Spec = ASC->MakeOutgoingSpec(MyDamageGE, Level, Ctx);
FActiveGameplayEffectHandle ActiveHandle = ASC->ApplyGameplayEffectSpecToSelf(*Spec.Data.Get());

// Apply to another ASC
ASC->ApplyGameplayEffectSpecToTarget(*Spec.Data.Get(), TargetASC);

// SetByCaller magnitude (for dynamic values like weapon damage)
Spec.Data->SetSetByCallerMagnitude(FGameplayTag::RequestGameplayTag("Data.Damage"), DamageAmount);
```

`MakeOutgoingSpec` (`AbilitySystemComponent.h:362`), `ApplyGameplayEffectSpecToTarget` (`:329`).

### Stacking

Configure on the GE asset via `StackingType` (stack by source or target), `StackLimitCount`,
`StackDurationRefreshPolicy`, and `StackPeriodResetPolicy`. The system handles overflow via the
`UAdditionalEffectsGameplayEffectComponent` on overflow condition.

## Initializing attribute values

Use a DataTable with `FAttributeMetaData` rows to initialize attributes from a curve table or
constant values, then call `ASC->InitStats(UMyAttributeSet::StaticClass(), DataTable)`. This calls
`InitFromMetaDataTable` on the attribute set, which uses `InitHealth(x)` etc. to set base values.
