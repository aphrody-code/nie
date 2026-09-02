"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import type * as React from "react";

import { X } from "lucide-react";
import { cn } from "../lib/utils";

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
	return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
	return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
	return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
	return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
	className,
	...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
	return (
		<DialogPrimitive.Overlay
			data-slot="dialog-overlay"
			className={cn(
				"fixed inset-0 z-50 bg-black/80 motion-safe:data-[state=open]:animate-in motion-safe:data-[state=closed]:animate-out motion-safe:data-[state=closed]:fade-out-0 motion-safe:data-[state=open]:fade-in-0 starting:opacity-0",
				className
			)}
			{...props}
		/>
	);
}

function DialogContent({
	className,
	children,
	showCloseButton = true,
	...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
	showCloseButton?: boolean;
}) {
	return (
		<DialogPortal>
			<DialogOverlay />
			<DialogPrimitive.Content
				data-slot="dialog-content"
				className={cn(
					"@container/dialog fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg motion-safe:duration-200 motion-safe:data-[state=open]:animate-in motion-safe:data-[state=closed]:animate-out motion-safe:data-[state=closed]:fade-out-0 motion-safe:data-[state=open]:fade-in-0 motion-safe:data-[state=closed]:zoom-out-95 motion-safe:data-[state=open]:zoom-in-95 motion-safe:data-[state=closed]:slide-out-to-left-1/2 motion-safe:data-[state=closed]:slide-out-to-top-[48%] motion-safe:data-[state=open]:slide-in-from-left-1/2 motion-safe:data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
					className
				)}
				{...props}
			>
				{children}
				{showCloseButton && (
					<DialogPrimitive.Close className="absolute end-4 top-4 rounded-sm opacity-70 motion-safe:transition-opacity hover:opacity-100 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-hidden disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
						<X className="size-4" />
						<span className="sr-only">Close</span>
					</DialogPrimitive.Close>
				)}
			</DialogPrimitive.Content>
		</DialogPortal>
	);
}

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
	return (
		<div
			data-slot="dialog-header"
			className={cn(
				"flex flex-col space-y-1.5 text-center sm:text-left @md/dialog:flex-row @md/dialog:items-start @md/dialog:gap-4 @md/dialog:space-y-0",
				className
			)}
			{...props}
		/>
	);
}

function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
	return (
		<div
			data-slot="dialog-footer"
			className={cn(
				"flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 @md/dialog:flex-row @md/dialog:justify-end @md/dialog:space-x-2",
				className
			)}
			{...props}
		/>
	);
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
	return (
		<DialogPrimitive.Title
			data-slot="dialog-title"
			className={cn("text-lg font-semibold leading-none tracking-tight", className)}
			{...props}
		/>
	);
}

function DialogDescription({
	className,
	...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
	return (
		<DialogPrimitive.Description
			data-slot="dialog-description"
			className={cn("text-sm text-muted-foreground", className)}
			{...props}
		/>
	);
}

export {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogOverlay,
	DialogPortal,
	DialogTitle,
	DialogTrigger,
};
