import {
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  type ReactNode,
  type Ref,
} from "react";
import { Select } from "@openai/apps-sdk-ui/components/Select";
import { SelectOptionVisual } from "./SelectOptionVisual";

export interface SingleSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  empty?: boolean;
  color?: string;
  leading?: ReactNode;
}

export interface SingleSelectGroup {
  label: string;
  options: SingleSelectOption[];
}

export interface SingleSelectHandle {
  focus: () => void;
  open: () => void;
}

type SdkOption = SingleSelectOption & { nativeValue: string };
const sdkValue = (value: string) => `v:${encodeURIComponent(value)}`;
const sdkOption = (option: SingleSelectOption): SdkOption => ({
  ...option,
  value: sdkValue(option.value),
  nativeValue: option.value,
});

function SelectedValue({ label, leading, color }: SingleSelectOption) {
  return (
    <span className="source-single-value source-select-content">
      <SelectOptionVisual leading={leading} color={color} />
      <span className="source-select-text">{label}</span>
    </span>
  );
}

function OptionView({ label, leading, color, nativeValue, empty }: SdkOption) {
  return (
    <span
      className="source-select-content"
      data-select-value={nativeValue}
      data-empty={empty || !nativeValue ? "true" : undefined}
    >
      <SelectOptionVisual leading={leading} color={color} />
      <span className="source-select-text">{label}</span>
    </span>
  );
}

export function SingleSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
  loading = false,
  block = false,
  placeholder = "Not set",
  searchPlaceholder = "Search…",
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
  block?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  id?: string;
  className?: string;
  ref?: Ref<SingleSelectHandle>;
}) {
  const generatedId = useId();
  const groupRef = useRef<HTMLDivElement>(null);
  const trigger = () =>
    groupRef.current?.querySelector<HTMLElement>('[role="button"]');
  const focus = () => trigger()?.focus();
  useImperativeHandle(ref, () => ({
    focus,
    open: () => {
      const control = trigger();
      if (
        !control ||
        disabled ||
        loading ||
        control.getAttribute("aria-expanded") === "true"
      )
        return;
      control.focus();
      // The SDK ignores click() and opens through its keyboard handler.
      control.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
          cancelable: true,
        }),
      );
    },
  }));

  const grouped = options.length > 0 && "options" in options[0];
  const all = options.flatMap((option) =>
    "options" in option ? option.options : [option],
  );
  const retained = useRef<{
    label: string;
    option?: SingleSelectOption;
  }>({ label });
  const selected =
    all.find((option) => option.value === value) ??
    (retained.current.label === label &&
    retained.current.option?.value === value
      ? retained.current.option
      : undefined);
  useEffect(() => {
    retained.current = { label, option: selected };
  }, [label, selected]);
  const missing = value && !all.some((option) => option.value === value);
  const current: SingleSelectOption = {
    ...(selected ?? { value, label: "Unavailable selection" }),
    disabled: true,
  };
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
      data-empty={!value || selected?.empty ? "true" : "false"}
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
        block={block}
        align="start"
        dropdownIconType="chevronDown"
        listMinWidth={220}
        listMaxWidth={360}
        searchPlaceholder={searchPlaceholder}
        TriggerView={SelectedValue}
        OptionView={OptionView}
      />
    </div>
  );
}
