import { AlarmClock, Droplet } from "lucide-react";
import { cn } from "@/lib/utils";
import { CHECK_CODES, type CheckStatus } from "@/api/readiness";
import { CHECK_META, STATUS_DOT, STATUS_LABEL } from "@/components/readiness/check-meta";
import { getActivityColor, isCataloguedActivityType } from "@/lib/chart-colors";
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

// Worst first, matching how the chart escalates. "Healthy" is deliberately
// absent — a marker that appeared on every rig would stop meaning anything.

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
              {/* A type outside the catalogue renders in the reserved neutral
                  until an admin/developer assigns it a validated color — say so,
                  so the grey reads as "pending", not broken. */}
              {!isCataloguedActivityType(type) && (
                <span className="italic text-muted-foreground">(colour pending)</span>
              )}
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
              Contract expiration
            </span>
            <p className="text-[10px] text-muted-foreground">
              A clock badge on a rig&apos;s row marks its contract&apos;s expiration
              date, with a line at the date. It states the date — urgency alerts
              live on the Overview and Fleet pages.
            </p>
            <span className="flex items-center gap-1.5 text-xs text-foreground">
              {/* The key IS the mark: the same solid badge the chart draws. */}
              <span
                className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full"
                style={{ backgroundColor: URGENCY_VISUAL.expired.hex }}
              >
                <AlarmClock className="h-2.5 w-2.5 text-white" strokeWidth={2.5} />
              </span>
              <span className="font-medium">Expiration date</span>
            </span>
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
