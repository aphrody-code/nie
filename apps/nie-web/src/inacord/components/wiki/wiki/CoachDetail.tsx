import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

export interface CoachScaling {
  coordCommon?: string | null;
  coordLegendary?: string | null;
  managerCommon?: string | null;
  managerLegendary?: string | null;
}

/** Host-neutral data required to render a coach profile. */
export interface CoachDetailModel {
  internalCode?: string | null;
  name: string;
  nameKanji?: string | null;
  nameRomaji?: string | null;
  roleLabel: string;
  playstyleLabel?: string | null;
  elementKey?: string | null;
  elementLabel?: string | null;
  passiveNumber?: number | null;
  requirements?: string | null;
  stat?: string | null;
  buff?: string | null;
  scaling?: CoachScaling | null;
}

export interface CoachDetailProps {
  coach: CoachDetailModel;
  backLabel: string;
  informationLabel: string;
  roleLabel: string;
  playstyleLabel: string;
  elementLabel: string;
  romajiLabel: string;
  passiveNumberLabel: string;
  teamPassiveLabel: string;
  conditionLabel: string;
  commonLabel: string;
  legendaryLabel: string;
  coordinatorLabel: string;
  managerLabel: string;
  renderBackLink: (content: ReactNode) => ReactNode;
  renderFace: (coach: Pick<CoachDetailModel, "internalCode" | "name">) => ReactNode;
  renderElement?: (element: string, size: "sm" | "md") => ReactNode;
}

interface InfoRowProps {
  label: string;
  value: ReactNode;
}

function InfoRow({ label, value }: InfoRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-outline-variant/20 py-2 last:border-b-0">
      <span className="text-sm text-on-surface-variant">{label}</span>
      <span className="text-right text-sm font-semibold text-on-surface">{value}</span>
    </div>
  );
}

/**
 * Shared coach-profile presentation. Hosts retain route navigation, localized data,
 * portrait decoding, and element-art resolution through the render callbacks.
 */
export function CoachDetail({
  coach,
  backLabel,
  informationLabel,
  roleLabel,
  playstyleLabel,
  elementLabel,
  romajiLabel,
  passiveNumberLabel,
  teamPassiveLabel,
  conditionLabel,
  commonLabel,
  legendaryLabel,
  coordinatorLabel,
  managerLabel,
  renderBackLink,
  renderFace,
  renderElement,
}: CoachDetailProps) {
  const { scaling } = coach;
  const hasScaling = Boolean(
    scaling &&
      (scaling.coordCommon ||
        scaling.coordLegendary ||
        scaling.managerCommon ||
        scaling.managerLegendary),
  );

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      {renderBackLink(
        <>
          <ArrowLeft size={16} aria-hidden="true" />
          {backLabel}
        </>,
      )}

      <div className="flex flex-col gap-4 rounded-3xl border border-outline-variant/30 bg-surface-container-low p-5 sm:flex-row sm:items-center">
        <div className="relative flex aspect-square w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-surface-container-high">
          {renderFace(coach)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-primary-container px-2.5 py-0.5 text-xs font-bold text-on-primary-container">
              {coach.roleLabel}
            </span>
            {coach.elementKey && renderElement ? renderElement(coach.elementKey, "md") : null}
          </div>
          <h1 className="mt-2 font-display text-2xl font-extrabold leading-tight text-on-surface">{coach.name}</h1>
          {coach.nameKanji && coach.nameKanji !== coach.name ? (
            <p className="text-sm text-on-surface-variant">
              {coach.nameKanji}
              {coach.nameRomaji ? ` · ${coach.nameRomaji}` : ""}
            </p>
          ) : null}
        </div>
      </div>

      <section className="rounded-3xl border border-outline-variant/30 bg-surface-container-low p-5">
        <h2 className="mb-3 text-lg font-bold text-on-surface">{informationLabel}</h2>
        <div className="flex flex-col">
          <InfoRow label={roleLabel} value={coach.roleLabel} />
          {coach.playstyleLabel ? <InfoRow label={playstyleLabel} value={coach.playstyleLabel} /> : null}
          {coach.elementLabel ? (
            <InfoRow
              label={elementLabel}
              value={
                <span className="inline-flex items-center gap-1.5">
                  {coach.elementKey && renderElement ? renderElement(coach.elementKey, "sm") : null}
                  {coach.elementLabel}
                </span>
              }
            />
          ) : null}
          {coach.nameRomaji ? <InfoRow label={romajiLabel} value={coach.nameRomaji} /> : null}
          {coach.passiveNumber != null ? <InfoRow label={passiveNumberLabel} value={coach.passiveNumber} /> : null}
        </div>
      </section>

      {coach.stat || coach.requirements ? (
        <section className="rounded-3xl border border-outline-variant/30 bg-surface-container-low p-5">
          <h2 className="mb-3 text-lg font-bold text-on-surface">{teamPassiveLabel}</h2>
          {coach.requirements ? (
            <p className="mb-3 text-sm text-on-surface-variant">
              <span className="font-semibold text-on-surface">{conditionLabel}: </span>
              {coach.requirements}
            </p>
          ) : null}
          {coach.stat ? (
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-surface-container-high p-4">
              <span className="font-semibold text-on-surface">{coach.stat}</span>
              {coach.buff ? (
                <span className="rounded-full bg-primary px-3 py-1 text-sm font-bold text-on-primary">{coach.buff}</span>
              ) : null}
            </div>
          ) : null}

          {hasScaling && scaling ? (
            <div className="mt-4 overflow-hidden rounded-2xl border border-outline-variant/20">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[18rem] text-sm">
                  <thead>
                    <tr className="bg-surface-container-high text-on-surface-variant">
                      <th className="px-3 py-2 text-left font-semibold">{roleLabel}</th>
                      <th className="px-3 py-2 text-right font-semibold">{commonLabel}</th>
                      <th className="px-3 py-2 text-right font-semibold">{legendaryLabel}</th>
                    </tr>
                  </thead>
                  <tbody className="text-on-surface">
                    <tr className="border-t border-outline-variant/20">
                      <td className="px-3 py-2 font-medium">{coordinatorLabel}</td>
                      <td className="px-3 py-2 text-right">{scaling.coordCommon ?? "—"}</td>
                      <td className="px-3 py-2 text-right">{scaling.coordLegendary ?? "—"}</td>
                    </tr>
                    <tr className="border-t border-outline-variant/20">
                      <td className="px-3 py-2 font-medium">{managerLabel}</td>
                      <td className="px-3 py-2 text-right">{scaling.managerCommon ?? "—"}</td>
                      <td className="px-3 py-2 text-right">{scaling.managerLegendary ?? "—"}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
