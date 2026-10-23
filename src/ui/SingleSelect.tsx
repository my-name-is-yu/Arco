import { useId, useImperativeHandle, useRef, type Ref } from "react";
import { Select } from "@openai/apps-sdk-ui/components/Select";

export interface SingleSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SingleSelectGroup {
  label: string;
  options: SingleSelectOption[];
}

export interface SingleSelectHandle {
  focus: () => void;
}

type SdkOption = SingleSelectOption & { nativeValue: string };
const sdkValue = (value: string) => `v:${encodeURIComponent(value)}`;
const sdkOption = (option: SingleSelectOption): SdkOption => ({
  ...option,
  value: sdkValue(option.value),
  nativeValue: option.value,
});

function SelectedValue({ label }: SingleSelectOption) {
  return <span className="source-single-value">{label}</span>;
}

function OptionView({ label, nativeValue }: SdkOption) {
  return <span data-select-value={nativeValue}>{label}</span>;
}

export function SingleSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
  loading = false,
  placeholder = "Not set",
  id,
  className,
  ref,
}: {
  label: string;
  value: string;
  options: SingleSelectOption[] | SingleSelectGroup[];
  onChange: (value: string) => void;
  disabled?: boolean;
  loading?: boolean;
  placeholder?: string;
  id?: string;
  className?: string;
  ref?: Ref<SingleSelectHandle>;
}) {
  const generatedId = useId();
  const groupRef = useRef<HTMLDivElement>(null);
  const focus = () =>
    groupRef.current?.querySelector<HTMLElement>('[role="button"]')?.focus();
  useImperativeHandle(ref, () => ({ focus }));

  const grouped = options.length > 0 && "options" in options[0];
  const all = options.flatMap((option) =>
    "options" in option ? option.options : [option],
  );
  const missing = value && !all.some((option) => option.value === value);
  const current = { value, label: value, disabled: true };
  const choices: SingleSelectOption[] | SingleSelectGroup[] = grouped
    ? [
        ...(options as SingleSelectGroup[]).map((group) => ({
          ...group,
          options: group.options.map((option) => ({
            ...option,
            disabled: disabled || option.disabled,
          })),
        })),
        ...(missing
          ? [{ label: "Current selection", options: [current] }]
          : []),
      ]
    : [
        ...(options as SingleSelectOption[]).map((option) => ({
          ...option,
          disabled: disabled || option.disabled,
        })),
        ...(missing ? [current] : []),
      ];

  return (
    <div
      ref={groupRef}
      className={`source-single-select${className ? ` ${className}` : ""}`}
      role="group"
      aria-label={label}
      data-value={value}
      onKeyDown={(event) => {
        if (event.key === "Escape") requestAnimationFrame(focus);
      }}
    >
      <Select
        id={id ?? generatedId}
        value={sdkValue(value)}
        options={
          grouped
            ? (choices as SingleSelectGroup[]).map((group) => ({
                ...group,
                options: group.options.map(sdkOption),
              }))
            : (choices as SingleSelectOption[]).map(sdkOption)
        }
        onChange={(selected) => {
          if (selected.nativeValue !== value) onChange(selected.nativeValue);
          requestAnimationFrame(focus);
        }}
        disabled={disabled}
        loading={loading}
        placeholder={placeholder}
        variant="soft"
        pill
        size="sm"
        block={false}
        align="start"
        dropdownIconType="chevronDown"
        listMinWidth={220}
        listMaxWidth={360}
        searchPlaceholder={`Search ${label.toLowerCase()}…`}
        TriggerView={SelectedValue}
        OptionView={OptionView}
      />
    </div>
  );
}
