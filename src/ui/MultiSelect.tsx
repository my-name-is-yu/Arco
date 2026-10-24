import { createContext, useContext, type ReactNode } from "react";
import { Select } from "@openai/apps-sdk-ui/components/Select";

export interface MultiSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  color?: string;
  leading?: ReactNode;
}

const PlaceholderLeading = createContext<ReactNode>(undefined);

function SelectedValues({ values }: { values: MultiSelectOption[] }) {
  return (
    <span className="source-multi-values">
      {values.map((option) => option.label).join(", ")}
    </span>
  );
}

function CompactSelectedValues({ values }: { values: MultiSelectOption[] }) {
  const placeholderLeading = useContext(PlaceholderLeading);
  const first = values[0];
  return (
    <span
      className="source-multi-values source-select-content"
      title={values.map((value) => value.label).join(", ")}
    >
      <OptionLeading
        leading={first?.leading ?? placeholderLeading}
        color={first?.color}
      />
      <span className="source-select-text">
        {first?.label}
        {values.length > 1 ? ` +${values.length - 1}` : ""}
      </span>
    </span>
  );
}

function OptionLeading({
  leading,
  color,
}: Pick<MultiSelectOption, "leading" | "color">) {
  const hex = color?.replace(/^#/, "");
  const decoration =
    leading ??
    (hex && /^[\da-f]{6}$/i.test(hex) ? (
      <span
        className="source-multi-dot"
        style={{ backgroundColor: `#${hex}` }}
      />
    ) : null);
  return decoration != null ? (
    <span className="source-select-leading" aria-hidden="true">
      {decoration}
    </span>
  ) : null;
}

function OptionView({ label, color, leading }: MultiSelectOption) {
  return (
    <span className="source-multi-option">
      <OptionLeading leading={leading} color={color} />
      <span className="source-select-text">{label}</span>
    </span>
  );
}

export function MultiSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
  loading = false,
  placeholder = "None",
  placeholderLeading,
  compact = false,
}: {
  label: string;
  value: string[];
  options: MultiSelectOption[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
  loading?: boolean;
  placeholder?: string;
  placeholderLeading?: ReactNode;
  compact?: boolean;
}) {
  const available = new Set(options.map((option) => option.value));
  const choices = [
    ...options,
    ...value
      .filter((selected) => !available.has(selected))
      .map((selected) => ({
        value: selected,
        label: selected,
        disabled: true,
      })),
  ];
  return (
    <div
      className="source-multi-select"
      role="group"
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        const group = event.currentTarget;
        requestAnimationFrame(() =>
          group.querySelector<HTMLElement>('[role="button"]')?.focus(),
        );
      }}
    >
      <PlaceholderLeading
        value={compact && !value.length ? placeholderLeading : undefined}
      >
        <Select
          multiple
          value={value}
          options={
            disabled
              ? choices.map((option) => ({ ...option, disabled: true }))
              : choices
          }
          onChange={(selected) =>
            onChange(selected.map((option) => option.value))
          }
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
          TriggerView={compact ? CompactSelectedValues : SelectedValues}
          OptionView={OptionView}
        />
      </PlaceholderLeading>
    </div>
  );
}
