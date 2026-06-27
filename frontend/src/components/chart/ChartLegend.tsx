import { AlarmClock, Droplet } from "lucide-react";
import { cn } from "@/lib/utils";
import { CHECK_CODES, type CheckStatus } from "@/api/readiness";
import { CHECK_META, STATUS_DOT, STATUS_LABEL } from "@/components/readiness/check-meta";
import { getActivityColor } from "@/lib/chart-colors";
import { URGENCY_VISUAL } from "@/lib/contract-urgency";

const STATUSES: CheckStatus[] = ["On Track", "Behind", "Completed", "N/A"];

interface ChartLegendProps {
  activityTypes: string[];
  /**
   * When true (default), the Status + Checks sections render. Pass `false` to
   * omit them for charts that don't display readiness data.
   */
  showReadiness?: boolean;
  /**
   * When true, adds a Contract expiry section explaining the rig-level Y-axis
   * indicator colors. Off by default.
   */
  showContractExpiry?: boolean;
  /** When true, adds a Risk section explaining the flood-risk droplet marker. */
  showFloodRisk?: boolean;
  className?: string;
}

const EXPIRY_LEGEND_ORDER = ["expired"] as const;

function Section({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  /** Optional width cap so dense sections wrap into columns instead of one long row. */
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">{children}</div>
    </div>
  );
}

export function ChartLegend({
  activityTypes,
  showReadiness = true,
  showContractExpiry = false,
  showFloodRisk = false,
  className,
}: ChartLegendProps) {
  // Each tier gets a friendly name AND its numeric range so readers can connect
  // the colored dot to both the urgency vocabulary and an absolute timeframe.
  const expiryItems: Record<
    (typeof EXPIRY_LEGEND_ORDER)[number],
    { name: string; range: string }
  > = {
    expired: { name: "Expired", range: "end date passed" },
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border/70 bg-card/60 px-4 py-3 md:flex-row md:flex-wrap md:gap-x-8 md:gap-y-3",
        "print:break-inside-avoid",
        className,
      )}
    >
      <Section label="Activity types" className="md:max-w-xs">
        {activityTypes.length === 0 ? (
          <span className="text-xs italic text-muted-foreground">—</span>
        ) : (
          activityTypes.map((type) => (
            <span key={type} className="flex items-center gap-1.5 text-xs text-foreground">
              <span
                className="inline-block h-3 w-3 shrink-0 rounded-[3px] ring-1 ring-inset ring-black/10 dark:ring-white/10"
                style={{ backgroundColor: getActivityColor(type) }}
              />
              {type}
            </span>
          ))
        )}
      </Section>

      {showReadiness && (
        <>
          <Section label="Readiness" className="md:max-w-sm">
            {CHECK_CODES.map((code) => {
              const meta = CHECK_META[code];
              const Icon = meta.icon;
              return (
                <span
                  key={code}
                  className="flex items-center gap-1.5 text-xs text-foreground"
                  title={meta.label}
                >
                  <Icon
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                    strokeWidth={2}
                  />
                  <span className="font-medium">{code}</span>
                  <span className="text-muted-foreground">{meta.label}</span>
                </span>
              );
            })}
          </Section>

          <Section label="Status" className="md:max-w-[10rem]">
            {STATUSES.map((s) => (
              <span key={s} className="flex items-center gap-1.5 text-xs text-foreground">
                <span className={cn("h-2.5 w-2.5 rounded-full", STATUS_DOT[s])} />
                {STATUS_LABEL[s]}
              </span>
            ))}
          </Section>
        </>
      )}

      {showContractExpiry && (
        <>
          <div className="flex min-w-0 flex-col gap-1.5 md:max-w-[13rem]">
            <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <AlarmClock className="h-3 w-3" strokeWidth={2.25} />
              Contract expiry
            </span>
            <p className="text-[10px] text-muted-foreground">
              A red clock marks a rig or HWU whose contract has already expired.
            </p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {EXPIRY_LEGEND_ORDER.map((key) => (
                <span
                  key={key}
                  className="flex items-center gap-1.5 text-xs text-foreground"
                >
                  <span
                    className={cn(
                      "h-2.5 w-2.5 rounded-full",
                      URGENCY_VISUAL[key].dotClass,
                    )}
                  />
                  <span className="font-medium">{expiryItems[key].name}</span>
                  <span className="text-muted-foreground">
                    ({expiryItems[key].range})
                  </span>
                </span>
              ))}
            </div>
          </div>
        </>
      )}

      {showFloodRisk && (
        <>
          <Section label="Risk">
            <span className="flex items-center gap-1.5 text-xs text-foreground">
              <Droplet
                className="h-3.5 w-3.5 shrink-0"
                style={{ color: "#2563eb" }}
                fill="#2563eb"
                strokeWidth={1.5}
              />
              Flood risk
            </span>
          </Section>
        </>
      )}
    </div>
  );
}
