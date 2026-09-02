import Link from "next/link";
import * as React from "react";
import { cn } from "../lib/utils";

interface AdminPageHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
	title: string;
	subtitle?: string;
	description?: string;
	actions?: React.ReactNode;
	icon?: React.ReactNode;
	breadcrumbs?: { label: string; href?: string }[];
}

/**
 * Shared Header for Admin/Dashboard pages.
 */
export function AdminPageHeader({
	title,
	subtitle,
	description,
	actions,
	icon,
	breadcrumbs,
	className,
	children,
	...props
}: AdminPageHeaderProps) {
	return (
		<div className={cn("flex flex-col gap-4 border-b border-border pb-6", className)} {...props}>
			{breadcrumbs && breadcrumbs.length > 0 && (
				<nav className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
					{breadcrumbs.map((crumb, i) => (
						<React.Fragment key={i}>
							{crumb.href ? (
								<Link href={crumb.href} className="hover:text-foreground transition-colors">
									{crumb.label}
								</Link>
							) : (
								<span className="font-medium text-foreground">{crumb.label}</span>
							)}
							{i < breadcrumbs.length - 1 && <span>/</span>}
						</React.Fragment>
					))}
				</nav>
			)}

			<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div className="flex items-start gap-3">
					{icon && (
						<div className="mt-1 flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary/10 text-primary [&>svg]:size-5">
							{icon}
						</div>
					)}
					<div className="space-y-1">
						<h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
							{title}
						</h1>
						{(subtitle || description) && (
							<p className="text-sm text-muted-foreground">{subtitle || description}</p>
						)}
						{children}
					</div>
				</div>
				{actions && (
					<div className="flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div>
				)}
			</div>
		</div>
	);
}
