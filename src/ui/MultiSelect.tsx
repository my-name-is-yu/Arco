import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { Select } from "@openai/apps-sdk-ui/components/Select";
import { SelectOptionVisual } from "./SelectOptionVisual";

export interface MultiSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  color?: string;
  leading?: ReactNode;
}

const PlaceholderLeading = createContext<ReactNode>(undefined);

function SelectedValues({ values }: { values: MultiSelectOption[] }) {
  const placeholderLeading = useContext(PlaceholderLeading);
  return (
    <span
      className="source-multi-values source-selected-values"
      title={values.map((option) => option.label).join(", ")}
    >
      {values.map((option, index) => (
        <span
          className="source-selected-value source-select-content"
          key={option.value}
        >
          <SelectOptionVisual
            leading={option.leading ?? placeholderLeading}
            color={option.color}
          />
          <span className="source-select-text">
            {option.label}
            {index < values.length - 1 ? ", " : ""}
          </span>
        </span>
      ))}
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
      <SelectOptionVisual
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

function OptionView({ label, color, leading }: MultiSelectOption) {
  return (
    <span className="source-multi-option">
      <SelectOptionVisual leading={leading} color={color} />
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
  const retained = useRef<{
    label: string;
    options: Map<string, MultiSelectOption>;
  }>({ label, options: new Map() });
  const selected = useMemo(
    () =>
      new Map(
        value.flatMap((selected) => {
          const option =
            options.find((option) => option.value === selected) ??
            (retained.current.label === label
              ? retained.current.options.get(selected)
              : undefined);
          return option ? [[selected, option] as const] : [];
        }),
      ),
    [label, options, value],
  );
  useEffect(() => {
    retained.current = { label, options: selected };
  }, [label, selected]);
  const choices = [
    ...options,
    ...value
      .filter((selected) => !available.has(selected))
      .map((value) => ({
        ...(selected.get(value) ?? {
          value,
          label: "Unavailable selection",
        }),
        disabled: true,
      })),
  ];
  return (
    <div
      className="source-multi-select"
      role="group"
      aria-label={label}
      data-empty={value.length === 0 ? "true" : "false"}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        const group = event.currentTarget;
        requestAnimationFrame(() =>
          group.querySelector<HTMLElement>('[role="button"]')?.focus(),
        );
      }}
    >
      <PlaceholderLeading
        value={!value.length ? placeholderLeading : undefined}
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
