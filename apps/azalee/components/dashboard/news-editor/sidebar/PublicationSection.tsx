"use client";

import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { useState } from "react";
import {
	Button,
	Calendar,
	Input,
	Popover,
	PopoverContent,
	PopoverTrigger,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@rosegriffon/ui";
import { CalendarClock } from "@/lib/icons-config";
import { cn } from "@/lib/utils";
import { CATEGORIES, STATUS_OPTIONS } from "../constants";

interface PublicationSectionProps {
	status: string;
	category: string;
	scheduledAt: string;
	onStatusChange: (value: string) => void;
	onCategoryChange: (value: string) => void;
	onScheduledAtChange: (value: string) => void;
}

function parseScheduled(value: string): {
	date: Date | undefined;
	time: string;
} {
	if (!value) {
		return { date: undefined, time: "09:00" };
	}
	const d = new Date(value);
	if (Number.isNaN(d.getTime())) {
		return { date: undefined, time: "09:00" };
	}
	const hh = String(d.getHours()).padStart(2, "0");
	const mm = String(d.getMinutes()).padStart(2, "0");
	return { date: d, time: `${hh}:${mm}` };
}

function combineDateTime(date: Date | undefined, time: string): string {
	if (!date) {
		return "";
	}
	const [hh, mm] = time.split(":").map((s) => Number.parseInt(s, 10) || 0);
	const d = new Date(date);
	d.setHours(hh, mm, 0, 0);
	const off = d.getTimezoneOffset();
	const local = new Date(d.getTime() - off * 60 * 1000);
	return local.toISOString().slice(0, 16);
}

export function PublicationSection({
	status,
	category,
	scheduledAt,
	onStatusChange,
	onCategoryChange,
	onScheduledAtChange,
}: PublicationSectionProps) {
	const { date, time } = parseScheduled(scheduledAt);
	const [calendarOpen, setCalendarOpen] = useState(false);
	const now = new Date();
	const minDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());

	const handleDateSelect = (next: Date | undefined) => {
		onScheduledAtChange(combineDateTime(next, time));
		setCalendarOpen(false);
	};

	const handleTimeChange = (nextTime: string) => {
		onScheduledAtChange(combineDateTime(date ?? new Date(), nextTime));
	};

	return (
		<div className="flex flex-col gap-4">
			{/* Status */}
			<div className="flex flex-col gap-2">
				<label
					htmlFor="article-status"
					id="article-status-label"
					className="font-bold text-[11px] text-muted-foreground uppercase tracking-wider"
				>
					Statut
				</label>
				<Select value={status} onValueChange={onStatusChange}>
					<SelectTrigger
						id="article-status"
						className="h-10 w-full rounded-xl border-none bg-surface-container-high"
						aria-labelledby="article-status-label"
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{STATUS_OPTIONS.map((opt) => (
							<SelectItem key={opt.value} value={opt.value}>
								<div className="flex items-center gap-2">
									<div className={cn("size-2 rounded-full", opt.color)} aria-hidden="true" />
									{opt.label}
								</div>
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{/* Scheduled date picker (Calendar + time) */}
			{status === "scheduled" && (
				<div className="flex flex-col gap-2">
					<span
						id="article-scheduled-at-label"
						className="flex items-center gap-1.5 font-bold text-[11px] text-muted-foreground uppercase tracking-wider"
					>
						<CalendarClock className="size-3.5" />
						Date de publication
					</span>

					<div className="flex gap-2">
						<Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
							<PopoverTrigger asChild>
								<Button
									type="button"
									variant="outline"
									aria-labelledby="article-scheduled-at-label"
									className={cn(
										"h-10 flex-1 justify-start rounded-xl border-none bg-surface-container-high font-normal text-xs",
										!date && "text-muted-foreground"
									)}
								>
									<CalendarClock className="mr-2 size-3.5 opacity-70" />
									{date ? format(date, "EEEE d MMMM yyyy", { locale: fr }) : "Choisir une date"}
								</Button>
							</PopoverTrigger>
							<PopoverContent className="w-auto p-0" align="start">
								<Calendar
									mode="single"
									selected={date}
									onSelect={handleDateSelect}
									disabled={{ before: minDate }}
									captionLayout="dropdown"
									locale={fr}
								/>
							</PopoverContent>
						</Popover>

						<Input
							id="article-scheduled-time"
							type="time"
							aria-label="Heure de publication"
							value={time}
							onChange={(e) => handleTimeChange(e.target.value)}
							className="h-10 w-24 rounded-xl border-none bg-surface-container-high text-xs"
						/>
					</div>

					{!scheduledAt && (
						<p className="text-[10px] text-destructive">
							Veuillez choisir une date de publication.
						</p>
					)}
					{scheduledAt && date && (
						<p className="text-[10px] text-blue-500">
							Sera publié le{" "}
							{format(new Date(scheduledAt), "EEEE d MMMM yyyy 'à' HH:mm", {
								locale: fr,
							})}
						</p>
					)}
				</div>
			)}

			{/* Category */}
			<div className="flex flex-col gap-2">
				<label
					htmlFor="article-category"
					id="article-category-label"
					className="font-bold text-[11px] text-muted-foreground uppercase tracking-wider"
				>
					Catégorie
				</label>
				<Select value={category} onValueChange={onCategoryChange}>
					<SelectTrigger
						id="article-category"
						className="h-10 w-full rounded-xl border-none bg-surface-container-high"
						aria-labelledby="article-category-label"
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{CATEGORIES.map((cat) => (
							<SelectItem key={cat.value} value={cat.value}>
								<div className="flex items-center gap-2">
									<div className={cn("size-2.5 rounded-full", cat.color)} aria-hidden="true" />
									{cat.label}
								</div>
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
		</div>
	);
}
