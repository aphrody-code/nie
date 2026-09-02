"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useCallback, useMemo, useState } from "react";
import type { JSX } from "react";

import { X } from "@/lib/icons-config";
import { cn } from "@/lib/utils";

/**
 * Editor modal hook that renders Dialogs above the editor's z-[100] wrapper.
 * Uses Radix primitives directly to control z-index (z-[150]) instead of
 * the shadcn DialogContent which is hardcoded to z-50.
 */
export function useEditorModal(): [
	JSX.Element | null,
	(title: string, showModal: (onClose: () => void) => JSX.Element) => void,
] {
	const [modalContent, setModalContent] = useState<null | {
		closeOnClickOutside: boolean;
		content: JSX.Element;
		title: string;
	}>(null);

	const onClose = useCallback(() => {
		setModalContent(null);
	}, []);

	const modal = useMemo(() => {
		if (modalContent === null) {
			return null;
		}
		const { title, content } = modalContent;
		return (
			<DialogPrimitive.Root open onOpenChange={onClose}>
				<DialogPrimitive.Portal>
					<DialogPrimitive.Overlay className="fixed inset-0 z-[150] bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
					<DialogPrimitive.Content
						aria-describedby={undefined}
						className={cn(
							"fixed left-[50%] top-[50%] z-[150] grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200",
							"data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
							"data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
							"data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]",
							"data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]",
							"sm:rounded-lg"
						)}
					>
						<div className="flex flex-col space-y-1.5 text-center sm:text-left">
							<DialogPrimitive.Title className="text-lg font-semibold leading-none tracking-tight">
								{title}
							</DialogPrimitive.Title>
						</div>
						{content}
						<DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
							<X className="size-4" />
							<span className="sr-only">Close</span>
						</DialogPrimitive.Close>
					</DialogPrimitive.Content>
				</DialogPrimitive.Portal>
			</DialogPrimitive.Root>
		);
	}, [modalContent, onClose]);

	const showModal = useCallback(
		(
			title: string,
			getContent: (onClose: () => void) => JSX.Element,
			closeOnClickOutside = false
		) => {
			setModalContent({
				closeOnClickOutside,
				content: getContent(onClose),
				title,
			});
		},
		[onClose]
	);

	return [modal, showModal];
}
