"use client";

import {
  Type,
  Hash,
  List,
  Tags,
  Calendar,
  CheckSquare,
  Link,
  CircleDot,
  Mail,
  Phone,
  Clock,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { PropertyType } from "@/extensions/database/database-types";
import { READONLY_PROPERTY_TYPES } from "@/extensions/database/database-types";

const PROPERTY_TYPE_ICONS: Record<PropertyType, React.ReactNode> = {
  text: <Type className="h-4 w-4" />,
  number: <Hash className="h-4 w-4" />,
  select: <List className="h-4 w-4" />,
  multi_select: <Tags className="h-4 w-4" />,
  status: <CircleDot className="h-4 w-4" />,
  date: <Calendar className="h-4 w-4" />,
  checkbox: <CheckSquare className="h-4 w-4" />,
  url: <Link className="h-4 w-4" />,
  email: <Mail className="h-4 w-4" />,
  phone: <Phone className="h-4 w-4" />,
  created_time: <Clock className="h-4 w-4" />,
  updated_time: <Clock className="h-4 w-4" />,
};

const BASIC_TYPES: PropertyType[] = ["text", "number", "checkbox", "url", "email", "phone"];

const ADVANCED_TYPES: PropertyType[] = [
  "select",
  "multi_select",
  "status",
  "date",
  "created_time",
  "updated_time",
];

interface PropertyTypePickerProps {
  value: PropertyType;
  onChange: (type: PropertyType) => void;
  showReadonly?: boolean;
}

export function PropertyTypePicker({
  value,
  onChange,
  showReadonly = true,
}: PropertyTypePickerProps) {
  const t = useTranslations("database");
  const renderGroup = (types: PropertyType[], label: string) => {
    const filtered = showReadonly
      ? types
      : types.filter((pt) => !READONLY_PROPERTY_TYPES.includes(pt));
    if (filtered.length === 0) return null;

    return (
      <div>
        <div className="text-ui-xs mb-1.5 px-1 font-semibold uppercase tracking-wider text-muted-foreground/60">
          {label}
        </div>
        <div className="grid grid-cols-2 gap-0.5">
          {filtered.map((type) => (
            <button
              key={type}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                value === type ? "bg-primary/10 text-primary" : "text-foreground hover:bg-accent"
              )}
              onClick={() => onChange(type)}
            >
              <span
                className={cn(
                  "shrink-0",
                  value === type ? "text-primary" : "text-muted-foreground"
                )}
              >
                {PROPERTY_TYPE_ICONS[type]}
              </span>
              <span className="truncate text-xs">{t(`propertyTypes.${type}`)}</span>
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {renderGroup(BASIC_TYPES, t("propertyGroups.basic"))}
      {renderGroup(ADVANCED_TYPES, t("propertyGroups.advanced"))}
    </div>
  );
}
