import Link from "next/link";
import { CoachFace } from "@/components/wiki/CoachFace";
import { ElementIcon } from "@/components/wiki/ElementIcon";
import { CoachDetail as SharedCoachDetail, type CoachDetailModel } from "@niers/inacord-ui/components/wiki/wiki/CoachDetail";
import type { Coach } from "@/lib/wiki/coaches";

export function CoachDetail({ coach }: { coach: Coach }) {
	return (
		<SharedCoachDetail
			coach={{
				internalCode: coach.internalCode,
				name: coach.name,
				nameKanji: coach.nameKanji,
				nameRomaji: coach.nameRomaji,
				roleLabel: coach.roleFr,
				playstyleLabel: coach.playstyleFr,
				elementKey: coach.elementKey,
				elementLabel: coach.elementFr,
				passiveNumber: coach.passiveNo,
				requirements: coach.requirements,
				stat: coach.stat,
				buff: coach.buff,
				scaling: coach.scaling,
			} satisfies CoachDetailModel}
			backLabel="Tous les entraîneurs"
			informationLabel="Informations"
			roleLabel="Rôle"
			playstyleLabel="Style de jeu"
			elementLabel="Élément"
			romajiLabel="Nom (romaji)"
			passiveNumberLabel="Passif n°"
			teamPassiveLabel="Passif d'équipe"
			conditionLabel="Condition"
			commonLabel="Commun"
			legendaryLabel="Légendaire"
			coordinatorLabel="Coordinateur"
			managerLabel="Manager"
			renderBackLink={(content) => (
				<Link
					href="/entraineur"
					className="inline-flex items-center gap-1.5 text-sm text-on-surface-variant transition-colors hover:text-primary"
				>
					{content}
				</Link>
			)}
			renderFace={({ internalCode, name }) => (
				<CoachFace internalCode={internalCode} alt={name} className="text-primary opacity-40" />
			)}
			renderElement={(element, size) => <ElementIcon element={element} size={size} />}
		/>
	);
}
