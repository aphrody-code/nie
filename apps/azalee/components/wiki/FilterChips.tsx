"use client";

import Image from "next/image";
import { FilterChipGroup } from "@niers/inacord-ui";
import { CommonSpriteIcon } from "@/components/ui/CommonSpriteIcon";
import { Icon } from "@/components/ui/Icon";
import type { SpriteCommonKey } from "@/config/sprites-common";
import { useFilterNavigation } from "@/lib/hooks/use-filter-navigation";

export interface FilterOption {
	label: string;
	value: string;
	icon?: string;
	imageIcon?: string;
	commonSprite?: string;
}

export interface FilterChipsProps {
	paramName: string;
	options: FilterOption[];
	className?: string;
	hideLabel?: boolean;
}

export function FilterChips({ paramName, options, className, hideLabel }: FilterChipsProps) {
	const { isPending, navigate, searchParams } = useFilterNavigation();
	const currentValue = searchParams.get(paramName);

	const toggleFilter = (value: string) => {
		navigate((params) => {
			if (params.get(paramName) === value) {
				params.delete(paramName);
			} else {
				params.set(paramName, value);
			}
		});
	};

	return (
		<FilterChipGroup
			options={options}
			selectedValue={currentValue}
			onToggle={toggleFilter}
			isPending={isPending}
			className={className}
			hideLabel={hideLabel}
			renderIcon={(option, imageOnly) =>
				option.imageIcon ? (
					<div className={imageOnly ? "relative size-10" : "relative size-6"}>
						<Image src={option.imageIcon} fill alt={option.label} sizes={imageOnly ? "40px" : "24px"} className="object-contain" />
					</div>
				) : option.commonSprite ? (
					<CommonSpriteIcon name={option.commonSprite as SpriteCommonKey} scale={imageOnly ? 0.6 : 0.4} />
				) : option.icon ? (
					<Icon name={option.icon} size={imageOnly ? 28 : 20} />
				) : null
			}
		/>
	);
}
