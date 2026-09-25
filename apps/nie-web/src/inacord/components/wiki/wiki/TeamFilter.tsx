"use client";

import * as React from "react";

import { cn } from "../../../lib/utils";
import { Button } from "../../ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "../../ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover";

export interface TeamOption {
	id: string;
	name: string;
}

export interface TeamFilterLabels {
	placeholder: string;
	searchPlaceholder: string;
	empty: string;
}

export interface TeamFilterProps {
	teams: readonly TeamOption[];
	selectedTeamId: string | null;
	onToggle: (teamId: string) => void;
	isPending?: boolean;
	labels: TeamFilterLabels;
}

/**
 * Controlled team-filter presentation shared by every host. The host owns
 * routing, query persistence and translations; this component only owns the
 * searchable selection control and its transient open state.
 */
export function TeamFilter({
	teams,
	selectedTeamId,
	onToggle,
	isPending = false,
	labels,
}: TeamFilterProps) {
	const [open, setOpen] = React.useState(false);
	const selectedTeam = teams.find((team) => team.id === selectedTeamId);

	const selectTeam = (teamId: string) => {
		setOpen(false);
		onToggle(teamId);
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				render={
					<Button
						variant="outline"
						role="combobox"
						aria-expanded={open}
						disabled={isPending}
						className={cn(
							"w-full justify-between bg-surface text-on-surface hover:bg-surface-container",
							isPending && "pointer-events-none opacity-70",
						)}
					>
						{selectedTeam?.name ?? labels.placeholder}
					</Button>
				}
			/>
			<PopoverContent className="w-[calc(100vw-2rem)] p-0 sm:w-[300px]" align="start">
				<Command>
					<CommandInput placeholder={labels.searchPlaceholder} />
					<CommandList>
						<CommandEmpty>{labels.empty}</CommandEmpty>
						<CommandGroup className="max-h-[300px] overflow-y-auto">
							{teams.map((team) => (
								<CommandItem
									key={team.id}
									value={team.name}
									onSelect={() => selectTeam(team.id)}
									className={cn(
										selectedTeamId === team.id && "bg-surface-container-highest font-medium",
									)}
								>
									<span className="truncate">{team.name}</span>
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
