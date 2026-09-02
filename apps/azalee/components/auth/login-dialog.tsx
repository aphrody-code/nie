"use client";

import { LogIn } from "lucide-react";
import { useState } from "react";
import { LoginForm } from "@/components/auth/login-form";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@rosegriffon/ui";

export function LoginDialog({ children }: { children: React.ReactNode }) {
	const [open, setOpen] = useState(false);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>{children}</DialogTrigger>
			<DialogContent className="sm:max-w-[420px] bg-surface p-8 rounded-[32px] gap-8 border-none shadow-2xl">
				<DialogHeader className="gap-3 text-center">
					<div className="mx-auto size-14 rounded-2xl bg-primary-container flex items-center justify-center mb-2 shadow-inner">
						<LogIn size={28} className="text-primary" aria-hidden="true" />
					</div>
					<DialogTitle className="font-sans text-3xl font-black italic tracking-tighter text-on-surface">
						AZALÉE <span className="text-primary">LOGIN</span>
					</DialogTitle>
					<DialogDescription className="text-on-surface-variant text-base font-medium">
						Accédez à l&apos;actualité exclusive de Victory Road.
					</DialogDescription>
				</DialogHeader>

				<LoginForm
					onSuccess={() => {
						/* Optional: close dialog on magic link sent? */
					}}
				/>
			</DialogContent>
		</Dialog>
	);
}
