"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as TogglePrimitive from "@radix-ui/react-toggle";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import type * as React from "react";
import {
	forwardRef,
	type ComponentPropsWithoutRef,
	type ElementRef,
	type HTMLAttributes,
} from "react";

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
	/** Makes the placeholder circular without introducing a separate token. */
	circular?: boolean;
}

export const Skeleton = forwardRef<HTMLDivElement, SkeletonProps>(
	({ circular = false, className, ...props }, ref) => (
		<div
			ref={ref}
			aria-hidden="true"
			className={clsx(
				"animate-pulse bg-app-selected",
				circular ? "rounded-full" : "rounded-md",
				className
			)}
			{...props}
		/>
	)
);
Skeleton.displayName = "Skeleton";

const toggleStyles = cva(
	"inline-flex items-center justify-center rounded-md border border-transparent px-2 py-1 text-sm text-ink-dull transition-colors duration-100 hover:bg-app-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50 data-[state=on]:border-app-line data-[state=on]:bg-app-selected data-[state=on]:text-ink",
	{
		variants: {
			variant: {
				default: "",
				outline: "border-app-line bg-app-box",
			},
			size: {
				sm: "h-7 px-2 text-xs",
				md: "h-9 px-3",
				lg: "h-11 px-4 text-base",
			},
		},
		defaultVariants: { variant: "default", size: "md" },
	}
);

export interface ToggleProps
	extends
		ComponentPropsWithoutRef<typeof TogglePrimitive.Root>,
		VariantProps<typeof toggleStyles> {}

export const Toggle = forwardRef<ElementRef<typeof TogglePrimitive.Root>, ToggleProps>(
	({ className, size, variant, ...props }, ref) => (
		<TogglePrimitive.Root
			ref={ref}
			className={clsx(toggleStyles({ size, variant }), className)}
			{...props}
		/>
	)
);
Toggle.displayName = "Toggle";

const ToggleGroupRootImpl = ToggleGroupPrimitive.Root as React.ComponentType<
	React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root>
>;

export const ToggleGroup = ({
	className,
	...props
}: React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root>) => (
	<ToggleGroupRootImpl
		className={clsx(
			"inline-flex items-center rounded-md border border-app-line bg-app-box p-0.5",
			className
		)}
		{...props}
	/>
);
ToggleGroup.displayName = "ToggleGroup";
export const ToggleGroupRoot = ToggleGroup;

export type ToggleGroupItemProps = ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item> &
	VariantProps<typeof toggleStyles>;

export const ToggleGroupItem = forwardRef<
	ElementRef<typeof ToggleGroupPrimitive.Item>,
	ToggleGroupItemProps
>(({ className, size, variant, ...props }, ref) => (
	<ToggleGroupPrimitive.Item
		ref={ref}
		className={clsx(toggleStyles({ size, variant }), className)}
		{...props}
	/>
));
ToggleGroupItem.displayName = "ToggleGroupItem";

export const TabsRoot = TabsPrimitive.Root;

export const TabsList = forwardRef<
	ElementRef<typeof TabsPrimitive.List>,
	ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
	<TabsPrimitive.List
		ref={ref}
		className={clsx("inline-flex items-center gap-1 border-b border-app-line", className)}
		{...props}
	/>
));
TabsList.displayName = "TabsList";

export const TabsTrigger = forwardRef<
	ElementRef<typeof TabsPrimitive.Trigger>,
	ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
	<TabsPrimitive.Trigger
		ref={ref}
		className={clsx(
			"border-b-2 border-transparent px-3 py-2 text-sm text-ink-dull transition-colors data-[state=active]:border-accent data-[state=active]:text-ink",
			className
		)}
		{...props}
	/>
));
TabsTrigger.displayName = "TabsTrigger";

export interface TabsContentProps extends ComponentPropsWithoutRef<typeof TabsPrimitive.Content> {
	/** Compatibility alias used by Inacord; Radix calls this `forceMount`. */
	keepMounted?: boolean;
}

export const TabsContent = forwardRef<ElementRef<typeof TabsPrimitive.Content>, TabsContentProps>(
	({ className, keepMounted, forceMount, ...props }, ref) => (
		<TabsPrimitive.Content
			ref={ref}
			{...(keepMounted || forceMount ? { forceMount: true as const } : {})}
			className={clsx("outline-none data-[state=inactive]:hidden", className)}
			{...props}
		/>
	)
);
TabsContent.displayName = "TabsContent";
