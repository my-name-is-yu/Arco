import { Select } from "@openai/apps-sdk-ui/components/Select";

export interface MultiSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  color?: string;
}

function SelectedValues({ values }: { values: MultiSelectOption[] }) {
  return (
    <span className="source-multi-values">
      {values.map((option) => option.label).join(", ")}
    </span>
  );
}

function OptionView({ label, color }: MultiSelectOption) {
  const hex = color?.replace(/^#/, "");
  return (
    <span className="source-multi-option">
      {hex && /^[\da-f]{6}$/i.test(hex) && (
        <span
          className="source-multi-dot"
          style={{ backgroundColor: `#${hex}` }}
          aria-hidden="true"
        />
      )}
      {label}
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
}: {
  label: string;
  value: string[];
  options: MultiSelectOption[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
  loading?: boolean;
  placeholder?: string;
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
        TriggerView={SelectedValues}
        OptionView={OptionView}
      />
    </div>
  );
}
