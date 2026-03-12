"use client";

import type {
  PropertyDef,
  CellValue,
  SelectChoice,
  DatabaseRow,
} from "@/extensions/database/database-types";
import { TextCell } from "../cells/text-cell";
import { NumberCell } from "../cells/number-cell";
import { SelectCell } from "../cells/select-cell";
import { StatusCell } from "../cells/status-cell";
import { DateCell } from "../cells/date-cell";
import { CheckboxCell } from "../cells/checkbox-cell";
import { UrlCell } from "../cells/url-cell";
import { EmailCell } from "../cells/email-cell";
import { PhoneCell } from "../cells/phone-cell";
import { TimestampCell } from "../cells/timestamp-cell";

interface TableCellProps {
  property: PropertyDef;
  value: CellValue;
  onChange: (value: CellValue) => void;
  onChoicesChange?: (choices: SelectChoice[]) => void;
  autoFocus?: boolean;
  row?: DatabaseRow;
}

export function TableCell({
  property,
  value,
  onChange,
  onChoicesChange,
  autoFocus,
  row,
}: TableCellProps) {
  switch (property.type) {
    case "text":
      return <TextCell value={(value as string) ?? ""} onChange={onChange} autoFocus={autoFocus} />;
    case "number":
      return <NumberCell value={value as number | null} onChange={onChange} />;
    case "select":
      return (
        <SelectCell
          value={value as string | null}
          choices={property.options?.choices ?? []}
          onChange={onChange}
          onChoicesChange={onChoicesChange}
        />
      );
    case "multi_select":
      return (
        <SelectCell
          value={value as string[] | null}
          choices={property.options?.choices ?? []}
          multiSelect
          onChange={onChange}
          onChoicesChange={onChoicesChange}
        />
      );
    case "status":
      return (
        <StatusCell
          value={value as string | null}
          choices={property.options?.choices ?? []}
          categories={property.options?.statusCategories}
          onChange={onChange}
          onChoicesChange={onChoicesChange}
        />
      );
    case "date":
      return <DateCell value={value as string | null} onChange={onChange} />;
    case "checkbox":
      return <CheckboxCell value={!!value} onChange={onChange} />;
    case "url":
      return <UrlCell value={(value as string) ?? ""} onChange={onChange} />;
    case "email":
      return <EmailCell value={(value as string) ?? ""} onChange={onChange} />;
    case "phone":
      return <PhoneCell value={(value as string) ?? ""} onChange={onChange} />;
    case "created_time":
      return <TimestampCell timestamp={row?.created_at ?? null} />;
    case "updated_time":
      return <TimestampCell timestamp={row?.updated_at ?? null} />;
    default:
      return <div className="px-2 py-1 text-sm text-muted-foreground">{String(value ?? "")}</div>;
  }
}
